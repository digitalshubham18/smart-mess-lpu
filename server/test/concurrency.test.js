import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { startTestServer } from '../test-support/harness.js'

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let t, sa, kitchen
const count = (sql, ...p) => t.db.prepare(sql).get(...p).n
const rejections = []
const onRejection = (e) => rejections.push(String(e))

before(async () => {
  process.on('unhandledRejection', onRejection)
  t = await startTestServer()
  sa = await t.superAdminToken()
  kitchen = await t.staffToken('KITCHEN_STAFF', 'BH2')
})
after(async () => { process.off('unhandledRejection', onRejection); await t.close() })

// The checks in a route often run BEFORE an `await` (bcrypt), so several simultaneous requests can all pass them.
// Each test below fires a burst and asserts the invariant still holds afterwards.

test('race: 40 simultaneous enrolments into a 5-bed hostel create exactly 5', async () => {
  await t.api('/hostels', { token: sa, body: { id: 'RACE1', name: 'Race', category: 'general', capacity: 5 } })
  const rs = await Promise.all(Array.from({ length: 40 }, (_, i) => t.api('/students', { token: sa, body: { name: `Racer Number${i}`, email: `racer${i}@example.com`, noUid: true, noUidReason: 'test fixture', hostelId: 'RACE1' } })))
  assert.equal(rs.filter((r) => r.status === 201).length, 5)
  assert.equal(count("SELECT COUNT(*) AS n FROM students WHERE hostel_id = 'RACE1'"), 5)
})

test('race: 30 simultaneous adds to one 2-bed room fit exactly 2', async () => {
  await t.api('/hostels', { token: sa, body: { id: 'RACE2', name: 'Race2', category: 'general', capacity: 100, roomCapacity: 2 } })
  const rs = await Promise.all(Array.from({ length: 30 }, (_, i) => t.api('/students', { token: sa, body: { name: `Roomer Number${i}`, email: `roomer${i}@example.com`, noUid: true, noUidReason: 'test fixture', hostelId: 'RACE2', room: 'R-1' } })))
  assert.equal(rs.filter((r) => r.status === 201).length, 2)
})

test('race: 25 simultaneous check-ins of one student for one meal record exactly 1', async () => {
  const rs = await Promise.all(Array.from({ length: 25 }, () => t.api('/attendance/checkin', { token: kitchen, body: { uid: '21000120', messId: 'MESS-BH2', meal: 'lunch', date: '2099-03-03' } })))
  assert.equal(rs.filter((r) => r.status === 201).length, 1)
  assert.equal(rs.filter((r) => r.status === 409).length, 24)
  assert.equal(count("SELECT COUNT(*) AS n FROM attendance WHERE student_id = '21000120' AND date = '2099-03-03'"), 1)
})

test('race: 20 simultaneous adds with the same email create exactly 1 (and the rest are clean 409s, not 500s)', async () => {
  const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => t.api('/students', { token: sa, body: { name: `Dup Person${i}`, email: 'same@example.com', noUid: true, noUidReason: 'test fixture', hostelId: 'BH3' } })))
  assert.equal(rs.filter((r) => r.status === 201).length, 1)
  assert.ok(rs.every((r) => r.status === 201 || r.status === 409), rs.map((r) => r.status).join())
})

test('race: 5 simultaneous no-show runs warn the student exactly once', async () => {
  t.setIntentionDirect('21000140', '2099-04-04', 'dinner')
  await Promise.all([1, 2, 3, 4, 5].map(() => t.api('/attendance/process-no-shows', { token: kitchen, body: { messId: 'MESS-BH2', date: '2099-04-04', meal: 'dinner', fineAmount: 100 } })))
  assert.equal(count("SELECT COUNT(*) AS n FROM warnings WHERE student_id = '21000140' AND date = '2099-04-04'"), 1)
})

test('race: 3 simultaneous registrations of one UID (each with its own verified email) create exactly 1 account', async () => {
  const uid = '21000130'
  const name = t.db.prepare('SELECT name FROM students WHERE id = ?').get(uid).name
  const emails = ['reg.a@example.com', 'reg.b@example.com', 'reg.c@example.com']
  for (const e of emails) { await t.api('/auth/send-otp', { body: { email: e } }); await t.api('/auth/verify-otp', { body: { email: e, code: t.lastCodeFor(e) } }) }
  const rs = await Promise.all(emails.map((e) => t.api('/auth/register', { body: { uid, name, email: e, password: 'password1' } })))
  assert.equal(rs.filter((r) => r.status === 201).length, 1, rs.map((r) => r.status).join())
  assert.ok(rs.filter((r) => r.status !== 201).every((r) => r.status === 409), 'the losers get a clear 409')
  // the loser's verification must not be burned by a failed attempt — it rolled back with the rest
  const winnerEmail = t.db.prepare('SELECT email FROM students WHERE id = ?').get(uid).email
  const losers = emails.filter((e) => e !== winnerEmail)
  for (const e of losers) assert.equal(count('SELECT COUNT(*) AS n FROM email_otps WHERE email = ?', e), 1, `${e} keeps its verification`)
})

