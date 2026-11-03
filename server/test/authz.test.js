import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'
import { startTestServer } from '../test-support/harness.js'

/**
 * Mess-scope authorization. The bug these guard against: any authenticated account could
 * act on ANY mess by crafting the request by hand (the frontend simply never offered the
 * option). Every test below crafts exactly that request and asserts two things — the
 * server refuses it, AND nothing was written.
 *
 * Cast: BH2 staff attacking BH5. BH5 is "the victim mess".
 */

let t
let bh2Kitchen, bh2Manager, bh2Admin, bh2Warden, bh5Admin, superAdmin
let bh5Student // a student who really lives in BH5
let bh2Student // a student who really lives in BH2

const count = (sql, ...params) => t.db.prepare(sql).get(...params).n

before(async () => {
  t = await startTestServer()
  bh2Kitchen = await t.staffToken('KITCHEN_STAFF', 'BH2')
  bh2Manager = await t.staffToken('MESS_MANAGER', 'BH2')
  bh2Admin = await t.staffToken('ADMIN', 'BH2')
  bh2Warden = await t.staffToken('HOSTEL_WARDEN', 'BH2')
  bh5Admin = await t.staffToken('ADMIN', 'BH5')
  superAdmin = await t.superAdminToken()
  bh5Student = t.db.prepare("SELECT id FROM students WHERE hostel_id = 'BH5' LIMIT 1").get().id
  bh2Student = t.db.prepare("SELECT id FROM students WHERE hostel_id = 'BH2' LIMIT 1").get().id
})
after(async () => { await t.close() })

// --- POST /attendance/checkin -------------------------------------------------

test('check-in: a BH2 Kitchen Staff account CANNOT check a student into BH5\'s mess', async () => {
  const before = count('SELECT COUNT(*) AS n FROM attendance')
  const { status, body } = await t.api('/attendance/checkin', {
    token: bh2Kitchen,
    body: { uid: bh5Student, messId: 'MESS-BH5', meal: 'lunch', date: '2026-04-01' },
  })
  assert.equal(status, 403)
  assert.equal(body.code, 'OUT_OF_SCOPE')
  assert.equal(count('SELECT COUNT(*) AS n FROM attendance'), before, 'no attendance row may be written')
})

test('check-in: the refusal reveals nothing about whether the UID exists', async () => {
  const real = await t.api('/attendance/checkin', { token: bh2Kitchen, body: { uid: bh5Student, messId: 'MESS-BH5', meal: 'lunch', date: '2026-04-01' } })
  const fake = await t.api('/attendance/checkin', { token: bh2Kitchen, body: { uid: '99999999', messId: 'MESS-BH5', meal: 'lunch', date: '2026-04-01' } })
  assert.equal(real.status, 403)
  assert.equal(fake.status, 403)
  assert.deepEqual(real.body, fake.body)
})

test('check-in: naming their OWN mess but a student from another mess is still refused (existing rule intact)', async () => {
  const { status, body } = await t.api('/attendance/checkin', {
    token: bh2Kitchen,
    body: { uid: bh5Student, messId: 'MESS-BH2', meal: 'lunch', date: '2026-04-01' },
  })
  assert.equal(status, 403)
  assert.match(body.error, /not enrolled in this mess/i)
})

test('check-in: positive control — the same Kitchen Staff CAN check in a BH2 student at MESS-BH2', async () => {
  const { status } = await t.api('/attendance/checkin', {
    token: bh2Kitchen,
    body: { uid: bh2Student, messId: 'MESS-BH2', meal: 'lunch', date: '2026-04-01' },
  })
  assert.equal(status, 201)
})

test('check-in: Super Admin may act on any mess', async () => {
  const { status } = await t.api('/attendance/checkin', {
    token: superAdmin,
    body: { uid: bh5Student, messId: 'MESS-BH5', meal: 'lunch', date: '2026-04-01' },
  })
  assert.equal(status, 201)
})

