import { Router } from 'express'
import { hashPassword, verifyPassword } from '../password.js'
import crypto from 'node:crypto'
import { db, logAudit, lockoutStatus, recordFailedLogin, clearFailedLogins, revokeAllTokens, messIdForHostel, NOT_ON_MESS_MESSAGE } from '../db.js'
import { toUserJSON, toStaffUserJSON, maskEmail } from '../mappers.js'
import { namesLikelyMatch } from '../fuzzyMatch.js'
import { signToken, signChallenge, verifyChallenge, requireAuth, setSessionCookie, clearSessionCookie, isWebClient, startSession, describeDevice } from '../auth.js'
import { twoFactorRequiredFor } from '../policy.js'
import { rateLimit } from '../rateLimit.js'
import { sendEmail, sendEmailInBackground } from '../email.js'
import {
  validate, registerSchema, loginSchema, otpEmailSchema, otpVerifySchema,
  passwordResetRequestSchema, passwordResetConfirmSchema, changePasswordSchema,
  twoFactorLoginSchema, twoFactorEnableSchema, twoFactorDisableSchema } from '../schemas.js'
import { newSecret, otpauthUri, verifyTotp, sealSecret, openSecret, newRecoveryCodes, hashRecoveryCode } from '../totp.js'

export const authRouter = Router()

// Staff passwords expire after this many days (0 = never). Students are not forced to rotate.
const PASSWORD_MAX_AGE_DAYS = process.env.PASSWORD_MAX_AGE_DAYS === undefined ? 90 : Number(process.env.PASSWORD_MAX_AGE_DAYS) || 0

const authLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 20, message: 'Too many attempts — please wait a few minutes and try again.' })
// Login gets its own, much higher per-IP ceiling. The real brute-force defense is the per-ACCOUNT lockout
// (5 wrong passwords → 15 min, in routes below); this per-IP limit only has to slow credential-stuffing across
// many accounts. Campus Wi-Fi puts a whole hostel behind one IP, and breakfast is a login rush — 20 per 5 minutes
// would lock out everyone after the first few students. Override with LOGIN_RATE_MAX.
const loginLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: Number(process.env.LOGIN_RATE_MAX) || 150, message: 'Too many sign-in attempts from this network — please wait a few minutes and try again.' })

// --- Registration email verification (real) ------------------------------------------
// send-otp emails a 6-digit code (stored only as a hash, 10-minute expiry); verify-otp checks
// it (max 5 wrong tries, then the code is dead); /register then REQUIRES a verified email and
// consumes it, so a verification can't be reused for a second account.
const nameGuesses = new Map() // uid -> { count, since }
const NAME_GUESS_MAX = 5
const NAME_GUESS_WINDOW_MS = 15 * 60 * 1000
const OTP_TTL_MS = 10 * 60 * 1000
const OTP_MAX_ATTEMPTS = 5
const VERIFIED_WINDOW_MS = 30 * 60 * 1000
const otpHash = (email, code) => crypto.createHash('sha256').update(`otp:${email}:${code}`).digest('hex')
const normEmail = (e) => String(e).trim().toLowerCase()

const OTP_RESEND_COOLDOWN_MS = 60 * 1000
const notOnMess = (res) => res.status(404).json({ error: NOT_ON_MESS_MESSAGE, code: 'NOT_ON_MESS' })

/**
 * Sign-up by UID. Resolves the student a UID belongs to, or sends the refusal itself and returns null:
 *  - not on the mess roster  → "You haven't taken mess…" (the warden office is who can fix that),
 *  - already has a login     → 409.
 * Everything after this uses the email ON FILE, never one the caller typed.
 */
function studentForSignup(uid, res) {
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(String(uid).trim())
  if (!student) { notOnMess(res); return null }
  // A temporary TMP- ID is a roster/QR identity only. The login belongs to the real UID, so the student has to have it linked
  // at the warden office first — otherwise their account would be created under an ID that is about to change.
  if (student.provisional) { res.status(403).json({ error: "You're on the mess with a temporary ID — your real UID hasn't been linked yet. Please visit the warden office.", code: 'TEMP_ID' }); return null }
  if (student.password_hash) { res.status(409).json({ error: 'This UID already has an account. Try signing in instead.', code: 'ALREADY_REGISTERED' }); return null }
  return student
}

