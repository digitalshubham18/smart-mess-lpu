import test, { before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { startTestServer } from '../test-support/harness.js'

/**
 * Web Push: devices subscribe, the server pushes check-in confirmations to the student and tamper/volume alerts to the
 * mess managers — to the browser's own push service, never to an arbitrary URL. The transport is stubbed so no network
 * call is made; one test runs the real encryption library on a genuine key pair to prove the VAPID setup is valid.
 */
let secondId, t, push, student, messId, studentToken, otherStudentToken, kitchen, manager, mw
let sent = []   // [{ endpoint, payload }]
let failWith = null

const FCM = (n) => `https://fcm.googleapis.com/fcm/send/device-${n}`
const keys = () => {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys()
  return { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') }
}
const subscribe = (token, endpoint, k = keys()) => t.api('/push/subscribe', { token, body: { subscription: { endpoint, keys: k } } })
const checkin = (body, token = kitchen) => t.api('/attendance/checkin', { token, body })
const wait = () => new Promise((r) => setTimeout(r, 60))
const getQr = async (token = studentToken) => (await t.api('/attendance/my-qr', { token })).body.token
const lunch = () => ({ messId, meal: 'lunch', date: mw.localParts().date })

before(async () => {
  t = await startTestServer()
  push = await import('../src/push.js')
  mw = await import('../src/mealWindows.js')
  push.setPushTransport(async (sub, payload) => {
    if (failWith) throw failWith
    sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) })
  })
  student = t.db.prepare('SELECT id, hostel_id, name FROM students WHERE password_hash IS NOT NULL ORDER BY id LIMIT 1').get()
  // a second student with a login (same demo password) in the same hostel
  const second = t.db.prepare('SELECT id FROM students WHERE hostel_id = ? AND id != ? ORDER BY id LIMIT 1').get(student.hostel_id, student.id)
  t.db.prepare('UPDATE students SET password_hash = (SELECT password_hash FROM students WHERE id = ?) WHERE id = ?').run(student.id, second.id)
  secondId = second.id
  messId = t.db.prepare('SELECT id FROM messes WHERE hostel_id = ?').get(student.hostel_id).id
  studentToken = await t.login(student.id)
  otherStudentToken = await t.login(secondId)
  kitchen = await t.staffToken('KITCHEN_STAFF', student.hostel_id)
  manager = await t.staffToken('MESS_MANAGER', student.hostel_id)
})
after(() => t.close())
beforeEach(() => {
  sent = []; failWith = null
  t.db.prepare('DELETE FROM push_subscriptions').run()
  t.db.prepare('DELETE FROM attendance').run()
  t.db.prepare('DELETE FROM used_qr').run()
  push._resetManagerThrottle()
})

test('the server has one stable VAPID key pair, kept across restarts, and only its PUBLIC half is ever sent', async () => {
  const a = await t.api('/push/public-key', { token: studentToken })
  const b = await t.api('/push/public-key', { token: kitchen })
  assert.equal(a.status, 200)
  assert.equal(a.body.publicKey, b.body.publicKey)
  assert.match(a.body.publicKey, /^[A-Za-z0-9_-]{80,100}$/)
  assert.equal(a.body.publicKey, t.db.prepare("SELECT value FROM app_secrets WHERE key = 'vapid_public'").get().value)
  assert.ok(!JSON.stringify(a.body).includes(t.db.prepare("SELECT value FROM app_secrets WHERE key = 'vapid_private'").get().value))
  assert.equal((await t.api('/push/public-key')).status, 401)
})

test('the VAPID keys and a real browser-style subscription produce a valid encrypted Web Push request', async () => {
  const webpush = (await import('web-push')).default
  const { publicKey, privateKey } = push.getVapid()
  const k = keys()
  const req = webpush.generateRequestDetails({ endpoint: FCM('real'), keys: k }, JSON.stringify({ title: 'Lunch check-in recorded', body: 'SECRET-PLAINTEXT' }), {
    vapidDetails: { subject: 'mailto:admin@lpu.smartmess.edu', publicKey, privateKey }, TTL: 60,
  })
  assert.equal(req.endpoint, FCM('real'))
  assert.match(req.headers.Authorization, /^vapid t=.+, k=/)
  assert.equal(req.headers['Content-Encoding'], 'aes128gcm')
  assert.ok(Buffer.isBuffer(req.body) && !req.body.toString('latin1').includes('SECRET-PLAINTEXT'), 'the message body is encrypted for the device')
})