test('check-in: roles outside the counter team (Finance Manager, Warden) are refused even in their own mess', async () => {
  for (const role of ['FINANCE_MANAGER', 'HOSTEL_WARDEN']) {
    const token = await t.staffToken(role, 'BH2')
    const { status, body } = await t.api('/attendance/checkin', { token, body: { uid: bh2Student, messId: 'MESS-BH2', meal: 'dinner', date: '2026-04-01' } })
    assert.equal(status, 403, role)
    assert.equal(body.code, 'ROLE_FORBIDDEN', role)
  }
})

test('check-in: a student account cannot check anyone in (not even themselves)', async () => {
  const reg = await t.registerStudent(bh2Student, 'self.checkin@example.com')
  assert.equal(reg.status, 201)
  const { status } = await t.api('/attendance/checkin', { token: reg.body.token, body: { uid: bh2Student, messId: 'MESS-BH2', meal: 'dinner', date: '2026-04-02' } })
  assert.equal(status, 403)
})

// --- POST /attendance/process-no-shows ---------------------------------------

test('no-shows: a BH2 Mess Manager CANNOT run no-show processing (warnings + fines) against BH5', async () => {
  t.setIntentionDirect(bh5Student, '2026-04-03', 'dinner')
  const warnBefore = count('SELECT COUNT(*) AS n FROM warnings')
  const { status, body } = await t.api('/attendance/process-no-shows', {
    token: bh2Manager,
    body: { messId: 'MESS-BH5', date: '2026-04-03', meal: 'dinner', fineAmount: 500 },
  })
  assert.equal(status, 403)
  assert.equal(body.code, 'OUT_OF_SCOPE')
  assert.equal(count('SELECT COUNT(*) AS n FROM warnings'), warnBefore, 'no warning may be written')
})

test('no-shows: positive control — the same manager CAN process their own mess', async () => {
  t.setIntentionDirect(bh2Student, '2026-04-03', 'dinner')
  const { status, body } = await t.api('/attendance/process-no-shows', {
    token: bh2Manager,
    body: { messId: 'MESS-BH2', date: '2026-04-03', meal: 'dinner', fineAmount: 100 },
  })
  assert.equal(status, 200)
  assert.equal(body.warningsIssued, 1)
})

test('no-shows: a Warden or student cannot trigger it at all', async () => {
  const w = await t.api('/attendance/process-no-shows', { token: bh2Warden, body: { messId: 'MESS-BH2', date: '2026-04-04', meal: 'dinner' } })
  assert.equal(w.status, 403)
})

// --- POST /staff and DELETE /staff/:id ----------------------------------------

test('staff: a BH2 Admin CANNOT add someone to BH5\'s team', async () => {
  const before = count('SELECT COUNT(*) AS n FROM staff')
  const { status, body } = await t.api('/staff', {
    token: bh2Admin,
    body: { name: 'Planted Insider', role: 'MESS_MANAGER', hostelId: 'BH5' },
  })
  assert.equal(status, 403)
  assert.equal(body.code, 'OUT_OF_SCOPE')
  assert.equal(count('SELECT COUNT(*) AS n FROM staff'), before, 'no staff row may be written')
})

test('staff: out-of-scope is refused BEFORE hostel existence is checked (no probing for hostel IDs)', async () => {
  const real = await t.api('/staff', { token: bh2Admin, body: { name: 'Probe One', role: 'KITCHEN_STAFF', hostelId: 'BH5' } })
  const fake = await t.api('/staff', { token: bh2Admin, body: { name: 'Probe Two', role: 'KITCHEN_STAFF', hostelId: 'NOPE99' } })
  assert.equal(real.status, 403)
  assert.equal(fake.status, 403)
})

test('staff: positive control — the same Admin CAN add to their own mess', async () => {
  const { status, body } = await t.api('/staff', { token: bh2Admin, body: { name: 'Legit New Hire', role: 'KITCHEN_STAFF', hostelId: 'BH2' } })
  assert.equal(status, 201)
  assert.equal(body.hostelId, 'BH2')
})

test('staff: a Kitchen Staff / Mess Manager / Warden cannot add staff anywhere, own mess included', async () => {
  for (const token of [bh2Kitchen, bh2Manager, bh2Warden]) {
    const { status, body } = await t.api('/staff', { token, body: { name: 'Nope Nopeson', role: 'KITCHEN_STAFF', hostelId: 'BH2' } })
    assert.equal(status, 403)
    assert.equal(body.code, 'ROLE_FORBIDDEN')
  }
})

