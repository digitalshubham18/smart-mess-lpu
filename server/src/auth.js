import jwt from 'jsonwebtoken'
import { randomUUID, randomBytes, createHmac, timingSafeEqual } from 'node:crypto'
import { twoFactorRequiredFor } from './policy.js'
import { db, resolveActorName } from './db.js'

// TODO(production): move this to a real secret manager / environment variable set at
// deploy time, and rotate it. A hardcoded fallback is fine for local/demo use only.
const DEV_SECRET = 'lpu-smart-mess-dev-secret-change-me'
const JWT_SECRET = process.env.JWT_SECRET || DEV_SECRET

/**
 * Refuses to boot a production server with a guessable signing key — anyone who knows the
 * dev fallback (it's in this repo) could mint a Super Admin token. Exported so tests can
 * exercise it without needing NODE_ENV=production for the whole process.
 */
export function assertSecureConfig(env = process.env) {
  if (env.NODE_ENV !== 'production') return
  const secret = env.JWT_SECRET
  if (!secret || secret === DEV_SECRET || /change-me/i.test(secret) || secret.length < 32) {
    throw new Error('Refusing to start in production: JWT_SECRET must be set to a random string of at least 32 characters (e.g. `openssl rand -hex 32`).')
  }
  if (!env.CORS_ORIGIN) throw new Error('Refusing to start in production: CORS_ORIGIN must be set to your frontend\'s real origin.')
}
assertSecureConfig()

// --- Cookie session -------------------------------------------------------------------
// Browsers authenticate with an httpOnly cookie, so page JavaScript (and therefore any XSS)
// can never read the token. Non-browser clients (and the tests) can still send
// `Authorization: Bearer`. Cookie-authenticated state-changing requests must also carry a
// custom header: a cross-site form/image can't add one, and a cross-site fetch that does
// triggers a CORS preflight the server refuses — that's the CSRF defense.
const PASSWORD_CHANGE_ALLOWED = new Set(['POST /api/auth/change-password', 'POST /api/auth/logout'])
// An Admin / Super Admin who has not set up two-factor yet can do exactly this: set it up, or sign out. (Policy: policy.js.)
const TWO_FACTOR_SETUP_ALLOWED = new Set(['POST /api/auth/2fa/setup', 'POST /api/auth/2fa/enable', 'POST /api/auth/logout', 'POST /api/auth/logout-all'])
export const SESSION_COOKIE = 'smartmess_session'
export const WEB_CLIENT_HEADER = 'x-smartmess-client'
const SESSION_MAX_AGE_S = 7 * 24 * 60 * 60

function cookieAttrs() {
  const sameSite = (process.env.COOKIE_SAMESITE || 'Lax').replace(/^./, (c) => c.toUpperCase())
  const secure = process.env.NODE_ENV === 'production' || sameSite === 'None' || process.env.COOKIE_SECURE === 'true'
  return `Path=/api; HttpOnly; SameSite=${sameSite}${secure ? '; Secure' : ''}`
}
export function setSessionCookie(res, token) {
  res.append('Set-Cookie', `${SESSION_COOKIE}=${token}; Max-Age=${SESSION_MAX_AGE_S}; ${cookieAttrs()}`)
}
export function clearSessionCookie(res) {
  res.append('Set-Cookie', `${SESSION_COOKIE}=; Max-Age=0; ${cookieAttrs()}`)
}
function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=')
    if (i !== -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim())
  }
  return null
}
export const isWebClient = (req) => !!req.headers[WEB_CLIENT_HEADER]

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' })
}

/** Short-lived proof that the password step succeeded — the ONLY thing /auth/login/2fa accepts. It is not a session. */
export function signChallenge(payload) {
  return jwt.sign({ ...payload, purpose: 'mfa' }, JWT_SECRET, { expiresIn: '5m' })
}
export function verifyChallenge(token) {
  const p = jwt.verify(token, JWT_SECRET)
  if (p.purpose !== 'mfa') throw new Error('not a 2FA challenge')
  return p
}