test('subscribe: a device is stored for the signed-in account and reported by /status', async () => {
  assert.equal((await subscribe(studentToken, FCM(1))).status, 201)
  const on = await t.api(`/push/status?endpoint=${encodeURIComponent(FCM(1))}`, { token: studentToken })
  assert.deepEqual(on.body, { subscribed: true, devices: 1 })
  const other = await t.api(`/push/status?endpoint=${encodeURIComponent(FCM(1))}`, { token: otherStudentToken })
  assert.deepEqual(other.body, { subscribed: false, devices: 0 }, "someone else's device is not 'mine'")
  assert.equal((await subscribe(studentToken, FCM(1))).status, 201, 'subscribing again is harmless')
  assert.equal(t.db.prepare('SELECT COUNT(*) n FROM push_subscriptions').get().n, 1)
  assert.equal((await t.api('/push/subscribe', { body: { subscription: { endpoint: FCM(2), keys: keys() } } })).status, 401)
})

test('only real browser push services are accepted — never an arbitrary or internal URL the server would then call', async () => {
  const bad = [
    'http://fcm.googleapis.com/fcm/send/x',                 // not https
    'https://localhost/x', 'https://127.0.0.1/x', 'https://169.254.169.254/latest/meta-data', 'https://10.0.0.5/x', // internal
    'https://fcm.googleapis.com.evil.example/x',            // look-alike host
    'https://evil.example/fcm.googleapis.com',              // allowed name only in the path
    'https://user:pass@fcm.googleapis.com/x',               // credentials
    'https://fcm.googleapis.com:8443/x',                    // unusual port
    'https://notfcm.googleapis.com.attacker.io/x',
  ]
  for (const endpoint of bad) {
    const r = await subscribe(studentToken, endpoint)
    assert.equal(r.status, 400, endpoint)
    assert.equal(r.body.code, 'BAD_PUSH_ENDPOINT', endpoint)
  }
  for (const endpoint of ['https://fcm.googleapis.com/fcm/send/ok', 'https://updates.push.services.mozilla.com/wpush/v2/ok', 'https://web.push.apple.com/ok', 'https://wns2-par02p.notify.windows.com/w/ok']) {
    assert.equal((await subscribe(studentToken, endpoint)).status, 201, endpoint)
  }
  assert.equal((await t.api('/push/subscribe', { token: studentToken, body: { subscription: { endpoint: FCM(9), keys: { p256dh: 'x', auth: 'y' } } } })).status, 400, 'malformed keys')
  assert.equal(t.db.prepare("SELECT COUNT(*) n FROM push_subscriptions WHERE endpoint LIKE '%evil%' OR endpoint LIKE '%127.0.0.1%'").get().n, 0)
})

test('at most 5 devices per account; re-subscribing an existing device is not a 6th', async () => {
  for (let i = 1; i <= 5; i++) assert.equal((await subscribe(studentToken, FCM(i))).status, 201)
  const sixth = await subscribe(studentToken, FCM(6))
  assert.equal(sixth.status, 409)
  assert.equal(sixth.body.code, 'TOO_MANY_DEVICES')
  assert.equal((await subscribe(studentToken, FCM(3))).status, 201)
})

test('a shared phone belongs to whoever subscribed last, and nobody can unsubscribe someone else\'s device', async () => {
  await subscribe(studentToken, FCM('shared'))
  await subscribe(otherStudentToken, FCM('shared')) // someone else signs in on that phone and turns notifications on
  assert.equal(t.db.prepare('SELECT account_id FROM push_subscriptions WHERE endpoint = ?').get(FCM('shared')).account_id, secondId)
  await checkin({ ...lunch(), qr: await getQr() })
  await wait()
  assert.equal(sent.length, 0, 'the previous owner\'s notifications no longer go to that phone')

  const attempt = await t.api('/push/unsubscribe', { token: studentToken, body: { endpoint: FCM('shared') } })
  assert.equal(attempt.status, 200)
  assert.equal(t.db.prepare('SELECT COUNT(*) n FROM push_subscriptions WHERE endpoint = ?').get(FCM('shared')).n, 1, "not theirs, so not removed")
  await t.api('/push/unsubscribe', { token: otherStudentToken, body: { endpoint: FCM('shared') } })
  assert.equal(t.db.prepare('SELECT COUNT(*) n FROM push_subscriptions').get().n, 0)
})

