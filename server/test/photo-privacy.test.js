import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer } from '../test-support/harness.js'

/** DPDP: a photo is held only with recorded consent, and is erased when the student leaves the mess or withdraws. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
let t, warden, student, studentTok, sweep, privacy

before(async () => {
  t = await startTestServer()
  privacy = await import('../src/privacy.js')
  sweep = (await import('../src/scheduler.js')).runHousekeeping
  student = t.db.prepare('SELECT id, hostel_id, name FROM students WHERE hostel_id = ? ORDER BY id LIMIT 1').get('BH7')
  t.db.prepare('UPDATE students SET password_hash = (SELECT password_hash FROM staff WHERE id = ?) WHERE id = ?').run('10001', student.id)
  warden = await t.staffToken('HOSTEL_WARDEN', 'BH7')
  studentTok = await t.login(student.id)
})
after(async () => { await t.close() })

const row = () => t.db.prepare('SELECT photo_data, photo_consent_at, photo_consent_method, photo_consent_by, photo_notice_version, status FROM students WHERE id = ?').get(student.id)
const photoSet = () => t.api(`/students/${student.id}/photo`, { token: warden, body: { dataUrl: PNG, consent: true } })

test('the notice is public, versioned, and says what is kept, why, who sees it, how long, and how to withdraw', async () => {
  const r = await t.api('/students/photo-notice')
  assert.equal(r.status, 200)
  assert.equal(r.body.version, privacy.PHOTO_NOTICE_VERSION)
  const text = JSON.stringify(r.body).toLowerCase()
  for (const must of ['why', 'who can see', 'how long', 'withdraw', 'under 18', 'face recognition']) assert.ok(text.includes(must), `notice mentions "${must}"`)
})

test('a photo cannot be stored without consent; with the warden confirming it, consent is recorded (who, when, how, which notice)', async () => {
  const refused = await t.api(`/students/${student.id}/photo`, { token: warden, body: { dataUrl: PNG } })
  assert.equal(refused.status, 400)
  assert.equal(refused.body.code, 'CONSENT_REQUIRED')
  assert.equal(row().photo_data, null)
  assert.equal((await photoSet()).status, 200)
  const r = row()
  assert.ok(r.photo_data)
  assert.ok(r.photo_consent_at)
  assert.equal(r.photo_consent_method, 'staff_attested')
  assert.ok(r.photo_consent_by)
  assert.equal(r.photo_notice_version, privacy.PHOTO_NOTICE_VERSION)
  // consent is on record now, so a replacement photo needs no second confirmation
  assert.equal((await t.api(`/students/${student.id}/photo`, { token: warden, body: { dataUrl: PNG } })).status, 200)
})

test('the student sees what is held, can give consent themselves, and nobody else can use these endpoints', async () => {
  const me = await t.api('/students/me/privacy', { token: studentTok })
  assert.equal(me.status, 200)
  assert.equal(me.body.photoOnFile, true)
  assert.equal(me.body.consentGiven, true)
  assert.equal((await t.api('/students/me/privacy', { token: warden })).status, 403)
  assert.equal((await t.api('/students/me/photo-consent', { token: warden, body: {} })).status, 403)
  assert.equal((await t.api('/students/me/photo-consent', { token: warden, method: 'DELETE' })).status, 403)
})

test('withdrawing consent deletes the photo itself — not just hides it — and the consent record', async () => {
  const r = await t.api('/students/me/photo-consent', { token: studentTok, method: 'DELETE' })
  assert.equal(r.status, 200)
  assert.equal(r.body.photoOnFile, false)
  assert.equal(r.body.consentGiven, false)
  const x = row()
  assert.equal(x.photo_data, null)
  assert.equal(x.photo_consent_at, null)
  assert.ok(t.db.prepare("SELECT 1 FROM audit_log WHERE action = 'student_photo_erased' AND summary LIKE ?").get(`%${student.id}%consent withdrawn%`), 'erasure is evidenced in the audit log')
  assert.equal((await t.api(`/students/${student.id}`, { token: warden })).body.hasPhoto, false)
})

test('a student who agrees in the app has consent on record, and a warden can then upload without re-confirming', async () => {
  const g = await t.api('/students/me/photo-consent', { token: studentTok, body: {} })
  assert.equal(g.status, 200)
  assert.equal(g.body.consentGiven, true)
  assert.equal(g.body.consentMethod, 'student_app')
  assert.equal((await t.api(`/students/${student.id}/photo`, { token: warden, body: { dataUrl: PNG } })).status, 200)
  assert.ok(row().photo_data)
})

test('leaving the mess (status inactive) erases the photo at once; coming back needs fresh consent', async () => {
  const off = await t.api(`/students/${student.id}`, { token: warden, method: 'PATCH', body: { status: 'inactive' } })
  assert.equal(off.status, 200)
  const x = row()
  assert.equal(x.photo_data, null)
  assert.equal(x.photo_consent_at, null)
  await t.api(`/students/${student.id}`, { token: warden, method: 'PATCH', body: { status: 'active' } })
  assert.equal((await t.api(`/students/${student.id}/photo`, { token: warden, body: { dataUrl: PNG } })).body.code, 'CONSENT_REQUIRED')
})

test('editing an active student leaves their photo alone', async () => {
  await photoSet()
  await t.api(`/students/${student.id}`, { token: warden, method: 'PATCH', body: { room: 'Z-1' } })
  assert.ok(row().photo_data)
})

test('the daily sweep catches a leaver the live path missed (e.g. status changed straight in the database)', async () => {
  t.db.prepare("UPDATE students SET status = 'inactive' WHERE id = ?").run(student.id)
  assert.ok(row().photo_data, 'precondition: the photo is still there')
  const r = sweep()
  assert.ok(r.photosErased >= 1)
  assert.equal(row().photo_data, null)
  t.db.prepare("UPDATE students SET status = 'active' WHERE id = ?").run(student.id)
})

test('removing a student from the roster takes the photo with the record, and is audited', async () => {
  const fresh = t.db.prepare("SELECT id FROM students WHERE hostel_id = 'BH7' AND id != ? ORDER BY id DESC LIMIT 1").get(student.id).id
  assert.equal((await t.api(`/students/${fresh}/photo`, { token: warden, body: { dataUrl: PNG, consent: true } })).status, 200)
  const del = await t.api(`/students/${fresh}`, { token: warden, method: 'DELETE' })
  assert.equal(del.status, 200)
  assert.equal(t.db.prepare('SELECT 1 FROM students WHERE id = ?').get(fresh), undefined)
  assert.ok(t.db.prepare("SELECT 1 FROM audit_log WHERE action = 'student_removed' AND summary LIKE ?").get(`%${fresh}%photo was deleted%`))
})

test('a university-record photo is not carried onto a bulk-imported roster row unless that row says the student agreed', async () => {
  t.db.prepare("UPDATE university_directory SET photo_data = ? WHERE uid IN ('22000021', '22000022')").run(PNG)
  const r = await t.api('/students/bulk', { token: warden, body: { rows: [
    { line: 1, data: { uid: '22000021', hostelId: 'BH7' } },
    { line: 2, data: { uid: '22000022', hostelId: 'BH7', photoConsent: 'yes' } },
  ] } })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  assert.equal(t.db.prepare("SELECT photo_data IS NOT NULL AS has FROM students WHERE id = '22000021'").get().has, 0)
  assert.equal(t.db.prepare("SELECT photo_data IS NOT NULL AS has FROM students WHERE id = '22000022'").get().has, 1)
  assert.ok(t.db.prepare("SELECT photo_consent_at FROM students WHERE id = '22000022'").get().photo_consent_at)
})

test('an erased photo is really gone from the database FILE, not just unreferenced (secure_delete)', async () => {
  const fs = await import('node:fs')
  const marker = 'ZZ-UNIQUE-PHOTO-MARKER-' + 'Q'.repeat(400)
  const id = t.db.prepare("SELECT id FROM students WHERE hostel_id = 'BH7' AND photo_data IS NULL LIMIT 1").get().id
  const payload = 'data:image/png;base64,' + Buffer.from(marker).toString('base64')
  t.db.prepare('UPDATE students SET photo_data = ?, photo_consent_at = ? WHERE id = ?').run(payload, new Date().toISOString(), id)
  t.db.pragma('wal_checkpoint(TRUNCATE)')
  assert.ok(fs.readFileSync(process.env.DB_PATH).includes(Buffer.from(payload.slice(0, 120))), 'precondition: the bytes are in the file')
  privacy.erasePhoto(id, { reason: 'test' })
  t.db.pragma('wal_checkpoint(TRUNCATE)')
  assert.ok(!fs.readFileSync(process.env.DB_PATH).includes(Buffer.from(payload.slice(0, 120))), 'the photo bytes were overwritten')
})