authRouter.post('/send-otp', authLimiter, validate(otpEmailSchema), async (req, res) => {
  let email
  let maskedEmail
  if (req.body.uid) {
    const student = studentForSignup(req.body.uid, res)
    if (!student) return
    email = normEmail(student.email)
    maskedEmail = maskEmail(student.email)
    // The inbox belongs to the student, not the caller — so anyone who knows a UID must not be able to flood it.
    const last = db.prepare('SELECT expires_at FROM email_otps WHERE email = ?').get(email)
    if (last && Date.now() - (new Date(last.expires_at).getTime() - OTP_TTL_MS) < OTP_RESEND_COOLDOWN_MS) {
      return res.status(429).json({ error: 'A code was just sent — wait a minute before asking for another.', code: 'OTP_COOLDOWN' })
    }
  } else {
    email = normEmail(req.body.email)
  }
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
  db.prepare('INSERT OR REPLACE INTO email_otps (email, code_hash, expires_at, attempts, verified_at) VALUES (?, ?, ?, 0, NULL)')
    .run(email, otpHash(email, code), new Date(Date.now() + OTP_TTL_MS).toISOString())
  try {
    await sendEmail({
      to: email,
      subject: 'LPU Smart Mess — your verification code',
      text: `Your email verification code is ${code}. It expires in 10 minutes.\n\nIf you didn't start creating an account, ignore this email.`,
    })
  } catch (e) {
    // The code is useless if it never arrives: say so clearly (not a bare 500), and don't leave an unusable code behind.
    db.prepare('DELETE FROM email_otps WHERE email = ?').run(email)
    console.error(`[email:FAILED] verification code -> ${email}: ${e?.message ?? e}`)
    return res.status(503).json({ error: "We couldn't send the verification email right now. Please try again in a minute.", code: 'EMAIL_UNAVAILABLE' })
  }
  res.json(maskedEmail ? { sent: true, maskedEmail } : { sent: true })
})

authRouter.post('/verify-otp', authLimiter, validate(otpVerifySchema), (req, res) => {
  let email
  let student = null
  if (req.body.uid) {
    student = studentForSignup(req.body.uid, res)
    if (!student) return
    email = normEmail(student.email)
  } else {
    email = normEmail(req.body.email)
  }
  const row = db.prepare('SELECT * FROM email_otps WHERE email = ?').get(email)
  const bad = () => res.status(400).json({ error: 'That code is incorrect or has expired — request a new one.', code: 'OTP_INVALID' })
  if (!row || row.verified_at || new Date(row.expires_at).getTime() < Date.now() || row.attempts >= OTP_MAX_ATTEMPTS) return bad()
  if (otpHash(email, req.body.code) !== row.code_hash) {
    db.prepare('UPDATE email_otps SET attempts = attempts + 1 WHERE email = ?').run(email)
    return bad()
  }
  db.prepare('UPDATE email_otps SET verified_at = ? WHERE email = ?').run(new Date().toISOString(), email)
  // The name is only handed over once the inbox on file has been proven — never to someone who merely knows a UID.
  res.json(student ? { verified: true, name: student.name } : { verified: true })
})

