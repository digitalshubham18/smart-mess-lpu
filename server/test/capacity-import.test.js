import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer } from '../test-support/harness.js'

let t
let superAdmin, bh1Admin, bh2Admin
const occupied = (hostelId) => t.db.prepare('SELECT COUNT(*) AS n FROM students WHERE hostel_id = ?').get(hostelId).n

before(async () => {
  t = await startTestServer()
  superAdmin = await t.superAdminToken()
  bh1Admin = await t.staffToken('ADMIN', 'BH1')
  bh2Admin = await t.staffToken('ADMIN', 'BH2')
})
after(async () => { await t.close() })

const student = (n, extra = {}) => ({ name: `Capacity Person ${n}`, email: `cap${n}@example.com`, noUid: true, noUidReason: 'test fixture', ...extra })

// --- capacity -----------------------------------------------------------------

test('capacity: a 3-bed hostel takes 3 students and refuses the 4th, with a clear message and nothing written', async () => {
  const made = await t.api('/hostels', { token: superAdmin, body: { id: 'TINY1', name: 'Tiny Hostel 1', category: 'general', capacity: 3 } })
  assert.equal(made.status, 201)

  for (let i = 1; i <= 3; i++) {
    const r = await t.api('/students', { token: superAdmin, body: student(i, { hostelId: 'TINY1' }) })
    assert.equal(r.status, 201, `student ${i} should fit`)
  }
  const fourth = await t.api('/students', { token: superAdmin, body: student(4, { hostelId: 'TINY1' }) })
  assert.equal(fourth.status, 409)
  assert.equal(fourth.body.code, 'HOSTEL_FULL')
  assert.match(fourth.body.error, /TINY1 is at full capacity \(3\/3 beds\)/)
  assert.equal(occupied('TINY1'), 3)
  assert.equal(t.db.prepare("SELECT COUNT(*) AS n FROM students WHERE email = 'cap4@example.com'").get().n, 0)
})

test('capacity: the exact scenario from the audit — student #113 into a 112-bed hostel', async () => {
  // BH1 is seeded with 100 of 112 beds. Fill to the brim through the real endpoint…
  const filler = Array.from({ length: 12 }, (_, i) => ({ line: i + 2, data: student(1000 + i, { hostelId: 'BH1' }) }))
  const bulk = await t.api('/students/bulk', { token: bh1Admin, body: { rows: filler } })
  assert.equal(bulk.status, 201)
  assert.equal(bulk.body.created, 12)
  assert.equal(occupied('BH1'), 112)

  // …and the 113th is refused.
  const r113 = await t.api('/students', { token: bh1Admin, body: student(9999, { hostelId: 'BH1' }) })
  assert.equal(r113.status, 409)
  assert.equal(r113.body.code, 'HOSTEL_FULL')
  assert.equal(r113.body.capacity, 112)
  assert.equal(r113.body.occupied, 112)
  assert.equal(occupied('BH1'), 112)
})

test('capacity: GET /hostels reports available beds consistently with what is enforced', async () => {
  const { body } = await t.api('/hostels')
  const bh1 = body.find((h) => h.id === 'BH1')
  const bh2 = body.find((h) => h.id === 'BH2')
  assert.equal(bh1.students, 112)
  assert.equal(bh1.available, 0)
  assert.equal(bh2.available, 112 - 100)
})

test('capacity: a transfer INTO a full hostel is refused and the student stays put', async () => {
  const mover = t.db.prepare("SELECT id FROM students WHERE hostel_id = 'BH2' LIMIT 1").get().id
  const { status, body } = await t.api(`/students/${mover}/transfer`, { token: superAdmin, body: { hostelId: 'BH1' } })
  assert.equal(status, 409)
  assert.equal(body.code, 'HOSTEL_FULL')
  assert.equal(t.db.prepare('SELECT hostel_id FROM students WHERE id = ?').get(mover).hostel_id, 'BH2')
})

test('capacity: a Super Admin PATCH that moves a student into a full hostel is refused too (no back door around transfer)', async () => {
  const mover = t.db.prepare("SELECT id FROM students WHERE hostel_id = 'BH2' LIMIT 1").get().id
  const { status, body } = await t.api(`/students/${mover}`, { token: superAdmin, method: 'PATCH', body: { hostelId: 'BH1' } })
  assert.equal(status, 409)
  assert.equal(body.code, 'HOSTEL_FULL')
})