test('race: a password-reset code is truly one-time — 5 simultaneous uses, exactly 1 succeeds', async () => {
  const reg = await t.registerStudent('21000131', 'resetrace@example.com', 'old-password')
  assert.equal(reg.status, 201)
  await t.api('/auth/request-password-reset', { body: { identifier: '21000131' } })
  const { getSentEmails } = await import('../src/email.js')
  const mail = [...getSentEmails()].reverse().find((m) => m.to === 'resetrace@example.com' && /\b\d{6}\b/.test(m.text) && /reset/i.test(m.subject))
  const code = mail.text.match(/\b(\d{6})\b/)[1]
  const rs = await Promise.all(Array.from({ length: 5 }, (_, i) => t.api('/auth/reset-password', { body: { identifier: '21000131', code, newPassword: `new-password-${i}` } })))
  assert.equal(rs.filter((r) => r.status === 200).length, 1, rs.map((r) => r.status).join())
  // exactly one of the five candidate passwords works
  let working = 0
  for (let i = 0; i < 5; i++) if ((await t.api('/auth/login', { body: { identifier: '21000131', password: `new-password-${i}` } })).status === 200) working++
  assert.equal(working, 1)
})

test('async errors: double-clicking "generate parent access" never hangs a request or raises an unhandled rejection', async () => {
  const before = rejections.length
  const rs = await Promise.all(Array.from({ length: 6 }, () => Promise.race([
    t.api('/staff/parent-access/21000150', { token: sa, body: {} }).then((r) => r.status),
    new Promise((r) => setTimeout(() => r('HUNG'), 8000)),
  ])))
  assert.ok(!rs.includes('HUNG'), `a request hung: ${rs.join()}`)
  assert.equal(rs.filter((s) => s === 201).length, 1)
  assert.ok(rs.every((s) => s === 201 || s === 200), rs.join())
  assert.equal(count("SELECT COUNT(*) AS n FROM staff WHERE student_id = '21000150'"), 1)
  assert.equal(rejections.length, before, 'no unhandled promise rejection (on current Node that would have killed the process)')
})

test('async errors: a failure inside an async route is answered with a 500 — not a hang', async () => {
  t.db.exec('ALTER TABLE hostels RENAME TO hostels_broken')
  const origError = console.error
  console.error = () => {}
  try {
    const res = await Promise.race([
      t.api('/staff', { token: sa, body: { name: 'Will Fail', role: 'KITCHEN_STAFF', hostelId: 'BH2' } }),
      new Promise((r) => setTimeout(() => r({ status: 'HUNG' }), 8000)),
    ])
    assert.notEqual(res.status, 'HUNG')
    assert.ok(res.status >= 400)
  } finally {
    console.error = origError
    t.db.exec('ALTER TABLE hostels_broken RENAME TO hostels')
  }
  assert.equal(rejections.length, 0)
})

// ---------------------------------------------------------------- proxy + limiter configuration (separate processes)

async function withServer(env, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartmess-proc-'))
  const port = 4300 + Math.floor(Math.random() * 600)
  const child = spawn('node', ['src/index.js'], { cwd: SERVER_DIR, env: { ...process.env, PORT: String(port), DB_PATH: path.join(dir, 'p.sqlite'), OUTBOX_DIR: path.join(dir, 'o'), JWT_SECRET: 'test-secret', REQUIRE_2FA_ROLES: '', SCHEDULER: '0', ...env }, stdio: 'ignore' })
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 250)) }
    await fn(`http://127.0.0.1:${port}/api`)
  } finally {
    child.kill()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
const lookupStatuses = async (base, headerFor) => {
  const out = []
  for (let i = 0; i < 40; i++) out.push((await fetch(`${base}/students/lookup/2100${3000 + i}`, { headers: headerFor(i) })).status)
  return out
}

test('proxy: by default X-Forwarded-For is IGNORED, so spoofing it cannot dodge a limiter', async () => {
  await withServer({}, async (base) => {
    const s = await lookupStatuses(base, (i) => ({ 'X-Forwarded-For': `10.1.${i}.${i}` }))
    assert.ok(s.includes(429), 'limiter still fires when each request claims a different IP')
  })
})

test('proxy: with TRUST_PROXY=1 each real client (per X-Forwarded-For) gets their own bucket — one busy network no longer blocks everyone', async () => {
  await withServer({ TRUST_PROXY: '1' }, async (base) => {
    const distinct = await lookupStatuses(base, (i) => ({ 'X-Forwarded-For': `10.2.${i}.${i}` }))
    assert.ok(!distinct.includes(429), '40 different clients, 1 request each: nobody is limited')
    const same = await lookupStatuses(base, () => ({ 'X-Forwarded-For': '10.3.3.3' }))
    assert.ok(same.includes(429), 'but one client hammering is still limited')
  })
})

test('login limiter: sized for a campus (shared IP) — and still bites; LOGIN_RATE_MAX is configurable', async () => {
  await withServer({ LOGIN_RATE_MAX: '8' }, async (base) => {
    const statuses = []
    for (let i = 0; i < 12; i++) statuses.push((await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: '10001', password: 'demo1234' }) })).status)
    assert.equal(statuses.filter((s) => s === 200).length, 8)
    assert.equal(statuses.filter((s) => s === 429).length, 4)
  })
  // and the default is far above the old 20: 30 logins from one IP all succeed
  const rs = await Promise.all(Array.from({ length: 30 }, () => t.api('/auth/login', { body: { identifier: '10001', password: 'demo1234' } })))
  assert.ok(rs.every((r) => r.status === 200), rs.map((r) => r.status).join())
})
