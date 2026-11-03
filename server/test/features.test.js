import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startTestServer } from '../test-support/harness.js'
import { getSentEmails } from '../src/email.js'

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let t, superAdmin, bh2Admin, bh2Kitchen, bh5Admin
// Imported AFTER the harness has pointed DB_PATH at a throwaway file — a top-level import of
// anything that touches db.js would open (and mutate) the developer's real database.
let assertSecureConfig, SESSION_COOKIE
const WEB = { 'X-SmartMess-Client': 'web' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const cookieOf = (res) => (res.headers.get('set-cookie') ?? '').split(';')[0]
const rawLogin = (id, pw = 'demo1234', headers = {}) => fetch(`${t.baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ identifier: id, password: pw }) })

before(async () => {
  t = await startTestServer()
  ;({ assertSecureConfig, SESSION_COOKIE } = await import('../src/auth.js'))
  superAdmin = await t.superAdminToken()
  bh2Admin = await t.staffToken('ADMIN', 'BH2')
  bh2Kitchen = await t.staffToken('KITCHEN_STAFF', 'BH2')
  bh5Admin = await t.staffToken('ADMIN', 'BH5')
})
after(async () => { await t.close() })

// ---------------------------------------------------------------- production config guard
test('config: production refuses to boot with the dev/default/short JWT secret or no CORS origin', () => {
  const ok = { NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40), CORS_ORIGIN: 'https://mess.lpu.in' }
  assert.doesNotThrow(() => assertSecureConfig(ok))
  assert.throws(() => assertSecureConfig({ ...ok, JWT_SECRET: undefined }), /JWT_SECRET/)
  assert.throws(() => assertSecureConfig({ ...ok, JWT_SECRET: 'lpu-smart-mess-dev-secret-change-me' }), /JWT_SECRET/)
  assert.throws(() => assertSecureConfig({ ...ok, JWT_SECRET: 'change-me-to-a-long-random-string-xxxxxxxx' }), /JWT_SECRET/)
  assert.throws(() => assertSecureConfig({ ...ok, JWT_SECRET: 'short' }), /at least 32/)
  assert.throws(() => assertSecureConfig({ ...ok, CORS_ORIGIN: undefined }), /CORS_ORIGIN/)
  assert.doesNotThrow(() => assertSecureConfig({ NODE_ENV: 'development' }), 'dev stays frictionless')
})

test('config: the real server process exits non-zero in production with no secret', () => {
  const run = spawnSync('node', ['src/index.js'], { cwd: SERVER_DIR, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'production', JWT_SECRET: '', CORS_ORIGIN: '', DB_PATH: '/tmp/never-created.sqlite' } })
  assert.notEqual(run.status, 0)
  assert.match(run.stderr, /Refusing to start in production/)
})

// ---------------------------------------------------------------- cookie sessions + CSRF
test('session: a browser login gets an httpOnly SameSite cookie and NO token in the body', async () => {
  const res = await rawLogin('10001', 'demo1234', WEB)
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.equal(body.token, undefined, 'token must not be readable by page JavaScript')
  const set = res.headers.get('set-cookie')
  assert.match(set, new RegExp(`^${SESSION_COOKIE}=`))
  assert.match(set, /HttpOnly/i)
  assert.match(set, /SameSite=Lax/i)
  assert.match(set, /Path=\/api/)
})

test('session: non-browser clients still get the bearer token in the body (scripts, tests)', async () => {
  const body = await (await rawLogin('10001')).json()
  assert.ok(body.token)
})

test('session: the cookie authenticates reads, and works for writes only with the client header (CSRF defense)', async () => {
  const cookie = cookieOf(await rawLogin('10001', 'demo1234', WEB))
  const read = await fetch(`${t.baseUrl}/audit-log`, { headers: { Cookie: cookie } })
  assert.equal(read.status, 200)

  const body = JSON.stringify({ id: 'CSRF1', name: 'Csrf Hostel', category: 'boys', capacity: 10 })
  const forged = await fetch(`${t.baseUrl}/hostels`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body })
  assert.equal(forged.status, 403)
  assert.equal((await forged.json()).code, 'CSRF_BLOCKED')
  assert.equal(t.db.prepare("SELECT COUNT(*) AS n FROM hostels WHERE id = 'CSRF1'").get().n, 0)

  const legit = await fetch(`${t.baseUrl}/hostels`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, ...WEB }, body })
  assert.equal(legit.status, 201)
})

test('session: a cross-origin preflight is refused for any origin but the configured one', async () => {
  const pre = (origin) => fetch(`${t.baseUrl}/hostels`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-smartmess-client,content-type' } })
  const good = await pre('http://localhost:5173')
  assert.equal(good.headers.get('access-control-allow-origin'), 'http://localhost:5173')
  assert.equal(good.headers.get('access-control-allow-credentials'), 'true')
  assert.match(good.headers.get('access-control-allow-headers'), /x-smartmess-client/i)
  const evil = await pre('https://evil.example')
  assert.notEqual(evil.headers.get('access-control-allow-origin'), 'https://evil.example')
})

test('session: logout clears the cookie AND revokes the session server-side', async () => {
  // A throwaway account — logout revokes every session of the account, which would otherwise
  // invalidate the Super Admin token the other tests in this file share.
  const who = t.db.prepare("SELECT id FROM staff WHERE role = 'FINANCE_MANAGER' AND hostel_id = 'BH7'").get().id
  const login = await rawLogin(who, 'demo1234', WEB)
  const cookie = cookieOf(login)
  assert.equal((await fetch(`${t.baseUrl}/auth/logout`, { method: 'POST', headers: { Cookie: cookie, ...WEB } })).status, 200)
  const out = await fetch(`${t.baseUrl}/auth/logout`, { method: 'POST', headers: { Cookie: cookieOf(await rawLogin(who, 'demo1234', WEB)), ...WEB } })
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/)
  const stale = await fetch(`${t.baseUrl}/students/21000101`, { headers: { Cookie: cookie } })
  assert.equal(stale.status, 401)
})

test('session: a bearer header wins over a stale cookie, and an invalid cookie is a clean 401', async () => {
  assert.equal((await fetch(`${t.baseUrl}/audit-log`, { headers: { Cookie: `${SESSION_COOKIE}=garbage` } })).status, 401)
})

// ---------------------------------------------------------------- real OTP + registration gating
test('otp: registration is REFUSED without a verified email', async () => {
  const uid = '21000030'
  const name = t.db.prepare('SELECT name FROM students WHERE id = ?').get(uid).name
  const r = await t.api('/auth/register', { body: { uid, name, email: 'noverify@example.com', password: 'password1' } })
  assert.equal(r.status, 403)
  assert.equal(r.body.code, 'EMAIL_NOT_VERIFIED')
  assert.equal(t.db.prepare('SELECT password_hash FROM students WHERE id = ?').get(uid).password_hash, null)
})

test('otp: any made-up 6-digit code is rejected (it used to accept everything)', async () => {
  await t.api('/auth/send-otp', { body: { email: 'guess@example.com' } })
  const real = t.lastCodeFor('guess@example.com')
  const wrong = real === '000000' ? '111111' : '000000'
  const r = await t.api('/auth/verify-otp', { body: { email: 'guess@example.com', code: wrong } })
  assert.equal(r.status, 400)
  assert.equal(r.body.code, 'OTP_INVALID')
})

test('otp: the code is stored hashed, expires, and locks after 5 wrong tries (even the right code then fails)', async () => {
  await t.api('/auth/send-otp', { body: { email: 'brute@example.com' } })
  const code = t.lastCodeFor('brute@example.com')
  const row = t.db.prepare('SELECT code_hash FROM email_otps WHERE email = ?').get('brute@example.com')
  assert.ok(!row.code_hash.includes(code) && row.code_hash.length === 64, 'plaintext code must not be stored')
  const wrong = code === '123456' ? '654321' : '123456'
  for (let i = 0; i < 5; i++) await t.api('/auth/verify-otp', { body: { email: 'brute@example.com', code: wrong } })
  assert.equal((await t.api('/auth/verify-otp', { body: { email: 'brute@example.com', code } })).status, 400)

  await t.api('/auth/send-otp', { body: { email: 'expire@example.com' } })
  const c2 = t.lastCodeFor('expire@example.com')
  t.db.prepare("UPDATE email_otps SET expires_at = '2000-01-01T00:00:00.000Z' WHERE email = 'expire@example.com'").run()
  assert.equal((await t.api('/auth/verify-otp', { body: { email: 'expire@example.com', code: c2 } })).status, 400)
})

test('otp: a verification is single-use — it cannot be reused to register a second account', async () => {
  const first = await t.registerStudent('21000031', 'once@example.com')
  assert.equal(first.status, 201)
  assert.equal(t.db.prepare("SELECT COUNT(*) AS n FROM email_otps WHERE email = 'once@example.com'").get().n, 0, 'the verification record is consumed')
  // …so a second account can't ride on it (it's refused as a duplicate email, and — for a
  // different address nobody verified — as unverified).
  const name2 = t.db.prepare('SELECT name FROM students WHERE id = ?').get('21000032').name
  const second = await t.api('/auth/register', { body: { uid: '21000032', name: name2, email: 'once@example.com', password: 'password1' } })
  assert.ok([403, 409].includes(second.status))
  assert.equal(t.db.prepare('SELECT password_hash FROM students WHERE id = ?').get('21000032').password_hash, null)
})

test('otp: a browser registration also gets a cookie session and no token in the body', async () => {
  const uid = '21000033'
  const name = t.db.prepare('SELECT name FROM students WHERE id = ?').get(uid).name
  await t.api('/auth/send-otp', { body: { email: 'webreg@example.com' } })
  await t.api('/auth/verify-otp', { body: { email: 'webreg@example.com', code: t.lastCodeFor('webreg@example.com') } })
  const res = await fetch(`${t.baseUrl}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...WEB }, body: JSON.stringify({ uid, name, email: 'webreg@example.com', password: 'password1' }) })
  const body = await res.json()
  assert.equal(res.status, 201)
  assert.equal(body.token, undefined)
  assert.match(res.headers.get('set-cookie'), /HttpOnly/i)
})