test('capacity: editing a student already in a full hostel is NOT blocked (only moving in is)', async () => {
  const resident = t.db.prepare("SELECT id FROM students WHERE hostel_id = 'BH1' LIMIT 1").get().id
  const { status } = await t.api(`/students/${resident}`, { token: bh1Admin, method: 'PATCH', body: { room: 'Q-7', hostelId: 'BH1' } })
  assert.equal(status, 200)
})

test('capacity: freeing a bed makes it available again (delete → add succeeds → next one refused)', async () => {
  const leaver = t.db.prepare("SELECT id FROM students WHERE hostel_id = 'BH1' AND email LIKE 'cap10%@example.com' LIMIT 1").get().id
  assert.equal((await t.api(`/students/${leaver}`, { token: bh1Admin, method: 'DELETE' })).body.success, true)
  assert.equal((await t.api('/students', { token: bh1Admin, body: student(2001, { hostelId: 'BH1' }) })).status, 201)
  assert.equal((await t.api('/students', { token: bh1Admin, body: student(2002, { hostelId: 'BH1' }) })).status, 409)
})

test('capacity: a transfer that frees a bed in the source and fits in the destination succeeds', async () => {
  const mover = t.db.prepare("SELECT id FROM students WHERE hostel_id = 'BH1' LIMIT 1").get().id
  const r = await t.api(`/students/${mover}/transfer`, { token: superAdmin, body: { hostelId: 'BH2', room: 'T-1' } })
  assert.equal(r.status, 200)
  assert.equal(r.body.hostelId, 'BH2')
})

// --- bulk import --------------------------------------------------------------

test('bulk: a mixed file imports the good rows and reports each bad row with its line number and reason', async () => {
  const before = occupied('BH2')
  const rows = [
    { line: 2, data: student(3001, { year: 2, branch: 'Civil', mealPreference: 'veg' }) },                 // ok (hostel defaults to BH2 for this admin)
    { line: 3, data: { name: 'X', email: 'short-name@example.com' } },                                      // name too short
    { line: 4, data: { name: 'Bad Email Person', email: 'not-an-email' } },                                 // invalid email
    { line: 5, data: student(3001) },                                                                        // duplicate of line 2 (same email, inside the file)
    { line: 6, data: student(3002, { hostelId: 'BH5' }) },                                                  // another mess — out of scope
    { line: 7, data: student(3003, { year: 'second' }) },                                                   // year isn't a number
    { line: 8, data: student(3004) },                                                                        // ok
    { line: 9, data: { ...student(3005), email: 'CAP3001@EXAMPLE.COM' } },                                  // same email as line 2, different case
  ]
  const { status, body } = await t.api('/students/bulk', { token: bh2Admin, body: { rows } })
  assert.equal(status, 201)
  assert.equal(body.created, 2)
  const byLine = Object.fromEntries(body.failed.map((f) => [f.line, f]))
  assert.deepEqual(Object.keys(byLine).map(Number).sort((a, b) => a - b), [3, 4, 5, 6, 7, 9])
  assert.match(byLine[3].error, /name/i)
  assert.match(byLine[4].error, /email/i)
  assert.match(byLine[5].error, /already exists/i)
  assert.equal(byLine[6].code, 'OUT_OF_SCOPE')
  assert.match(byLine[7].error, /year/i)
  assert.match(byLine[9].error, /already exists/i, 'email uniqueness is case-insensitive, matching how login matches emails')
  assert.equal(occupied('BH2'), before + 2)
  assert.equal(t.db.prepare("SELECT COUNT(*) AS n FROM students WHERE email = 'cap3002@example.com'").get().n, 0, 'the BH5 row must not have been written')
})

test('bulk: imported students get real, sequential, unique UIDs and the defaults the single-add path uses', async () => {
  const { body } = await t.api('/students/bulk', { token: bh2Admin, body: { rows: [{ line: 2, data: student(3101) }, { line: 3, data: student(3102) }] } })
  assert.equal(body.created, 2)
  const rows = t.db.prepare("SELECT id, room, year, branch, meal_preference, status, hostel_id FROM students WHERE email IN ('cap3101@example.com','cap3102@example.com') ORDER BY id").all()
  assert.equal(rows.length, 2)
  assert.equal(Number(rows[1].id), Number(rows[0].id) + 1)
  assert.deepEqual({ room: rows[0].room, year: rows[0].year, branch: rows[0].branch, meal_preference: rows[0].meal_preference, status: rows[0].status, hostel_id: rows[0].hostel_id },
    { room: 'Unassigned', year: 1, branch: 'Not specified', meal_preference: 'either', status: 'active', hostel_id: 'BH2' })
})

