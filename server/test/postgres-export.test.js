import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { startTestServer } from '../test-support/harness.js'
import { exportToPostgres } from '../src/pgExport.js'

// The export is loaded into a REAL PostgreSQL engine (PGlite = Postgres compiled to WASM,
// version 18 here) — not parsed, not eyeballed — and the result is compared to the SQLite source.

let t, pg, exported
before(async () => {
  t = await startTestServer()
  // make the data awkward on purpose: quotes, unicode, a backslash, newlines, NULLs, a paid fine
  t.db.prepare("UPDATE students SET name = ?, room = ?, phone = NULL WHERE id = '21000001'").run("D'Souza \"Dee\" \\ ₹ नमस्ते\nline2", "A-1'; DROP TABLE students;--")
  t.db.prepare("INSERT INTO fines (id, student_id, mess_id, amount, month, issued_at, warning_ids, paid) VALUES ('F-PG-1', '21000001', 'MESS-BH1', 250, '2026-10', '2026-10-01T00:00:00Z', '[\"w1\"]', 1)").run()
  t.db.prepare("INSERT INTO meal_intentions (student_id, date, meal, status, submitted_at) VALUES ('21000001', '2026-10-07', 'lunch', 'will_eat', datetime('now'))").run()
  t.db.pragma('wal_checkpoint(TRUNCATE)')
  exported = exportToPostgres(process.env.DB_PATH)
  pg = new PGlite()
  await pg.exec(exported.sql)
}, { timeout: 60000 })
after(async () => { await pg?.close(); await t.close() })

const q = async (sql, ...p) => (await pg.query(sql, p)).rows
const lite = (sql, ...p) => t.db.prepare(sql).get(...p)

test('postgres: the whole export loads into a real PostgreSQL with ON_ERROR_STOP semantics (it did, in before())', async () => {
  assert.match((await q('select version() v'))[0].v, /^PostgreSQL/)
})

test('postgres: every table exists and every row count matches SQLite exactly', async () => {
  assert.ok(exported.tables.length >= 11)
  for (const table of exported.tables) {
    const n = (await q(`SELECT COUNT(*)::int AS n FROM "${table}"`))[0].n
    assert.equal(n, lite(`SELECT COUNT(*) AS n FROM "${table}"`).n, `${table} row count`)
  }
  assert.equal((await q('SELECT COUNT(*)::int AS n FROM students'))[0].n, 2000)
})

test('postgres: hostile strings survive byte-for-byte (quotes, backslash, unicode, newline, SQL-injection-looking text)', async () => {
  const row = (await q("SELECT name, room, phone FROM students WHERE id = '21000001'"))[0]
  const src = lite("SELECT name, room, phone FROM students WHERE id = '21000001'")
  assert.equal(row.name, src.name)
  assert.equal(row.room, src.room)
  assert.equal(row.phone, null, 'NULL stays NULL (not the string "NULL")')
  assert.equal((await q('SELECT COUNT(*)::int AS n FROM students'))[0].n, 2000, 'the injection-looking text did not execute')
})

test('postgres: 0/1 flag columns became real booleans with correct values', async () => {
  const cols = await q("SELECT table_name, column_name, data_type FROM information_schema.columns WHERE (table_name, column_name) IN (('fines','paid'),('password_reset_tokens','used'))")
  assert.ok(cols.length === 2 && cols.every((c) => c.data_type === 'boolean'))
  assert.equal((await q("SELECT paid FROM fines WHERE id = 'F-PG-1'"))[0].paid, true)
})

test('postgres: primary keys, composite keys, UNIQUE constraints and foreign keys are enforced by Postgres itself', async () => {
  await assert.rejects(pg.exec("INSERT INTO students (id, name, email, hostel_id) VALUES ('21000001','Dup','dup@x.com','BH1')"), /duplicate key|unique/i)
  const taken = (await q("SELECT email FROM students WHERE id = '21000002'"))[0].email
  await assert.rejects(pg.exec(`INSERT INTO students (id, name, email, hostel_id) VALUES ('99999999','Dup Email','${taken}','BH1')`), /duplicate key|unique/i)
  await assert.rejects(pg.exec("INSERT INTO students (id, name, email, hostel_id) VALUES ('99999998','Orphan','orphan@x.com','NOPE')"), /foreign key/i)
  await assert.rejects(pg.exec("INSERT INTO meal_intentions (student_id, date, meal, status, submitted_at) VALUES ('21000001','2026-10-07','lunch','will_not','x')"), /duplicate key|unique/i)
  await assert.rejects(pg.exec("INSERT INTO attendance (id, student_id, mess_id, date, meal, scanned_at) VALUES ('a1','21000001','MESS-BH1','d','lunch','t'),('a2','21000001','MESS-BH1','d','lunch','t')"), /duplicate key|unique/i)
})

test('postgres: ON DELETE CASCADE carried over (deleting a student removes their meal intentions)', async () => {
  await pg.exec("INSERT INTO students (id, name, email, hostel_id) VALUES ('88888888','Temp','temp@x.com','BH1'); INSERT INTO meal_intentions (student_id,date,meal,status,submitted_at) VALUES ('88888888','2026-10-08','lunch','will_eat','x'); DELETE FROM students WHERE id = '88888888'")
  assert.equal((await q("SELECT COUNT(*)::int AS n FROM meal_intentions WHERE student_id = '88888888'"))[0].n, 0)
})

test('postgres: every SQLite index (incl. lower(email) expression indexes and the partial staff index) exists in Postgres', async () => {
  const lites = t.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'").all().map((r) => r.name)
  const pgs = new Set((await q("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'")).map((r) => r.indexname))
  assert.ok(lites.length >= 16)
  for (const name of lites) assert.ok(pgs.has(name), `missing index ${name}`)
  const staff = (await q("SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_staff_student'"))[0].indexdef
  assert.match(staff, /WHERE \(?student_id IS NOT NULL/)
})

test('postgres: the app\'s own login lookup (case-insensitive email) works and the planner can use the expression index', async () => {
  const email = lite("SELECT email FROM students WHERE id = '21000005'").email
  const hit = await q('SELECT id FROM students WHERE lower(email) = lower($1)', email.toUpperCase())
  assert.equal(hit[0].id, '21000005')
  await pg.exec('SET enable_seqscan = off')
  const plan = (await q("EXPLAIN SELECT id FROM students WHERE lower(email) = 'x'")).map((r) => r['QUERY PLAN']).join('\n')
  assert.match(plan, /idx_students_lower_email/)
})

test('postgres: schema-only export has structure and no rows', async () => {
  const { sql } = exportToPostgres(process.env.DB_PATH, { schemaOnly: true })
  assert.ok(!/INSERT INTO/.test(sql))
  const fresh = new PGlite()
  await fresh.exec(sql)
  assert.equal((await fresh.query('SELECT COUNT(*)::int AS n FROM students')).rows[0].n, 0)
  await fresh.close()
})

test('postgres: the exporter is generated from the live schema — a newly added column appears with no code change', async () => {
  t.db.exec("ALTER TABLE hostels ADD COLUMN warden_note TEXT NOT NULL DEFAULT 'none'")
  const { sql } = exportToPostgres(process.env.DB_PATH)
  assert.match(sql, /"warden_note" TEXT NOT NULL DEFAULT 'none'/)
  const fresh = new PGlite()
  await fresh.exec(sql)
  assert.equal((await fresh.query("SELECT warden_note FROM hostels LIMIT 1")).rows[0].warden_note, 'none')
  await fresh.close()
})
