import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startTestServer } from '../test-support/harness.js'

let t, sched, summary, errorLog
let manager, kitchen, finance, warden, otherManager, studentTok, student2Tok, studentId, student2Id
const MESS = 'MESS-BH2'
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
const ago = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)

before(async () => {
  t = await startTestServer()
  sched = await import('../src/scheduler.js')
  summary = await import('../src/summary.js')
  errorLog = await import('../src/errorLog.js')
  manager = await t.staffToken('MESS_MANAGER', 'BH2'); kitchen = await t.staffToken('KITCHEN_STAFF', 'BH2')
  finance = await t.staffToken('FINANCE_MANAGER', 'BH2'); warden = await t.staffToken('HOSTEL_WARDEN', 'BH2')
  otherManager = await t.staffToken('MESS_MANAGER', 'BH5')
  const ids = t.db.prepare("SELECT id FROM students WHERE hostel_id = 'BH2' ORDER BY id LIMIT 2").all().map((r) => r.id)
  ;[studentId, student2Id] = ids
  for (const id of ids) t.db.prepare('UPDATE students SET password_hash = (SELECT password_hash FROM staff WHERE id = ?) WHERE id = ?').run('10001', id)
  studentTok = await t.login(studentId); student2Tok = await t.login(student2Id)
})
after(async () => { await t.close() })

// ------------------------------------------------------------------------------------------------ feedback
const rate = (tok, over = {}) => t.api('/feedback', { token: tok, body: { date: today(), meal: 'lunch', rating: 4, category: 'Taste', ...over } })

test('feedback: a student rates a meal; rating again the same meal replaces it (one rating per meal)', async () => {
  assert.equal((await rate(studentTok)).status, 201)
  assert.equal((await rate(studentTok, { rating: 2, comment: 'cold today' })).status, 201)
  const rows = t.db.prepare("SELECT rating, comment FROM feedback WHERE student_id = ? AND kind = 'feedback' AND meal = 'lunch'").all(studentId)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].rating, 2)
})

test('feedback: validation — rating required, 1-5, real meal, date in the last 3 days only', async () => {
  assert.equal((await rate(studentTok, { rating: undefined })).status, 400)
  assert.equal((await rate(studentTok, { rating: 6 })).status, 400)
  assert.equal((await rate(studentTok, { meal: 'brunch' })).status, 400)
  assert.equal((await rate(studentTok, { date: ago(10) })).body.code, 'DATE_OUT_OF_RANGE')
  assert.equal((await rate(studentTok, { date: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10) })).body.code, 'DATE_OUT_OF_RANGE')
  assert.equal((await t.api('/feedback', { token: manager, body: { date: today(), meal: 'lunch', rating: 3, category: 'Taste' } })).status, 403, 'only students submit')
})

test('feedback: staff see ratings ANONYMOUSLY with averages; complaints are named; scope is enforced', async () => {
  await rate(student2Tok, { meal: 'dinner', rating: 5, category: 'Variety' })
  const c = await t.api('/feedback', { token: studentTok, body: { kind: 'complaint', date: today(), meal: 'dinner', category: 'Hygiene', comment: 'Found a hair in the dal' } })
  assert.equal(c.status, 201)
  const r = await t.api(`/feedback?messId=${MESS}`, { token: manager })
  assert.equal(r.status, 200)
  const ratings = r.body.items.filter((i) => i.kind === 'feedback')
  assert.ok(ratings.length >= 2)
  assert.ok(ratings.every((i) => i.studentName === null || i.studentName === undefined), 'a rating never reveals who gave it')
  assert.ok(!JSON.stringify(ratings).includes(studentId))
  const complaint = r.body.items.find((i) => i.kind === 'complaint')
  assert.ok(complaint.studentName, 'a complaint is named so it can be answered')
  assert.equal(r.body.summary.openComplaints, 1)
  assert.equal(r.body.summary.byMeal.find((m) => m.meal === 'dinner').avgRating, 5)
  assert.equal((await t.api(`/feedback?messId=${MESS}`, { token: otherManager })).status, 403)
  assert.equal((await t.api(`/feedback?messId=${MESS}`, { token: finance })).status, 403)
})

