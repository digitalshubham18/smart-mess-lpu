import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer } from '../test-support/harness.js'
import { namesLikelyMatch } from '../src/fuzzyMatch.js'

let t, names
before(async () => {
  t = await startTestServer()
  // The seed gives students RANDOM names, so pin the ones the register tests use: a test that depends on
  // whatever name the dice produced is a test that fails one run in a hundred.
  const pin = t.db.prepare('UPDATE students SET name = ? WHERE id = ?')
  pin.run('Riya Mehta', '21000141'); pin.run('Ishaan Joshi', '21000142'); pin.run('Ananya Kumar', '21000143'); pin.run('Reyansh Gupta', '21000144')
  names = t.db.prepare('SELECT id, name FROM students ORDER BY id').all()
})
const pinned = (uid) => names.find((n) => n.id === uid)
after(async () => { await t.close() })

const mask = (n) => n.split(/\s+/).filter(Boolean).map((w) => `${w[0]}${'•'.repeat(Math.min(5, Math.max(1, w.length - 1)))}`).join(' ')

test('name check: across ALL 2000 enrolled students, only their own full name passes', () => {
  let own = 0, first = 0, initials = 0, masked = 0, other = 0
  names.forEach(({ name }, i) => {
    if (namesLikelyMatch(name, name)) own++
    if (namesLikelyMatch(name, name.split(' ')[0])) first++
    if (namesLikelyMatch(name, name.split(' ').map((w) => w[0]).join(' '))) initials++
    if (namesLikelyMatch(name, mask(name))) masked++
    const someoneElse = names[(i + 7) % names.length].name
    if (someoneElse !== name && namesLikelyMatch(name, someoneElse)) other++
  })
  assert.deepEqual({ own, first, initials, masked, other }, { own: 2000, first: 0, initials: 0, masked: 0, other: 0 })
})

test('name check: harmless variations are accepted (case, spacing, punctuation, word order)', () => {
  assert.ok(namesLikelyMatch('Riya Mehta', '  RIYA   mehta '))
  assert.ok(namesLikelyMatch('Riya Mehta', 'Mehta, Riya'))
  assert.ok(namesLikelyMatch('Dr. Ashok Mittal', 'dr ashok mittal'))
})

test('name check: ONE typo is forgiven only in long words; short names must be exact', () => {
  assert.ok(namesLikelyMatch('Ananya Kumar', 'Ananyya Kumar'))
  assert.ok(!namesLikelyMatch('Riya Mehta', 'Rhea Mehta'), 'a slip in a short word is a different name')
  assert.ok(!namesLikelyMatch('Riya Mehta', 'Riya Mehra'))
  assert.ok(!namesLikelyMatch('Ananya Kumar', 'Ananyya Kummar'), 'one typo per word is fine, but not in short words either')
})

test('name check: missing, extra or substituted words are refused', () => {
  assert.ok(!namesLikelyMatch('Riya Mehta', 'Riya'))
  assert.ok(!namesLikelyMatch('Riya Mehta', 'Mehta'))
  assert.ok(!namesLikelyMatch('Riya Mehta', 'Riya Mehta Sharma'))
  assert.ok(!namesLikelyMatch('Riya Mehta', 'Riya Sharma'))
  assert.ok(!namesLikelyMatch('Riya Mehta', ''))
  assert.ok(!namesLikelyMatch('', 'Riya'))
})

test('register: the refusal does NOT reveal the enrolled name (it used to say `on file: "…"`)', async () => {
  const { id, name } = pinned('21000141')
  await t.api('/auth/send-otp', { body: { email: 'leakcheck@example.com' } })
  await t.api('/auth/verify-otp', { body: { email: 'leakcheck@example.com', code: t.lastCodeFor('leakcheck@example.com') } })
  const r = await t.api('/auth/register', { body: { uid: id, name: 'Wrong Person', email: 'leakcheck@example.com', password: 'password1' } })
  assert.equal(r.status, 400)
  assert.equal(r.body.code, 'NAME_MISMATCH')
  for (const part of name.split(' ')) assert.ok(!JSON.stringify(r.body).includes(part), `error leaked "${part}"`)
})

test('register: a first name alone (all a masked lookup + a guess gives you) no longer claims an account', async () => {
  const { id, name } = pinned('21000142')
  await t.api('/auth/send-otp', { body: { email: 'firstonly@example.com' } })
  await t.api('/auth/verify-otp', { body: { email: 'firstonly@example.com', code: t.lastCodeFor('firstonly@example.com') } })
  const r = await t.api('/auth/register', { body: { uid: id, name: name.split(' ')[0], email: 'firstonly@example.com', password: 'password1' } })
  assert.equal(r.status, 400, `uid=${id} name=${JSON.stringify(name)} body=${JSON.stringify(r.body)} row=${JSON.stringify(t.db.prepare('SELECT id,name,email,password_hash IS NOT NULL AS reg FROM students WHERE id = ?').get(id))}`)
  assert.equal(t.db.prepare('SELECT password_hash FROM students WHERE id = ?').get(id).password_hash, null)
})

test('register: after 5 wrong names a UID locks for 15 minutes — even the right name is refused — and a success clears the count', async () => {
  const { id, name } = pinned('21000143')
  await t.api('/auth/send-otp', { body: { email: 'guesser@example.com' } })
  await t.api('/auth/verify-otp', { body: { email: 'guesser@example.com', code: t.lastCodeFor('guesser@example.com') } })
  const attempt = (n) => t.api('/auth/register', { body: { uid: id, name: n, email: 'guesser@example.com', password: 'password1' } })
  for (let i = 0; i < 5; i++) { const r = await attempt(`Guess Number${i}`); assert.equal(r.status, 400, JSON.stringify(r.body)) }
  const locked = await attempt(name)
  assert.equal(locked.status, 429)
  assert.equal(locked.body.code, 'NAME_GUESS_LOCKED')
  assert.equal(t.db.prepare('SELECT password_hash FROM students WHERE id = ?').get(id).password_hash, null)

  // a different UID is unaffected, and 4 misses followed by the right name still succeeds
  const other = pinned('21000144')
  const reg = async (n) => t.api('/auth/register', { body: { uid: other.id, name: n, email: 'honest@example.com', password: 'password1' } })
  await t.api('/auth/send-otp', { body: { email: 'honest@example.com' } })
  await t.api('/auth/verify-otp', { body: { email: 'honest@example.com', code: t.lastCodeFor('honest@example.com') } })
  for (let i = 0; i < 4; i++) { const r = await reg(`Typo Attempt${i}`); assert.equal(r.status, 400, JSON.stringify(r.body)) }
  assert.equal((await reg(other.name)).status, 201)
})
