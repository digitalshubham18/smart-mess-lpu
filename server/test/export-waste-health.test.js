import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startTestServer } from '../test-support/harness.js'

let t, messId, manager, finance, kitchen, warden, ids
const csv = async (url, token) => {
  const r = await t.api(url, { token, raw: true })
  const buf = Buffer.from(await r.arrayBuffer())
  return { status: r.status, text: buf.toString('utf8'), bytes: buf, headers: r.headers }
}
const parse = (text) => text.replace(/^\ufeff/, '').trim().split('\r\n').map((l) => l.split(','))

before(async () => {
  t = await startTestServer()
  messId = 'MESS-BH3'
  manager = await t.staffToken('MESS_MANAGER', 'BH3')
  finance = await t.staffToken('FINANCE_MANAGER', 'BH3')
  kitchen = await t.staffToken('KITCHEN_STAFF', 'BH3')
  warden = await t.staffToken('HOSTEL_WARDEN', 'BH3')
  ids = t.db.prepare("SELECT id FROM students WHERE hostel_id = 'BH3' ORDER BY id LIMIT 3").all().map((r) => r.id)
  const ins = t.db.prepare("INSERT INTO attendance (id, student_id, mess_id, date, meal, scanned_at, scanned_by, method) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
  ins.run('e1', ids[0], messId, '2026-10-01', 'breakfast', '2026-10-01T02:30:00.000Z', null, 'qr')
  ins.run('e2', ids[0], messId, '2026-10-01', 'lunch', '2026-10-01T07:00:00.000Z', null, 'manual')
  ins.run('e3', ids[1], messId, '2026-10-02', 'lunch', '2026-10-02T07:00:00.000Z', null, 'card')
  ins.run('e4', ids[2], messId, '2026-11-20', 'dinner', '2026-11-20T15:00:00.000Z', null, 'qr')
})
after(async () => { await t.close() })

// ------------------------------------------------------------------------------------------------------ CSV export
test('export: managers and finance get a CSV of check-ins for a date range (with BOM, correct headers, mess-local times)', async () => {
  for (const tok of [manager, finance]) {
    const r = await csv(`/attendance/export?messId=${messId}&from=2026-10-01&to=2026-10-31`, tok)
    assert.equal(r.status, 200)
    assert.match(r.headers.get('content-type'), /text\/csv/)
    assert.match(r.headers.get('content-disposition'), /attachment; filename="attendance-records-MESS-BH3-2026-10-01-to-2026-10-31\.csv"/)
    assert.equal(r.headers.get('cache-control'), 'private, no-store')
    assert.deepEqual([...r.bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM so Excel reads the names correctly')
    const rows = parse(r.text)
    assert.deepEqual(rows[0].slice(0, 5), ['Date', 'Meal', 'Student ID', 'Name', 'Hostel'])
    assert.equal(rows.length, 4, 'header + the three October check-ins (the November one is outside the range)')
    assert.equal(rows[1][0], '2026-10-01')
    assert.equal(rows[1][1], 'breakfast')
    assert.match(rows[1][9], /^2026-10-01 08:00$/, '02:30Z is 08:00 in Asia/Kolkata')
  }
})

test('export: filter by meal; summary view gives one row per student with counts', async () => {
  const lunch = parse((await csv(`/attendance/export?messId=${messId}&from=2026-10-01&to=2026-10-31&meal=lunch`, manager)).text)
  assert.equal(lunch.length, 3)
  assert.ok(lunch.slice(1).every((r) => r[1] === 'lunch'))
  const sum = parse((await csv(`/attendance/export?messId=${messId}&from=2026-10-01&to=2026-11-30&view=summary`, finance)).text)
  assert.deepEqual(sum[0].slice(4), ['Breakfast', 'Lunch', 'Snacks', 'Dinner', 'Total meals', 'No-show warnings'])
  const first = sum.find((r) => r[0] === ids[0])
  assert.deepEqual(first.slice(4, 9), ['1', '1', '0', '0', '2'])
  assert.equal(sum.length, 4, 'header + three students')
})

test('export: kitchen staff, wardens and students cannot export; another mess\'s manager is refused; unauthenticated is 401', async () => {
  const url = `/attendance/export?messId=${messId}&from=2026-10-01&to=2026-10-31`
  assert.equal((await csv(url, kitchen)).status, 403)
  assert.equal((await csv(url, warden)).status, 403)
  assert.equal((await csv(url)).status, 401)
  const stu = t.db.prepare("SELECT id FROM students WHERE hostel_id = 'BH3' LIMIT 1").get().id
  t.db.prepare('UPDATE students SET password_hash = (SELECT password_hash FROM staff WHERE id = ?) WHERE id = ?').run('10001', stu)
  assert.equal((await csv(url, await t.login(stu))).status, 403)
  const other = await t.staffToken('MESS_MANAGER', 'BH4')
  const r = await csv(url, other)
  assert.equal(r.status, 403)
  assert.ok(!r.text.includes(ids[0]), 'and nothing leaks in the refusal')
})

test('export: bad input is a 400, a range over a year is refused, and every export is audited', async () => {
  const bad = (q) => csv(`/attendance/export?${q}`, manager)
  assert.equal((await bad(`messId=${messId}&from=2026-10-01`)).status, 400)
  assert.equal((await bad(`messId=${messId}&from=2026-10-31&to=2026-10-01`)).status, 400)
  assert.equal((await bad(`messId=${messId}&from=2026-10-01&to=2026-10-02&meal=brunch`)).status, 400)
  const wide = await t.api(`/attendance/export?messId=${messId}&from=2024-01-01&to=2026-01-01`, { token: manager })
  assert.equal(wide.status, 400)
  assert.equal(wide.body.code, 'RANGE_TOO_LARGE')
  assert.ok(t.db.prepare("SELECT 1 FROM audit_log WHERE action = 'attendance_exported' AND summary LIKE '%3 attendance check-in rows%'").get())
})

test('export: a student whose name starts with = + - @ cannot plant a spreadsheet formula, and commas/quotes are escaped', async () => {
  const { csvCell } = await import('../src/routes/attendance.js')
  assert.equal(csvCell('=HYPERLINK("http://evil","x")'), '"\'=HYPERLINK(""http://evil"",""x"")"')
  assert.equal(csvCell('+91 98765'), "'+91 98765")
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)")
  assert.equal(csvCell('-2+3'), "'-2+3")
  assert.equal(csvCell('Sharma, Aarav'), '"Sharma, Aarav"')
  assert.equal(csvCell(null), '')
  t.db.prepare('UPDATE students SET name = ? WHERE id = ?').run('=cmd|calc', ids[2])
  const r = await csv(`/attendance/export?messId=${messId}&from=2026-11-01&to=2026-11-30`, manager)
  assert.ok(r.text.includes("'=cmd|calc"), 'neutralised in the real output')
  assert.ok(!/,=cmd/.test(r.text))
})

// --------------------------------------------------------------------------------------------------------- waste log
const waste = (token, body) => t.api('/waste', { token, method: 'PUT', body })
const entry = { messId: 'MESS-BH3', date: '2026-10-20', meal: 'lunch', preparedKg: 120, consumedKg: 105.5, reason: 'Plate waste' }

test('waste: kitchen staff record what was cooked and eaten; the server works out the waste', async () => {
  const r = await waste(kitchen, entry)
  assert.equal(r.status, 201, JSON.stringify(r.body))
  assert.equal(r.body.wasteKg, 14.5)
  assert.equal(r.body.wastePct, 12.1)
  assert.equal(r.body.recordedBy.length > 0, true)
})

test('waste: saving the same meal again corrects it (one row per meal) and the correction is audited with the old value', async () => {
  const r = await waste(manager, { ...entry, preparedKg: 120, consumedKg: 110, note: 'recount' })
  assert.equal(r.status, 200)
  assert.equal(r.body.wasteKg, 10)
  assert.equal(t.db.prepare("SELECT COUNT(*) n FROM waste_log WHERE mess_id = 'MESS-BH3' AND date = '2026-10-20' AND meal = 'lunch'").get().n, 1)
  assert.ok(t.db.prepare("SELECT 1 FROM audit_log WHERE action = 'waste_entry_corrected' AND summary LIKE '%was 14.5 kg%'").get())
})

test('waste: consumed > prepared, negatives and unknown reasons are refused', async () => {
  assert.equal((await waste(kitchen, { ...entry, consumedKg: 200 })).status, 400)
  assert.equal((await waste(kitchen, { ...entry, preparedKg: -1 })).status, 400)
  assert.equal((await waste(kitchen, { ...entry, reason: 'because' })).status, 400)
})

test('waste: reading is for mess staff + finance with totals; writing is not for finance; another mess is out of scope', async () => {
  await waste(kitchen, { ...entry, date: '2026-10-21', meal: 'dinner', preparedKg: 80, consumedKg: 70, reason: 'Overproduction' })
  const list = await t.api(`/waste?messId=MESS-BH3&from=2026-10-01&to=2026-10-31`, { token: finance })
  assert.equal(list.status, 200)
  assert.equal(list.body.entries.length, 2)
  assert.equal(list.body.totals.preparedKg, 200)
  assert.equal(list.body.totals.wasteKg, 20)
  assert.equal(list.body.totals.wastePct, 10)
  assert.equal((await waste(finance, entry)).status, 403, 'finance reads, but does not record')
  assert.equal((await t.api('/waste?messId=MESS-BH3', { token: warden })).status, 403)
  const otherKitchen = await t.staffToken('KITCHEN_STAFF', 'BH4')
  assert.equal((await waste(otherKitchen, entry)).status, 403)
  assert.equal((await t.api('/waste?messId=MESS-BH3', { token: otherKitchen })).status, 403)
  assert.equal((await t.api('/waste?messId=MESS-BH3', { raw: true })).status, 401)
})

// ----------------------------------------------------------------------------------------------------------- health
test('health: /api/health is liveness; /api/health/ready fails (503, with the reason) when there is no recent backup, passes with one', async () => {
  assert.equal((await t.api('/health')).status, 200)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'))
  process.env.BACKUP_DIR = dir
  try {
    const none = await t.api('/health/ready')
    assert.equal(none.status, 503)
    assert.equal(none.body.checks.backup.ok, false)
    assert.equal(none.body.checks.database.ok, true)
    const { backupDatabase } = await import('../src/backup.js')
    await backupDatabase({ outDir: dir, dbPath: process.env.DB_PATH })
    const ok = await t.api('/health/ready')
    assert.equal(ok.status, 200)
    assert.equal(ok.body.ok, true)
    assert.ok(ok.body.checks.backup.ageHours < 1)
    assert.ok(!JSON.stringify(ok.body).includes('students'), 'no personal data or counts in the health response')
    // an old backup is stale
    const f = fs.readdirSync(dir).find((n) => n.endsWith('.sqlite'))
    const old = new Date(Date.now() - 72 * 3_600_000)
    fs.utimesSync(path.join(dir, f), old, old)
    assert.equal((await t.api('/health/ready')).status, 503)
    process.env.BACKUP_CHECK = '0'
  } finally {
    delete process.env.BACKUP_DIR
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