test('feedback: a manager replies and resolves; the student is told and sees it; others cannot touch it', async () => {
  const id = t.db.prepare("SELECT id FROM feedback WHERE kind = 'complaint'").get().id
  assert.equal((await t.api(`/feedback/${id}`, { token: kitchen, method: 'PATCH', body: { status: 'resolved' } })).status, 403)
  assert.equal((await t.api(`/feedback/${id}`, { token: otherManager, method: 'PATCH', body: { status: 'resolved' } })).status, 403)
  assert.equal((await t.api(`/feedback/${id}`, { token: manager, method: 'PATCH', body: {} })).status, 400)
  const r = await t.api(`/feedback/${id}`, { token: manager, method: 'PATCH', body: { status: 'resolved', response: 'Thank you — the cook has been spoken to.' } })
  assert.equal(r.status, 200)
  const mine = await t.api('/feedback/mine', { token: studentTok })
  const row = mine.body.find((m) => m.id === id)
  assert.equal(row.status, 'resolved')
  assert.match(row.response, /cook has been spoken to/)
  assert.deepEqual((await t.api('/feedback/mine', { token: student2Tok })).body.filter((m) => m.id === id), [], 'only your own')
  assert.ok(t.db.prepare("SELECT 1 FROM audit_log WHERE action = 'complaint_updated'").get())
})

test('feedback: a complaint needs words, and no more than 5 can be open at once', async () => {
  const c = (comment) => t.api('/feedback', { token: student2Tok, body: { kind: 'complaint', date: today(), meal: 'snacks', category: 'Service', comment } })
  assert.equal((await c('no')).status, 400)
  for (let i = 0; i < 5; i++) assert.equal((await c(`complaint number ${i}`)).status, 201)
  const sixth = await c('one too many')
  assert.equal(sixth.status, 429)
  assert.equal(sixth.body.code, 'TOO_MANY_OPEN')
})

// ------------------------------------------------------------------------------------------------ inventory
const inv = (tok, body, url = '/inventory', method = 'POST') => t.api(url, { token: tok, method, body })
let rice

test('inventory: create an item with opening stock; it is listed; duplicates and bad units are refused', async () => {
  const r = await inv(kitchen, { messId: MESS, name: 'Basmati rice', unit: 'kg', category: 'Grains', quantity: 100, reorderLevel: 30 })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  rice = r.body
  assert.equal(rice.quantity, 100)
  assert.equal(rice.low, false)
  assert.equal((await inv(kitchen, { messId: MESS, name: 'BASMATI RICE', unit: 'kg' })).status, 409, 'case-insensitive duplicate')
  assert.equal((await inv(kitchen, { messId: MESS, name: 'Salt', unit: 'bags' })).status, 400)
  const list = await t.api(`/inventory?messId=${MESS}`, { token: finance })
  assert.equal(list.status, 200, 'finance can read')
  assert.equal(list.body.items.length, 1)
})

test('inventory: receive / use / waste change the balance and are recorded with who and why', async () => {
  await inv(kitchen, { kind: 'receive', qty: 20, note: 'delivery' }, `/inventory/${rice.id}/move`)
  const u = await inv(kitchen, { kind: 'use', qty: 45.5, note: 'lunch' }, `/inventory/${rice.id}/move`)
  assert.equal(u.body.quantity, 74.5)
  await inv(kitchen, { kind: 'waste', qty: 4.5, note: 'spoiled bag' }, `/inventory/${rice.id}/move`)
  const moves = await t.api(`/inventory/${rice.id}/moves`, { token: manager })
  assert.deepEqual(moves.body.map((m) => [m.kind, m.delta, m.balance]), [['waste', -4.5, 70], ['use', -45.5, 74.5], ['receive', 20, 120], ['receive', 100, 100]])
  assert.ok(moves.body[0].byName)
})

test('inventory: the shelf can never go below zero; 0/negative quantities refused; a stock-take needs a reason', async () => {
  const over = await inv(kitchen, { kind: 'use', qty: 500 }, `/inventory/${rice.id}/move`)
  assert.equal(over.status, 409)
  assert.equal(over.body.code, 'INSUFFICIENT_STOCK')
  assert.equal(t.db.prepare('SELECT quantity FROM inventory_items WHERE id = ?').get(rice.id).quantity, 70, 'unchanged')
  assert.equal((await inv(kitchen, { kind: 'use', qty: 0 }, `/inventory/${rice.id}/move`)).status, 400)
  assert.equal((await inv(kitchen, { kind: 'use', qty: -3 }, `/inventory/${rice.id}/move`)).status, 400)
  assert.equal((await inv(kitchen, { kind: 'adjust', qty: 65 }, `/inventory/${rice.id}/move`)).status, 400, 'no reason')
  const adj = await inv(kitchen, { kind: 'adjust', qty: 65, note: 'weekly stock-take' }, `/inventory/${rice.id}/move`)
  assert.equal(adj.body.quantity, 65)
  assert.equal(t.db.prepare("SELECT delta FROM inventory_moves WHERE kind = 'adjust'").get().delta, -5)
})

