import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'
import { startTestServer } from '../test-support/harness.js'

/**
 * The meal-counter scan: a student shows a signed, 60-second QR from their own phone; the counter scans it in the meal's
 * serving window; the server verifies it against the database and answers with the student's record and photo.
 */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
let t, student, messId, studentToken, kitchen, otherKitchen, warden, localParts, mealStatus

before(async () => {
  t = await startTestServer()
  ;({ localParts, mealStatus } = await import('../src/mealWindows.js')) // after startTestServer: it loads db.js
  student = t.db.prepare('SELECT id, hostel_id, name FROM students WHERE password_hash IS NOT NULL ORDER BY id LIMIT 1').get()
  messId = t.db.prepare('SELECT id FROM messes WHERE hostel_id = ?').get(student.hostel_id).id
  studentToken = await t.login(student.id)
  kitchen = await t.staffToken('KITCHEN_STAFF', student.hostel_id)
  warden = await t.staffToken('HOSTEL_WARDEN', student.hostel_id)
  const otherHostel = student.hostel_id === 'BH5' ? 'BH4' : 'BH5'
  otherKitchen = await t.staffToken('KITCHEN_STAFF', otherHostel)
})
after(() => t.close())

const checkin = (body, token = kitchen) => t.api('/attendance/checkin', { token, body })
const getQr = async (token = studentToken) => (await t.api('/attendance/my-qr', { token })).body.token
const clear = () => t.db.prepare('DELETE FROM attendance').run()

/** A scan instant at a given mess-local time (Asia/Kolkata, UTC+5:30, no DST) within the last 24h → { scannedAt, date }. */
function at(hhmm) {
  const today = localParts().date
  let instant = Date.parse(`${today}T${hhmm}:00+05:30`)
  if (instant > Date.now() - 60_000) instant -= 86_400_000
  return { scannedAt: new Date(instant).toISOString(), date: localParts(new Date(instant)).date }
}

test('my-qr: only the student gets one, it is a short-lived signed token, and it is useless as a login', async () => {
  const r = await t.api('/attendance/my-qr', { token: studentToken })
  assert.equal(r.status, 200)
  assert.equal(r.body.studentId, student.id)
  assert.equal(r.body.ttlSeconds, 60)
  assert.notEqual(r.body.token, student.id, 'it is NOT the plain UID')
  assert.ok(r.body.token.split('.').length === 3)
  const exp = jwt.decode(r.body.token).exp - jwt.decode(r.body.token).iat
  assert.equal(exp, 60)
  assert.equal((await t.api('/students', { token: r.body.token })).status, 401, 'cannot be used as a session')
  assert.equal((await t.api('/attendance/my-qr', { token: kitchen })).status, 403)
  assert.equal((await t.api('/attendance/my-qr')).status, 401)
})

test('a genuine QR checks the student in: record, hostel, room, photo link, method and time all come from the database', async () => {
  clear()
  const r = await checkin({ qr: await getQr(), messId, meal: 'lunch', ...at('13:00') })
  assert.equal(r.status, 201)
  assert.equal(r.body.studentId, student.id)
  assert.equal(r.body.studentName, student.name)
  assert.equal(r.body.method, 'qr')
  assert.ok(r.body.hostelName && r.body.room)
  assert.equal(r.body.photoUrl, `/students/${student.id}/photo`)
  assert.ok(!Number.isNaN(Date.parse(r.body.scannedAt)))
  assert.equal(t.db.prepare('SELECT method FROM attendance WHERE student_id = ?').get(student.id).method, 'qr')
  assert.match(t.db.prepare("SELECT summary FROM audit_log WHERE action = 'meal_checked_in' ORDER BY rowid DESC LIMIT 1").get().summary, /by QR scan/)
})

