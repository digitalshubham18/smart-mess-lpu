import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startTestServer } from '../test-support/harness.js'
import { getSentEmails } from '../src/email.js'

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let t, sa
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const hire = async (name = 'Fresh Hire') => (await t.api('/staff', { token: sa, body: { name, role: 'KITCHEN_STAFF', hostelId: 'BH2' } })).body
const loginFull = (id, password) => t.api('/auth/login', { body: { identifier: id, password } })

before(async () => { t = await startTestServer(); sa = await t.superAdminToken() })
after(async () => { await t.close() })

// ------------------------------------------------------------------ forced first-sign-in change
test('forced change: an account with a temporary password can sign in, but nothing else works until it chooses its own', async () => {
  const h = await hire()
  const login = await loginFull(h.id, h.tempPassword)
  assert.equal(login.status, 200)
  assert.equal(login.body.user.mustChangePassword, true)
  const tok = login.body.token
  for (const [method, p] of [['GET', '/students'], ['GET', '/staff'], ['GET', '/attendance?messId=MESS-BH2'], ['POST', '/attendance/checkin'], ['PUT', '/intentions/21000101'], ['GET', '/audit-log'], ['GET', '/students/21000101']]) {
    const r = await t.api(p, { token: tok, method, body: method === 'GET' ? undefined : {} })
    assert.equal(r.status, 403, `${method} ${p} must be blocked`)
    assert.equal(r.body.code, 'PASSWORD_CHANGE_REQUIRED', `${method} ${p}`)
  }
})

test('forced change: it cannot be dodged with query-string, case or trailing-slash tricks, nor by borrowing an allowed URL', async () => {
  const h = await hire('Sneaky Hire')
  const tok = (await loginFull(h.id, h.tempPassword)).body.token
  const raw = (p, method = 'GET') => fetch(`${t.baseUrl}${p}`, { method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : '{}' })
  assert.equal((await raw('/students?x=/api/auth/change-password')).status, 403)
  assert.equal((await raw('/students#/api/auth/logout')).status, 403)
  assert.equal((await raw('/STUDENTS')).status, 403)
  assert.ok([403, 404].includes((await raw('/auth/change-password?next=/students', 'GET')).status), 'GET on the allowed path is not the allowed request (there is no such route)')
  assert.equal((await raw('/auth/change-password/', 'POST')).status, 403, 'unlisted spelling stays blocked (the safe direction)')
})

test('forced change: public pages still work, and so does signing out', async () => {
  const h = await hire('Logout Hire')
  const tok = (await loginFull(h.id, h.tempPassword)).body.token
  assert.equal((await t.api('/hostels')).status, 200)
  assert.equal((await t.api('/auth/logout', { token: tok, body: {} })).status, 200)
  assert.equal((await t.api('/students', { token: tok })).status, 401, 'and logout really revoked it')
})

test('forced change: choosing a new password unlocks the account, kills the old password and the old session, and re-issues a working one', async () => {
  const h = await hire('Unlock Hire')
  const old = (await loginFull(h.id, h.tempPassword)).body.token
  const r = await t.api('/auth/change-password', { token: old, body: { currentPassword: h.tempPassword, newPassword: 'Granite-Harbour-42' } })
  assert.equal(r.status, 200)
  assert.equal(r.body.user.mustChangePassword, false)
  assert.ok(r.body.token)
  assert.equal((await t.api('/students/21000101', { token: old })).status, 401, 'the pre-change session is revoked')
  assert.equal((await loginFull(h.id, h.tempPassword)).status, 401, 'the temporary password no longer works')
  const fresh = await loginFull(h.id, 'Granite-Harbour-42')
  assert.equal(fresh.status, 200)
  assert.equal(fresh.body.user.mustChangePassword, false)
  assert.equal((await t.api('/attendance?messId=MESS-BH2', { token: r.body.token })).status, 200, 'the re-issued session works at once')
})

test('flag set by every path that issues a temporary password — and by none of the others', async () => {
  const flagged = (id) => t.db.prepare('SELECT must_change_password AS f FROM staff WHERE id = ?').get(id).f
  const h = await hire('Flag Hire')
  assert.equal(flagged(h.id), 1, 'new staff')
  const parent = (await t.api('/staff/parent-access/21000101', { token: sa, body: {} })).body
  assert.equal(flagged(parent.id), 1, 'new parent account')
  const admin = t.db.prepare("SELECT id FROM staff WHERE role='ADMIN' AND hostel_id='BH3'").get().id
  assert.equal(flagged(admin), 0, 'seeded demo accounts are not flagged (they would break every demo and test)')
  await t.api(`/staff/${admin}/reset-password`, { token: sa, body: {} })
  assert.equal(flagged(admin), 1, 'an Admin reset')
  const reg = await t.registerStudent('21000160', 'selfreg@example.com')
  assert.equal(reg.body.user.mustChangePassword, false, 'a student who chose their own password at registration')
  assert.equal(t.db.prepare("SELECT must_change_password AS f FROM students WHERE id='21000160'").get().f, 0)
})

