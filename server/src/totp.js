import crypto from 'node:crypto'

// RFC 6238 TOTP (the algorithm behind Google Authenticator, Microsoft Authenticator, Authy, 1Password…), written on
// node:crypto so there is no extra dependency to audit. SHA-1, 6 digits, 30-second steps — the combination every
// authenticator app supports.
const STEP_S = 30
const DIGITS = 6
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buf) {
  let bits = 0, value = 0, out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(str) {
  let bits = 0, value = 0
  const out = []
  for (const ch of String(str).replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(ch)
    if (i === -1) continue
    value = (value << 5) | i
    bits += 5
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8 }
  }
  return Buffer.from(out)
}

export const newSecret = () => base32Encode(crypto.randomBytes(20))

export function hotp(secretB32, counter) {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const h = crypto.createHmac('sha1', base32Decode(secretB32)).update(msg).digest()
  const o = h[h.length - 1] & 15
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]
  return String(n % 10 ** DIGITS).padStart(DIGITS, '0')
}

export const stepAt = (ms = Date.now()) => Math.floor(ms / 1000 / STEP_S)

/**
 * Checks a code against the current step ±1 (clock drift). Returns the matching step, or null. `lastStep` is the
 * highest step already accepted for this account: anything at or below it is refused, so a code that was just used
 * (or shoulder-surfed) can't be replayed within its validity window.
 */
export function verifyTotp(secretB32, code, { lastStep = 0, now = Date.now() } = {}) {
  const clean = String(code).replace(/\s/g, '')
  if (!/^\d{6}$/.test(clean)) return null
  const current = stepAt(now)
  for (const step of [current, current - 1, current + 1]) {
    if (step <= lastStep) continue
    const a = Buffer.from(hotp(secretB32, step))
    const b = Buffer.from(clean)
    if (crypto.timingSafeEqual(a, b)) return step
  }
  return null
}

export function otpauthUri({ secret, account, issuer = 'LPU Smart Mess' }) {
  const label = encodeURIComponent(`${issuer}:${account}`)
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_S}`
}

// --- secret at rest ---------------------------------------------------------------------------------------------
// The shared secret is encrypted (AES-256-GCM, key derived from JWT_SECRET) so a leaked database file alone doesn't
// hand out everyone's second factor.
const key = () => crypto.createHash('sha256').update(`totp-at-rest:${process.env.JWT_SECRET || 'lpu-smart-mess-dev-secret-change-me'}`).digest()
export function sealSecret(secret) {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const enc = Buffer.concat([c.update(secret, 'utf8'), c.final()])
  return `${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${enc.toString('base64')}`
}
export function openSecret(sealed) {
  const [iv, tag, enc] = String(sealed).split('.').map((p) => Buffer.from(p, 'base64'))
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8')
}

// --- recovery codes ---------------------------------------------------------------------------------------------
export const newRecoveryCodes = (n = 8) => Array.from({ length: n }, () => {
  const raw = crypto.randomBytes(5).toString('hex') // 10 hex chars
  return `${raw.slice(0, 5)}-${raw.slice(5)}`
})
export const hashRecoveryCode = (code) => crypto.createHash('sha256').update(`recovery:${String(code).trim().toLowerCase().replace(/[^a-f0-9]/g, '')}`).digest('hex')