// ---------------------------------------------------------------- minimal lookup
test('lookup: leaks no name, email, phone or room — so the name check on /register means something', async () => {
  const { body } = await t.api('/students/lookup/21000040')
  assert.deepEqual(Object.keys(body).sort(), ['alreadyRegistered', 'hostelName', 'maskedEmail', 'maskedName', 'messId', 'messName'])
  const real = t.db.prepare('SELECT name, email, phone, room FROM students WHERE id = ?').get('21000040')
  const dump = JSON.stringify(body)
  for (const secret of [real.name, real.email, real.phone, real.room]) assert.ok(!dump.includes(secret), `lookup leaked ${secret}`)
})

test('lookup: an impersonator who only knows a UID cannot register — they have no name to match', async () => {
  const uid = '21000041'
  await t.api('/auth/send-otp', { body: { email: 'impostor@example.com' } })
  await t.api('/auth/verify-otp', { body: { email: 'impostor@example.com', code: t.lastCodeFor('impostor@example.com') } })
  const { body: look } = await t.api(`/students/lookup/${uid}`)
  const r = await t.api('/auth/register', { body: { uid, name: look.maskedName, email: 'impostor@example.com', password: 'password1' } })
  assert.equal(r.status, 400)
  assert.equal(r.body.code, 'NAME_MISMATCH')
})