// --- Meal QR codes -----------------------------------------------------------------------------------------------
// Two kinds of token can identify a student at the counter, both signed, neither a login session (each carries a `purpose`):
//   * the live QR on the student's own phone — 60 seconds, single-use (its `jti` is burned by the first check-in it is used for);
//   * a printed ID-card QR — permanent but revocable (it names a card_id; reissuing the card replaces card_id).
export const QR_TTL_SECONDS = 60
export function signMealQr(studentId) {
  return jwt.sign({ sub: studentId, purpose: 'meal-qr', jti: randomUUID() }, JWT_SECRET, { expiresIn: QR_TTL_SECONDS })
}
export function signIdCard(cardId) {
  return jwt.sign({ cid: cardId, purpose: 'meal-card' }, JWT_SECRET) // no expiry: it is a card; revoke by reissuing
}
/** Returns { kind: 'qr', studentId, jti } or { kind: 'card', cardId }; throws an Error whose .code is 'QR_EXPIRED' | 'QR_INVALID'. */
export function verifyMealToken(token, atMs = Date.now()) {
  if (String(token).startsWith('SMO1.')) return verifyOfflineCode(token, atMs)
  try {
    const p = jwt.verify(String(token), JWT_SECRET)
    if (p.purpose === 'meal-qr' && p.sub && p.jti) return { kind: 'qr', studentId: p.sub, jti: p.jti }
    if (p.purpose === 'meal-card' && p.cid) return { kind: 'card', cardId: p.cid }
    throw new Error('wrong kind of token')
  } catch (e) {
    const err = new Error(e?.name === 'TokenExpiredError' ? 'expired' : 'invalid')
    err.code = e?.name === 'TokenExpiredError' ? 'QR_EXPIRED' : 'QR_INVALID'
    throw err
  }
}

// --- Sessions (devices) -------------------------------------------------------------------------------------------
export const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_S * 1000
const MAX_ACTIVE_SESSIONS = 10

/** "Chrome on Android" — enough for a person to recognise their own device in a list. Never trusted for anything else. */
export function describeDevice(ua) {
  const s = String(ua ?? '')
  if (!s) return 'Unknown device'
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /SamsungBrowser/.test(s) ? 'Samsung Internet' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\/|CriOS/.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : /node|undici|curl/i.test(s) ? 'API client' : 'Browser'
  const os = /Android/.test(s) ? 'Android' : /iPhone|iPad|iOS/.test(s) ? 'iOS' : /Windows/.test(s) ? 'Windows' : /Mac OS X|Macintosh/.test(s) ? 'macOS' : /CrOS/.test(s) ? 'ChromeOS' : /Linux/.test(s) ? 'Linux' : ''
  return os ? `${browser} on ${os}` : browser
}

/** Records a new signed-in device and returns its id (put it in the JWT as `sid`). Keeps at most 10 live devices per account. */
export function startSession(req, role, accountId) {
  const type = role === 'STUDENT' ? 'student' : 'staff'
  const now = new Date().toISOString()
  const sid = randomBytes(16).toString('base64url')
  db.prepare('INSERT INTO sessions (id, account_type, account_id, created_at, last_seen_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(sid, type, accountId, now, now, String(req.headers?.['user-agent'] ?? '').slice(0, 300) || null, req.ip ?? null)
  const live = db.prepare('SELECT id FROM sessions WHERE account_type = ? AND account_id = ? AND revoked_at IS NULL ORDER BY created_at DESC, rowid DESC').all(type, accountId)
  for (const old of live.slice(MAX_ACTIVE_SESSIONS)) db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(now, old.id)
  return sid
}

// --- Offline meal codes -------------------------------------------------------------------------------------------
// The live QR needs the network to be fetched. For a phone with no data at the counter, the signed-in phone is given ONE
// per-device secret (derived from the server's key + this session + the student; nothing extra stored) and computes a
// short code from it every minute. The server recomputes it — and checks the session is still live — so signing the device
// out (or "sign out everywhere") kills offline codes too. A code is valid for the minute it names ±1 minute, and each is
// single-use exactly like the online QR.
export const OFFLINE_STEP_SECONDS = 60
export function offlineKey(sid, studentId) {
  return createHmac('sha256', JWT_SECRET).update(`offline-qr|v1|${sid}|${studentId}`).digest()
}
const offlineMac = (key, step) => createHmac('sha256', key).update(String(step)).digest('base64url').slice(0, 16)
/** What the phone computes — exported so tests can play the phone's part. */
export function makeOfflineCode(sid, studentId, atMs = Date.now()) {
  const step = Math.floor(atMs / 1000 / OFFLINE_STEP_SECONDS)
  return `SMO1.${studentId}.${sid}.${step}.${offlineMac(offlineKey(sid, studentId), step)}`
}
function verifyOfflineCode(token, atMs) {
  const bad = (code) => { const e = new Error(code === 'QR_EXPIRED' ? 'expired' : 'invalid'); e.code = code; return e }
  const parts = String(token).split('.')
  if (parts.length !== 5 || parts[0] !== 'SMO1') throw bad('QR_INVALID')
  const [, studentId, sid, stepStr, mac] = parts
  const step = Number(stepStr)
  if (!Number.isInteger(step)) throw bad('QR_INVALID')
  const expected = offlineMac(offlineKey(sid, studentId), step)
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) throw bad('QR_INVALID')
  const sess = db.prepare("SELECT created_at, revoked_at FROM sessions WHERE id = ? AND account_type = 'student' AND account_id = ?").get(sid, studentId)
  if (!sess || sess.revoked_at || atMs - new Date(sess.created_at).getTime() > SESSION_MAX_AGE_MS) throw bad('QR_INVALID')
  if (Math.abs(step - Math.floor(atMs / 1000 / OFFLINE_STEP_SECONDS)) > 1) throw bad('QR_EXPIRED')
  return { kind: 'qr', studentId, jti: `off:${studentId}:${step}`, offline: true }
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET)
}

