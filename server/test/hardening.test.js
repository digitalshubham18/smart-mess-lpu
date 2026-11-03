import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer } from '../test-support/harness.js'

let t
let superAdmin
before(async () => {
  t = await startTestServer()
  superAdmin = await t.superAdminToken()
})
after(async () => { await t.close() })

// --- security headers ------------------------------------------------------------

function assertBaselineHeaders(headers, label) {
  const csp = headers.get('content-security-policy') ?? ''
  assert.match(csp, /default-src 'none'/, `${label}: CSP default-src 'none'`)
  assert.match(csp, /frame-ancestors 'none'/, `${label}: CSP frame-ancestors 'none'`)
  assert.equal(headers.get('x-frame-options'), 'DENY', `${label}: X-Frame-Options`)
  assert.equal(headers.get('x-content-type-options'), 'nosniff', `${label}: nosniff`)
  assert.ok(headers.get('strict-transport-security'), `${label}: HSTS`)
  assert.ok(headers.get('referrer-policy'), `${label}: Referrer-Policy`)
  assert.equal(headers.get('cross-origin-opener-policy'), 'same-origin', `${label}: COOP`)
  assert.equal(headers.get('x-powered-by'), null, `${label}: X-Powered-By must not advertise Express`)
}

test('headers: a normal API response carries the full security-header set', async () => {
  const { status, headers } = await t.api('/health')
  assert.equal(status, 200)
  assertBaselineHeaders(headers, '/health')
  assert.equal(headers.get('cross-origin-resource-policy'), 'same-origin')
})

test('headers: error responses carry them too (401, 400, 403) — not just the happy path', async () => {
  const unauth = await t.api('/students')
  assert.equal(unauth.status, 401)
  assertBaselineHeaders(unauth.headers, '401')

  const bad = await t.api('/auth/login', { body: { identifier: '' } })
  assert.equal(bad.status, 400)
  assertBaselineHeaders(bad.headers, '400')

  const bh2 = await t.staffToken('KITCHEN_STAFF', 'BH2')
  const forbidden = await t.api('/staff', { token: bh2 })
  assert.equal(forbidden.status, 403)
  assertBaselineHeaders(forbidden.headers, '403')
})

test('headers: avatar images stay loadable cross-origin by the frontend, but are sandboxed', async () => {
  const staffId = t.db.prepare("SELECT id FROM staff WHERE role = 'MESS_MANAGER' AND hostel_id = 'BH1'").get().id
  const superToken = await t.superAdminToken()
  for (const url of [`/staff/${staffId}/photo`, '/students/21000001/photo']) {
    const res = await t.api(url, { raw: true, token: superToken })
    assert.equal(res.status, 200, url)
    assert.equal(res.headers.get('cross-origin-resource-policy'), 'cross-origin', `${url}: must be loadable by an <img> on the frontend origin`)
    assert.match(res.headers.get('content-security-policy'), /sandbox/, `${url}: sandboxed`)
    assert.match(res.headers.get('content-security-policy'), /default-src 'none'/, `${url}: no script/network`)
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  }
})

test('CORS is still locked to the configured origin', async () => {
  const allowed = await fetch(`${t.baseUrl}/health`, { headers: { Origin: 'http://localhost:5173' } })
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:5173')
  const evil = await fetch(`${t.baseUrl}/health`, { headers: { Origin: 'https://evil.example' } })
  assert.notEqual(evil.headers.get('access-control-allow-origin'), 'https://evil.example')
})

// --- avatar upload / rendering hardening ---------------------------------------------

test('photo upload: SVG (which can carry script) is refused; real raster images are accepted', async () => {
  const staffId = t.db.prepare("SELECT id FROM staff WHERE role = 'MESS_MANAGER' AND hostel_id = 'BH1'").get().id
  const svg = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>').toString('base64')
  const rejected = await t.api(`/staff/${staffId}/photo`, { token: superAdmin, body: { dataUrl: svg } })
  assert.equal(rejected.status, 400)
  assert.match(rejected.body.error, /PNG, JPEG, WebP or GIF/)

  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  assert.equal((await t.api(`/staff/${staffId}/photo`, { token: superAdmin, body: { dataUrl: png } })).status, 200)
})

test('generated initials avatars XML-escape the name (a hostile name can\'t inject markup into the SVG)', async () => {
  const made = await t.api('/staff', { token: superAdmin, body: { name: '<script> &co', role: 'KITCHEN_STAFF', hostelId: 'BH3' } })
  assert.equal(made.status, 201)
  const svg = await (await t.api(`/staff/${made.body.id}/photo`, { raw: true })).text()
  assert.ok(svg.includes('&lt;&amp;'), svg)
  assert.ok(!/<[^a-z/!?]/i.test(svg.replace(/<\/?(svg|rect|text)[^>]*>/g, '')), 'no stray raw "<" outside the SVG\'s own tags')
})