test('a check-in pushes to the student\'s own devices — and only theirs, and only if they turned it on', async () => {
  await checkin({ ...lunch(), qr: await getQr() })
  await wait()
  assert.equal(sent.length, 0, 'no subscription → no push')

  t.db.prepare('DELETE FROM attendance').run(); t.db.prepare('DELETE FROM used_qr').run()
  await subscribe(studentToken, FCM('phone'))
  await subscribe(studentToken, FCM('tablet'))
  await subscribe(otherStudentToken, FCM('someone-else'))
  const r = await checkin({ ...lunch(), qr: await getQr() })
  assert.equal(r.status, 201)
  await wait()
  assert.deepEqual(sent.map((s) => s.endpoint).sort(), [FCM('phone'), FCM('tablet')])
  const p = sent[0].payload
  assert.equal(p.title, 'Lunch check-in recorded')
  assert.match(p.body, /Checked in at \d\d:\d\d.*Not you\? Tell the warden office\./)
  assert.equal(p.url, '/attendance')
  assert.match(p.tag, /^checkin-\d{4}-\d\d-\d\d-lunch$/)
  assert.ok(!JSON.stringify(p).includes(student.id), 'the UID is not put on a lock screen')
})

test('a typed-UID check-in says the counter typed it — the clue a student needs to spot a check-in they did not make', async () => {
  await subscribe(studentToken, FCM('phone'))
  await checkin({ ...lunch(), uid: student.id })
  await wait()
  assert.match(sent[0].payload.body, /the counter typed your UID/)
})

test('a refused check-in sends nothing to the student', async () => {
  await subscribe(studentToken, FCM('phone'))
  await checkin({ ...lunch(), qr: 'not-a-real-qr-token-at-all' })
  await wait()
  assert.equal(sent.length, 0)
})

test('devices that no longer exist (410/404) are removed; a temporary failure keeps them', async () => {
  await subscribe(studentToken, FCM('gone'))
  failWith = Object.assign(new Error('gone'), { statusCode: 410 })
  const gone = await push.sendPush('student', student.id, { title: 'x', body: 'y' })
  assert.deepEqual([gone.sent, gone.removed], [0, 1])
  assert.equal(t.db.prepare('SELECT COUNT(*) n FROM push_subscriptions').get().n, 0)

  await subscribe(studentToken, FCM('flaky'))
  failWith = Object.assign(new Error('upstream 503'), { statusCode: 503 })
  const flaky = await push.sendPush('student', student.id, { title: 'x', body: 'y' })
  assert.deepEqual([flaky.sent, flaky.removed, flaky.failed], [0, 0, 1])
  assert.equal(t.db.prepare('SELECT COUNT(*) n FROM push_subscriptions').get().n, 1)
})

test('a push service that is down never breaks the check-in itself', async () => {
  await subscribe(studentToken, FCM('phone'))
  failWith = Object.assign(new Error('boom'), { statusCode: 500 })
  const r = await checkin({ ...lunch(), qr: await getQr() })
  assert.equal(r.status, 201)
  await wait()
  assert.equal(t.db.prepare('SELECT COUNT(*) n FROM attendance').get().n, 1)
})

test('"send me a test" reaches this account\'s devices, and says so plainly when there are none', async () => {
  const none = await t.api('/push/test', { token: studentToken, body: {} })
  assert.equal(none.status, 409)
  assert.equal(none.body.code, 'NO_DELIVERY')
  await subscribe(studentToken, FCM('phone'))
  const ok = await t.api('/push/test', { token: studentToken, body: {} })
  assert.equal(ok.status, 200)
  assert.equal(ok.body.sent, 1)
  assert.equal(sent.at(-1).payload.title, 'Smart Mess test notification')
})