test('staff: Super Admin may add to any mess', async () => {
  const { status } = await t.api('/staff', { token: superAdmin, body: { name: 'Super Hire', role: 'FINANCE_MANAGER', hostelId: 'BH5' } })
  assert.equal(status, 201)
})

test('staff: a BH2 Admin CANNOT remove a BH5 team member', async () => {
  const victim = t.db.prepare("SELECT id FROM staff WHERE hostel_id = 'BH5' AND role = 'KITCHEN_STAFF'").get().id
  const { status, body } = await t.api(`/staff/${victim}`, { token: bh2Admin, method: 'DELETE' })
  assert.equal(status, 403)
  assert.equal(body.code, 'OUT_OF_SCOPE')
  assert.equal(count('SELECT COUNT(*) AS n FROM staff WHERE id = ?', victim), 1, 'the BH5 staff row must still exist')
})

test('staff: a student token cannot delete staff (this used to be allowed)', async () => {
  const reg = await t.registerStudent(bh5Student, 'student.attacker@example.com')
  const victim = t.db.prepare("SELECT id FROM staff WHERE hostel_id = 'BH5' AND role = 'MESS_MANAGER'").get().id
  const { status } = await t.api(`/staff/${victim}`, { token: reg.body.token, method: 'DELETE' })
  assert.equal(status, 403)
  assert.equal(count('SELECT COUNT(*) AS n FROM staff WHERE id = ?', victim), 1)
})

test('staff: listing is Admin/Super Admin only and an Admin only ever sees their own mess', async () => {
  const own = await t.api('/staff', { token: bh2Admin })
  assert.equal(own.status, 200)
  assert.ok(own.body.length > 0)
  assert.ok(own.body.every((s) => s.hostelId === 'BH2'), 'no BH5 staff may leak into a BH2 admin\'s list')

  const other = await t.api('/staff?hostelId=BH5', { token: bh2Admin })
  assert.equal(other.status, 403)

  const asKitchen = await t.api('/staff', { token: bh2Kitchen })
  assert.equal(asKitchen.status, 403)
})

test('parent access: cannot be generated for another mess\'s student', async () => {
  const { status } = await t.api(`/staff/parent-access/${bh5Student}`, { token: bh2Warden, body: {} })
  assert.equal(status, 403)
  assert.equal(count("SELECT COUNT(*) AS n FROM staff WHERE role = 'PARENT' AND student_id = ?", bh5Student), 0)
})

// --- /students ----------------------------------------------------------------

test('students: a BH2 Warden CANNOT enroll into, edit, or delete from BH5', async () => {
  const create = await t.api('/students', { token: bh2Warden, body: { name: 'Planted Student', email: 'planted@example.com', noUid: true, noUidReason: 'test fixture', hostelId: 'BH5' } })
  assert.equal(create.status, 403)
  assert.equal(count("SELECT COUNT(*) AS n FROM students WHERE email = 'planted@example.com'"), 0)

  const patch = await t.api(`/students/${bh5Student}`, { token: bh2Warden, method: 'PATCH', body: { room: 'HACKED' } })
  assert.equal(patch.status, 403)
  assert.notEqual(t.db.prepare('SELECT room FROM students WHERE id = ?').get(bh5Student).room, 'HACKED')

  const del = await t.api(`/students/${bh5Student}`, { token: bh2Warden, method: 'DELETE' })
  assert.equal(del.status, 403)
  assert.equal(count('SELECT COUNT(*) AS n FROM students WHERE id = ?', bh5Student), 1)
})

test('students: PATCH cannot be used to smuggle a student into another hostel (that\'s a Super-Admin transfer)', async () => {
  const { status, body } = await t.api(`/students/${bh2Student}`, { token: bh2Admin, method: 'PATCH', body: { hostelId: 'BH5' } })
  assert.equal(status, 403)
  assert.equal(body.code, 'ROLE_FORBIDDEN')
  assert.equal(t.db.prepare('SELECT hostel_id FROM students WHERE id = ?').get(bh2Student).hostel_id, 'BH2')
})

