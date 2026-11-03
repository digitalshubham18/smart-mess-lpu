import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Boots the real Express app against a throwaway, freshly seeded SQLite file (one per
 * test file, since `node --test` runs each file in its own process) and returns a tiny
 * fetch-based client. Nothing is mocked: it's the same app, router stack, and database
 * code that production runs.
 *
 * NOTE: lives outside test/ on purpose — `node --test` treats every .js under a test/
 * directory as a test file.
 */
export async function startTestServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartmess-test-'))
  const dbPath = path.join(dir, 'test.sqlite')
  process.env.DB_PATH = dbPath
  process.env.JWT_SECRET = 'test-secret'
  // Meal-time rules depend on the wall clock, so ordinary tests turn them off; the meal-timing tests switch them on explicitly.
  process.env.ENFORCE_MEAL_WINDOWS = '0'
  // Admin / Super Admin must use two-factor in real life (src/policy.js). Most tests just need to sign in as them, so the
  // requirement is off here by default; the tests for the requirement itself switch it on (process.env is read per request).
  process.env.REQUIRE_2FA_ROLES = ''
  // The scheduler is never started by app.js, but keep its pushes/clocks out of the way regardless.
  process.env.SCHEDULER = '0'

  const { app } = await import('../src/app.js')
  const { db } = await import('../src/db.js')
  const { getSentEmails } = await import('../src/email.js')
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`

  async function api(urlPath, { token, body, method, headers, raw } = {}) {
    const res = await fetch(`${baseUrl}${urlPath}`, {
      method: method ?? (body !== undefined ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (raw) return res
    const json = await res.json().catch(() => null)
    return { status: res.status, body: json, headers: res.headers }
  }

  async function login(identifier, password = 'demo1234') {
    const { status, body } = await api('/auth/login', { body: { identifier, password } })
    if (status !== 200) throw new Error(`login(${identifier}) failed: ${status} ${JSON.stringify(body)}`)
    return body.token
  }

  /** Token for the seeded staff member with this role in this hostel (e.g. 'KITCHEN_STAFF', 'BH2'). */
  async function staffToken(role, hostelId) {
    const row = db.prepare('SELECT id FROM staff WHERE role = ? AND hostel_id = ?').get(role, hostelId)
    if (!row) throw new Error(`no seeded ${role} in ${hostelId}`)
    return login(row.id)
  }

  const superAdminToken = () => login('10001')

  /** Reads the most recent emailed 6-digit code for an address (the in-memory outbox — never exposed over HTTP). */
  function lastCodeFor(email) {
    const mail = [...getSentEmails()].reverse().find((m) => m.to.toLowerCase() === email.toLowerCase() && /code is (\d{6})/.test(m.text))
    return mail ? mail.text.match(/code is (\d{6})/)[1] : null
  }

  /** Full, real registration: send-otp → verify-otp → register. Returns the register response. */
  async function registerStudent(uid, email, password = 'password1') {
    const name = db.prepare('SELECT name FROM students WHERE id = ?').get(uid).name
    await api('/auth/send-otp', { body: { email } })
    const v = await api('/auth/verify-otp', { body: { email, code: lastCodeFor(email) } })
    if (v.status !== 200) throw new Error(`verify-otp failed: ${JSON.stringify(v.body)}`)
    return api('/auth/register', { body: { uid, name, email, password } })
  }

  /** Server-side "will eat" record — what no-show processing is computed from. */
  function setIntentionDirect(studentId, date, meal, status = 'will_eat') {
    db.prepare("INSERT OR REPLACE INTO meal_intentions (student_id, date, meal, status, submitted_at) VALUES (?, ?, ?, ?, datetime('now'))").run(studentId, date, meal, status)
  }

  async function close() {
    await new Promise((resolve) => server.close(resolve))
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }

  return { api, login, staffToken, superAdminToken, registerStudent, lastCodeFor, setIntentionDirect, db, baseUrl, close }
}
