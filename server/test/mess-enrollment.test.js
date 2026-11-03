import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer } from '../test-support/harness.js'

/**
 * "Taken mess" = on the mess roster (students table). The university directory knows every student by UID.
 *  - Warden types a UID → name/email/phone/branch/year fill in from the directory.
 *  - Student gives a UID → on the roster: accepted, name and email come from the record; not on it:
 *    "You haven't taken mess. For any query, visit the warden office."
 */
let t, warden, wardenBH2
const NOT_ON_MESS = /haven't taken mess.*visit the warden office/i

before(async () => {
  t = await startTestServer()
  warden = await t.staffToken('HOSTEL_WARDEN', 'BH1')
  wardenBH2 = await t.staffToken('HOSTEL_WARDEN', 'BH2')
})
after(() => t.close())

const dir = (uid) => t.db.prepare('SELECT * FROM university_directory WHERE uid = ?').get(uid)

// ------------------------------------------------------------------ warden: UID → details
test('directory: a warden types a UID and gets the name, email, phone, branch and year', async () => {
  const r = await t.api('/students/directory/22000001', { token: warden })
  assert.equal(r.status, 200)
  const rec = dir('22000001')
  assert.deepEqual(r.body, { uid: '22000001', name: rec.name, email: rec.email, phone: rec.phone, branch: rec.branch, year: rec.year, onMess: false })
})

test('directory: an unknown UID is a clear 404', async () => {
  const r = await t.api('/students/directory/99999999', { token: warden })
  assert.equal(r.status, 404)
  assert.equal(r.body.code, 'UID_NOT_IN_RECORDS')
})

test('directory: needs a login, and a role that may enroll students', async () => {
  assert.equal((await t.api('/students/directory/22000001')).status, 401)
  const kitchen = await t.staffToken('KITCHEN_STAFF', 'BH1')
  assert.equal((await t.api('/students/directory/22000001', { token: kitchen })).status, 403)
})

test('directory: a UID already on a roster says so — and only its own mess sees who it is', async () => {
  const own = t.db.prepare("SELECT id, name FROM students WHERE hostel_id = 'BH1' LIMIT 1").get()
  const a = await t.api(`/students/directory/${own.id}`, { token: warden })
  assert.deepEqual(a.body, { uid: own.id, name: own.name, onMess: true, hostelId: 'BH1' })
  const b = await t.api(`/students/directory/${own.id}`, { token: wardenBH2 })
  assert.deepEqual(b.body, { uid: own.id, onMess: true, outOfScope: true })
  assert.ok(!JSON.stringify(b.body).includes(own.name))
})

// ------------------------------------------------------------------ warden: enroll by UID
test('enroll by UID: only hostel/room are needed — name and email come from the university record', async () => {
  const r = await t.api('/students', { token: warden, body: { uid: '22000002', hostelId: 'BH1', room: 'A-101', name: 'Typed Over', email: 'typed@over.example' } })
  assert.equal(r.status, 201)
  const rec = dir('22000002')
  assert.equal(r.body.id, '22000002')
  assert.equal(r.body.name, rec.name, 'the record wins over a typed name')
  assert.equal(r.body.email, rec.email)
  assert.equal(r.body.branch, rec.branch)
  assert.equal(r.body.year, rec.year)
  assert.equal(r.body.hostelId, 'BH1')
  const again = await t.api('/students', { token: warden, body: { uid: '22000002', hostelId: 'BH1' } })
  assert.equal(again.status, 409)
  assert.equal(again.body.code, 'ALREADY_ON_MESS')
})

test('enroll by UID: an explicit phone/branch/year overrides the record, the rest still fills in', async () => {
  const r = await t.api('/students', { token: warden, body: { uid: '22000010', hostelId: 'BH1', branch: 'Mechanical', year: 3 } })
  assert.equal(r.status, 201)
  assert.equal(r.body.branch, 'Mechanical')
  assert.equal(r.body.year, 3)
  assert.equal(r.body.phone, dir('22000010').phone)
})