test('lookup: rate limited so the UID space can\'t be swept', async () => {
  let limited = 0
  for (let i = 0; i < 40; i++) if ((await t.api(`/students/lookup/2100${1000 + i}`)).status === 429) limited++
  assert.ok(limited > 0)
})

// ---------------------------------------------------------------- server-side intentions → no-shows
const D = '2099-05-05'
test('intentions: a student marks their OWN meal (before cutoff) and it is stored server-side', async () => {
  const reg = await t.registerStudent('21000150', 'intent.student@example.com')
  const tok = reg.body.token
  const ok = await t.api('/intentions/21000150', { token: tok, method: 'PUT', body: { date: D, meal: 'lunch', status: 'will_eat' } })
  assert.equal(ok.status, 200)
  assert.equal(t.db.prepare('SELECT status FROM meal_intentions WHERE student_id = ? AND date = ? AND meal = ?').get('21000150', D, 'lunch').status, 'will_eat')
  assert.equal((await t.api('/intentions/21000150', { token: tok })).body.length, 1)
  // another student cannot read or write it
  assert.equal((await t.api('/intentions/21000151', { token: tok, method: 'PUT', body: { date: D, meal: 'lunch', status: 'will_eat' } })).status, 403)
  assert.equal((await t.api('/intentions/21000151', { token: tok })).status, 403)
})

