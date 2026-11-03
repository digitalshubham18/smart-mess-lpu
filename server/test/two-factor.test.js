import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer } from '../test-support/harness.js'
import { hotp, stepAt, base32Encode, verifyTotp, sealSecret, openSecret } from '../src/totp.js'

let t, id
const login = (identifier = id, password = 'demo1234') => t.api('/auth/login', { body: { identifier, password } })
const code = (secret, stepOffset = 0) => hotp(secret, stepAt() + stepOffset)

before(async () => {
  t = await startTestServer()
  id = t.db.prepare("SELECT id FROM staff WHERE role = 'MESS_MANAGER' AND hostel_id = 'BH2'").get().id
})
after(async () => { await t.close() })

async function enrol(identifier = id) {
  const tok = (await login(identifier)).body.token
  const setup = await t.api('/auth/2fa/setup', { token: tok, body: {} })
  assert.equal(setup.status, 200)
  const enable = await t.api('/auth/2fa/enable', { token: tok, body: { code: code(setup.body.secret) } })
  assert.equal(enable.status, 200)
  return { tok, secret: setup.body.secret, recoveryCodes: enable.body.recoveryCodes, setup }
}

test('TOTP matches the RFC 4226 test vectors, and sealed secrets round-trip', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'))
  assert.deepEqual([0, 1, 2, 9].map((n) => hotp(secret, n)), ['755224', '287082', '359152', '520489'])
  assert.equal(openSecret(sealSecret('ABCDEF234567')), 'ABCDEF234567')
  assert.equal(verifyTotp(secret, hotp(secret, stepAt() + 5)), null, 'a code far outside the drift window is refused')
})

test('setup hands back a secret and an otpauth URI; two-factor is NOT on until a real code is entered', async () => {
  const tok = (await login()).body.token
  const setup = await t.api('/auth/2fa/setup', { token: tok, body: {} })
  assert.equal(setup.status, 200)
  assert.match(setup.body.otpauthUri, /^otpauth:\/\/totp\/.+secret=[A-Z2-7]+/)
  assert.equal((await login()).body.twoFactorRequired, undefined, 'merely starting setup changes nothing about sign-in')
  const bad = await t.api('/auth/2fa/enable', { token: tok, body: { code: '000000' === code(setup.body.secret) ? '111111' : '000000' } })
  assert.equal(bad.status, 400)
  assert.equal(t.db.prepare('SELECT totp_enabled FROM staff WHERE id = ?').get(id).totp_enabled, 0)
  assert.notEqual(t.db.prepare('SELECT totp_secret FROM staff WHERE id = ?').get(id).totp_secret, setup.body.secret, 'the secret is stored encrypted')
})

test('once on: the password alone gives NO session — only a challenge — and the challenge is useless as a session', async () => {
  const { secret } = await enrol()
  const r = await login()
  assert.equal(r.status, 200)
  assert.equal(r.body.twoFactorRequired, true)
  assert.equal(r.body.token, undefined)
  assert.equal(r.body.user, undefined)
  const asSession = await t.api('/students', { token: r.body.challenge })
  assert.equal(asSession.status, 401)

  // the same-step code was consumed by enabling; the next step's code is valid and logs in
  const ok = await t.api('/auth/login/2fa', { body: { challenge: r.body.challenge, code: code(secret, 1) } })
  assert.equal(ok.status, 200)
  assert.equal(ok.body.user.twoFactorEnabled, true)
  assert.ok(ok.body.token)
  assert.equal((await t.api('/students', { token: ok.body.token })).status, 200)
})

test('a code cannot be replayed, and a wrong one is refused', async () => {
  const row = t.db.prepare('SELECT totp_secret FROM staff WHERE id = ?').get(id)
  const real = openSecret(row.totp_secret)
  const c1 = (await login()).body.challenge
  const c2 = (await login()).body.challenge
  const c = code(real, 1)
  // the previous test used step+1 already, so push further forward via the stored last step instead of waiting 30s
  t.db.prepare('UPDATE staff SET totp_last_step = 0 WHERE id = ?').run(id)
  assert.equal((await t.api('/auth/login/2fa', { body: { challenge: c1, code: c } })).status, 200)
  const replay = await t.api('/auth/login/2fa', { body: { challenge: c2, code: c } })
  assert.equal(replay.status, 401)
  assert.equal(replay.body.code, 'TOTP_INVALID')
  const wrong = await t.api('/auth/login/2fa', { body: { challenge: c2, code: c === '123456' ? '654321' : '123456' } })
  assert.equal(wrong.status, 401)
})

test('five wrong codes lock the account, exactly like five wrong passwords', async () => {
  const other = t.db.prepare("SELECT id FROM staff WHERE role = 'KITCHEN_STAFF' AND hostel_id = 'BH3'").get().id
  await enrol(other)
  const ch = (await login(other)).body.challenge
  let last
  for (let i = 0; i < 5; i++) last = await t.api('/auth/login/2fa', { body: { challenge: ch, code: '000000' } })
  assert.equal(last.status, 423)
  assert.equal((await login(other)).status, 423)
})

test('a recovery code signs in once and is then gone', async () => {
  const other = t.db.prepare("SELECT id FROM staff WHERE role = 'FINANCE_MANAGER' AND hostel_id = 'BH4'").get().id
  const { recoveryCodes } = await enrol(other)
  assert.equal(recoveryCodes.length, 8)
  const first = await t.api('/auth/login/2fa', { body: { challenge: (await login(other)).body.challenge, code: recoveryCodes[0] } })
  assert.equal(first.status, 200)
  const again = await t.api('/auth/login/2fa', { body: { challenge: (await login(other)).body.challenge, code: recoveryCodes[0] } })
  assert.equal(again.status, 401)
  assert.equal((await t.api('/auth/login/2fa', { body: { challenge: (await login(other)).body.challenge, code: recoveryCodes[1] } })).status, 200)
})

test('turning it off needs the password AND a code; a borrowed session alone cannot', async () => {
  const other = t.db.prepare("SELECT id FROM staff WHERE role = 'KITCHEN_STAFF' AND hostel_id = 'BH5'").get().id
  const { tok, recoveryCodes } = await enrol(other)
  const sneaky = await t.api('/auth/2fa/disable', { token: tok, body: { password: 'demo1234', code: '000000' } })
  assert.equal(sneaky.status, 400)
  const noPw = await t.api('/auth/2fa/disable', { token: tok, body: { password: 'wrong-password', code: recoveryCodes[0] } })
  assert.equal(noPw.status, 400)
  assert.equal(t.db.prepare('SELECT totp_enabled FROM staff WHERE id = ?').get(other).totp_enabled, 1)
  const off = await t.api('/auth/2fa/disable', { token: tok, body: { password: 'demo1234', code: recoveryCodes[1] } })
  assert.equal(off.status, 200)
  const r = await login(other)
  assert.equal(r.body.twoFactorRequired, undefined)
  assert.ok(r.body.token)
})

test('students can use it too, and an expired/forged challenge is refused', async () => {
  const stu = t.db.prepare('SELECT id FROM students WHERE password_hash IS NOT NULL LIMIT 1').get().id
  const { secret } = await enrol(stu)
  const r = await login(stu)
  assert.equal(r.body.twoFactorRequired, true)
  assert.equal((await t.api('/auth/login/2fa', { body: { challenge: 'not-a-token', code: code(secret, 1) } })).status, 401)
})
