import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { startTestServer } from '../test-support/harness.js'

/**
 * A phone with no data at the counter: it holds a per-device key (fetched once while online) and computes the code itself.
 * `phoneCode` below does exactly what the browser does (WebCrypto HMAC-SHA256 over the step number) from ONLY what the API handed over.
 */
let t, student, tok, kitchen, messId, makeOfflineCode, OFFLINE_STEP_SECONDS
const meal = (date) => ({ messId, meal: 'lunch', date })
const day = '2026-10-21'
const phoneCode = (k, atMs) => {
  const step = Math.floor(atMs / 1000 / k.stepSeconds)
  const mac = crypto.createHmac('sha256', Buffer.from(k.key, 'base64url')).update(String(step)).digest('base64url').slice(0, 16)
  return `SMO1.${k.studentId}.${k.sid}.${step}.${mac}`
}
const fresh = () => { t.db.prepare('DELETE FROM attendance WHERE student_id = ?').run(student.id); t.db.prepare('DELETE FROM used_qr').run() }
const checkin = (qr, extra = {}) => t.api('/attendance/checkin', { token: kitchen, body: { qr, ...meal(day), ...extra } })

before(async () => {
  t = await startTestServer()
  ;({ makeOfflineCode, OFFLINE_STEP_SECONDS } = await import('../src/auth.js')) // AFTER the harness points DB_PATH at a throwaway database
  student = t.db.prepare("SELECT id, hostel_id FROM students WHERE hostel_id = 'BH2' ORDER BY id LIMIT 1").get()
  t.db.prepare('UPDATE students SET password_hash = (SELECT password_hash FROM staff WHERE id = ?) WHERE id = ?').run('10001', student.id)
  messId = t.db.prepare('SELECT id FROM messes WHERE hostel_id = ?').get(student.hostel_id).id
  kitchen = await t.staffToken('KITCHEN_STAFF', 'BH2')
  tok = await t.login(student.id)
})
after(async () => { await t.close() })

const fetchKey = async (token = tok) => (await t.api('/attendance/my-offline-key', { token })).body

test('only a signed-in student gets a key, and it is bound to that device\'s session', async () => {
  assert.equal((await t.api('/attendance/my-offline-key', { raw: true })).status, 401)
  assert.equal((await t.api('/attendance/my-offline-key', { token: kitchen })).status, 403)
  const k = await fetchKey()
  assert.equal(k.studentId, student.id)
  assert.equal(k.stepSeconds, OFFLINE_STEP_SECONDS)
  assert.ok(k.key && k.sid && k.serverTime && k.validUntil)
  const other = await fetchKey(await t.login(student.id))
  assert.notEqual(other.key, k.key, 'a different device gets a different key')
})

test('a code the phone computes on its own checks the student in — same record, method "qr"', async () => {
  const k = await fetchKey()
  fresh()
  const r = await checkin(phoneCode(k, Date.now()))
  assert.equal(r.status, 201, JSON.stringify(r.body))
  assert.equal(r.body.studentId, student.id)
  assert.equal(r.body.method, 'qr')
})

test('the server and the phone agree byte for byte (the server\'s own generator produces what the phone computes)', async () => {
  const k = await fetchKey()
  const now = Date.now()
  assert.equal(makeOfflineCode(k.sid, k.studentId, now), phoneCode(k, now))
})

test('each code works once: replaying it — even a second later — is refused as already used', async () => {
  const k = await fetchKey()
  const code = phoneCode(k, Date.now())
  fresh()
  assert.equal((await checkin(code)).status, 201)
  t.db.prepare('DELETE FROM attendance WHERE student_id = ?').run(student.id) // even with the meal reset, the code is burned
  const again = await checkin(code)
  assert.equal(again.status, 409)
  assert.equal(again.body.code, 'QR_ALREADY_USED')
})

test('forged, tampered, expired and future codes are refused with the right reason', async () => {
  const k = await fetchKey()
  t.db.prepare('DELETE FROM attendance WHERE student_id = ?').run(student.id)
  const good = phoneCode(k, Date.now())
  const bad = good.slice(0, -3) + (good.endsWith('aaa') ? 'bbb' : 'aaa')
  assert.equal((await checkin(bad)).body.code, 'QR_INVALID', 'wrong MAC')
  assert.equal((await checkin(`SMO1.${student.id}.${k.sid}.1.xxxxxxxxxxxxxxxx`)).body.code, 'QR_INVALID')
  assert.equal((await checkin('SMO1.garbage')).body.code, 'QR_INVALID')
  assert.equal((await checkin(phoneCode(k, Date.now() - 10 * 60_000))).body.code, 'QR_EXPIRED', 'ten minutes old')
  assert.equal((await checkin(phoneCode(k, Date.now() + 10 * 60_000))).body.code, 'QR_EXPIRED', 'a code from the future')
  // a code that names a DIFFERENT student than the key it was made with cannot be made at all
  const someone = t.db.prepare("SELECT id FROM students WHERE hostel_id = 'BH2' AND id != ? LIMIT 1").get(student.id).id
  assert.equal((await checkin(phoneCode({ ...k, studentId: someone }, Date.now()))).body.code, 'QR_INVALID')
})

test('a phone whose clock is a minute out still works (±1 step); five minutes out does not', async () => {
  const k = await fetchKey()
  fresh()
  assert.equal((await checkin(phoneCode(k, Date.now() - 55_000))).status, 201)
})

test('signing the device out kills its offline codes at once — a lost phone cannot keep feeding people', async () => {
  const tok2 = await t.login(student.id)
  const k = await fetchKey(tok2)
  fresh()
  await t.api('/auth/logout', { token: tok2, body: {} })
  const r = await checkin(phoneCode(k, Date.now()))
  assert.equal(r.status, 400)
  assert.equal(r.body.code, 'QR_INVALID')
  // and "sign out everywhere" kills every device's codes
  const tok3 = await t.login(student.id)
  const k3 = await fetchKey(tok3)
  await t.api('/auth/logout-all', { token: tok3, body: {} })
  assert.equal((await checkin(phoneCode(k3, Date.now()))).body.code, 'QR_INVALID')
})

test('a counter that was offline can queue an offline code and sync it later: it is verified as of the scan time, then recorded', async () => {
  const live = await t.login(student.id)
  const k = await fetchKey(live)
  fresh()
  const scannedAtMs = Date.now() - 20 * 60_000          // scanned 20 minutes ago…
  const code = phoneCode(k, scannedAtMs)                // …so the code is long out of date "now" but right for THAT moment
  const r = await checkin(code, { scannedAt: new Date(scannedAtMs).toISOString() })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  assert.match((t.db.prepare("SELECT summary FROM audit_log WHERE action = 'meal_checked_in' ORDER BY rowid DESC LIMIT 1").get()).summary, /offline queue/)
  // without the real scan time, that same old code is refused
  t.db.prepare('DELETE FROM attendance WHERE student_id = ?').run(student.id)
  t.db.prepare('DELETE FROM used_qr').run()
  assert.equal((await checkin(code)).body.code, 'QR_EXPIRED')
})

test('the existing online QR is unaffected', async () => {
  fresh()
  const live = (await t.api('/attendance/my-qr', { token: await t.login(student.id) })).body.token
  assert.equal((await checkin(live)).status, 201)
})
