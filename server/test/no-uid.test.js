import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer } from '../test-support/harness.js'

/**
 * Adding a student needs a UID. A student who genuinely has none yet is added explicitly ("No UID yet", with a
 * reason) and holds a clearly-marked temporary ID (TMP-00001…) until staff assign the real UID — never a made-up
 * number that looks like one.
 */
let t, warden, wardenBH2
before(async () => {
  t = await startTestServer()
  warden = await t.staffToken('HOSTEL_WARDEN', 'BH1')
  wardenBH2 = await t.staffToken('HOSTEL_WARDEN', 'BH2')
})
after(() => t.close())

const addNoUid = (n, extra = {}) => t.api('/students', { token: warden, body: { name: `Newcomer Number${n}`, email: `newcomer${n}@example.com`, hostelId: 'BH1', noUid: true, noUidReason: 'new admission, UID pending', ...extra } })

test('a UID is required: leaving it out without choosing "No UID yet" is refused with an explanation', async () => {
  const r = await t.api('/students', { token: warden, body: { name: 'Forgetful Person', email: 'forgetful@example.com', hostelId: 'BH1' } })
  assert.equal(r.status, 400)
  assert.match(r.body.error, /UID is required.*No UID yet/i)
  assert.equal(t.db.prepare("SELECT COUNT(*) n FROM students WHERE email = 'forgetful@example.com'").get().n, 0)
})

test('"No UID yet" needs a reason, a name and an email — and cannot be combined with a UID', async () => {
  const noReason = await t.api('/students', { token: warden, body: { name: 'No Reason Person', email: 'noreason@example.com', hostelId: 'BH1', noUid: true } })
  assert.equal(noReason.status, 400)
  assert.match(noReason.body.error, /why there is no UID/i)
  const noName = await t.api('/students', { token: warden, body: { email: 'nn@example.com', hostelId: 'BH1', noUid: true, noUidReason: 'pending' } })
  assert.equal(noName.status, 400)
  const both = await t.api('/students', { token: warden, body: { uid: '22000001', noUid: true, noUidReason: 'x', hostelId: 'BH1' } })
  assert.equal(both.status, 400)
})

test('no UID yet → a TMP- temporary ID, flagged provisional, audited with the reason; IDs are sequential and never UID-shaped', async () => {
  const a = await addNoUid(1)
  assert.equal(a.status, 201)
  assert.match(a.body.id, /^TMP-\d{5}$/)
  assert.equal(a.body.provisional, true)
  const b = await addNoUid(2)
  assert.equal(b.body.id, `TMP-${String(Number(a.body.id.slice(4)) + 1).padStart(5, '0')}`)
  assert.ok(!/^\d{8}$/.test(a.body.id), 'cannot be mistaken for, or collide with, a real 8-digit UID')
  const audit = t.db.prepare("SELECT summary FROM audit_log WHERE action = 'student_enrolled_no_uid' ORDER BY rowid DESC LIMIT 1").get()
  assert.match(audit.summary, /TMP-\d{5}.*new admission, UID pending/)
  // students added WITH a UID are never provisional
  const real = await t.api('/students', { token: warden, body: { uid: '22000001', hostelId: 'BH1' } })
  assert.equal(real.body.provisional, false)
})

test('a temporary-ID student is on the roster for the mess: they can be checked in, but cannot create an app login yet', async () => {
  const s = (await addNoUid(3)).body
  const kitchen = await t.staffToken('KITCHEN_STAFF', 'BH1')
  const day = new Date().toISOString().slice(0, 10)
  const ci = await t.api('/attendance/checkin', { token: kitchen, body: { uid: s.id, messId: 'MESS-BH1', meal: 'lunch', date: day } })
  assert.equal(ci.status, 201)
  const otp = await t.api('/auth/send-otp', { body: { uid: s.id } })
  assert.equal(otp.status, 403)
  assert.equal(otp.body.code, 'TEMP_ID')
  assert.match(otp.body.error, /visit the warden office/i)
  const login = await t.api('/auth/login', { body: { identifier: s.id, password: 'password1' } })
  assert.ok([401, 403, 404].includes(login.status))
})