test('bulk: capacity is enforced row by row — a file that overfills admits up to the last free bed, rejects the rest', async () => {
  await t.api('/hostels', { token: superAdmin, body: { id: 'TINY2', name: 'Tiny Hostel 2', category: 'general', capacity: 5 } })
  await t.api('/students', { token: superAdmin, body: student(4001, { hostelId: 'TINY2' }) })
  const rows = Array.from({ length: 8 }, (_, i) => ({ line: i + 2, data: student(4100 + i, { hostelId: 'TINY2' }) }))
  const { status, body } = await t.api('/students/bulk', { token: superAdmin, body: { rows } })
  assert.equal(status, 201)
  assert.equal(body.created, 4) // 1 already there + 4 = 5/5
  assert.equal(body.failed.length, 4)
  assert.ok(body.failed.every((f) => f.code === 'HOSTEL_FULL' && /TINY2 is at full capacity \(5\/5 beds\)/.test(f.error)))
  assert.deepEqual(body.failed.map((f) => f.line), [6, 7, 8, 9], 'the LAST rows are the ones refused')
  assert.equal(occupied('TINY2'), 5)
})

test('bulk: Super Admin must name a hostel per row; a scoped admin may omit it', async () => {
  const sa = await t.api('/students/bulk', { token: superAdmin, body: { rows: [{ line: 2, data: student(5001) }] } })
  assert.equal(sa.status, 422)
  assert.equal(sa.body.created, 0)
  assert.match(sa.body.failed[0].error, /hostelId is required/)

  const own = await t.api('/students/bulk', { token: bh2Admin, body: { rows: [{ line: 2, data: student(5002) }] } })
  assert.equal(own.body.created, 1)
})

test('bulk: unknown hostel is reported per row', async () => {
  const { body } = await t.api('/students/bulk', { token: superAdmin, body: { rows: [{ line: 4, data: student(5101, { hostelId: 'NOPE99' }) }] } })
  assert.match(body.failed[0].error, /Unknown hostel/)
})

test('bulk: students and non-roster staff cannot use it; limits and shape are enforced', async () => {
  const kitchen = await t.staffToken('KITCHEN_STAFF', 'BH2')
  assert.equal((await t.api('/students/bulk', { token: kitchen, body: { rows: [{ line: 2, data: student(5201) }] } })).status, 403)
  assert.equal((await t.api('/students/bulk', { body: { rows: [] } })).status, 401)
  assert.equal((await t.api('/students/bulk', { token: bh2Admin, body: { rows: [] } })).status, 400)
  const tooMany = Array.from({ length: 1001 }, (_, i) => ({ line: i + 2, data: student(6000 + i) }))
  assert.equal((await t.api('/students/bulk', { token: bh2Admin, body: { rows: tooMany } })).status, 400)
})

test('bulk: the import is recorded in the audit log', async () => {
  const { body } = await t.api('/audit-log?action=students_imported', { token: superAdmin })
  assert.ok(body.length >= 3)
  assert.ok(body.some((e) => /Imported 2 students from CSV into BH2/.test(e.summary) && e.actor_role === 'ADMIN'))
})

test('bulk: a large import is one fast transaction (500 rows)', async () => {
  await t.api('/hostels', { token: superAdmin, body: { id: 'BIG1', name: 'Big Hostel', category: 'general', capacity: 600 } })
  const rows = Array.from({ length: 500 }, (_, i) => ({ line: i + 2, data: student(70000 + i, { hostelId: 'BIG1' }) }))
  const started = Date.now()
  const { status, body } = await t.api('/students/bulk', { token: superAdmin, body: { rows } })
  const ms = Date.now() - started
  assert.equal(status, 201)
  assert.equal(body.created, 500)
  assert.ok(ms < 5000, `500-row import took ${ms}ms`)
})