test('students: transfer is Super Admin only — a hostel Admin gets 403 even for their own student', async () => {
  const { status } = await t.api(`/students/${bh2Student}/transfer`, { token: bh2Admin, body: { hostelId: 'BH3' } })
  assert.equal(status, 403)
  assert.equal(t.db.prepare('SELECT hostel_id FROM students WHERE id = ?').get(bh2Student).hostel_id, 'BH2')
})

test('students: the roster list is scoped to the caller\'s hostel and refuses other hostels', async () => {
  const own = await t.api('/students', { token: bh2Admin })
  assert.equal(own.status, 200)
  assert.ok(own.body.length > 0 && own.body.every((s) => s.hostelId === 'BH2'))

  const other = await t.api('/students?hostelId=BH5', { token: bh2Admin })
  assert.equal(other.status, 403)

  const all = await t.api('/students', { token: superAdmin })
  assert.ok(all.body.length >= 2000)
})

test('students: a student cannot list the roster (names, emails, phone numbers)', async () => {
  const login = await t.api('/auth/login', { body: { identifier: bh2Student, password: 'password1' } })
  assert.equal(login.status, 200, `setup: ${JSON.stringify(login.body)}`)
  const { status } = await t.api('/students', { token: login.body.token })
  assert.equal(status, 403)
})

// --- hostels, audit ------------------------------------------------------------

test('hostels: only the Super Admin can create a hostel', async () => {
  const body = { id: 'BH77', name: 'Boys Hostel 77', category: 'boys', capacity: 50 }
  assert.equal((await t.api('/hostels', { token: bh2Admin, body })).status, 403)
  assert.equal(count("SELECT COUNT(*) AS n FROM hostels WHERE id = 'BH77'"), 0)
  assert.equal((await t.api('/hostels', { token: superAdmin, body })).status, 201)
})

test('audit log: Super Admin only', async () => {
  assert.equal((await t.api('/audit-log', { token: bh2Admin })).status, 403)
  assert.equal((await t.api('/audit-log', { token: superAdmin })).status, 200)
})

// --- fines & reads ------------------------------------------------------------

test('fines: a BH2 account cannot mark a BH5 fine as paid, nor list BH5\'s fines', async () => {
  t.db.prepare("INSERT INTO fines (id, student_id, mess_id, amount, month, issued_at, warning_ids, paid) VALUES ('FINE-BH5-1', ?, 'MESS-BH5', 250, '2026-04', ?, '[]', 0)").run(bh5Student, new Date().toISOString())

  const pay = await t.api('/attendance/fines/FINE-BH5-1/pay', { token: bh2Manager, body: {} })
  assert.equal(pay.status, 403)
  assert.equal(t.db.prepare("SELECT paid FROM fines WHERE id = 'FINE-BH5-1'").get().paid, 0)

  const list = await t.api('/attendance/fines?messId=MESS-BH5', { token: bh2Manager })
  assert.equal(list.status, 403)

  const ok = await t.api('/attendance/fines/FINE-BH5-1/pay', { token: bh5Admin, body: {} })
  assert.equal(ok.status, 200)
})

test('reads: a student sees only their own attendance/warnings/fines; staff only their mess', async () => {
  // bh2Student registered earlier (see the student-check-in test) so has a real token.
  const own = await t.api('/auth/login', { body: { identifier: bh2Student, password: 'password1' } })
  const tok = own.body.token

  assert.equal((await t.api(`/attendance?studentId=${bh2Student}`, { token: tok })).status, 200)
  assert.equal((await t.api(`/attendance/warnings/${bh2Student}`, { token: tok })).status, 200)
  assert.equal((await t.api(`/attendance/fines/${bh2Student}`, { token: tok })).status, 200)
  assert.equal((await t.api(`/students/${bh2Student}`, { token: tok })).status, 200)

  assert.equal((await t.api(`/attendance?studentId=${bh5Student}`, { token: tok })).status, 403)
  assert.equal((await t.api(`/attendance/warnings/${bh5Student}`, { token: tok })).status, 403)
  assert.equal((await t.api(`/attendance/fines/${bh5Student}`, { token: tok })).status, 403)
  assert.equal((await t.api(`/students/${bh5Student}`, { token: tok })).status, 403)
  assert.equal((await t.api('/attendance?messId=MESS-BH2', { token: tok })).status, 403, 'a student can\'t pull a mess-wide list')

  // staff: own mess yes, other mess no
  assert.equal((await t.api('/attendance?messId=MESS-BH2', { token: bh2Kitchen })).status, 200)
  assert.equal((await t.api('/attendance?messId=MESS-BH5', { token: bh2Kitchen })).status, 403)
  assert.equal((await t.api(`/attendance/warnings/${bh5Student}`, { token: bh2Kitchen })).status, 403)
  assert.equal((await t.api(`/students/${bh5Student}`, { token: bh2Kitchen })).status, 403)
})