function findAccount(identifier) {
  const value = identifier.trim().toLowerCase()
  const staff = db.prepare('SELECT * FROM staff WHERE lower(id) = ? OR lower(email) = ?').get(value, value)
  if (staff) return { table: 'staff', role: staff.role, row: staff }
  const student = db.prepare('SELECT * FROM students WHERE lower(id) = ? OR lower(email) = ?').get(value, value)
  if (student) return { table: 'students', role: 'STUDENT', row: student }
  return null
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

authRouter.post('/register', authLimiter, validate(registerSchema), async (req, res) => {
  const { uid, name, email: typedEmail, password } = req.body

  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(String(uid).trim())
  if (!student) return notOnMess(res)
  if (student.password_hash) {
    return res.status(409).json({ error: 'This UID already has an account. Try signing in instead.' })
  }

  // UID-only sign-up (what the app does): the roster record already says who this is, so there is nothing to type or
  // match — the proof is the code emailed to the address on file. The older explicit form below still works for
  // API clients: it must match the enrolled name and verifies whatever email it was given.
  const auto = typedEmail === undefined
  const email = auto ? student.email : typedEmail
  if (!auto) {
    if (!name) return res.status(400).json({ error: 'name: Enter your full name as it is on your university records.' })
    // Guessing names is the attack on this check, so wrong guesses are limited per UID (5 per 15 minutes) —
    // on top of the per-IP limiter, which a distributed attacker would sidestep. In memory: resets on restart.
    const guess = nameGuesses.get(student.id)
    if (guess && Date.now() - guess.since < NAME_GUESS_WINDOW_MS && guess.count >= NAME_GUESS_MAX) {
      return res.status(429).json({ error: 'Too many incorrect names for this UID — wait 15 minutes, or ask your hostel\'s Admin to help you register.', code: 'NAME_GUESS_LOCKED' })
    }
    if (!namesLikelyMatch(student.name, name)) {
      const fresh = guess && Date.now() - guess.since < NAME_GUESS_WINDOW_MS ? guess : { count: 0, since: Date.now() }
      fresh.count++
      nameGuesses.set(student.id, fresh)
      // Deliberately does NOT say what IS on file — echoing the enrolled name here would hand it to anyone
      // who guesses a UID, and the name check is the thing that stops them claiming the account.
      return res.status(400).json({ error: `That name doesn't match our enrollment record for UID ${uid}. Enter your full name exactly as it appears on your university records, or ask your hostel's Admin.`, code: 'NAME_MISMATCH' })
    }
    const emailTaken = db.prepare('SELECT 1 FROM students WHERE lower(email) = lower(?) AND id != ?').get(email, student.id)
    if (emailTaken) return res.status(409).json({ error: 'An account with that email already exists.' })
  }

  const otp = db.prepare('SELECT verified_at FROM email_otps WHERE email = ?').get(normEmail(email))
  if (!otp?.verified_at || Date.now() - new Date(otp.verified_at).getTime() > VERIFIED_WINDOW_MS) {
    return res.status(403).json({ error: 'Verify your email first — request a code and enter it before creating the account.', code: 'EMAIL_NOT_VERIFIED' })
  }

  const passwordHash = await hashPassword(password, 10)
  // The checks above ran BEFORE `await hashPassword`, so N simultaneous requests can all have passed them.
  // Claiming the account must therefore be one atomic step that re-checks everything it relies on:
  //  1. consume the verified email (a verification is single-use — only one racer can delete the row),
  //  2. set the password ONLY IF the account is still unclaimed (password_hash IS NULL).
  // Anything that fails rolls the whole thing back, including the consumed verification.
  try {
    db.transaction(() => {
      if (db.prepare('DELETE FROM email_otps WHERE email = ? AND verified_at IS NOT NULL').run(normEmail(email)).changes !== 1) throw new Error('EMAIL_NOT_VERIFIED')
      if (db.prepare('UPDATE students SET email = ?, password_hash = ? WHERE id = ? AND password_hash IS NULL').run(email, passwordHash, student.id).changes !== 1) throw new Error('ALREADY_REGISTERED')
    })()
  } catch (e) {
    if (e.message === 'EMAIL_NOT_VERIFIED') return res.status(403).json({ error: 'Verify your email first — request a code and enter it before creating the account.', code: 'EMAIL_NOT_VERIFIED' })
    if (e.message === 'ALREADY_REGISTERED' || String(e?.code).startsWith('SQLITE_CONSTRAINT')) return res.status(409).json({ error: 'This UID (or email) already has an account. Try signing in instead.', code: 'ALREADY_REGISTERED' })
    throw e
  }
  nameGuesses.delete(student.id)

  const updated = db.prepare('SELECT * FROM students WHERE id = ?').get(student.id)
  const user = toUserJSON(updated)
  const token = signToken({ sub: updated.id, role: 'STUDENT', tv: updated.token_version, sid: startSession(req, 'STUDENT', updated.id) })
  logAudit({ actorId: updated.id, actorName: updated.name, actorRole: 'STUDENT', action: 'student_registered', summary: `${updated.name} (${updated.id}) created their login` })
  respondWithSession(req, res, 201, withoutInternal(user), token)
})

authRouter.post('/login', loginLimiter, validate(loginSchema), async (req, res) => {
  const { identifier, password } = req.body
  const found = findAccount(identifier)

  if (!found) {
    // An 8-digit number is a student UID: the likeliest reason it has no account is that they haven't taken mess.
    if (/^\d{8}$/.test(identifier.trim())) return notOnMess(res)
    return res.status(404).json({ error: 'No account found for that registration number or email.' })
  }

  const { table, role, row } = found
  if (role === 'STUDENT' && !row.password_hash) {
    return res.status(403).json({ error: "This UID hasn't created a login yet — use \"Create account\" first." })
  }

  const lock = lockoutStatus(row)
  if (lock.locked) {
    return res.status(423).json({ error: `Too many failed attempts — this account is locked for ${lock.retryAfterMinutes} more minute${lock.retryAfterMinutes === 1 ? '' : 's'}.` })
  }

  const ok = await verifyPassword(password, row.password_hash)
  if (!ok) {
    const result = recordFailedLogin(table, row.id)
    if (result.locked) {
      return res.status(423).json({ error: `Too many failed attempts — this account is now locked for ${result.retryAfterMinutes} minutes.` })
    }
    return res.status(401).json({ error: `Incorrect password.${result.attemptsLeft <= 2 ? ` ${result.attemptsLeft} attempt${result.attemptsLeft === 1 ? '' : 's'} left before this account locks.` : ''}` })
  }

  clearFailedLogins(table, row.id)
  // Password expiry (staff): past the maximum age, the account is put into the same "choose a new password" state a
  // temporary password uses — the API then refuses everything but changing it. 0 turns this off.
  if (table === 'staff' && PASSWORD_MAX_AGE_DAYS > 0 && !row.must_change_password) {
    if (!row.password_changed_at) {
      // No timestamp (seeded, or created before this existed): the clock starts now rather than counting as expired.
      db.prepare('UPDATE staff SET password_changed_at = ? WHERE id = ?').run(new Date().toISOString(), row.id)
    } else {
      const iso = row.password_changed_at.includes('T') ? row.password_changed_at : `${row.password_changed_at.replace(' ', 'T')}Z`
      if (Date.now() - new Date(iso).getTime() > PASSWORD_MAX_AGE_DAYS * 86_400_000) {
        db.prepare('UPDATE staff SET must_change_password = 1 WHERE id = ?').run(row.id)
        row.must_change_password = 1
      }
    }
  }
  // Two-factor: a correct password is only the first half. No session yet — just a 5-minute challenge that
  // /auth/login/2fa exchanges for one once the authenticator code is right.
  if (row.totp_enabled) {
    return res.json({ twoFactorRequired: true, challenge: signChallenge({ sub: row.id, role }) })
  }
  completeLogin(req, res, table, role, row)
})

function completeLogin(req, res, table, role, row) {
  const freshRow = db.prepare(`SELECT token_version FROM ${table} WHERE id = ?`).get(row.id)
  const token = signToken({ sub: row.id, role, tv: freshRow.token_version, sid: startSession(req, role, row.id) })
  const current = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(row.id)
  const user = role === 'STUDENT' ? withoutInternal(toUserJSON(current)) : toStaffUserJSON(current)
  respondWithSession(req, res, 200, user, token)
}

const tableOf = (role) => (role === 'STUDENT' ? 'students' : 'staff')
const typeOf = (role) => (role === 'STUDENT' ? 'student' : 'staff')

/** Accepts a TOTP code (never the same step twice) or an unused recovery code (burned on use). Returns true/false. */
function checkSecondFactor(table, row, code) {
  const clean = String(code).trim()
  if (/^\d{3}\s?\d{3}$/.test(clean) && row.totp_secret) {
    const step = verifyTotp(openSecret(row.totp_secret), clean, { lastStep: row.totp_last_step })
    if (step === null) return false
    // Compare-and-set: two simultaneous requests with the same code can't both win.
    return db.prepare(`UPDATE ${table} SET totp_last_step = ? WHERE id = ? AND totp_last_step < ?`).run(step, row.id, step).changes === 1
  }
  const type = table === 'students' ? 'student' : 'staff'
  return db.prepare('DELETE FROM totp_recovery_codes WHERE account_type = ? AND account_id = ? AND code_hash = ?').run(type, row.id, hashRecoveryCode(clean)).changes === 1
}

authRouter.post('/login/2fa', loginLimiter, validate(twoFactorLoginSchema), (req, res) => {
  let p
  try { p = verifyChallenge(req.body.challenge) } catch {
    return res.status(401).json({ error: 'That sign-in attempt has expired — enter your password again.', code: 'CHALLENGE_EXPIRED' })
  }
  const table = tableOf(p.role)
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(p.sub)
  if (!row || !row.totp_enabled) return res.status(401).json({ error: 'That sign-in attempt has expired — enter your password again.', code: 'CHALLENGE_EXPIRED' })
  const lock = lockoutStatus(row)
  if (lock.locked) return res.status(423).json({ error: `Too many failed attempts — this account is locked for ${lock.retryAfterMinutes} more minute${lock.retryAfterMinutes === 1 ? '' : 's'}.` })

  if (!checkSecondFactor(table, row, req.body.code)) {
    // Wrong codes feed the same 5-strikes lockout as wrong passwords — a 6-digit code must not be brute-forceable.
    const result = recordFailedLogin(table, row.id)
    if (result.locked) return res.status(423).json({ error: `Too many failed attempts — this account is now locked for ${result.retryAfterMinutes} minutes.` })
    return res.status(401).json({ error: 'That code is incorrect or has already been used.', code: 'TOTP_INVALID' })
  }
  clearFailedLogins(table, row.id)
  completeLogin(req, res, table, p.role, row)
})

// --- Turning two-factor on and off (signed-in people, for their own account) ---------------------------------------
authRouter.post('/2fa/setup', loginLimiter, requireAuth, (req, res) => {
  const table = tableOf(req.auth.role)
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.auth.sub)
  if (row.totp_enabled) return res.status(409).json({ error: 'Two-factor login is already on. Turn it off first to set it up again.', code: 'TOTP_ALREADY_ENABLED' })
  const secret = newSecret()
  db.prepare(`UPDATE ${table} SET totp_secret = ?, totp_enabled = 0, totp_last_step = 0 WHERE id = ?`).run(sealSecret(secret), row.id)
  res.json({ secret, otpauthUri: otpauthUri({ secret, account: row.email }) })
})

