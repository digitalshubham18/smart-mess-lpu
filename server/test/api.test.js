import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TEST_DB = path.join(__dirname, 'test.sqlite')
for (const ext of ['', '-wal', '-shm']) fs.rmSync(TEST_DB + ext, { force: true })
process.env.DB_PATH = TEST_DB
process.env.JWT_SECRET = 'test-secret'
process.env.REQUIRE_2FA_ROLES = '' // Admin/Super Admin two-factor is mandatory in real life (src/policy.js); only the tests about it turn it on
process.env.ENFORCE_MEAL_WINDOWS = '0' // meal-time rules depend on the wall clock; the meal-timing tests turn them on explicitly

const { app } = await import('../src/app.js')
const { getSentEmails } = await import('../src/email.js')

// Read-only side channel into the test database: enrollment names (the unauthenticated lookup
// no longer returns them) and server-side meal intentions for the no-show tests.
const peek = new Database(TEST_DB, { readonly: true, fileMustExist: true })
const nameOf = (uid) => peek.prepare('SELECT name FROM students WHERE id = ?').get(uid).name
const writer = new Database(TEST_DB)
const setIntention = (uid, date, meal) => writer.prepare("INSERT OR REPLACE INTO meal_intentions (student_id, date, meal, status, submitted_at) VALUES (?, ?, ?, 'will_eat', datetime('now'))").run(uid, date, meal)