test('inventory: two people taking stock at once cannot both succeed past zero', async () => {
  const it = (await inv(kitchen, { messId: MESS, name: 'Turmeric', unit: 'kg', quantity: 10 })).body
  const rs = await Promise.all(Array.from({ length: 6 }, () => inv(kitchen, { kind: 'use', qty: 3 }, `/inventory/${it.id}/move`)))
  assert.equal(rs.filter((r) => r.status === 200).length, 3)
  assert.equal(rs.filter((r) => r.status === 409).length, 3)
  assert.equal(t.db.prepare('SELECT quantity FROM inventory_items WHERE id = ?').get(it.id).quantity, 1)
})

test('inventory: dropping to the reorder level flags it low and pushes the manager once; scope and roles enforced', async () => {
  const push = await import('../src/push.js')
  push._resetManagerThrottle?.()
  const got = []
  push.setPushTransport(async (_s, payload) => { got.push(JSON.parse(payload)) })
  const mgrId = t.db.prepare("SELECT id FROM staff WHERE role = 'MESS_MANAGER' AND hostel_id = 'BH2'").get().id
  t.db.prepare("INSERT OR REPLACE INTO push_subscriptions (endpoint, account_type, account_id, p256dh, auth, created_at) VALUES ('https://fcm.googleapis.com/fcm/send/mgr', 'staff', ?, 'p', 'a', datetime('now'))").run(mgrId)
  const r = await inv(kitchen, { kind: 'use', qty: 40 }, `/inventory/${rice.id}/move`) // 65 → 25 (≤ 30)
  assert.equal(r.body.low, true)
  await new Promise((res) => setTimeout(res, 100))
  assert.ok(got.some((g) => /low stock: basmati rice/i.test(g.title)))
  assert.equal((await t.api(`/inventory?messId=${MESS}`, { token: otherManager })).status, 403)
  assert.equal((await inv(otherManager, { kind: 'use', qty: 1 }, `/inventory/${rice.id}/move`)).status, 403)
  assert.equal((await inv(warden, { messId: MESS, name: 'X', unit: 'kg' })).status, 403)
  assert.equal((await inv(finance, { kind: 'use', qty: 1 }, `/inventory/${rice.id}/move`)).status, 403, 'finance reads, does not move stock')
  const archived = await inv(manager, { archived: true }, `/inventory/${rice.id}`, 'PATCH')
  assert.equal(archived.body.archived, true)
  assert.equal((await t.api(`/inventory?messId=${MESS}`, { token: manager })).body.items.find((i) => i.id === rice.id), undefined, 'archived items drop out of the list')
})

// ------------------------------------------------------------------------------------------ waste analytics + advice
const wasteRow = (date, meal, prepared, consumed, reason) => t.api('/waste', { token: kitchen, method: 'PUT', body: { messId: MESS, date, meal, preparedKg: prepared, consumedKg: consumed, reason } })

test('waste: summary groups the real entries by day, meal and reason', async () => {
  await wasteRow(ago(1), 'lunch', 100, 80, 'Overproduction')
  await wasteRow(ago(2), 'lunch', 100, 85, 'Overproduction')
  await wasteRow(ago(3), 'lunch', 100, 82, 'Overproduction')
  await wasteRow(ago(1), 'dinner', 60, 58, 'Plate waste')
  const s = await t.api(`/waste/summary?messId=${MESS}`, { token: finance })
  assert.equal(s.status, 200)
  assert.equal(s.body.byDay.length, 3)
  assert.equal(s.body.byMeal.find((m) => m.meal === 'lunch').wasteKg, 53)
  assert.equal(s.body.byReason[0].reason, 'Overproduction')
  assert.equal((await t.api(`/waste/summary?messId=${MESS}`, { token: otherManager })).status, 403)
})