test('managers are pushed when a forged/replayed/revoked code is presented — once per 10 minutes, never to counter staff', async () => {
  await subscribe(manager, FCM('manager'))
  await subscribe(kitchen, FCM('kitchen-phone'))
  const forged = { ...lunch(), qr: `${student.id}${student.id}` }
  await checkin(forged)
  await wait()
  assert.equal(sent.length, 1)
  assert.equal(sent[0].endpoint, FCM('manager'))
  assert.equal(sent[0].payload.title, 'Suspicious meal scan')
  assert.match(sent[0].payload.body, /forged or unrecognised QR/i)
  assert.ok(!JSON.stringify(sent[0].payload).includes(student.id))
  await checkin(forged); await checkin(forged)
  await wait()
  assert.equal(sent.length, 1, 'throttled: one buzz, not three')
})

test('routine refusals (wrong mess, inactive) do not wake a manager', async () => {
  await subscribe(manager, FCM('manager'))
  t.db.prepare("UPDATE students SET status = 'inactive' WHERE id = ?").run(student.id)
  await checkin({ ...lunch(), qr: await getQr() })
  t.db.prepare("UPDATE students SET status = 'active' WHERE id = ?").run(student.id)
  await wait()
  assert.equal(sent.length, 0)
})

test('unusual scanning volume pushes the managers', async () => {
  await subscribe(manager, FCM('manager'))
  process.env.SCAN_SPIKE_PER_2MIN = '2'
  try {
    const ids = t.db.prepare('SELECT id FROM students WHERE hostel_id = ? ORDER BY id LIMIT 4').all(student.hostel_id).map((r) => r.id)
    for (const id of ids) await checkin({ ...lunch(), uid: id })
    await wait()
    const spike = sent.filter((s) => s.payload.title === 'Unusual check-in volume')
    assert.equal(spike.length, 1)
    assert.match(spike[0].payload.body, /check-ins in 2 minutes/)
  } finally { delete process.env.SCAN_SPIKE_PER_2MIN }
})

test('managers of OTHER messes are never notified about this mess', async () => {
  const otherHostel = student.hostel_id === 'BH5' ? 'BH4' : 'BH5'
  const otherManager = await t.staffToken('MESS_MANAGER', otherHostel)
  await subscribe(otherManager, FCM('other-manager'))
  await checkin({ ...lunch(), qr: `${student.id}${student.id}` })
  await wait()
  assert.equal(sent.length, 0)
})

test('end to end: a message encrypted by the server for a device\'s keys decrypts with that device\'s PRIVATE key (and with nothing else)', async () => {
  const webpush = (await import('web-push')).default
  const ece = (await import('http_ece')).default
  // play the browser: it holds a private key + auth secret and gives the server only the public half
  const device = crypto.createECDH('prime256v1'); device.generateKeys()
  const auth = crypto.randomBytes(16)
  const subscription = { endpoint: FCM('e2e'), keys: { p256dh: device.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } }
  const { publicKey, privateKey } = push.getVapid()
  const message = JSON.stringify({ title: 'Lunch check-in recorded', body: 'Checked in at 13:05.', url: '/attendance' })
  const req = webpush.generateRequestDetails(subscription, message, { vapidDetails: { subject: 'mailto:admin@lpu.smartmess.edu', publicKey, privateKey } })

  const plain = ece.decrypt(req.body, { version: 'aes128gcm', privateKey: device, authSecret: auth.toString('base64url') })
  assert.equal(plain.toString(), message)

  // a different device (or an eavesdropper at the push service) cannot read it
  const stranger = crypto.createECDH('prime256v1'); stranger.generateKeys()
  assert.throws(() => ece.decrypt(req.body, { version: 'aes128gcm', privateKey: stranger, authSecret: auth.toString('base64url') }))
  assert.throws(() => ece.decrypt(req.body, { version: 'aes128gcm', privateKey: device, authSecret: crypto.randomBytes(16).toString('base64url') }))
})