test('intentions: after the 2:00 AM cutoff a student is refused (they must file a change request)', async () => {
  const tok = await t.login('21000150', 'password1')
  const r = await t.api('/intentions/21000150', { token: tok, method: 'PUT', body: { date: '2020-01-01', meal: 'lunch', status: 'will_not' } })
  assert.equal(r.status, 403)
  assert.equal(r.body.code, 'CUTOFF_PASSED')
})

test('intentions: in-scope counter staff can set one (an approved change request), other messes\' staff cannot', async () => {
  const body = { date: '2020-01-01', meal: 'lunch', status: 'will_eat' }
  assert.equal((await t.api('/intentions/21000150', { token: bh2Kitchen, method: 'PUT', body })).status, 200) // 21000050 is a BH2 student
  assert.equal((await t.api('/intentions/21000150', { token: bh5Admin, method: 'PUT', body })).status, 403)
  const fin = await t.staffToken('FINANCE_MANAGER', 'BH2')
  assert.equal((await t.api('/intentions/21000150', { token: fin, method: 'PUT', body })).status, 403)
})

test('no-shows: computed from the SERVER\'s intentions — a request can no longer name who to punish', async () => {
  const victim = '21000152', expected = '21000153'
  t.setIntentionDirect(expected, D, 'dinner')
  const before = t.db.prepare('SELECT COUNT(*) AS n FROM warnings').get().n
  const r = await t.api('/attendance/process-no-shows', { token: bh2Kitchen, body: { messId: 'MESS-BH2', date: D, meal: 'dinner', fineAmount: 100, intendedStudentIds: [victim] } })
  assert.equal(r.status, 200)
  assert.equal(r.body.warningsIssued, 1, 'only the student with a server-side "will eat" record')
  assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM warnings WHERE student_id = ?').get(victim).n, 0, 'the named victim is untouched')
  assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM warnings WHERE student_id = ?').get(expected).n, 1)
  assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM warnings').get().n, before + 1)
})

test('no-shows: "will not eat", already-checked-in, and on-leave students are never warned', async () => {
  const day = '2099-06-06'
  const [willNot, present, onLeave, absent] = ['21000154', '21000155', '21000156', '21000157']
  t.setIntentionDirect(willNot, day, 'lunch', 'will_not')
  t.setIntentionDirect(present, day, 'lunch')
  t.setIntentionDirect(onLeave, day, 'lunch')
  t.setIntentionDirect(absent, day, 'lunch')
  t.db.prepare('UPDATE students SET leave_until = ? WHERE id = ?').run('2099-06-10', onLeave)
  assert.equal((await t.api('/attendance/checkin', { token: bh2Kitchen, body: { uid: present, messId: 'MESS-BH2', meal: 'lunch', date: day } })).status, 201)
  const r = await t.api('/attendance/process-no-shows', { token: bh2Kitchen, body: { messId: 'MESS-BH2', date: day, meal: 'lunch', fineAmount: 100 } })
  assert.equal(r.body.checked, 2) // present + absent; "will not eat" and on-leave never enter the list
  assert.equal(r.body.warningsIssued, 1)
  assert.equal(t.db.prepare('SELECT student_id FROM warnings WHERE date = ?').get(day).student_id, absent)
})