test('waste advice: "cook less" only after 3+ real entries show consistent over-production; capped; not for other causes', async () => {
  const r = await t.api(`/waste/suggestions?messId=${MESS}`, { token: manager })
  const lunch = r.body.suggestions.find((s) => s.meal === 'lunch')
  assert.ok(lunch, 'lunch has 3 entries averaging ~17.7% waste')
  assert.equal(lunch.entries, 3)
  assert.equal(lunch.avgWastePct, 17.7)
  assert.equal(lunch.reducePct, 14)
  assert.match(lunch.advice, /cooking about 14% less/i)
  assert.equal(r.body.suggestions.find((s) => s.meal === 'dinner'), undefined, 'one dinner entry is not a pattern')
  await wasteRow(ago(4), 'breakfast', 50, 30, 'Plate waste'); await wasteRow(ago(5), 'breakfast', 50, 30, 'Plate waste'); await wasteRow(ago(6), 'breakfast', 50, 30, 'Plate waste')
  const b = (await t.api(`/waste/suggestions?messId=${MESS}`, { token: manager })).body.suggestions.find((s) => s.meal === 'breakfast')
  assert.equal(b.reducePct, 0, 'plate waste is not fixed by cooking less')
  assert.match(b.advice, /won't fix that/i)
  await wasteRow(ago(7), 'snacks', 10, 1, 'Overproduction'); await wasteRow(ago(8), 'snacks', 10, 1, 'Overproduction'); await wasteRow(ago(9), 'snacks', 10, 1, 'Overproduction')
  assert.equal((await t.api(`/waste/suggestions?messId=${MESS}`, { token: manager })).body.suggestions.find((s) => s.meal === 'snacks').reducePct, 25, 'advice is capped at 25%')
})

// ------------------------------------------------------------------------------------------------ daily summary
const ist = (date, hm) => new Date(`${date}T${hm}:00+05:30`)

test('daily summary: the day in numbers (check-ins, response rate, no-shows, waste, rating, complaints, low stock)', async () => {
  const d = today()
  t.setIntentionDirect(studentId, d, 'lunch', 'will_eat'); t.setIntentionDirect(student2Id, d, 'lunch', 'will_not')
  t.db.prepare("INSERT INTO attendance (id, student_id, mess_id, date, meal, scanned_at, method) VALUES ('sum1', ?, ?, ?, 'lunch', ?, 'qr')").run(studentId, MESS, d, new Date().toISOString())
  await wasteRow(d, 'lunch', 100, 90, 'Plate waste')
  const s = summary.buildDailySummary(MESS, d)
  assert.equal(s.totalCheckedIn, 1)
  assert.equal(s.meals.find((m) => m.meal === 'lunch').willEat, 1)
  assert.equal(s.responseRate, Math.round((2 / s.activeStudents) * 100))
  assert.equal(s.waste.wasteKg, 10)
  assert.equal(s.waste.wastePct, 10)
  assert.equal(s.feedback.count, 2)
  assert.equal(s.lowStockItems, 0, 'the only low item was archived')
  const api = await t.api(`/attendance/daily-summary?messId=${MESS}&date=${d}`, { token: manager })
  assert.equal(api.status, 200)
  assert.match(api.body.message.body, /Checked in: 1/)
  assert.equal((await t.api(`/attendance/daily-summary?messId=${MESS}`, { token: otherManager })).status, 403)
})

test('daily summary: sent once, after the set time, to that mess\'s manager and admin only; quiet messes send nothing', async () => {
  const d = today()
  const sent = []
  const send = async (type, id, msg) => { sent.push({ type, id, msg }); return { sent: 1 } }
  assert.equal((await sched.runDailySummaries(ist(d, '22:00'), { send })).due, false)
  const r = await sched.runDailySummaries(ist(d, '22:30'), { send })
  assert.equal(r.due, true)
  const recipients = t.db.prepare("SELECT id FROM staff WHERE hostel_id = 'BH2' AND role IN ('MESS_MANAGER', 'ADMIN')").all().map((x) => x.id).sort()
  assert.deepEqual(sent.map((s) => s.id).sort(), recipients)
  assert.ok(sent.every((s) => s.type === 'staff' && /checked in/i.test(s.msg.body) && s.msg.url === '/attendance'))
  assert.ok(r.quiet >= 15, 'the other messes did nothing today, so nothing was sent for them')
  const again = await sched.runDailySummaries(ist(d, '23:00'), { send })
  assert.equal(sent.length, recipients.length, 'never twice in a day')
  assert.equal(again.sent, 0)
  process.env.DAILY_SUMMARY = '0'
  assert.equal((await sched.runDailySummaries(ist('2026-01-05', '23:00'), { send })).due, false)
  delete process.env.DAILY_SUMMARY
})

// ------------------------------------------------------------------------------------------------ error reporting
test('errors: browsers report (no sign-in needed); identical errors collapse into one row with a count; no personal data kept', async () => {
  const rep = (b) => t.api('/client-errors', { body: b })
  const a = await rep({ message: 'Cannot read properties of undefined (reading "x")', stack: 'TypeError: boom\n    at render (app.js:10:5)', url: 'https://mess.example.edu/attendance?token=SECRET&uid=21000012#frag' })
  assert.equal(a.status, 204)
  await rep({ message: 'Cannot read properties of undefined (reading "x")', stack: 'TypeError: boom\n    at render (app.js:99:7)', url: '/attendance' })
  const row = t.db.prepare("SELECT * FROM error_reports WHERE kind = 'client'").get()
  assert.equal(row.count, 2, 'same bug, same row (line numbers ignored)')
  assert.equal(row.url, '/attendance', 'no host, no query string, no fragment')
  assert.ok(!JSON.stringify(row).includes('SECRET') && !JSON.stringify(row).includes('21000012'))
  assert.equal((await rep({})).status, 400)
  assert.equal((await rep({ message: 'x'.repeat(5000) })).status, 204)
  assert.ok(t.db.prepare('SELECT length(message) l FROM error_reports ORDER BY id DESC LIMIT 1').get().l <= 500, 'oversize messages are clipped')
})

test('errors: only the Super Admin can read or dismiss them; the server records its own failures too', async () => {
  const sa = await t.superAdminToken()
  assert.equal((await t.api('/errors', { token: manager })).status, 403)
  assert.equal((await t.api('/errors', { raw: true })).status, 401)
  errorLog.recordError({ kind: 'server', message: 'SqliteError: disk full', stack: 'Error: x\n    at db.js:1:1', url: 'POST /api/waste' })
  const list = await t.api('/errors', { token: sa })
  assert.equal(list.status, 200)
  assert.ok(list.body.errors.some((e) => e.kind === 'server' && /disk full/.test(e.message)))
  assert.ok(list.body.errors.some((e) => e.kind === 'client'))
  const id = list.body.errors[0].id
  assert.equal((await t.api(`/errors/${id}`, { token: sa, method: 'DELETE' })).body.success, true)
  assert.ok(!(await t.api('/errors', { token: sa })).body.errors.some((e) => e.id === id), 'dismissed errors drop out')
  errorLog.recordError({ kind: 'server', message: 'SqliteError: disk full', stack: 'Error: x\n    at db.js:1:1', url: 'POST /api/waste' })
  assert.ok((await t.api('/errors', { token: sa })).body.errors.some((e) => /disk full/.test(e.message)), 'it comes back if it happens again')
})

test('errors: client reports are rate-limited', async () => {
  let limited = 0
  for (let i = 0; i < 40; i++) if ((await t.api('/client-errors', { body: { message: `spam ${i}` } })).status === 429) limited++
  assert.ok(limited > 0)
})

// ------------------------------------------------------------------------------------------------ SEED_DEMO=0
test('SEED_DEMO=0: a fresh database has the hostels and messes but NO people; the first Super Admin is created from the console', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed0-'))
  const env = { ...process.env, DB_PATH: path.join(dir, 'a.sqlite'), OUTBOX_DIR: path.join(dir, 'ob'), JWT_SECRET: 'x', SEED_DEMO: '0' }
  const q = (sql) => spawnSync('node', ['-e', `import('./src/db.js').then(({db})=>console.log(JSON.stringify(db.prepare(${JSON.stringify(sql)}).get())))`], { env, encoding: 'utf8' }).stdout.trim().split('\n').pop()
  assert.equal(JSON.parse(q('SELECT (SELECT COUNT(*) FROM hostels) h, (SELECT COUNT(*) FROM messes) m, (SELECT COUNT(*) FROM students) s, (SELECT COUNT(*) FROM staff) f, (SELECT COUNT(*) FROM university_directory) d')).s, 0)
  const counts = JSON.parse(q('SELECT (SELECT COUNT(*) FROM hostels) h, (SELECT COUNT(*) FROM messes) m, (SELECT COUNT(*) FROM students) s, (SELECT COUNT(*) FROM staff) f, (SELECT COUNT(*) FROM university_directory) d'))
  assert.deepEqual(counts, { h: 20, m: 20, s: 0, f: 0, d: 0 })
  const run = (input, args) => spawnSync('node', ['scripts/create-super-admin.js', ...args], { env, input, encoding: 'utf8' })
  assert.match(run('short\n', ['Dr Test', 'a@b.edu']).stderr, /at least 12/)
  assert.match(run('demo1234\n', ['Dr Test', 'a@b.edu']).stderr, /at least 12|published demo/)
  const ok = run('a-very-long-passphrase\n', ['Dr Test', 'a@b.edu'])
  assert.match(ok.stdout, /Created Dr Test as Super Admin, UID 10001/)
  assert.match(run('another-long-passphrase\n', ['Dr Two', 'c@d.edu']).stderr, /already exists/)
  const row = JSON.parse(q("SELECT role, must_change_password m FROM staff WHERE id = '10001'"))
  assert.equal(row.role, 'SUPER_ADMIN')
  fs.rmSync(dir, { recursive: true, force: true })
})