test('enroll by UID: unknown UID is refused; no UID and no name/email is still a validation error', async () => {
  const unknown = await t.api('/students', { token: warden, body: { uid: '99999998', hostelId: 'BH1' } })
  assert.equal(unknown.status, 404)
  assert.equal(unknown.body.code, 'UID_NOT_IN_RECORDS')
  const bare = await t.api('/students', { token: warden, body: { hostelId: 'BH1' } })
  assert.equal(bare.status, 400)
  const badUid = await t.api('/students', { token: warden, body: { uid: 'abc', hostelId: 'BH1' } })
  assert.equal(badUid.status, 400)
})

test('enroll by UID: still limited to your own hostel and to its bed capacity', async () => {
  const out = await t.api('/students', { token: warden, body: { uid: '22000003', hostelId: 'BH5' } })
  assert.equal(out.status, 403)
  assert.equal(dir('22000003') && t.db.prepare('SELECT 1 FROM students WHERE id = ?').get('22000003'), undefined)
  t.db.prepare("UPDATE hostels SET capacity = (SELECT COUNT(*) FROM students WHERE hostel_id = 'BH1') WHERE id = 'BH1'").run()
  const full = await t.api('/students', { token: warden, body: { uid: '22000003', hostelId: 'BH1' } })
  assert.equal(full.status, 409)
  assert.equal(full.body.code, 'HOSTEL_FULL')
  t.db.prepare("UPDATE hostels SET capacity = 112 WHERE id = 'BH1'").run()
})

test('enroll by UID is audited', async () => {
  const row = t.db.prepare("SELECT summary FROM audit_log WHERE action = 'student_enrolled' AND summary LIKE '%22000002%'").get()
  assert.ok(row, 'an audit entry names the enrolled UID')
  assert.match(row.summary, /from the university record/)
})

test('bulk import accepts UID-only rows and reports unknown ones per line', async () => {
  const r = await t.api('/students/bulk', { token: warden, body: { rows: [
    { line: 2, data: { uid: '22000020', room: 'B-201' } },
    { line: 3, data: { uid: '99999997' } },
    { line: 4, data: { uid: '22000020' } },
    { line: 5, data: { room: 'B-1' } },
  ] } })
  assert.equal(r.status, 201)
  assert.equal(r.body.created, 1)
  assert.deepEqual(r.body.failed.map((f) => f.line).sort(), [3, 4, 5])
  assert.equal(r.body.failed.find((f) => f.line === 3).code, 'UID_NOT_IN_RECORDS')
  assert.equal(r.body.failed.find((f) => f.line === 4).code, 'ALREADY_ON_MESS')
})

// ------------------------------------------------------------------ student: "have you taken mess?"
test('a UID that has NOT taken mess is told to visit the warden office — at lookup, sign-up code, register and sign-in', async () => {
  // 22000030 is in the university records but on no roster; 00000000 is in nothing at all. Same answer for both.
  for (const uid of ['22000030', '00000000']) {
    assert.equal((await t.api(`/students/lookup/${uid}`)).body, null)
    const send = await t.api('/auth/send-otp', { body: { uid } })
    assert.equal(send.status, 404)
    assert.equal(send.body.code, 'NOT_ON_MESS')
    assert.match(send.body.error, NOT_ON_MESS)
    assert.equal((await t.api('/auth/verify-otp', { body: { uid, code: '123456' } })).body.code, 'NOT_ON_MESS')
    const reg = await t.api('/auth/register', { body: { uid, password: 'password1' } })
    assert.equal(reg.status, 404)
    assert.match(reg.body.error, NOT_ON_MESS)
    const login = await t.api('/auth/login', { body: { identifier: uid, password: 'whatever1' } })
    assert.equal(login.status, 404)
    assert.match(login.body.error, NOT_ON_MESS)
  }
})

