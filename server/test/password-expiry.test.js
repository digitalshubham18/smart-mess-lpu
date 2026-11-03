import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer } from '../test-support/harness.js'

let t, kitchen, kitchenId
const login = (identifier, password = 'demo1234') => t.api('/auth/login', { body: { identifier, password } })
const backdate = (table, id, days) => t.db.prepare(`UPDATE ${table} SET password_changed_at = ? WHERE id = ?`).run(new Date(Date.now() - days * 86_400_000).toISOString(), id)

before(async () => {
  t = await startTestServer()
  kitchenId = t.db.prepare("SELECT id FROM staff WHERE role = 'KITCHEN_STAFF' AND hostel_id = 'BH2'").get().id
})
after(async () => { await t.close() })

test('a staff password younger than the limit signs in normally', async () => {
  backdate('staff', kitchenId, 30)
  const r = await login(kitchenId)
  assert.equal(r.status, 200)
  assert.equal(r.body.user.mustChangePassword, false)
})

test('a staff password older than 90 days forces a new one: sign-in works, everything else is refused until it is changed', async () => {
  backdate('staff', kitchenId, 91)
  const r = await login(kitchenId)
  assert.equal(r.status, 200)
  assert.equal(r.body.user.mustChangePassword, true)
  const blocked = await t.api('/students', { token: r.body.token })
  assert.equal(blocked.status, 403)
  assert.equal(blocked.body.code, 'PASSWORD_CHANGE_REQUIRED')

  const changed = await t.api('/auth/change-password', { token: r.body.token, body: { currentPassword: 'demo1234', newPassword: 'Fresh-Pass-2026' } })
  assert.equal(changed.status, 200)
  const again = await login(kitchenId, 'Fresh-Pass-2026')
  assert.equal(again.status, 200)
  assert.equal(again.body.user.mustChangePassword, false, 'changing it restarts the clock')
})

test('students are not forced to rotate their passwords', async () => {
  const demo = t.db.prepare("SELECT id FROM students WHERE password_hash IS NOT NULL LIMIT 1").get()
  backdate('students', demo.id, 400)
  const r = await login(demo.id)
  assert.equal(r.status, 200)
  assert.equal(r.body.user.mustChangePassword, false)
})

test('an account with no timestamp (seeded / pre-existing) is not treated as expired — its clock starts at first sign-in', async () => {
  const id = t.db.prepare("SELECT id FROM staff WHERE role = 'FINANCE_MANAGER' AND hostel_id = 'BH2'").get().id
  t.db.prepare('UPDATE staff SET password_changed_at = NULL WHERE id = ?').run(id)
  const r = await login(id)
  assert.equal(r.status, 200)
  assert.equal(r.body.user.mustChangePassword, false)
  assert.ok(t.db.prepare('SELECT password_changed_at FROM staff WHERE id = ?').get(id).password_changed_at)
})