authRouter.post('/2fa/enable', loginLimiter, requireAuth, validate(twoFactorEnableSchema), (req, res) => {
  const table = tableOf(req.auth.role)
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.auth.sub)
  if (row.totp_enabled) return res.status(409).json({ error: 'Two-factor login is already on.', code: 'TOTP_ALREADY_ENABLED' })
  if (!row.totp_secret) return res.status(400).json({ error: 'Start setup first.', code: 'TOTP_NOT_STARTED' })
  const step = verifyTotp(openSecret(row.totp_secret), req.body.code)
  if (step === null) return res.status(400).json({ error: 'That code is incorrect — check your authenticator app and try the newest code.', code: 'TOTP_INVALID' })
  const codes = newRecoveryCodes()
  db.transaction(() => {
    db.prepare(`UPDATE ${table} SET totp_enabled = 1, totp_last_step = ? WHERE id = ?`).run(step, row.id)
    db.prepare('DELETE FROM totp_recovery_codes WHERE account_type = ? AND account_id = ?').run(typeOf(req.auth.role), row.id)
    const ins = db.prepare('INSERT INTO totp_recovery_codes (account_type, account_id, code_hash) VALUES (?, ?, ?)')
    for (const c of codes) ins.run(typeOf(req.auth.role), row.id, hashRecoveryCode(c))
  })()
  logAudit({ actorId: req.auth.sub, actorName: req.auth.name, actorRole: req.auth.role, action: 'two_factor_enabled', messId: row.hostel_id ? messIdForHostel(row.hostel_id) : undefined, summary: `${req.auth.name} turned on two-factor login` })
  res.json({ enabled: true, recoveryCodes: codes })
})