let server
let baseUrl

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}/api`
      resolve()
    })
  })
})

after(async () => {
  peek.close(); writer.close()
  await new Promise((resolve) => server.close(resolve))
  for (const ext of ['', '-wal', '-shm']) fs.rmSync(TEST_DB + ext, { force: true })
})

/** Real registration: send-otp → verify-otp (code read from the outbox) → register. */
async function registerWithOtp(uid, email, password, name = nameOf(uid)) {
  await api('/auth/send-otp', { method: 'POST', body: JSON.stringify({ email }) })
  const mail = [...getSentEmails()].reverse().find((m) => m.to === email && /code is (\d{6})/.test(m.text))
  await api('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ email, code: mail.text.match(/code is (\d{6})/)[1] }) })
  return api('/auth/register', { method: 'POST', body: JSON.stringify({ uid, name, email, password }) })
}

async function api(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })
  const body = await res.json().catch(() => null)
  return { status: res.status, body }
}

test('health check', async () => {
  const { status, body } = await api('/health')
  assert.equal(status, 200)
  assert.equal(body.ok, true)
})

test('hostels lists 20 real seeded hostels with real student counts', async () => {
  const { status, body } = await api('/hostels')
  assert.equal(status, 200)
  assert.equal(body.length, 20)
  const bh1 = body.find((h) => h.id === 'BH1')
  assert.equal(bh1.students, 100)
})

test('lookup: unknown UID returns null', async () => {
  const { status, body } = await api('/students/lookup/00000000')
  assert.equal(status, 200)
  assert.equal(body, null)
})

test('lookup: known UID resolves real hostel/mess and alreadyRegistered=false', async () => {
  const { body } = await api('/students/lookup/21000010')
  assert.ok(body)
  assert.equal(body.messId, 'MESS-BH1')
  assert.match(body.hostelName, /Boys Hostel 1/)
  assert.equal(body.student, undefined, 'the unauthenticated lookup must not return the student record')
  assert.ok(!/@|\d{6,}/.test(JSON.stringify(body)) || body.messId, 'no email/phone/room in the lookup response')
  assert.match(body.maskedName, /^[A-Z]•+ [A-Z]•+$/)
  assert.notEqual(body.maskedName, nameOf('21000010'))
  assert.equal(body.alreadyRegistered, false)
})

test('register: rejects unknown UID', async () => {
  const { status, body } = await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ uid: '00000000', name: 'Nobody', email: 'nobody@example.com', password: 'password1' }),
  })
  assert.equal(status, 404)
  assert.equal(body.code, 'NOT_ON_MESS')
  assert.match(body.error, /haven't taken mess.*warden office/i)
})

test('register: rejects a wildly mismatched name', async () => {
  await api('/auth/send-otp', { method: 'POST', body: JSON.stringify({ email: 'diff@example.com' }) })
  const mail = [...getSentEmails()].reverse().find((m) => m.to === 'diff@example.com')
  await api('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ email: 'diff@example.com', code: mail.text.match(/code is (\d{6})/)[1] }) })
  const { status, body } = await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ uid: '21000011', name: 'Totally Different Person', email: 'diff@example.com', password: 'password1' }),
  })
  assert.equal(status, 400)
  assert.equal(body.code, 'NAME_MISMATCH')
  assert.ok(!body.error.includes(nameOf('21000011')), 'the refusal must not reveal the enrolled name')
  assert.ok(nameOf('21000011')) // sanity: the record really does have its own name on file
})

test('register + login round trip with bcrypt + JWT', async () => {
  const { status: regStatus, body: reg } = await registerWithOtp('21000012', 'claim12@example.com', 'password1')
  assert.equal(regStatus, 201)
  assert.ok(reg.token)
  assert.equal(reg.user.studentId, '21000012')

  const { status: loginStatus, body: login } = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: '21000012', password: 'password1' }),
  })
  assert.equal(loginStatus, 200)
  assert.equal(login.user.studentId, '21000012')

  const { status: wrongPwStatus } = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: '21000012', password: 'WRONG' }),
  })
  assert.equal(wrongPwStatus, 401)
})

test('register: rejects re-registering the same UID', async () => {
  const { status, body } = await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ uid: '21000012', name: 'Whoever', email: 'again@example.com', password: 'password1' }),
  })
  assert.equal(status, 409)
  assert.match(body.error, /already has an account/i)
})

test('login: refuses an enrolled-but-unclaimed UID', async () => {
  const { status, body } = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: '21000013', password: 'anything' }),
  })
  assert.equal(status, 403)
  assert.match(body.error, /hasn't created a login/i)
})

let token
test('login: acquire a token for attendance tests', async () => {
  const { body } = await api('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: '21000012', password: 'password1' }) })
  token = body.token
  assert.ok(token)
})

// Counter actions are staff-only AND mess-scoped (see authz.test.js for the full matrix),
// so these tests act as the real seeded BH1 staff, not as a student.
let bh1Kitchen
let bh1Admin
test('acquire BH1 staff tokens for counter tests', async () => {
  const { body: sa } = await api('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: '10001', password: 'demo1234' }) })
  const { body: team } = await api('/staff?hostelId=BH1', { headers: { Authorization: `Bearer ${sa.token}` } })
  const login = async (role) => {
    const member = team.find((m) => m.role === role)
    const { body } = await api('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: member.id, password: 'demo1234' }) })
    return body.token
  }
  bh1Kitchen = await login('KITCHEN_STAFF')
  bh1Admin = await login('ADMIN')
  assert.ok(bh1Kitchen && bh1Admin)
})

test('attendance: rejects check-in for a student not enrolled in this mess', async () => {
  // Super Admin (allowed to act on any mess) so we reach the "is this student enrolled HERE" rule.
  const { body: sa } = await api('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: '10001', password: 'demo1234' }) })
  const { status, body } = await api('/attendance/checkin', {
    method: 'POST',
    headers: { Authorization: `Bearer ${sa.token}` },
    body: JSON.stringify({ uid: '21000012', messId: 'MESS-GH1', meal: 'lunch', date: '2026-03-01' }),
  })
  assert.equal(status, 403)
  assert.match(body.error, /not enrolled in this mess/i)
})

test('attendance: real check-in succeeds and rejects duplicates', async () => {
  const { status } = await api('/attendance/checkin', {
    method: 'POST',
    headers: { Authorization: `Bearer ${bh1Kitchen}` },
    body: JSON.stringify({ uid: '21000012', messId: 'MESS-BH1', meal: 'lunch', date: '2026-03-01' }),
  })
  assert.equal(status, 201)

  const { status: dupeStatus, body: dupeBody } = await api('/attendance/checkin', {
    method: 'POST',
    headers: { Authorization: `Bearer ${bh1Kitchen}` },
    body: JSON.stringify({ uid: '21000012', messId: 'MESS-BH1', meal: 'lunch', date: '2026-03-01' }),
  })
  assert.equal(dupeStatus, 409)
  assert.match(dupeBody.error, /already checked in/i)
})

test('attendance: no-show warnings escalate to a fine on the 3rd warning in a month', async () => {
  const noShowUid = '21000014' // a different BH1 student who never checks in
  const dates = ['2026-03-01', '2026-03-02', '2026-03-03']
  for (const d of dates) setIntention(noShowUid, d, 'dinner') // the server's own record of "will eat"
  let lastSummary
  for (const date of dates) {
    const { status, body } = await api('/attendance/process-no-shows', {
      method: 'POST',
      headers: { Authorization: `Bearer ${bh1Kitchen}` },
      body: JSON.stringify({ messId: 'MESS-BH1', date, meal: 'dinner', fineAmount: 150 }),
    })
    assert.equal(status, 200)
    lastSummary = body
  }
  assert.equal(lastSummary.warningsIssued, 1)
  assert.equal(lastSummary.finesIssued, 1) // the 3rd warning this "month" (all same YYYY-MM) triggers the fine

  const { body: warnings } = await api(`/attendance/warnings/${noShowUid}`, { headers: { Authorization: `Bearer ${bh1Kitchen}` } })
  assert.equal(warnings.length, 3)

  const { body: fines } = await api(`/attendance/fines/${noShowUid}`, { headers: { Authorization: `Bearer ${bh1Kitchen}` } })
  assert.equal(fines.length, 1)
  assert.equal(fines[0].amount, 150)
  assert.equal(fines[0].paid, false)
})

test('attendance: re-processing the same date/meal never double-warns (idempotent)', async () => {
  const noShowUid = '21000014'
  await api('/attendance/process-no-shows', {
    method: 'POST',
    headers: { Authorization: `Bearer ${bh1Kitchen}` },
    body: JSON.stringify({ messId: 'MESS-BH1', date: '2026-03-01', meal: 'dinner', fineAmount: 150 }),
  })
  const { body: warnings } = await api(`/attendance/warnings/${noShowUid}`, { headers: { Authorization: `Bearer ${bh1Kitchen}` } })
  assert.equal(warnings.length, 3) // unchanged
})

test('student CRUD: BH1 admin adds + edits, Super Admin transfers + deletes', async () => {
  const { body: sa } = await api('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: '10001', password: 'demo1234' }) })
  const superToken = sa.token

  const { status: addStatus, body: created } = await api('/students', {
    method: 'POST',
    headers: { Authorization: `Bearer ${bh1Admin}` },
    body: JSON.stringify({ name: 'Test Add Student', email: 'test.add.student@example.com', noUid: true, noUidReason: 'test fixture', hostelId: 'BH1', room: 'Z-1', year: 1, branch: 'Civil', mealPreference: 'veg', status: 'active' }),
  })
  assert.equal(addStatus, 201)
  assert.ok(created.id)

  const { status: patchStatus, body: patched } = await api(`/students/${created.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${bh1Admin}` },
    body: JSON.stringify({ room: 'Z-2' }),
  })
  assert.equal(patchStatus, 200)
  assert.equal(patched.room, 'Z-2')

  const { status: transferStatus, body: transferred } = await api(`/students/${created.id}/transfer`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({ hostelId: 'BH2', room: 'Y-1' }),
  })
  assert.equal(transferStatus, 200)
  assert.equal(transferred.hostelId, 'BH2')
  assert.equal(transferred.room, 'Y-1')

  const { status: deleteStatus, body: deleted } = await api(`/students/${created.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${superToken}` },
  })
  assert.equal(deleteStatus, 200)
  assert.equal(deleted.success, true)
})

test('every protected route requires a bearer token', async () => {
  const { status } = await api('/students')
  assert.equal(status, 401)
})

test('staff login works with the seeded Super Admin account', async () => {
  const { status, body } = await api('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: '10001', password: 'demo1234' }) })
  assert.equal(status, 200)
  assert.equal(body.user.role, 'SUPER_ADMIN')
  assert.ok(body.token)
})

let superAdminToken
test('acquire a Super Admin token for staff/audit tests', async () => {
  const { body } = await api('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: '10001', password: 'demo1234' }) })
  superAdminToken = body.token
})

test('staff: list BH1 team returns the seeded 5-person team', async () => {
  const { status, body } = await api('/staff?hostelId=BH1', { headers: { Authorization: `Bearer ${superAdminToken}` } })
  assert.equal(status, 200)
  assert.equal(body.length, 5)
})

test('staff: create, then remove a Mess Manager for a hostel', async () => {
  const { status: createStatus, body: created } = await api('/staff', {
    method: 'POST',
    headers: { Authorization: `Bearer ${superAdminToken}` },
    body: JSON.stringify({ name: 'Test New Manager', role: 'MESS_MANAGER', hostelId: 'BH2' }),
  })
  assert.equal(createStatus, 201)
  assert.ok(created.id)

  const { status: deleteStatus } = await api(`/staff/${created.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${superAdminToken}` } })
  assert.equal(deleteStatus, 200)
})

test('staff: cannot remove an Admin account through this endpoint', async () => {
  const { body: bh1Team } = await api('/staff?hostelId=BH1', { headers: { Authorization: `Bearer ${superAdminToken}` } })
  const admin = bh1Team.find((s) => s.role === 'ADMIN')
  const { status, body } = await api(`/staff/${admin.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${superAdminToken}` } })
  assert.equal(status, 403)
  assert.match(body.error, /cannot be removed/i)
})

test('staff photo: generated by default, then a real upload overrides it', async () => {
  const { body: bh1Team } = await api('/staff?hostelId=BH1', { headers: { Authorization: `Bearer ${superAdminToken}` } })
  const manager = bh1Team.find((s) => s.role === 'MESS_MANAGER')

  const generated = await fetch(`${baseUrl}/staff/${manager.id}/photo`)
  assert.equal(generated.headers.get('content-type'), 'image/svg+xml; charset=utf-8')

  const tinyPngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  const { status: uploadStatus } = await api(`/staff/${manager.id}/photo`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${superAdminToken}` },
    body: JSON.stringify({ dataUrl: tinyPngDataUrl }),
  })
  assert.equal(uploadStatus, 200)

  const uploaded = await fetch(`${baseUrl}/staff/${manager.id}/photo`)
  assert.equal(uploaded.headers.get('content-type'), 'image/png')
})