function tableFor(role) {
  return role === 'STUDENT' ? 'students' : 'staff'
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null
  const cookieToken = bearer ? null : readCookie(req, SESSION_COOKIE)
  const token = bearer ?? cookieToken
  if (!token) return res.status(401).json({ error: 'Missing bearer token.' })
  if (cookieToken && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !isWebClient(req)) {
    return res.status(403).json({ error: 'Missing client header on a cookie-authenticated request.', code: 'CSRF_BLOCKED' })
  }
  try {
    const payload = verifyToken(token)
    if (payload.purpose) return res.status(401).json({ error: 'Invalid or expired token.' }) // a 2FA challenge is not a session
    // Real token revocation: a token's "tv" claim must match the account's current
    // token_version — logout(), password reset, and account lockout all bump it, which
    // instantly invalidates every token issued before that point, not just the one the
    // person is currently using.
    // Only staff rows have student_id (set for PARENT accounts); students rows don't have the column.
    const cols = payload.role === 'STUDENT' ? 'token_version, hostel_id, must_change_password, totp_enabled' : 'token_version, hostel_id, student_id, must_change_password, totp_enabled'
    const row = db.prepare(`SELECT ${cols} FROM ${tableFor(payload.role)} WHERE id = ?`).get(payload.sub)
    if (!row || row.token_version !== payload.tv) {
      return res.status(401).json({ error: 'Your session is no longer valid — please sign in again.', code: 'TOKEN_REVOKED' })
    }
    // hostelId is read from the database on every request, never from the JWT: a staff
    // member's mess is an authorization boundary, so a transfer or reassignment has to
    // take effect immediately rather than whenever their old token happens to expire.
    // (SUPER_ADMIN rows have hostel_id NULL — they're the only role scoped to every mess.)
    // A token that names a device must name one that is still signed in (tokens issued before sessions existed have no sid
    // and are covered by token_version alone).
    if (payload.sid) {
      const sess = db.prepare('SELECT revoked_at, last_seen_at FROM sessions WHERE id = ? AND account_id = ?').get(payload.sid, payload.sub)
      if (!sess || sess.revoked_at) return res.status(401).json({ error: 'You were signed out of this device — please sign in again.', code: 'TOKEN_REVOKED' })
      if (Date.now() - new Date(sess.last_seen_at).getTime() > 5 * 60 * 1000) db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(new Date().toISOString(), payload.sid)
    }
    req.auth = { ...payload, mustChangePassword: !!row.must_change_password, hostelId: row.hostel_id ?? null, studentId: row.student_id ?? null, name: resolveActorName(payload.sub, payload.role) }
    // An account holding a temporary password can do exactly two things: choose a new password, or sign out. Everything
    // else is refused until it has — otherwise "temporary" is just a password that never expires.
    if (req.auth.mustChangePassword && !PASSWORD_CHANGE_ALLOWED.has(`${req.method} ${req.originalUrl.split('?')[0]}`)) {
      return res.status(403).json({ error: 'You must choose a new password before you can continue.', code: 'PASSWORD_CHANGE_REQUIRED' })
    }
    // Mandatory two-factor for the roles policy.js names: until it is set up, the session can only set it up or sign out.
    req.auth.twoFactorSetupRequired = twoFactorRequiredFor(payload.role) && !row.totp_enabled
    if (req.auth.twoFactorSetupRequired && !TWO_FACTOR_SETUP_ALLOWED.has(`${req.method} ${req.originalUrl.split('?')[0]}`)) {
      return res.status(403).json({ error: 'Your role requires two-factor login. Set it up to continue.', code: 'TWO_FACTOR_SETUP_REQUIRED' })
    }
    next()
  } catch (e) {
    if (e?.name === 'TokenExpiredError') return res.status(401).json({ error: 'Your session has expired — please sign in again.', code: 'TOKEN_EXPIRED' })
    res.status(401).json({ error: 'Invalid or expired token.' })
  }
}