authRouter.post('/2fa/disable', loginLimiter, requireAuth, validate(twoFactorDisableSchema), async (req, res) => {
  const table = tableOf(req.auth.role)
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.auth.sub)
  if (!row.totp_enabled) return res.status(409).json({ error: 'Two-factor login is not on.', code: 'TOTP_NOT_ENABLED' })
  // Required roles can't switch it off — that is the whole point of the requirement (a stolen session must not be able to strip it).
  if (twoFactorRequiredFor(req.auth.role)) return res.status(403).json({ error: 'Two-factor login is required for your role and cannot be turned off. If you lost your authenticator, ask the Super Admin to reset it.', code: 'TWO_FACTOR_REQUIRED_BY_POLICY' })
  const lock = lockoutStatus(row)
  if (lock.locked) return res.status(423).json({ error: `Too many failed attempts — locked for ${lock.retryAfterMinutes} more minute${lock.retryAfterMinutes === 1 ? '' : 's'}.` })
  // A borrowed, signed-in session must not be able to strip the protection: password AND a code are both required.
  if (!(await verifyPassword(req.body.password, row.password_hash)) || !checkSecondFactor(table, row, req.body.code)) {
    const result = recordFailedLogin(table, row.id)
    if (result.locked) return res.status(423).json({ error: `Too many failed attempts — this account is now locked for ${result.retryAfterMinutes} minutes.` })
    return res.status(400).json({ error: 'Your password or code is incorrect.', code: 'TOTP_DISABLE_REFUSED' })
  }
  clearFailedLogins(table, row.id)
  db.transaction(() => {
    db.prepare(`UPDATE ${table} SET totp_enabled = 0, totp_secret = NULL, totp_last_step = 0 WHERE id = ?`).run(row.id)
    db.prepare('DELETE FROM totp_recovery_codes WHERE account_type = ? AND account_id = ?').run(typeOf(req.auth.role), row.id)
  })()
  logAudit({ actorId: req.auth.sub, actorName: req.auth.name, actorRole: req.auth.role, action: 'two_factor_disabled', messId: row.hostel_id ? messIdForHostel(row.hostel_id) : undefined, summary: `${req.auth.name} turned off two-factor login` })
  res.json({ enabled: false })
})