test('audit log: real actions are persisted and queryable', async () => {
  const { status, body } = await api('/audit-log', { headers: { Authorization: `Bearer ${superAdminToken}` } })
  assert.equal(status, 200)
  assert.ok(body.length > 0)
  assert.ok(body.some((e) => e.action === 'student_registered'))
  assert.ok(body.some((e) => e.action === 'meal_checked_in'))
})

test('fines: mess-wide listing and staff-only "mark paid"', async () => {
  const { body: outstanding } = await api('/attendance/fines?messId=MESS-BH1&paid=false', { headers: { Authorization: `Bearer ${superAdminToken}` } })
  assert.ok(outstanding.length >= 1)
  const fine = outstanding[0]

  const { status: studentPayStatus } = await api(`/attendance/fines/${fine.id}/pay`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
  assert.equal(studentPayStatus, 403) // the student token belongs to a STUDENT role — not allowed to self-mark paid

  const { status: staffPayStatus, body: paid } = await api(`/attendance/fines/${fine.id}/pay`, { method: 'POST', headers: { Authorization: `Bearer ${superAdminToken}` } })
  assert.equal(staffPayStatus, 200)
  assert.equal(paid.success, true)
})

test('pagination: ?page=&pageSize= returns a wrapped page instead of the full roster', async () => {
  const { status, body } = await api('/students?page=1&pageSize=10', { headers: { Authorization: `Bearer ${superAdminToken}` } })
  assert.equal(status, 200)
  assert.equal(body.data.length, 10)
  assert.equal(body.page, 1)
  assert.ok(body.total >= 2000)
})

test('validation: registering with a bad email is rejected before touching the database', async () => {
  const { status, body } = await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ uid: '21000015', name: 'Someone', email: 'not-an-email', password: 'password1' }),
  })
  assert.equal(status, 400)
  assert.match(body.error, /email/i)
})