test('no-shows: fine amount is capped server-side', async () => {
  const r = await t.api('/attendance/process-no-shows', { token: bh2Kitchen, body: { messId: 'MESS-BH2', date: D, meal: 'dinner', fineAmount: 9999999 } })
  assert.equal(r.status, 400)
})

// ---------------------------------------------------------------- notifications
test('notify: a no-show warning and a fine each email the student, without delaying or failing the request', async () => {
  const uid = '21000158'
  const email = t.db.prepare('SELECT email FROM students WHERE id = ?').get(uid).email
  for (const d of ['2099-07-01', '2099-07-02', '2099-07-03']) {
    t.setIntentionDirect(uid, d, 'dinner')
    const r = await t.api('/attendance/process-no-shows', { token: bh2Kitchen, body: { messId: 'MESS-BH2', date: d, meal: 'dinner', fineAmount: 150 } })
    assert.equal(r.status, 200)
  }
  await sleep(100)
  const mails = getSentEmails().filter((m) => m.to === email)
  assert.equal(mails.length, 3)
  assert.match(mails[0].subject, /no-show warning/)
  assert.match(mails[0].text, /1 this month/)
  assert.match(mails[2].subject, /fine issued/)
  assert.match(mails[2].text, /₹150/)
})

// ---------------------------------------------------------------- offline check-in sync
test('offline: a queued scan keeps its real timestamp; future and >48h-old timestamps are refused; replays are idempotent', async () => {
  const day = '2099-08-08', uid = '21000159'
  const real = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
  const ok = await t.api('/attendance/checkin', { token: bh2Kitchen, body: { uid, messId: 'MESS-BH2', meal: 'lunch', date: day, scannedAt: real } })
  assert.equal(ok.status, 201)
  assert.equal(ok.body.scannedAt, real)
  assert.match(t.db.prepare("SELECT summary FROM audit_log WHERE action = 'meal_checked_in' ORDER BY at DESC").get().summary, /synced from offline queue/)

  const replay = await t.api('/attendance/checkin', { token: bh2Kitchen, body: { uid, messId: 'MESS-BH2', meal: 'lunch', date: day, scannedAt: real } })
  assert.equal(replay.status, 409)
  assert.equal(replay.body.code, 'ALREADY_CHECKED_IN')

  const future = await t.api('/attendance/checkin', { token: bh2Kitchen, body: { uid: '21000160', messId: 'MESS-BH2', meal: 'lunch', date: day, scannedAt: new Date(Date.now() + 3600e3).toISOString() } })
  assert.equal(future.status, 400)
  const old = await t.api('/attendance/checkin', { token: bh2Kitchen, body: { uid: '21000160', messId: 'MESS-BH2', meal: 'lunch', date: day, scannedAt: new Date(Date.now() - 49 * 3600e3).toISOString() } })
  assert.equal(old.status, 400)
  assert.equal(old.body.code, 'SCAN_TOO_OLD')
  const wrong = await t.api('/attendance/checkin', { token: bh2Kitchen, body: { uid: t.db.prepare("SELECT id FROM students WHERE hostel_id='BH5' LIMIT 1").get().id, messId: 'MESS-BH2', meal: 'lunch', date: day } })
  assert.equal(wrong.body.code, 'NOT_ENROLLED')
})

