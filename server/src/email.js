import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUTBOX_DIR = process.env.OUTBOX_DIR ? path.resolve(process.env.OUTBOX_DIR) : path.resolve(__dirname, '../data/outbox')
fs.mkdirSync(OUTBOX_DIR, { recursive: true })

/**
 * Real email sending, pluggable by environment:
 *
 * - No SMTP_* env vars set (the default, including in all tests and the out-of-the-box
 *   demo): writes each email as a real .txt file under server/data/outbox/ AND logs it
 *   to the console. This is the standard "dev-mode mailer" pattern (same idea as
 *   Django's console backend or Rails' letter_opener) — nothing is faked about it, it's
 *   just not routed over the network, so you can open server/data/outbox/ and read
 *   exactly what would have been sent.
 * - SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS set: sends for real via nodemailer.
 *   Exercised in test/email.test.js against a real in-process SMTP server (delivery, AUTH, a dead
 *   server, a black-holed one). NOT exercised against a real provider/TLS — verify that with your own
 *   credentials (send yourself a password reset) before launch.
 *
 * Failure policy — there are two kinds of email and they must not be treated alike:
 *   - sendEmail()         the email IS the point (a verification code). Throws on failure so the caller can say so.
 *   - sendEmailQuietly()  the email is a courtesy copy of something already done/shown (a new staff password the
 *                         Admin sees on screen; a no-show notice). Never throws; returns whether it was sent.
 */
let transporter = null
async function getTransporter() {
  if (transporter) return transporter
  if (!process.env.SMTP_HOST) return null
  const nodemailer = await import('nodemailer')
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    // nodemailer's defaults are 2 min to connect and 10 min of silence — a mail server that's down or black-holed
    // would hold a request open that long. Fail fast instead.
    connectionTimeout: Number(process.env.SMTP_TIMEOUT_MS) || 8000,
    greetingTimeout: Number(process.env.SMTP_TIMEOUT_MS) || 8000,
    socketTimeout: (Number(process.env.SMTP_TIMEOUT_MS) || 8000) * 2,
    // Refuse to send over an unencrypted connection (STARTTLS downgrade) when set — recommended in production.
    requireTLS: process.env.SMTP_REQUIRE_TLS === 'true',
  })
  return transporter
}

let seq = 1
// Ring buffer of the most recent emails, in memory. Lets tests (and a dev poking at the app)
// read an OTP/temporary password without scraping files; it is never exposed over HTTP.
const recent = []
export function getSentEmails() { return recent }
function remember(entry) { recent.push({ ...entry, at: new Date().toISOString() }); if (recent.length > 200) recent.shift() }

export async function sendEmail({ to, subject, text }) {
  remember({ to, subject, text })
  const real = await getTransporter()
  if (real) {
    await real.sendMail({ from: process.env.SMTP_FROM || 'no-reply@lpu.smartmess.edu', to, subject, text })
    return { sent: true, transport: 'smtp' }
  }
  const file = path.join(OUTBOX_DIR, `${Date.now()}-${seq++}-${to.replace(/[^a-z0-9]/gi, '_')}.txt`)
  const body = `To: ${to}\nSubject: ${subject}\nDate: ${new Date().toISOString()}\n\n${text}\n`
  fs.writeFileSync(file, body)
  console.log(`[email:outbox] ${subject} -> ${to} (${file})`)
  return { sent: true, transport: 'outbox', file }
}

/** Like sendEmail but never throws: logs the failure and returns whether the message went out. */
export async function sendEmailQuietly(opts) {
  try {
    await sendEmail(opts)
    return true
  } catch (e) {
    // e.message only — never the transporter config (it holds the SMTP password).
    console.error(`[email:FAILED] "${opts.subject}" -> ${opts.to}: ${e?.message ?? e}`)
    return false
  }
}

/** Fire-and-forget: returns immediately, delivery (and any failure) happens afterwards. */
export function sendEmailInBackground(opts) {
  setImmediate(() => { void sendEmailQuietly(opts) })
}