test('forced change: a parent account is held to it as well, and it works for students changing voluntarily', async () => {
  const parent = (await t.api('/staff/parent-access/21000102', { token: sa, body: {} })).body
  const tok = (await loginFull(parent.id, parent.tempPassword)).body.token
  assert.equal((await t.api('/attendance/fines/21000102', { token: tok })).status, 403)
  assert.equal((await t.api('/auth/change-password', { token: tok, body: { currentPassword: parent.tempPassword, newPassword: 'Parent-Sunrise-77' } })).status, 200)

  const reg = await t.registerStudent('21000161', 'studentchange@example.com', 'first-password')
  const ch = await t.api('/auth/change-password', { token: reg.body.token, body: { currentPassword: 'first-password', newPassword: 'Second-Password-9!' } })
  assert.equal(ch.status, 200)
  assert.equal((await loginFull('21000161', 'Second-Password-9!')).status, 200)
  assert.equal((await loginFull('21000161', 'first-password')).status, 401)
})

// ------------------------------------------------------------------ the endpoint's own safeguards
test('change-password: needs a session, the CURRENT password, and a genuinely new, non-trivial password', async () => {
  assert.equal((await t.api('/auth/change-password', { body: { currentPassword: 'x', newPassword: 'Whatever-123' } })).status, 401)

  const h = await hire('Rules Hire')
  const tok = (await loginFull(h.id, h.tempPassword)).body.token
  const change = (body) => t.api('/auth/change-password', { token: tok, body })
  assert.equal((await change({ currentPassword: h.tempPassword, newPassword: h.tempPassword })).body.code, 'SAME_PASSWORD')
  for (const weak of ['short', 'demo1234', 'Password1', 'PASSWORD123', '12345678']) {
    const r = await change({ currentPassword: h.tempPassword, newPassword: weak })
    assert.equal(r.status, 400, `"${weak}" must be refused`)
  }
  assert.equal((await change({ currentPassword: h.tempPassword, newPassword: 'x'.repeat(200) })).status, 400)
  assert.equal((await change({ currentPassword: h.tempPassword })).status, 400)
  assert.equal(t.db.prepare('SELECT must_change_password AS f FROM staff WHERE id = ?').get(h.id).f, 1, 'none of those changed anything')
  assert.equal((await change({ currentPassword: h.tempPassword, newPassword: 'पासवर्ड-सुरक्षित-🔐-99' })).status, 200, 'unicode passwords are fine')
})

test('change-password: guessing the current password is lockout-limited — a stolen session cannot be used to brute-force it', async () => {
  const h = await hire('Brute Hire')
  const tok = (await loginFull(h.id, h.tempPassword)).body.token
  const attempt = (pw) => t.api('/auth/change-password', { token: tok, body: { currentPassword: pw, newPassword: 'Totally-New-Pass-5' } })
  const codes = []
  for (let i = 0; i < 5; i++) codes.push((await attempt(`wrong-guess-${i}`)).status)
  assert.deepEqual(codes.slice(0, 4), [400, 400, 400, 400])
  assert.equal(codes[4], 423, 'the 5th wrong guess locks the account')
  assert.equal((await attempt(h.tempPassword)).status, 423, 'even the right password is refused while locked')
  assert.equal((await loginFull(h.id, h.tempPassword)).status, 423, 'and so is signing in')
})

test('change-password: it signs out every OTHER device', async () => {
  const reg = await t.registerStudent('21000162', 'devices@example.com', 'device-password')
  const laptop = reg.body.token
  const phone = (await loginFull('21000162', 'device-password')).body.token
  assert.equal((await t.api('/students/21000162', { token: laptop })).status, 200, 'two devices can be signed in at once')
  assert.equal((await t.api('/students/21000162', { token: phone })).status, 200)
  const r = await t.api('/auth/change-password', { token: phone, body: { currentPassword: 'device-password', newPassword: 'Brand-New-Device-Pw1' } })
  assert.equal(r.status, 200)
  assert.equal((await t.api('/students/21000162', { token: phone })).status, 401, 'the session that made the change is re-issued…')
  assert.equal((await t.api('/students/21000162', { token: laptop })).status, 401, '…and the OTHER device is signed out')
  assert.equal((await t.api('/students/21000162', { token: r.body.token })).status, 200)
})