// ---------------------------------------------------------------- room capacity + hostel limits
test('rooms: with beds-per-room set, a full room refuses add, bulk, move-in and transfer; "Unassigned" and other rooms are unaffected', async () => {
  await t.api('/hostels', { token: superAdmin, body: { id: 'RM1', name: 'Room Test Hostel', category: 'general', capacity: 50, roomCapacity: 2 } })
  const add = (n, room) => t.api('/students', { token: superAdmin, body: { name: `Room Person ${n}`, email: `room${n}@example.com`, noUid: true, noUidReason: 'test fixture', hostelId: 'RM1', room } })
  assert.equal((await add(1, 'A-1')).status, 201)
  assert.equal((await add(2, 'a-1')).status, 201) // case-insensitive: same room
  const third = await add(3, 'A-1')
  assert.equal(third.status, 409)
  assert.equal(third.body.code, 'ROOM_FULL')
  assert.match(third.body.error, /Room A-1 in RM1 is full \(2\/2 beds\)/)
  assert.equal((await add(4, 'A-2')).status, 201)
  assert.equal((await add(5, 'Unassigned')).status, 201)
  assert.equal((await add(6, undefined)).status, 201)
  assert.equal((await add(7, 'Unassigned')).status, 201, 'the placeholder never counts as a room')

  const bulk = await t.api('/students/bulk', { token: superAdmin, body: { rows: [{ line: 2, data: { name: 'Bulk One', email: 'rb1@example.com', noUid: true, hostelId: 'RM1', room: 'A-1' } }, { line: 3, data: { name: 'Bulk Two', email: 'rb2@example.com', noUid: true, hostelId: 'RM1', room: 'B-1' } }] } })
  assert.equal(bulk.body.created, 1)
  assert.equal(bulk.body.failed[0].code, 'ROOM_FULL')

  const id4 = t.db.prepare("SELECT id FROM students WHERE email = 'room4@example.com'").get().id
  const move = await t.api(`/students/${id4}`, { token: superAdmin, method: 'PATCH', body: { room: 'A-1' } })
  assert.equal(move.status, 409)
  const resave = await t.api(`/students/${id4}`, { token: superAdmin, method: 'PATCH', body: { room: 'A-2', name: 'Room Person 4b' } })
  assert.equal(resave.status, 200, 'saving a student into the room they already occupy never counts against them')

  const outsider = t.db.prepare("SELECT id FROM students WHERE hostel_id = 'BH3' LIMIT 1").get().id
  const tr = await t.api(`/students/${outsider}/transfer`, { token: superAdmin, body: { hostelId: 'RM1', room: 'A-1' } })
  assert.equal(tr.status, 409)
  assert.equal(tr.body.code, 'ROOM_FULL')
})

test('rooms: hostel limits — Admin sets beds-per-room for own hostel only; capacity is Super-Admin only and never below occupancy', async () => {
  const ok = await t.api('/hostels/BH2', { token: bh2Admin, method: 'PATCH', body: { roomCapacity: 4 } })
  assert.equal(ok.status, 200)
  assert.equal(ok.body.roomCapacity, 4)
  assert.equal((await t.api('/hostels/BH5', { token: bh2Admin, method: 'PATCH', body: { roomCapacity: 4 } })).status, 403)
  assert.equal((await t.api('/hostels/BH2', { token: bh2Admin, method: 'PATCH', body: { capacity: 500 } })).status, 403)
  assert.equal((await t.api('/hostels/BH2', { token: bh2Kitchen, method: 'PATCH', body: { roomCapacity: 2 } })).status, 403)

  const below = await t.api('/hostels/BH2', { token: superAdmin, method: 'PATCH', body: { capacity: 10 } })
  assert.equal(below.status, 409)
  assert.equal(below.body.code, 'BELOW_OCCUPANCY')
  assert.equal((await t.api('/hostels/BH2', { token: superAdmin, method: 'PATCH', body: { capacity: 120 } })).status, 200)

  t.db.prepare("UPDATE students SET room = 'CRAM-1' WHERE id IN (SELECT id FROM students WHERE hostel_id = 'BH4' LIMIT 3)").run()
  const over = await t.api('/hostels/BH4', { token: superAdmin, method: 'PATCH', body: { roomCapacity: 2 } })
  assert.equal(over.status, 409)
  assert.equal(over.body.code, 'ROOMS_OVER_LIMIT')
  assert.match(over.body.error, /CRAM-1 \(3\)/)

  assert.equal((await t.api('/hostels/BH2', { token: bh2Admin, method: 'PATCH', body: { roomCapacity: null } })).body.roomCapacity, null)
  assert.ok((await t.api('/hostels')).body.every((h) => 'roomCapacity' in h))
})