// Real token revocation: bumps token_version, which invalidates every outstanding JWT
// for this account immediately — not just removing the token client-side.
// Change your own password. Needs the CURRENT password even though you're signed in — a stolen/borrowed session must
// not be enough to lock the real owner out — and wrong guesses count toward the same lockout as sign-in. On success
// every OTHER session is revoked (token_version bump) and this one is re-issued, and a forced "choose a new password"
// flag is cleared.
// loginLimiter, not the strict authLimiter: this needs a live session AND the current password (with lockout), and a whole
// hostel's staff changing their first-day passwords from one campus IP must not trip a 20-per-5-minutes ceiling.
authRouter.post('/change-password', loginLimiter, requireAuth, validate(changePasswordSchema), async (req, res) => {
  const { currentPassword, newPassword } = req.body
  const table = req.auth.role === 'STUDENT' ? 'students' : 'staff'
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.auth.sub)

  const lock = lockoutStatus(row)
  if (lock.locked) return res.status(423).json({ error: `Too many failed attempts — locked for ${lock.retryAfterMinutes} more minute${lock.retryAfterMinutes === 1 ? '' : 's'}.` })

  if (!(await verifyPassword(currentPassword, row.password_hash))) {
    const result = recordFailedLogin(table, row.id)
    if (result.locked) return res.status(423).json({ error: `Too many failed attempts — this account is now locked for ${result.retryAfterMinutes} minutes.` })
    return res.status(400).json({ error: 'Your current password is incorrect.', code: 'WRONG_CURRENT_PASSWORD' })
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ error: 'Your new password must be different from the current one.', code: 'SAME_PASSWORD' })
  }

  const newHash = await hashPassword(newPassword)
  db.prepare(`UPDATE ${table} SET password_hash = ?, must_change_password = 0, password_changed_at = ? WHERE id = ?`).run(newHash, new Date().toISOString(), row.id)
  clearFailedLogins(table, row.id)
  // Signs out every OTHER device; this one keeps its session row (a token from before sessions existed gets a fresh one).
  const keepSid = req.auth.sid ?? startSession(req, req.auth.role, row.id)
  revokeAllTokens(table, row.id, { keepSid })
  const fresh = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(row.id)
  logAudit({
    actorId: req.auth.sub, actorName: req.auth.name, actorRole: req.auth.role, action: 'password_changed',
    messId: fresh.hostel_id ? messIdForHostel(fresh.hostel_id) : undefined,
    summary: `${req.auth.name} changed their own password${row.must_change_password ? ' (first-sign-in change)' : ''}`,
  })
  const token = signToken({ sub: row.id, role: req.auth.role, tv: fresh.token_version, sid: keepSid })
  const user = table === 'students' ? withoutInternal(toUserJSON(fresh)) : toStaffUserJSON(fresh)
  respondWithSession(req, res, 200, user, token)
})