test('change-password: leaves an audit entry that never contains either password', async () => {
  const h = await hire('Audit Hire')
  const tok = (await loginFull(h.id, h.tempPassword)).body.token
  await t.api('/auth/change-password', { token: tok, body: { currentPassword: h.tempPassword, newPassword: 'Audit-Trail-Secret-31' } })
  const rows = t.db.prepare("SELECT summary FROM audit_log WHERE action = 'password_changed'").all()
  assert.ok(rows.some((r) => /Audit Hire changed their own password \(first-sign-in change\)/.test(r.summary)))
  assert.ok(!JSON.stringify(t.db.prepare('SELECT * FROM audit_log').all()).includes('Audit-Trail-Secret-31'))
  assert.ok(!JSON.stringify(t.db.prepare('SELECT * FROM audit_log').all()).includes(h.tempPassword))
})

test('change-password: a browser session gets the new cookie and no token in the body', async () => {
  const h = await hire('Cookie Hire')
  const login = await fetch(`${t.baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SmartMess-Client': 'web' }, body: JSON.stringify({ identifier: h.id, password: h.tempPassword }) })
  const cookie = login.headers.get('set-cookie').split(';')[0]
  const res = await fetch(`${t.baseUrl}/auth/change-password`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SmartMess-Client': 'web', Cookie: cookie }, body: JSON.stringify({ currentPassword: h.tempPassword, newPassword: 'Cookie-Monster-Pass-8' }) })
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.equal(body.token, undefined)
  const newCookie = res.headers.get('set-cookie').split(';')[0]
  assert.notEqual(newCookie, cookie)
  assert.match(res.headers.get('set-cookie'), /HttpOnly/i)
  assert.equal((await fetch(`${t.baseUrl}/attendance?messId=MESS-BH2`, { headers: { Cookie: newCookie } })).status, 200)
})

test('forgot-password (email code) counts as choosing your own password: it clears the forced-change flag', async () => {
  const h = await hire('Forgot Hire')
  const email = t.db.prepare('SELECT email FROM staff WHERE id = ?').get(h.id).email
  await t.api('/auth/request-password-reset', { body: { identifier: h.id } })
  await sleep(300)
  const mail = [...getSentEmails()].reverse().find((m) => m.to === email && /reset/i.test(m.subject))
  const code = mail.text.match(/\b(\d{6})\b/)[1]
  assert.equal((await t.api('/auth/reset-password', { body: { identifier: h.id, code, newPassword: 'Forgot-And-Fixed-12' } })).status, 200)
  const login = await loginFull(h.id, 'Forgot-And-Fixed-12')
  assert.equal(login.body.user.mustChangePassword, false)
  assert.equal((await t.api('/attendance?messId=MESS-BH2', { token: login.body.token })).status, 200)
})

test('migration: a database from before this change gains the column on boot, every existing account unflagged', () => {
  const dir = path.join(SERVER_DIR, 'test', '.tmp-mcp')
  const legacy = '/tmp/legacy-mcp.sqlite'
  const prep = `process.env.DB_PATH='${legacy}'; import('node:fs').then(async (fs) => { for (const e of ['','-wal','-shm']) fs.rmSync('${legacy}'+e,{force:true}); const { db } = await import('./src/db.js'); db.exec('DROP INDEX IF EXISTS x'); db.exec('ALTER TABLE staff DROP COLUMN must_change_password'); db.exec('ALTER TABLE students DROP COLUMN must_change_password'); console.log(db.prepare("select count(*) n from pragma_table_info('staff') where name='must_change_password'").get().n); db.close() })`
  const a = spawnSync('node', ['-e', prep], { cwd: SERVER_DIR, encoding: 'utf8' })
  assert.equal(a.stdout.trim().split('\n').pop(), '0', a.stderr)
  const probe = `const { db } = await import('./src/db.js'); console.log(JSON.stringify({ staff: db.prepare("select count(*) n from pragma_table_info('staff') where name='must_change_password'").get().n, students: db.prepare("select count(*) n from pragma_table_info('students') where name='must_change_password'").get().n, flagged: db.prepare('select (select count(*) from staff where must_change_password=1)+(select count(*) from students where must_change_password=1) n').get().n }))`
  const b = spawnSync('node', ['--input-type=module', '-e', probe], { cwd: SERVER_DIR, encoding: 'utf8', env: { ...process.env, DB_PATH: legacy } })
  assert.deepEqual(JSON.parse(b.stdout.trim().split('\n').pop()), { staff: 1, students: 1, flagged: 0 })
  void dir
})