// --- indices ---------------------------------------------------------------------------

const plan = (sql, ...params) => t.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map((r) => r.detail).join(' | ')

test('indices: every expected index exists', () => {
  const have = new Set(t.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((r) => r.name))
  for (const name of [
    'idx_students_room', 'idx_intentions_day_meal', 'idx_students_lower_email', 'idx_students_lower_id',
    'idx_staff_hostel', 'idx_staff_student', 'idx_staff_lower_email', 'idx_staff_lower_id',
    'idx_messes_hostel', 'idx_attendance_mess_meal', 'idx_fines_student', 'idx_fines_mess_paid',
    'idx_audit_at', 'idx_audit_mess_at', 'idx_audit_actor_at', 'idx_audit_action_at',
  ]) assert.ok(have.has(name), `missing ${name}`)
})

// These are the exact statements the routes run. Each must be served by an index — if a
// future edit changes a query so the planner falls back to a full scan, this fails.
const HOT_QUERIES = [
  ['login: students by UID or email (case-insensitive)', 'SELECT * FROM students WHERE lower(id) = ? OR lower(email) = ?', ['x', 'y'], /idx_students_lower_id[\s\S]*idx_students_lower_email/],
  ['login: staff by UID or email (case-insensitive)', 'SELECT * FROM staff WHERE lower(id) = ? OR lower(email) = ?', ['x', 'y'], /idx_staff_lower_id[\s\S]*idx_staff_lower_email/],
  ['roster / scoping by hostel', 'SELECT * FROM students WHERE hostel_id = ? ORDER BY name', ['BH1'], /idx_students_room/],
  ['hostel occupancy (capacity check)', 'SELECT COUNT(*) FROM students WHERE hostel_id = ?', ['BH1'], /idx_students_room/],
  ['attendance for a mess/date/meal', 'SELECT * FROM attendance WHERE mess_id = ? AND date = ? AND meal = ?', ['m', 'd', 'l'], /idx_attendance_mess_meal/],
  ['attendance for one student/date/meal (duplicate check)', 'SELECT * FROM attendance WHERE student_id = ? AND date = ? AND meal = ?', ['s', 'd', 'l'], /autoindex_attendance/],
  ['outstanding fines for a mess', 'SELECT * FROM fines WHERE mess_id = ? AND paid = 0', ['m'], /idx_fines_mess_paid/],
  ['fines for one student', 'SELECT * FROM fines WHERE student_id = ? ORDER BY issued_at DESC', ['s'], /idx_fines_student/],
  ['a mess\'s staff team', 'SELECT * FROM staff WHERE hostel_id = ? ORDER BY role', ['BH1'], /idx_staff_hostel/],
  ['parent account for a student', "SELECT * FROM staff WHERE role = 'PARENT' AND student_id = ?", ['s'], /idx_staff_student/],
  ['mess for a hostel (per student in no-show processing)', 'SELECT id FROM messes WHERE hostel_id = ?', ['BH1'], /idx_messes_hostel/],
  ['audit log by mess', 'SELECT * FROM audit_log WHERE mess_id = ? ORDER BY at DESC LIMIT 200', ['m'], /idx_audit_mess_at/],
  ['audit log by actor', 'SELECT * FROM audit_log WHERE actor_id = ? ORDER BY at DESC LIMIT 200', ['a'], /idx_audit_actor_at/],
  ['audit log by action', 'SELECT * FROM audit_log WHERE action = ? ORDER BY at DESC LIMIT 200', ['a'], /idx_audit_action_at/],
  ['audit log, newest first', 'SELECT * FROM audit_log WHERE 1=1 ORDER BY at DESC LIMIT 200', [], /idx_audit_at/],
]
for (const [name, sql, params, expected] of HOT_QUERIES) {
  test(`indices: ${name} is index-served, not a table scan`, () => {
    const p = plan(sql, ...params)
    assert.match(p, expected, p)
    assert.ok(!/\bSCAN (students|staff|attendance|fines|messes)\b/.test(p), `full table scan: ${p}`)
  })
}

test('indices: login by mixed-case email still resolves (the lower() index is used AND correct)', async () => {
  const email = t.db.prepare("SELECT email FROM staff WHERE id = '10001'").get().email
  const { status } = await t.api('/auth/login', { body: { identifier: email.toUpperCase(), password: 'demo1234' } })
  assert.equal(status, 200)
})