// Signs out THIS device only. (A token from before per-device sessions existed has no device row, so for it this still
// signs out everywhere — the only way to revoke it.)
authRouter.post('/logout', requireAuth, (req, res) => {
  if (req.auth.sid) db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(new Date().toISOString(), req.auth.sid)
  else revokeAllTokens(tableOf(req.auth.role), req.auth.sub)
  clearSessionCookie(res)
  res.json({ success: true })
})

// --- Devices: see where you are signed in, and end any of them (a lost phone) ---------------------------------------------
const sessionLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, scope: 'sessions', message: 'Too many requests — please wait a minute.' })
const sessionType = (role) => (role === 'STUDENT' ? 'student' : 'staff')

authRouter.get('/sessions', requireAuth, sessionLimiter, (req, res) => {
  const rows = db.prepare('SELECT id, created_at, last_seen_at, user_agent, ip FROM sessions WHERE account_type = ? AND account_id = ? AND revoked_at IS NULL ORDER BY last_seen_at DESC').all(sessionType(req.auth.role), req.auth.sub)
  res.json(rows.map((r) => ({ id: r.id, current: r.id === req.auth.sid, device: describeDevice(r.user_agent), ip: r.ip ?? null, signedInAt: r.created_at, lastActiveAt: r.last_seen_at })))
})

// End one device. Only your own — the account_id in the WHERE is the check, so another person's session id changes nothing.
authRouter.delete('/sessions/:id', requireAuth, sessionLimiter, (req, res) => {
  const r = db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND account_type = ? AND account_id = ? AND revoked_at IS NULL').run(new Date().toISOString(), req.params.id, sessionType(req.auth.role), req.auth.sub)
  if (r.changes === 0) return res.status(404).json({ error: 'That device is not signed in any more.', code: 'SESSION_NOT_FOUND' })
  const wasCurrent = req.params.id === req.auth.sid
  if (wasCurrent) clearSessionCookie(res)
  logAudit({ actorId: req.auth.sub, actorName: req.auth.name, actorRole: req.auth.role, action: 'session_revoked', messId: req.auth.hostelId ? messIdForHostel(req.auth.hostelId) : undefined, summary: `${req.auth.name} signed out one of their devices` })
  res.json({ success: true, current: wasCurrent })
})

// Sign out every OTHER device and keep this one: the answer to "I think someone else is in my account".
authRouter.post('/sessions/revoke-others', requireAuth, sessionLimiter, (req, res) => {
  const table = tableOf(req.auth.role)
  const keepSid = req.auth.sid ?? startSession(req, req.auth.role, req.auth.sub)
  revokeAllTokens(table, req.auth.sub, { keepSid }) // also kills any pre-upgrade token that has no device row
  const fresh = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(req.auth.sub)
  logAudit({ actorId: req.auth.sub, actorName: req.auth.name, actorRole: req.auth.role, action: 'sessions_revoked_others', messId: fresh.hostel_id ? messIdForHostel(fresh.hostel_id) : undefined, summary: `${req.auth.name} signed out all their other devices` })
  const token = signToken({ sub: req.auth.sub, role: req.auth.role, tv: fresh.token_version, sid: keepSid })
  respondWithSession(req, res, 200, table === 'students' ? withoutInternal(toUserJSON(fresh)) : toStaffUserJSON(fresh), token)
})