test('forged, expired and wrong-kind QR codes are refused with a clear reason', async () => {
  const when = at('13:00')
  const base = { messId, meal: 'lunch', ...when }
  assert.equal((await checkin({ ...base, qr: student.id.padEnd(12, '0') })).body.code, 'QR_INVALID') // a hand-made "QR of the UID"
  const forged = jwt.sign({ sub: student.id, purpose: 'meal-qr', jti: 'x' }, 'not-the-secret', { expiresIn: 60 })
  assert.equal((await checkin({ ...base, qr: forged })).body.code, 'QR_INVALID')
  const expired = jwt.sign({ sub: student.id, purpose: 'meal-qr', jti: 'y' }, 'test-secret', { expiresIn: -5 })
  const e = await checkin({ ...base, qr: expired })
  assert.equal(e.status, 400)
  assert.equal(e.body.code, 'QR_EXPIRED')
  assert.match(e.body.error, /screenshots don't work/i)
  // a login session token is not a meal QR
  assert.equal((await checkin({ ...base, qr: studentToken })).body.code, 'QR_INVALID')
  // a QR can't carry a different kind of identity than a student
  const wrongPurpose = jwt.sign({ sub: student.id, purpose: 'mfa' }, 'test-secret', { expiresIn: 60 })
  assert.equal((await checkin({ ...base, qr: wrongPurpose })).body.code, 'QR_INVALID')
  assert.equal(t.db.prepare('SELECT COUNT(*) n FROM attendance').get().n, 1, 'nothing was recorded by any of those') // the one from the previous test
})

test('needs exactly one of qr / uid', async () => {
  const base = { messId, meal: 'lunch', ...at('13:00') }
  assert.equal((await checkin(base)).status, 400)
  assert.equal((await checkin({ ...base, qr: await getQr(), uid: student.id })).status, 400)
})

test('typed UID still works for a dead phone, and is recorded as "manual"', async () => {
  clear()
  const r = await checkin({ uid: student.id, messId, meal: 'dinner', ...at('20:00') })
  assert.equal(r.status, 201)
  assert.equal(r.body.method, 'manual')
  assert.match(t.db.prepare("SELECT summary FROM audit_log WHERE action = 'meal_checked_in' ORDER BY rowid DESC LIMIT 1").get().summary, /typed UID/)
})

test('meal timing is enforced at the scan instant, in mess-local time', async () => {
  process.env.ENFORCE_MEAL_WINDOWS = '1'
  try {
    clear()
    const qr = async () => await getQr()
    const ok = await checkin({ qr: await qr(), messId, meal: 'lunch', ...at('13:00') })
    assert.equal(ok.status, 201)
    clear()
    const late = await checkin({ qr: await qr(), messId, meal: 'lunch', ...at('15:00') })
    assert.equal(late.status, 409)
    assert.equal(late.body.code, 'OUTSIDE_MEAL_WINDOW')
    assert.match(late.body.error, /not Lunch time.*12:00–14:30.*ended/i)
    assert.ok(late.body.meals.windows.length === 4)
    const early = await checkin({ qr: await qr(), messId, meal: 'lunch', ...at('11:00') })
    assert.equal(early.status, 409)
    assert.match(early.body.error, /hasn't started/i)
    const wrongMeal = await checkin({ qr: await qr(), messId, meal: 'dinner', ...at('13:00') }) // lunch time, dinner selected
    assert.equal(wrongMeal.status, 409)
    assert.equal((await checkin({ qr: await qr(), messId, meal: 'breakfast', ...at('09:30') })).status, 409, 'the end of a window is exclusive')
    assert.equal((await checkin({ qr: await qr(), messId, meal: 'breakfast', ...at('07:00') })).status, 201, 'the start is inclusive')
    assert.equal(t.db.prepare('SELECT COUNT(*) n FROM attendance').get().n, 1, 'refused scans leave no record')
    // the date must be the mess-local date of the scan
    const w = at('13:00')
    const wrongDate = await checkin({ qr: await qr(), messId, meal: 'lunch', scannedAt: w.scannedAt, date: '2020-01-01' })
    assert.equal(wrongDate.status, 400)
    assert.equal(wrongDate.body.code, 'DATE_MISMATCH')
  } finally { process.env.ENFORCE_MEAL_WINDOWS = '0' }
})

test('mealStatus is exact at the edges (pure)', () => {
  const w = { lunch: { start: 720, end: 870 } }
  assert.equal(mealStatus('lunch', w, 719).open, false)
  assert.equal(mealStatus('lunch', w, 720).open, true)
  assert.equal(mealStatus('lunch', w, 869).open, true)
  assert.equal(mealStatus('lunch', w, 870).open, false)
})

test('GET meal-windows reports server time, every meal, and what is on now / next; counter staff of that mess only', async () => {
  const r = await t.api(`/attendance/meal-windows?messId=${messId}`, { token: kitchen })
  assert.equal(r.status, 200)
  assert.equal(r.body.timezone, 'Asia/Kolkata')
  assert.deepEqual(r.body.windows.map((w) => w.meal), ['breakfast', 'lunch', 'snacks', 'dinner'])
  const lunchW = r.body.windows.find((w) => w.meal === 'lunch')
  assert.deepEqual({ meal: lunchW.meal, start: lunchW.start, end: lunchW.end, crossesMidnight: lunchW.crossesMidnight }, { meal: 'lunch', start: '12:00', end: '14:30', crossesMidnight: false })
  assert.match(lunchW.date, /^\d{4}-\d{2}-\d{2}$/)
  assert.match(r.body.now.time, /^\d\d:\d\d$/)
  assert.equal(r.body.windows.filter((w) => w.open).length <= 1, true)
  assert.equal((await t.api(`/attendance/meal-windows?messId=${messId}`, { token: otherKitchen })).status, 403)
  assert.equal((await t.api(`/attendance/meal-windows?messId=${messId}`, { token: studentToken })).status, 403)
  assert.equal((await t.api('/attendance/meal-windows', { token: kitchen })).status, 400)
})

test('managers can change timings (validated, no overlaps), kitchen staff cannot, and reset restores the defaults', async () => {
  const manager = await t.staffToken('MESS_MANAGER', student.hostel_id)
  assert.equal((await t.api('/attendance/meal-windows', { token: kitchen, method: 'PUT', body: { messId, windows: [{ meal: 'lunch', start: '13:00', end: '15:00' }] } })).status, 403)
  const ok = await t.api('/attendance/meal-windows', { token: manager, method: 'PUT', body: { messId, windows: [{ meal: 'lunch', start: '13:00', end: '15:00' }] } })
  assert.equal(ok.status, 200)
  const lw = ok.body.windows.find((w) => w.meal === 'lunch')
  assert.deepEqual([lw.start, lw.end], ['13:00', '15:00'])
  // now a 14:00 scan is lunch time (it wasn't under the defaults), and 12:30 isn't
  process.env.ENFORCE_MEAL_WINDOWS = '1'
  try {
    clear()
    assert.equal((await checkin({ qr: await getQr(), messId, meal: 'lunch', ...at('14:00') })).status, 201)
    clear()
    assert.equal((await checkin({ qr: await getQr(), messId, meal: 'lunch', ...at('12:30') })).status, 409)
  } finally { process.env.ENFORCE_MEAL_WINDOWS = '0' }
  const bad = [
    { windows: [{ meal: 'lunch', start: '15:00', end: '14:00' }] },
    { windows: [{ meal: 'lunch', start: '9:00', end: '10:00' }] },
    { windows: [{ meal: 'lunch', start: '09:00', end: '13:30' }] }, // overlaps breakfast 07:00–09:30 and snacks? (breakfast overlap)
    {},
  ]
  for (const b of bad) assert.equal((await t.api('/attendance/meal-windows', { token: manager, method: 'PUT', body: { messId, ...b } })).status, 400, JSON.stringify(b))
  const reset = await t.api('/attendance/meal-windows', { token: manager, method: 'PUT', body: { messId, reset: true } })
  assert.equal(reset.body.windows.find((w) => w.meal === 'lunch').start, '12:00')
  assert.ok(t.db.prepare("SELECT 1 FROM audit_log WHERE action = 'meal_windows_changed'").get())
})

test('a QR for a student of ANOTHER mess, or one removed from the roster, or with an inactive membership, is refused', async () => {
  const when = at('13:00')
  clear()
  const qr = await getQr()
  assert.equal((await checkin({ qr, messId, meal: 'lunch', ...when }, otherKitchen)).status, 403, 'other mess staff cannot even try this mess')
  const otherMess = t.db.prepare('SELECT id FROM messes WHERE id != ? LIMIT 1').get(messId).id
  const otherStaff = await t.staffToken('KITCHEN_STAFF', t.db.prepare('SELECT hostel_id FROM messes WHERE id = ?').get(otherMess).hostel_id)
  const notEnrolled = await checkin({ qr, messId: otherMess, meal: 'lunch', ...when }, otherStaff)
  assert.equal(notEnrolled.status, 403)
  assert.equal(notEnrolled.body.code, 'NOT_ENROLLED')

  t.db.prepare("UPDATE students SET status = 'inactive' WHERE id = ?").run(student.id)
  const inactive = await checkin({ qr, messId, meal: 'lunch', ...when })
  assert.equal(inactive.status, 403)
  assert.equal(inactive.body.code, 'MESS_INACTIVE')
  assert.match(inactive.body.error, /warden office/i)
  t.db.prepare("UPDATE students SET status = 'active' WHERE id = ?").run(student.id)

  const orphan = jwt.sign({ sub: '29999999', purpose: 'meal-qr', jti: 'orphan-1' }, 'test-secret', { expiresIn: 60 }) // a signed QR for someone no longer on the roster
  const gone = await checkin({ qr: orphan, messId, meal: 'lunch', ...when })
  assert.equal(gone.status, 404)
  assert.equal(gone.body.code, 'NOT_ON_MESS')
  assert.match(gone.body.error, /warden office/i)
  assert.equal(t.db.prepare('SELECT COUNT(*) n FROM attendance').get().n, 0)
})

test('scanning the same QR twice for one meal is refused the second time, with the first time shown', async () => {
  clear()
  const when = at('13:00')
  assert.equal((await checkin({ qr: await getQr(), messId, meal: 'lunch', ...when })).status, 201)
  const again = await checkin({ qr: await getQr(), messId, meal: 'lunch', ...when })
  assert.equal(again.status, 409)
  assert.equal(again.body.code, 'ALREADY_CHECKED_IN')
  assert.match(again.body.error, /already checked in for lunch at \d\d:\d\d/i)
})

test('official photo: staff upload it, it is served from the database behind login, and the student cannot change it', async () => {
  const otherStudent = t.db.prepare('SELECT id FROM students WHERE id != ? AND hostel_id != ? LIMIT 1').get(student.id, student.hostel_id).id
  const before = await t.api(`/students/${student.id}`, { token: warden })
  assert.equal(before.body.hasPhoto, false)
  // not logged in → nothing; student cannot upload their own; SVG refused; bad scope refused
  assert.equal((await t.api(`/students/${student.id}/photo`, { raw: true })).status, 401)
  assert.equal((await t.api(`/students/${student.id}/photo`, { token: studentToken, body: { dataUrl: PNG } })).status, 403)
  assert.equal((await t.api(`/students/${student.id}/photo`, { token: warden, body: { dataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' } })).status, 400)
  const otherWarden = await t.staffToken('HOSTEL_WARDEN', t.db.prepare('SELECT hostel_id FROM students WHERE id = ?').get(otherStudent).hostel_id)
  assert.equal((await t.api(`/students/${student.id}/photo`, { token: otherWarden, body: { dataUrl: PNG } })).status, 403)

  // No consent on record yet → refused, with a reason the warden can act on (the privacy notice must be shown first).
  const noConsent = await t.api(`/students/${student.id}/photo`, { token: warden, body: { dataUrl: PNG } })
  assert.equal(noConsent.status, 400)
  assert.equal(noConsent.body.code, 'CONSENT_REQUIRED')
  const up = await t.api(`/students/${student.id}/photo`, { token: warden, body: { dataUrl: PNG, consent: true } })
  assert.equal(up.status, 200)
  assert.equal(up.body.hasPhoto, true)
  assert.equal((await t.api(`/students/${student.id}`, { token: warden })).body.hasPhoto, true)

  const img = await t.api(`/students/${student.id}/photo`, { raw: true, token: warden })
  assert.equal(img.status, 200)
  assert.equal(img.headers.get('content-type'), 'image/png')
  assert.equal(img.headers.get('cache-control'), 'private, no-store')
  assert.equal(Buffer.from(await img.arrayBuffer()).toString('base64'), PNG.split(',')[1], 'the exact stored image')
  assert.equal((await t.api(`/students/${student.id}/photo`, { raw: true, token: studentToken })).status, 200, 'the student can see their own')
  assert.equal((await t.api(`/students/${student.id}/photo`, { raw: true, token: otherKitchen })).status, 403, "another mess's staff cannot")
  assert.equal((await t.api(`/students/${otherStudent}/photo`, { raw: true, token: studentToken })).status, 403, "nor another student")

  // the counter's result says a real photo exists
  clear()
  const scan = await checkin({ qr: await getQr(), messId, meal: 'lunch', ...at('13:00') })
  assert.equal(scan.body.hasPhoto, true)

  assert.equal((await t.api(`/students/${student.id}/photo`, { token: warden, method: 'DELETE' })).status, 200)
  assert.equal((await t.api(`/students/${student.id}`, { token: warden })).body.hasPhoto, false)
  const placeholder = await t.api(`/students/${student.id}/photo`, { raw: true, token: warden })
  assert.equal(placeholder.headers.get('content-type'), 'image/svg+xml; charset=utf-8')
})

test('a photo on the university record comes along when a student is added by UID — only if the warden confirms the student agreed', async () => {
  t.db.prepare("UPDATE university_directory SET photo_data = ? WHERE uid = '22000011'").run(PNG)
  // Without the warden confirming the student agreed to the photo notice, the university photo is NOT copied onto the roster.
  const withheld = await t.api('/students', { token: warden, body: { uid: '22000011', hostelId: student.hostel_id } })
  assert.equal(withheld.status, 201)
  assert.equal(withheld.body.hasPhoto, false)
  assert.equal((await t.api('/students/22000011', { token: warden, method: 'DELETE' })).status, 200)
  const r = await t.api('/students', { token: warden, body: { uid: '22000011', hostelId: student.hostel_id, photoConsent: true } })
  assert.equal(r.status, 201)
  assert.equal(r.body.hasPhoto, true)
  assert.equal(r.body.photoConsent, true)
  const img = await t.api('/students/22000011/photo', { raw: true, token: warden })
  assert.equal(img.headers.get('content-type'), 'image/png')
  assert.equal(Buffer.from(await img.arrayBuffer()).toString('base64'), PNG.split(',')[1])
})

test('import-photos.js: loads UID-named images, checks real bytes, and reports what it skipped', async () => {
  const { execFileSync } = await import('node:child_process')
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'photos-'))
  const png = Buffer.from(PNG.split(',')[1], 'base64')
  const target = t.db.prepare("SELECT id FROM students WHERE photo_data IS NULL AND provisional = 0 ORDER BY id LIMIT 1").get().id
  fs.writeFileSync(path.join(dir, `${target}.png`), png)
  fs.writeFileSync(path.join(dir, '29999998.png'), png)                    // UID on no roster and not in the directory
  fs.writeFileSync(path.join(dir, `${target.slice(0, 7)}9.jpg`), 'not an image at all') // not an image, whatever the extension says
  fs.writeFileSync(path.join(dir, 'holiday-snap.png'), png)               // not a UID
  const out = execFileSync('node', ['scripts/import-photos.js', dir], { env: process.env, cwd: path.resolve(import.meta.dirname, '..') }).toString()
  assert.match(out, /set 1 student photo/)
  assert.match(out, /29999998\.png: UID is on no roster/)
  assert.match(out, /not a JPEG, PNG or WebP image/)
  assert.match(out, /holiday-snap\.png: file name is not an 8-digit UID/)
  assert.equal(t.db.prepare('SELECT photo_data FROM students WHERE id = ?').get(target).photo_data, PNG)
})