test('rooms: an existing database without the room_capacity column is migrated on boot', () => {
  const dir = path.join(SERVER_DIR, 'test', '.tmp-legacy')
  const legacy = '/tmp/legacy-roomcap.sqlite'
  const prep = `import Database from 'better-sqlite3'; import fs from 'node:fs'; for (const e of ['','-wal','-shm']) fs.rmSync('${legacy}'+e,{force:true}); const d=new Database('${legacy}'); d.exec('CREATE TABLE hostels (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, capacity INTEGER NOT NULL); INSERT INTO hostels VALUES (\\'OLD1\\',\\'Old\\',\\'boys\\',10);'); d.close()`
  assert.equal(spawnSync('node', ['--input-type=module', '-e', prep], { cwd: SERVER_DIR }).status, 0)
  const probe = `const { db } = await import('./src/db.js'); console.log(JSON.stringify(db.prepare("SELECT id, capacity, room_capacity FROM hostels WHERE id='OLD1'").get()))`
  const run = spawnSync('node', ['--input-type=module', '-e', probe], { cwd: SERVER_DIR, encoding: 'utf8', env: { ...process.env, DB_PATH: legacy } })
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(JSON.parse(run.stdout.trim().split('\n').pop()), { id: 'OLD1', capacity: 10, room_capacity: null })
  void dir
})

// ---------------------------------------------------------------- staff password reset
test('reset-password: Admin resets own mess\'s team + parents; not other messes, not Admins, not self; old password and sessions die', async () => {
  const member = (await t.api('/staff', { token: bh2Admin, body: { name: 'Reset Target', role: 'KITCHEN_STAFF', hostelId: 'BH2' } })).body
  const oldToken = await t.login(member.id, member.tempPassword)

  const r = await t.api(`/staff/${member.id}/reset-password`, { token: bh2Admin, body: {} })
  assert.equal(r.status, 200)
  assert.notEqual(r.body.tempPassword, member.tempPassword)
  assert.equal((await t.api('/auth/login', { body: { identifier: member.id, password: member.tempPassword } })).status, 401)
  assert.equal((await t.api('/auth/login', { body: { identifier: member.id, password: r.body.tempPassword } })).status, 200)
  assert.equal((await t.api('/students/21000101', { token: oldToken })).status, 401, 'old session revoked')

  assert.equal((await t.api(`/staff/${member.id}/reset-password`, { token: bh5Admin, body: {} })).status, 403)
  const bh2AdminRow = t.db.prepare("SELECT id FROM staff WHERE role = 'ADMIN' AND hostel_id = 'BH2'").get()
  assert.equal((await t.api(`/staff/${bh2AdminRow.id}/reset-password`, { token: bh2Admin, body: {} })).status, 403)
  assert.equal((await t.api(`/staff/${bh2AdminRow.id}/reset-password`, { token: superAdmin, body: {} })).status, 200)
  assert.equal((await t.api(`/staff/${member.id}/reset-password`, { token: bh2Kitchen, body: {} })).status, 403)

  const parent = (await t.api('/staff/parent-access/21000101', { token: superAdmin, body: {} })).body
  const warden = await t.staffToken('HOSTEL_WARDEN', 'BH2')
  assert.equal((await t.api(`/staff/${parent.id}/reset-password`, { token: warden, body: {} })).status, 200, 'roster staff may reset a parent account')
  assert.equal((await t.api(`/staff/${member.id}/reset-password`, { token: warden, body: {} })).status, 403, '…but not a team member')
})
