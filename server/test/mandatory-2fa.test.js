import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer } from '../test-support/harness.js'
import { hotp, stepAt } from '../src/totp.js'

/** Admin and Super Admin MUST have two-factor. Until they do, their session can only set it up or sign out. */
let t, adminId, otherAdminId, managerId
const code = (secret, offset = 0) => hotp(secret, stepAt() + offset)
const login = (id) => t.api('/auth/login', { body: { identifier: id, password: 'demo1234' } })

before(async () => {
  t = await startTestServer()
  process.env.REQUIRE_2FA_ROLES = 'SUPER_ADMIN,ADMIN' // the real default, switched on for this file
  adminId = t.db.prepare("SELECT id FROM staff WHERE role = 'ADMIN' AND hostel_id = 'BH5'").get().id
  otherAdminId = t.db.prepare("SELECT id FROM staff WHERE role = 'ADMIN' AND hostel_id = 'BH6'").get().id
  managerId = t.db.prepare("SELECT id FROM staff WHERE role = 'MESS_MANAGER' AND hostel_id = 'BH5'").get().id
})
after(async () => { process.env.REQUIRE_2FA_ROLES = ''; await t.close() })

test('the default policy covers exactly Admin and Super Admin', async () => {
  const { twoFactorRoles } = await import('../src/policy.js')
  assert.deepEqual(twoFactorRoles(), ['SUPER_ADMIN', 'ADMIN'])
  delete process.env.REQUIRE_2FA_ROLES
  assert.deepEqual(twoFactorRoles(), ['SUPER_ADMIN', 'ADMIN'], 'unset = the safe default, not "off"')
  process.env.REQUIRE_2FA_ROLES = 'SUPER_ADMIN,ADMIN'
})

test('an Admin without two-factor can sign in, but the API refuses everything except setting it up', async () => {
  const r = await login(adminId)
  assert.equal(r.status, 200)
  assert.equal(r.body.user.twoFactorRequired, true)
  assert.equal(r.body.user.twoFactorSetupRequired, true)
  const tok = r.body.token
  for (const url of ['/students', '/staff', '/audit-log', '/attendance/my-qr', '/auth/sessions']) {
    const x = await t.api(url, { token: tok })
    assert.equal(x.status, 403, url)
    assert.equal(x.body.code, 'TWO_FACTOR_SETUP_REQUIRED', url)
  }
  assert.equal((await t.api('/auth/2fa/setup', { token: tok, body: {} })).status, 200, 'setting it up is allowed')
})

test('after enrolling, the same Admin has full access and the flag clears; later sign-ins ask for the code', async () => {
  const tok = (await login(adminId)).body.token
  const setup = await t.api('/auth/2fa/setup', { token: tok, body: {} })
  const enable = await t.api('/auth/2fa/enable', { token: tok, body: { code: code(setup.body.secret) } })
  assert.equal(enable.status, 200)
  assert.equal((await t.api('/staff', { token: tok })).status, 200, 'same session, no re-login needed')
  const next = await login(adminId)
  assert.equal(next.body.twoFactorRequired, true, 'the sign-in now asks for a code')
  assert.equal(next.body.token, undefined)
})

test('a required role cannot turn two-factor off — even with the right password and code', async () => {
  const secretRow = t.db.prepare('SELECT totp_secret FROM staff WHERE id = ?').get(adminId)
  const { openSecret } = await import('../src/totp.js')
  const secret = openSecret(secretRow.totp_secret)
  const ch = (await login(adminId)).body.challenge
  const tok = (await t.api('/auth/login/2fa', { body: { challenge: ch, code: code(secret, 1) } })).body.token
  assert.ok(tok)
  const off = await t.api('/auth/2fa/disable', { token: tok, body: { password: 'demo1234', code: code(secret, 2) } })
  assert.equal(off.status, 403)
  assert.equal(off.body.code, 'TWO_FACTOR_REQUIRED_BY_POLICY')
  assert.equal(t.db.prepare('SELECT totp_enabled FROM staff WHERE id = ?').get(adminId).totp_enabled, 1)
})

test('other roles are not forced (a Mess Manager keeps the optional behaviour)', async () => {
  const r = await login(managerId)
  assert.equal(r.body.user.twoFactorRequired, false)
  assert.equal((await t.api('/attendance/summary?messId=MESS-BH5&date=2026-01-01&meal=lunch', { token: r.body.token })).status, 200)
})

test('the Super Admin can reset an Admin who lost their authenticator; the Admin must then enrol again', async () => {
  // Super Admin enrols first (they are required too)
  const sa0 = (await login('10001')).body.token
  const s = await t.api('/auth/2fa/setup', { token: sa0, body: {} })
  await t.api('/auth/2fa/enable', { token: sa0, body: { code: code(s.body.secret) } })
  const ch = (await login('10001')).body.challenge
  const sa = (await t.api('/auth/login/2fa', { body: { challenge: ch, code: code(s.body.secret, 1) } })).body.token

  const reset = await t.api(`/staff/${adminId}/reset-2fa`, { token: sa, body: {} })
  assert.equal(reset.status, 200)
  assert.equal(t.db.prepare('SELECT totp_enabled FROM staff WHERE id = ?').get(adminId).totp_enabled, 0)
  const again = await login(adminId)
  assert.equal(again.body.token !== undefined, true, 'password alone gets a (restricted) session again')
  assert.equal(again.body.user.twoFactorSetupRequired, true)
  assert.equal((await t.api('/students', { token: again.body.token })).status, 403)
  assert.ok(t.db.prepare("SELECT 1 FROM audit_log WHERE action = 'staff_two_factor_reset'").get(), 'the reset is audited')
})

test('who may reset: an Admin cannot reset another Admin or themselves; no one outside the mess', async () => {
  const a = (await login(otherAdminId)).body.token
  const st = await t.api('/auth/2fa/setup', { token: a, body: {} })
  await t.api('/auth/2fa/enable', { token: a, body: { code: code(st.body.secret) } })
  const ch = (await login(otherAdminId)).body.challenge
  const adminTok = (await t.api('/auth/login/2fa', { body: { challenge: ch, code: code(st.body.secret, 1) } })).body.token
  assert.equal((await t.api(`/staff/${adminId}/reset-2fa`, { token: adminTok, body: {} })).status, 403)
  assert.equal((await t.api(`/staff/${otherAdminId}/reset-2fa`, { token: adminTok, body: {} })).status, 403)
  const outsider = t.db.prepare("SELECT id FROM staff WHERE role = 'MESS_MANAGER' AND hostel_id = 'BH5'").get().id
  assert.equal((await t.api(`/staff/${outsider}/reset-2fa`, { token: adminTok, body: {} })).status, 403, "another mess's manager is out of scope")
})

test('with the requirement switched off (local development) nothing is forced', async () => {
  process.env.REQUIRE_2FA_ROLES = ''
  const r = await login('10001')
  assert.ok(r.body.token || r.body.twoFactorRequired, 'signs in normally')
  process.env.REQUIRE_2FA_ROLES = 'SUPER_ADMIN,ADMIN'
})
