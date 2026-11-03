import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer } from '../test-support/harness.js'

/** Devices: each sign-in is its own session; one can be ended without touching the others; "everywhere" ends all. */
let t, wardenId, studentId, signToken
const UA = (ua) => ({ 'User-Agent': ua })
const PHONE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36'
const LAPTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0'
const signIn = async (id, ua) => (await t.api('/auth/login', { body: { identifier: id, password: 'demo1234' }, headers: ua ? UA(ua) : {} })).body.token

before(async () => {
  t = await startTestServer()
  ;({ signToken } = await import('../src/auth.js')) // AFTER the harness has pointed DB_PATH at a throwaway database
  wardenId = t.db.prepare("SELECT id FROM staff WHERE role = 'HOSTEL_WARDEN' AND hostel_id = 'BH3'").get().id
  studentId = t.db.prepare('SELECT id FROM students WHERE password_hash IS NOT NULL LIMIT 1').get().id
})
after(async () => { await t.close() })

test('every sign-in is a device in the list, described in words, with the current one marked', async () => {
  const phone = await signIn(wardenId, PHONE)
  const laptop = await signIn(wardenId, LAPTOP)
  const list = await t.api('/auth/sessions', { token: phone })
  assert.equal(list.status, 200)
  assert.ok(list.body.length >= 2)
  const devices = list.body.map((d) => d.device)
  assert.ok(devices.includes('Chrome on Android'), devices.join())
  assert.ok(devices.includes('Edge on Windows'), devices.join())
  assert.equal(list.body.filter((d) => d.current).length, 1)
  assert.equal(list.body.find((d) => d.current).device, 'Chrome on Android')
  assert.ok(laptop)
})

test('ending ONE device signs only that device out — the others carry on', async () => {
  const keep = await signIn(wardenId, LAPTOP)
  const lost = await signIn(wardenId, PHONE)
  const list = (await t.api('/auth/sessions', { token: keep })).body
  const lostId = list.find((d) => d.device === 'Chrome on Android' && !d.current).id
  const r = await t.api(`/auth/sessions/${lostId}`, { token: keep, method: 'DELETE' })
  assert.equal(r.status, 200)
  assert.equal((await t.api('/students', { token: lost })).status, 401, 'the revoked device is out at once')
  assert.equal((await t.api('/students', { token: keep })).status, 200, 'the other device is untouched')
  assert.equal((await t.api(`/auth/sessions/${lostId}`, { token: keep, method: 'DELETE' })).status, 404, 'already gone')
})

test("nobody can end someone else's device by guessing its id", async () => {
  const mine = await signIn(wardenId)
  const theirs = await signIn(studentId)
  const theirList = (await t.api('/auth/sessions', { token: theirs })).body
  const r = await t.api(`/auth/sessions/${theirList[0].id}`, { token: mine, method: 'DELETE' })
  assert.equal(r.status, 404)
  assert.equal((await t.api('/attendance/my-qr', { token: theirs })).status, 200, 'their session is unaffected')
})

test('plain logout ends this device only', async () => {
  const a = await signIn(wardenId, PHONE)
  const b = await signIn(wardenId, LAPTOP)
  assert.equal((await t.api('/auth/logout', { token: a, body: {} })).status, 200)
  assert.equal((await t.api('/students', { token: a })).status, 401)
  assert.equal((await t.api('/students', { token: b })).status, 200)
})

test('"sign out all OTHER devices" keeps this one (with a fresh token) and ends the rest', async () => {
  const here = await signIn(wardenId, LAPTOP)
  const other1 = await signIn(wardenId, PHONE)
  const other2 = await signIn(wardenId, PHONE)
  const r = await t.api('/auth/sessions/revoke-others', { token: here, body: {} })
  assert.equal(r.status, 200)
  assert.ok(r.body.token, 'a fresh token for this device (the old one is superseded)')
  assert.equal((await t.api('/students', { token: other1 })).status, 401)
  assert.equal((await t.api('/students', { token: other2 })).status, 401)
  const list = (await t.api('/auth/sessions', { token: r.body.token })).body
  assert.equal(list.length, 1)
  assert.equal(list[0].current, true)
})

test('"sign out everywhere" ends every device including this one, and stops push notifications to its phones', async () => {
  const a = await signIn(studentId, PHONE)
  const b = await signIn(studentId, LAPTOP)
  t.db.prepare("INSERT INTO push_subscriptions (endpoint, account_type, account_id, p256dh, auth, created_at) VALUES ('https://fcm.googleapis.com/fcm/send/lost-phone', 'student', ?, 'p', 'a', datetime('now'))").run(studentId)
  const r = await t.api('/auth/logout-all', { token: a, body: {} })
  assert.equal(r.status, 200)
  assert.equal((await t.api('/attendance/my-qr', { token: a })).status, 401)
  assert.equal((await t.api('/attendance/my-qr', { token: b })).status, 401)
  assert.equal(t.db.prepare("SELECT COUNT(*) n FROM push_subscriptions WHERE account_id = ?").get(studentId).n, 0, 'a lost phone stops receiving notifications')
  assert.equal(t.db.prepare("SELECT COUNT(*) n FROM sessions WHERE account_id = ? AND revoked_at IS NULL").get(studentId).n, 0)
  const fresh = await signIn(studentId)
  assert.equal((await t.api('/attendance/my-qr', { token: fresh })).status, 200, 'signing in again works')
})

test('a token issued before sessions existed (no sid) still works, and "everywhere" still kills it', async () => {
  const tv = t.db.prepare('SELECT token_version FROM staff WHERE id = ?').get(wardenId).token_version
  const legacy = signToken({ sub: wardenId, role: 'HOSTEL_WARDEN', tv })
  assert.equal((await t.api('/students', { token: legacy })).status, 200)
  const live = await signIn(wardenId)
  await t.api('/auth/logout-all', { token: live, body: {} })
  assert.equal((await t.api('/students', { token: legacy })).status, 401)
})

test('changing your password signs out your other devices but keeps this one', async () => {
  const here = await signIn(wardenId, LAPTOP)
  const other = await signIn(wardenId, PHONE)
  const r = await t.api('/auth/change-password', { token: here, body: { currentPassword: 'demo1234', newPassword: 'a-new-Passw0rd!' } })
  assert.equal(r.status, 200)
  assert.equal((await t.api('/students', { token: other })).status, 401)
  assert.equal((await t.api('/students', { token: r.body.token })).status, 200)
  assert.equal((await t.api('/auth/sessions', { token: r.body.token })).body.length, 1)
})

test('no more than 10 live devices per account: the oldest is signed out', async () => {
  const uid = t.db.prepare("SELECT id FROM staff WHERE role = 'KITCHEN_STAFF' AND hostel_id = 'BH4'").get().id
  const first = await signIn(uid)
  for (let i = 0; i < 10; i++) await signIn(uid)
  assert.equal((await t.api('/auth/sessions', { token: await signIn(uid) })).body.length, 10)
  assert.equal((await t.api('/students', { token: first })).status, 401, 'the oldest was pushed out')
})