// Sign out EVERYWHERE, this device included, and stop notifications reaching any phone: for a lost or stolen one.
authRouter.post('/logout-all', requireAuth, sessionLimiter, (req, res) => {
  const table = tableOf(req.auth.role)
  db.transaction(() => {
    revokeAllTokens(table, req.auth.sub)
    db.prepare('DELETE FROM push_subscriptions WHERE account_type = ? AND account_id = ?').run(sessionType(req.auth.role), req.auth.sub)
  })()
  logAudit({ actorId: req.auth.sub, actorName: req.auth.name, actorRole: req.auth.role, action: 'sessions_revoked_all', messId: req.auth.hostelId ? messIdForHostel(req.auth.hostelId) : undefined, summary: `${req.auth.name} signed out everywhere and removed their notification devices` })
  clearSessionCookie(res)
  res.json({ success: true })
})

// --- Real password reset (persisted, hashed, expiring tokens; actually changes the DB) ---

authRouter.post('/request-password-reset', authLimiter, validate(passwordResetRequestSchema), async (req, res) => {
  const found = findAccount(req.body.identifier)
  // Deliberately the same response whether or not the account exists, so this endpoint
  // can't be used to probe which UIDs/emails are registered.
  if (!found) return res.json({ sent: true })

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
  const tokenHash = hashToken(`${found.table}:${found.row.id}:${code}`)
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()
  db.prepare('INSERT OR REPLACE INTO password_reset_tokens (token_hash, account_type, account_id, expires_at, used) VALUES (?, ?, ?, ?, 0)')
    .run(tokenHash, found.table === 'students' ? 'student' : 'staff', found.row.id, expiresAt)

  // Sent AFTER responding, and failures are only logged: the response must look identical (same body, same timing)
  // whether the account exists, the mail server is slow, or it is down — otherwise this endpoint tells an attacker
  // which UIDs/emails are registered, by status code when mail fails and by latency even when it works.
  sendEmailInBackground({
    to: found.row.email,
    subject: 'LPU Smart Mess — password reset code',
    text: `Hi ${found.row.name},\n\nYour password reset code is ${code}. It expires in 15 minutes.\n\nIf you didn't request this, you can ignore this email.`,
  })
  res.json({ sent: true })
})

authRouter.post('/reset-password', authLimiter, validate(passwordResetConfirmSchema), async (req, res) => {
  const { identifier, code, newPassword } = req.body
  const found = findAccount(identifier)
  if (!found) return res.status(400).json({ error: 'Invalid or expired code.' })

  const tokenHash = hashToken(`${found.table}:${found.row.id}:${code}`)
  const resetRow = db.prepare('SELECT * FROM password_reset_tokens WHERE token_hash = ? AND used = 0').get(tokenHash)
  if (!resetRow || resetRow.account_id !== found.row.id || new Date(resetRow.expires_at).getTime() < Date.now()) {
    return res.status(400).json({ error: 'Invalid or expired code.' })
  }

  const passwordHash = await hashPassword(newPassword, 10)
  // One-time means one-time even under concurrency: the check above ran before the `await`, so several requests
  // can hold the same valid code. Only the one that actually flips used 0→1 gets to change the password.
  const claimed = db.transaction(() => {
    if (db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE token_hash = ? AND used = 0').run(tokenHash).changes !== 1) return false
    db.prepare(`UPDATE ${found.table} SET password_hash = ?, must_change_password = 0, password_changed_at = ? WHERE id = ?`).run(passwordHash, new Date().toISOString(), found.row.id)
    return true
  })()
  if (!claimed) return res.status(400).json({ error: 'Invalid or expired code.' })
  clearFailedLogins(found.table, found.row.id)
  revokeAllTokens(found.table, found.row.id) // a password reset invalidates every existing session, not just future logins

  res.json({ success: true })
})

// Browsers (they send X-SmartMess-Client) get the session ONLY as an httpOnly cookie — the
// token is not in the response body, so no page script ever holds it. Other API clients
// (scripts, tests) have no cookie jar, so they still get the token in the body.
function respondWithSession(req, res, status, user, token) {
  setSessionCookie(res, token)
  res.status(status).json(isWebClient(req) ? { user } : { user, token })
}

function withoutInternal(user) {
  const { _student, ...rest } = user
  return rest
}