test('assign-uid swaps the temporary ID for the real UID everywhere, so history follows the student', async () => {
  const s = (await addNoUid(4)).body
  const kitchen = await t.staffToken('KITCHEN_STAFF', 'BH1')
  const day = new Date().toISOString().slice(0, 10)
  await t.api('/attendance/checkin', { token: kitchen, body: { uid: s.id, messId: 'MESS-BH1', meal: 'dinner', date: day } })
  t.setIntentionDirect(s.id, day, 'lunch', 'will_eat')
  t.db.prepare("INSERT INTO fines (id, student_id, mess_id, amount, month, issued_at, paid) VALUES ('F-TMP', ?, 'MESS-BH1', 50, '2026-10', datetime('now'), 0)").run(s.id)

  const r = await t.api(`/students/${s.id}/assign-uid`, { token: warden, body: { uid: '22000002' } })
  assert.equal(r.status, 200)
  assert.equal(r.body.id, '22000002')
  assert.equal(r.body.provisional, false)
  assert.equal(t.db.prepare('SELECT COUNT(*) n FROM students WHERE id = ?').get(s.id).n, 0, 'the temporary ID is gone')
  for (const [table, col] of [['attendance', 'student_id'], ['meal_intentions', 'student_id'], ['fines', 'student_id']]) {
    assert.equal(t.db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${col} = ?`).get(s.id).n, 0, `${table} no longer points at the old ID`)
    assert.equal(t.db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${col} = ?`).get('22000002').n, 1, `${table} followed the student`)
  }
  // the university record is now the source of truth for the details, like any student added by UID
  const rec = t.db.prepare('SELECT * FROM university_directory WHERE uid = ?').get('22000002')
  assert.equal(r.body.name, rec.name)
  assert.equal(r.body.email, rec.email)
  assert.ok(t.db.prepare("SELECT 1 FROM audit_log WHERE action = 'student_uid_assigned' AND summary LIKE ?").get(`%22000002%${s.id}%`))
  // and now they can sign up like everyone else
  const lookup = await t.api('/students/lookup/22000002')
  assert.equal(lookup.status, 200)
  assert.ok(lookup.body && lookup.body.alreadyRegistered === false)
})

test('assign-uid refuses: a UID already on a roster, a student who already has a real UID, another mess, and bad input', async () => {
  const s = (await addNoUid(5)).body
  const taken = await t.api(`/students/${s.id}/assign-uid`, { token: warden, body: { uid: '21000001' } })
  assert.equal(taken.status, 409)
  assert.equal(taken.body.code, 'UID_TAKEN')
  const already = await t.api('/students/22000002/assign-uid', { token: warden, body: { uid: '22000003' } })
  assert.equal(already.status, 409)
  assert.equal(already.body.code, 'NOT_PROVISIONAL')
  assert.equal((await t.api(`/students/${s.id}/assign-uid`, { token: wardenBH2, body: { uid: '22000004' } })).status, 403)
  assert.equal((await t.api(`/students/${s.id}/assign-uid`, { token: warden, body: { uid: 'abc' } })).status, 400)
  assert.equal((await t.api(`/students/${s.id}/assign-uid`, { body: { uid: '22000004' } })).status, 401)
  assert.equal(t.db.prepare('SELECT provisional FROM students WHERE id = ?').get(s.id).provisional, 1, 'nothing changed')
  const kitchen = await t.staffToken('KITCHEN_STAFF', 'BH1')
  assert.equal((await t.api(`/students/${s.id}/assign-uid`, { token: kitchen, body: { uid: '22000004' } })).status, 403)
})

test('a real UID that is not in the university records can still be assigned; details stay as entered', async () => {
  const s = (await addNoUid(6)).body
  const r = await t.api(`/students/${s.id}/assign-uid`, { token: warden, body: { uid: '88888888' } })
  assert.equal(r.status, 200)
  assert.equal(r.body.id, '88888888')
  assert.equal(r.body.name, 'Newcomer Number6')
})

test('bulk import: rows need a UID too; a row can opt in to "no UID yet" and gets a temporary ID', async () => {
  const r = await t.api('/students/bulk', { token: warden, body: { rows: [
    { line: 2, data: { name: 'Bulk Missing Uid', email: 'bulkmissing@example.com' } },
    { line: 3, data: { name: 'Bulk Pending Uid', email: 'bulkpending@example.com', noUid: true } },
    { line: 4, data: { uid: '22000005' } },
  ] } })
  assert.equal(r.status, 201)
  assert.equal(r.body.created, 2)
  assert.deepEqual(r.body.failed.map((f) => f.line), [2])
  assert.match(r.body.failed[0].error, /UID is required/i)
  assert.match(t.db.prepare("SELECT id FROM students WHERE email = 'bulkpending@example.com'").get().id, /^TMP-\d{5}$/)
})