test('reads: a parent sees only their linked child', async () => {
  const created = await t.api(`/staff/parent-access/${bh2Student}`, { token: bh2Admin, body: {} })
  assert.equal(created.status, 201)
  const tempToken = await t.login(created.body.id, created.body.tempPassword)
  // a brand-new parent account holds a temporary password: nothing works until they choose their own
  assert.equal((await t.api(`/attendance/fines/${bh2Student}`, { token: tempToken })).status, 403)
  const changed = await t.api('/auth/change-password', { token: tempToken, body: { currentPassword: created.body.tempPassword, newPassword: 'Parent-Chosen-Pass-81' } })
  assert.equal(changed.status, 200)
  const parentToken = changed.body.token

  assert.equal((await t.api(`/attendance/fines/${bh2Student}`, { token: parentToken })).status, 200)
  const otherBh2 = t.db.prepare("SELECT id FROM students WHERE hostel_id = 'BH2' AND id != ? LIMIT 1").get(bh2Student).id
  assert.equal((await t.api(`/attendance/fines/${otherBh2}`, { token: parentToken })).status, 403)
  assert.equal((await t.api('/attendance?messId=MESS-BH2', { token: parentToken })).status, 403)
})

// --- how the scope is derived --------------------------------------------------

test('scope comes from the DATABASE, not the token: a forged hostelId claim in a valid JWT changes nothing', async () => {
  const row = t.db.prepare("SELECT id, token_version FROM staff WHERE role = 'KITCHEN_STAFF' AND hostel_id = 'BH2'").get()
  const forged = jwt.sign({ sub: row.id, role: 'KITCHEN_STAFF', tv: row.token_version, hostelId: 'BH5' }, 'test-secret')
  const { status } = await t.api('/attendance/checkin', { token: forged, body: { uid: bh5Student, messId: 'MESS-BH5', meal: 'snacks', date: '2026-04-05' } })
  assert.equal(status, 403)
})

test('scope comes from the DATABASE, not the token: a reassignment takes effect on the very next request', async () => {
  const row = t.db.prepare("SELECT id FROM staff WHERE role = 'MESS_MANAGER' AND hostel_id = 'BH2'").get()
  const token = await t.login(row.id)
  const attempt = () => t.api('/attendance/process-no-shows', { token, body: { messId: 'MESS-BH5', date: '2026-04-06', meal: 'dinner' } })

  assert.equal((await attempt()).status, 403)
  t.db.prepare("UPDATE staff SET hostel_id = 'BH5' WHERE id = ?").run(row.id) // reassigned to BH5 — same token
  assert.equal((await attempt()).status, 200)
  t.db.prepare("UPDATE staff SET hostel_id = 'BH2' WHERE id = ?").run(row.id) // and back
  assert.equal((await attempt()).status, 403)
})

// --- audit trail of blocked attempts -------------------------------------------

test('every blocked cross-mess attempt leaves an audit entry the Super Admin can see', async () => {
  const { body } = await t.api('/audit-log?action=cross_mess_attempt_blocked&limit=500', { token: superAdmin })
  assert.ok(body.length >= 5, `expected several blocked attempts to be recorded, got ${body.length}`)
  assert.ok(body.every((e) => e.actor_id && e.summary.startsWith('Blocked:')))
  assert.ok(body.some((e) => e.mess_id === 'MESS-BH5'))
})