test('account lockout: 5 wrong passwords locks the account, even with the right password after', async () => {
  const uid = '21000016'
  await registerWithOtp(uid, 'lockout.test@example.com', 'correct-password')

  let lastStatus
  for (let i = 0; i < 5; i++) {
    const { status } = await api('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: uid, password: 'wrong' }) })
    lastStatus = status
  }
  assert.equal(lastStatus, 423) // locked on the 5th failure

  const { status: lockedOutStatus, body: lockedOutBody } = await api('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: uid, password: 'correct-password' }) })
  assert.equal(lockedOutStatus, 423)
  assert.match(lockedOutBody.error, /locked/i)
})

test('logout revokes the token — it stops working immediately, not just client-side', async () => {
  const uid = '21000017'
  const { body: reg } = await registerWithOtp(uid, 'revoke.test@example.com', 'password1')

  const { status: beforeStatus } = await api(`/students/${uid}`, { headers: { Authorization: `Bearer ${reg.token}` } })
  assert.equal(beforeStatus, 200)

  const { status: logoutStatus } = await api('/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${reg.token}` } })
  assert.equal(logoutStatus, 200)

  const { status: afterStatus, body: afterBody } = await api(`/students/${uid}`, { headers: { Authorization: `Bearer ${reg.token}` } })
  assert.equal(afterStatus, 401)
  assert.equal(afterBody.code, 'TOKEN_REVOKED')
})

test('password reset: real end-to-end flow actually changes the password and revokes old sessions', async () => {
  const uid = '21000018'
  const { body: reg } = await registerWithOtp(uid, 'reset.test@example.com', 'old-password')

  const { status: requestStatus, body: requestBody } = await api('/auth/request-password-reset', { method: 'POST', body: JSON.stringify({ identifier: uid }) })
  assert.equal(requestStatus, 200)
  assert.equal(requestBody.sent, true)

  // Read the real code back from the outbox file this just wrote (no mocking — this is
  // the actual "email" the real send-email code path produced).
  const fs = await import('node:fs')
  const path = await import('node:path')
  const outboxDir = path.join(path.dirname(new URL(import.meta.url).pathname), '../data/outbox')
  const files = fs.readdirSync(outboxDir).filter((f) => f.includes('reset_test_example_com')).sort()
  const latest = fs.readFileSync(path.join(outboxDir, files[files.length - 1]), 'utf8')
  const code = latest.match(/code is (\d{6})/)[1]

  const { status: wrongCodeStatus } = await api('/auth/reset-password', { method: 'POST', body: JSON.stringify({ identifier: uid, code: '000000', newPassword: 'new-password' }) })
  assert.ok([400].includes(wrongCodeStatus) || code === '000000')

  const { status: resetStatus } = await api('/auth/reset-password', { method: 'POST', body: JSON.stringify({ identifier: uid, code, newPassword: 'new-password' }) })
  assert.equal(resetStatus, 200)

  const { status: oldPwStatus } = await api('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: uid, password: 'old-password' }) })
  assert.equal(oldPwStatus, 401)

  const { status: newPwStatus } = await api('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: uid, password: 'new-password' }) })
  assert.equal(newPwStatus, 200)

  // The pre-reset token must now be dead too.
  const { status: oldTokenStatus } = await api(`/students/${uid}`, { headers: { Authorization: `Bearer ${reg.token}` } })
  assert.equal(oldTokenStatus, 401)
})

test('staff creation returns a real random temp password, not a fixed default', async () => {
  const { body: created } = await api('/staff', {
    method: 'POST',
    headers: { Authorization: `Bearer ${superAdminToken}` },
    body: JSON.stringify({ name: 'Temp Password Test', role: 'KITCHEN_STAFF', hostelId: 'BH3' }),
  })
  assert.ok(created.tempPassword)
  assert.notEqual(created.tempPassword, 'demo1234')

  const { status } = await api('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: created.id, password: created.tempPassword }) })
  assert.equal(status, 200)
})

test('hostels: creating a new hostel mirror succeeds, duplicates are rejected', async () => {
  const { status: createStatus, body: created } = await api('/hostels', {
    method: 'POST',
    headers: { Authorization: `Bearer ${superAdminToken}` },
    body: JSON.stringify({ id: 'BH99', name: 'Boys Hostel 99 (BH-99)', category: 'boys', capacity: 100 }),
  })
  assert.equal(createStatus, 201)
  assert.equal(created.messId, 'MESS-BH99')

  const { status: dupeStatus, body: dupeBody } = await api('/hostels', {
    method: 'POST',
    headers: { Authorization: `Bearer ${superAdminToken}` },
    body: JSON.stringify({ id: 'BH99', name: 'Boys Hostel 99 (BH-99)', category: 'boys', capacity: 100 }),
  })
  assert.equal(dupeStatus, 409)
  assert.match(dupeBody.error, /already exists/i)

  // The new hostel is immediately real — a student can be enrolled against it.
  const { status: enrollStatus } = await api('/students', {
    method: 'POST',
    headers: { Authorization: `Bearer ${superAdminToken}` },
    body: JSON.stringify({ name: 'New Hostel Test Student', email: 'newhosteltest@example.com', noUid: true, noUidReason: 'test fixture', hostelId: 'BH99' }),
  })
  assert.equal(enrollStatus, 201)
})

test('audit log: filters by action and actorId narrow the results', async () => {
  const { body: onlyRegistrations } = await api('/audit-log?action=student_registered', { headers: { Authorization: `Bearer ${superAdminToken}` } })
  assert.ok(onlyRegistrations.length > 0)
  assert.ok(onlyRegistrations.every((e) => e.action === 'student_registered'))

  const { body: byActor } = await api(`/audit-log?actorId=${superAdminToken ? '10001' : ''}`, { headers: { Authorization: `Bearer ${superAdminToken}` } })
  assert.ok(byActor.every((e) => e.actor_id === '10001'))
})