test('a student who HAS taken mess signs up with just their UID: code goes to the email on file, name appears after verifying', async () => {
  const uid = '22000002' // enrolled above
  const rec = dir(uid)
  const look = await t.api(`/students/lookup/${uid}`)
  assert.equal(look.body.alreadyRegistered, false)
  assert.match(look.body.maskedEmail, /^.•+@/)
  assert.ok(!JSON.stringify(look.body).includes(rec.name), 'no full name before the inbox is proven')

  const send = await t.api('/auth/send-otp', { body: { uid } })
  assert.equal(send.status, 200)
  assert.equal(send.body.maskedEmail, look.body.maskedEmail)
  const code = t.lastCodeFor(rec.email)
  assert.ok(code, 'the code is emailed to the address on file')

  const wrong = await t.api('/auth/verify-otp', { body: { uid, code: code === '000000' ? '111111' : '000000' } })
  assert.equal(wrong.status, 400)
  assert.equal(wrong.body.name, undefined)

  const ok = await t.api('/auth/verify-otp', { body: { uid, code } })
  assert.equal(ok.status, 200)
  assert.deepEqual(ok.body, { verified: true, name: rec.name })

  const reg = await t.api('/auth/register', { body: { uid, password: 'a-fine-password' } })
  assert.equal(reg.status, 201)
  assert.equal(reg.body.user.name, rec.name)
  assert.equal(reg.body.user.email, rec.email)
  assert.equal((await t.api('/auth/login', { body: { identifier: uid, password: 'a-fine-password' } })).status, 200)

  const second = await t.api('/auth/send-otp', { body: { uid } })
  assert.equal(second.status, 409, 'a UID that already has a login cannot start sign-up again')
})

test('knowing a UID is NOT enough: without the emailed code (or with a code for another inbox) register is refused', async () => {
  await t.api('/students', { token: warden, body: { uid: '22000004', hostelId: 'BH1' } })
  const bare = await t.api('/auth/register', { body: { uid: '22000004', password: 'password1' } })
  assert.equal(bare.status, 403)
  assert.equal(bare.body.code, 'EMAIL_NOT_VERIFIED')

  // An attacker verifies THEIR OWN inbox, then tries to claim the UID with it.
  await t.api('/auth/send-otp', { body: { email: 'attacker@example.com' } })
  await t.api('/auth/verify-otp', { body: { email: 'attacker@example.com', code: t.lastCodeFor('attacker@example.com') } })
  const hijack = await t.api('/auth/register', { body: { uid: '22000004', password: 'password1' } })
  assert.equal(hijack.status, 403)
  assert.equal(t.db.prepare('SELECT password_hash FROM students WHERE id = ?').get('22000004').password_hash, null)
})

test('asking for codes for someone else’s UID is rate limited per student (no inbox flooding)', async () => {
  await t.api('/students', { token: warden, body: { uid: '22000005', hostelId: 'BH1' } })
  assert.equal((await t.api('/auth/send-otp', { body: { uid: '22000005' } })).status, 200)
  const again = await t.api('/auth/send-otp', { body: { uid: '22000005' } })
  assert.equal(again.status, 429)
  assert.equal(again.body.code, 'OTP_COOLDOWN')
})

test('removing a student from the roster puts their UID back to "hasn\'t taken mess"', async () => {
  await t.api('/students', { token: warden, body: { uid: '22000006', hostelId: 'BH1' } })
  assert.equal((await t.api('/auth/send-otp', { body: { uid: '22000006' } })).status, 200)
  assert.equal((await t.api('/students/22000006', { token: warden, method: 'DELETE' })).status, 200)
  const r = await t.api('/auth/send-otp', { body: { uid: '22000006' } })
  assert.equal(r.status, 404)
  assert.equal(r.body.code, 'NOT_ON_MESS')
  assert.ok(dir('22000006'), 'the university record itself is untouched')
})

test('the older explicit sign-up (uid + matching name + typed email) still works for API clients', async () => {
  const uid = '21000200'
  const reg = await t.registerStudent(uid, 'legacy.path@example.com')
  assert.equal(reg.status, 201)
})