test('indices: an EXISTING database from before this change gains them on next boot, data intact (no manual migration)', async () => {
  const { spawnSync } = await import('node:child_process')
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

  // Build a "legacy" database: snapshot the live one, then strip every index and the planner stats.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartmess-legacy-'))
  const legacy = path.join(dir, 'legacy.sqlite')
  try {
    await t.db.backup(legacy)
    const Database = (await import('better-sqlite3')).default
    const c = new Database(legacy)
    for (const { name } of c.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'").all()) c.exec(`DROP INDEX ${name}`)
    c.exec('DROP TABLE IF EXISTS sqlite_stat1')
    const studentsBefore = c.prepare('SELECT COUNT(*) AS n FROM students').get().n
    assert.equal(c.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'idx_%'").get().n, 0, 'precondition: legacy DB has no idx_*')
    c.close()

    // Boot the real db.js against it, exactly as `npm start` would.
    const probe = "const { db } = await import('./src/db.js');" +
      "console.log(JSON.stringify({ idx: db.prepare(\"SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'idx_%'\").get().n," +
      " stats: !!db.prepare(\"SELECT 1 FROM sqlite_master WHERE name = 'sqlite_stat1'\").get()," +
      " students: db.prepare('SELECT COUNT(*) AS n FROM students').get().n })); db.close()"
    const run = spawnSync('node', ['--input-type=module', '-e', probe], { cwd: serverDir, encoding: 'utf8', env: { ...process.env, DB_PATH: legacy } })
    assert.equal(run.status, 0, run.stderr)
    const out = JSON.parse(run.stdout.trim().split('\n').pop())
    assert.equal(out.idx, 23) // was 16; +1 idx_students_card (ID-card lookups), +1 idx_push_account (push devices), +1 idx_sessions_account (device list), +1 idx_waste_mess_date (waste log), +2 feedback (the unique one isn't an idx_ index), +1 inventory moves
    assert.equal(out.stats, true, 'planner statistics were generated')
    assert.equal(out.students, studentsBefore, 'no data lost or reseeded')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// --- malformed input is the client's error, not the server's ---------------------------------

test('errors: malformed JSON → 400 (not 500), with a clean message and the security headers', async () => {
  const res = await fetch(`${t.baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json' })
  assert.equal(res.status, 400)
  const body = await res.json()
  assert.equal(body.code, 'entity.parse.failed')
  assert.ok(!/at |node_modules|body-parser|position/.test(JSON.stringify(body)), 'no parser internals in the response')
  assert.ok(res.headers.get('content-security-policy'))
})

test('errors: an oversized body → 413 (not 500)', async () => {
  const res = await fetch(`${t.baseUrl}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'x', password: 'y'.repeat(4_000_000) }) })
  assert.equal(res.status, 413)
  assert.equal((await res.json()).code, 'entity.too.large')
})

test('errors: a genuine server fault is still a 500 with a generic message (no SQL / paths leaked)', async () => {
  t.db.exec('ALTER TABLE hostels RENAME TO hostels_broken') // make the next query throw a real SQLite error
  const origError = console.error
  console.error = () => {}
  try {
    const res = await fetch(`${t.baseUrl}/hostels`)
    assert.equal(res.status, 500)
    assert.deepEqual(await res.json(), { error: 'Internal server error.' })
  } finally {
    console.error = origError
    t.db.exec('ALTER TABLE hostels_broken RENAME TO hostels')
  }
  assert.equal((await t.api('/hostels')).status, 200, 'and the server recovers')
})

test('seed: the pre-claimed demo student is always 21000001 (it is documented, so it must not depend on row/index order)', async () => {
  const demo = t.db.prepare('SELECT id, name FROM students WHERE password_hash IS NOT NULL').all()
  assert.equal(demo.length, 1)
  assert.equal(demo[0].id, '21000001')
  assert.match(demo[0].name, /Ananya Iyer/)
  assert.equal((await t.api('/auth/login', { body: { identifier: '21000001', password: 'demo1234' } })).status, 200)
})

// --- the default demo password must never sit silently on a production server ----------------

test('production start: warns loudly while the Super Admin still has the published demo password, and stops once changed', async () => {
  const { spawn } = await import('node:child_process')
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartmess-prodwarn-'))
  const run = (port) => new Promise((resolve) => {
    const child = spawn('node', ['src/index.js'], { cwd: serverDir, env: { ...process.env, NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40), CORS_ORIGIN: 'https://mess.example.edu', PORT: String(port), DB_PATH: path.join(dir, 'p.sqlite'), OUTBOX_DIR: path.join(dir, 'o') }, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => { out += d }); child.stderr.on('data', (d) => { out += d })
    const poll = setInterval(() => { if (/password hashing/.test(out)) { setTimeout(() => { clearInterval(poll); child.kill(); resolve(out) }, 800) } }, 100)
  })
  try {
    const first = await run(4801)
    assert.match(first, /SECURITY WARNING.*Super Admin \(UID 10001\)/s)

    const Database = (await import('better-sqlite3')).default
    const { hashPasswordSync } = await import('../src/password.js')
    const conn = new Database(path.join(dir, 'p.sqlite'))
    conn.prepare("UPDATE staff SET password_hash = ? WHERE id = '10001'").run(hashPasswordSync('a-Real-Strong-Passw0rd!'))
    conn.close()
    const second = await run(4802)
    assert.doesNotMatch(second, /SECURITY WARNING/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
