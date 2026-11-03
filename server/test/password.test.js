import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import bcryptjs from 'bcryptjs'
import { hashPassword, verifyPassword, hashingImplementation } from '../src/password.js'

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('password: hashes made by the pure-JS bcrypt verify with the active implementation, and vice versa (existing accounts keep working)', async () => {
  const oldHash = bcryptjs.hashSync('correct horse', 10)
  assert.equal(await verifyPassword('correct horse', oldHash), true)
  assert.equal(await verifyPassword('wrong horse', oldHash), false)
  const newHash = await hashPassword('battery staple')
  assert.match(newHash, /^\$2[aby]\$10\$/)
  assert.equal(bcryptjs.compareSync('battery staple', newHash), true)
  assert.equal(bcryptjs.compareSync('nope', newHash), false)
})

test('password: unicode, long and empty inputs behave sanely', async () => {
  const pw = 'पासवर्ड-🔐-' + 'x'.repeat(40)
  assert.equal(await verifyPassword(pw, await hashPassword(pw)), true)
  assert.equal(await verifyPassword('', await hashPassword('something')), false)
})

test('password: BCRYPT_IMPL=js forces the pure-JS fallback, which still hashes and verifies', () => {
  const run = spawnSync('node', ['--input-type=module', '-e', `
    const m = await import('./src/password.js')
    const h = await m.hashPassword('pw'); console.log(JSON.stringify({ impl: m.hashingImplementation, ok: await m.verifyPassword('pw', h), bad: await m.verifyPassword('x', h) }))`],
    { cwd: SERVER_DIR, encoding: 'utf8', env: { ...process.env, BCRYPT_IMPL: 'js' } })
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(JSON.parse(run.stdout.trim()), { impl: 'js', ok: true, bad: false })
})

test('password: with the native module, hashing runs OFF the event loop — a burst of hashes does not freeze timers', { skip: hashingImplementation !== 'native' && 'native bcrypt not installed on this platform' }, async () => {
  // 8 concurrent hashes ≈ 8 × 70 ms of CPU. On the main thread (pure JS) that's a ~500 ms+ freeze; on the thread pool
  // a 20 ms ticker should keep ticking. Generous bound so a slow CI box doesn't flake, but far below the JS number.
  let last = performance.now(), maxGap = 0
  const ticker = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - last); last = now }, 20)
  await new Promise((r) => setTimeout(r, 100))
  maxGap = 0; last = performance.now()
  await Promise.all(Array.from({ length: 8 }, (_, i) => hashPassword(`pw-${i}`)))
  clearInterval(ticker)
  assert.ok(maxGap < 250, `event loop stalled for ${maxGap.toFixed(0)}ms during the hash burst`)
})

test('password: …whereas the pure-JS version does stall the loop (this is the problem the native module solves)', { skip: hashingImplementation !== 'native' && 'comparison needs both implementations' }, async () => {
  let last = performance.now(), maxGap = 0
  const ticker = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - last); last = now }, 20)
  await new Promise((r) => setTimeout(r, 100))
  maxGap = 0; last = performance.now()
  await Promise.all(Array.from({ length: 8 }, (_, i) => bcryptjs.hash(`pw-${i}`, 10)))
  clearInterval(ticker)
  assert.ok(maxGap > 250, `expected the JS bcrypt to stall the loop, but the longest gap was only ${maxGap.toFixed(0)}ms`)
})
