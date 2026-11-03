import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { startTestServer } from '../test-support/harness.js'

// forecasting.js loads db.js, so it must be imported only AFTER startTestServer() has pointed DB_PATH at a throwaway file —
// a static import here would open (and write to) the real dev database.
let t, sa, mgr, otherMgr, predictFrom
const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)

function scan(messId, date, meal, n) {
  const ids = t.db.prepare('SELECT s.id FROM students s JOIN messes m ON m.hostel_id = s.hostel_id WHERE m.id = ? ORDER BY s.id LIMIT ?').all(messId, n).map((r) => r.id)
  const ins = t.db.prepare('INSERT INTO attendance (id, student_id, mess_id, date, meal, scanned_at, scanned_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
  for (const id of ids) ins.run(randomUUID(), id, messId, date, meal, `${date}T12:00:00.000Z`, 'test')
}

before(async () => {
  t = await startTestServer()
  ;({ predictFrom } = await import('../src/forecasting.js'))
  sa = await t.superAdminToken()
  mgr = await t.staffToken('MESS_MANAGER', 'BH2')
  otherMgr = await t.staffToken('MESS_MANAGER', 'BH3')
})
after(async () => { await t.close() })

const get = (q, token = mgr) => t.api(`/forecast?${new URLSearchParams(q)}`, { token })

test('with no check-ins and no intentions it says there is nothing to forecast from — no invented number', async () => {
  const r = await get({ messId: 'MESS-BH2', date: day(1), meal: 'lunch' })
  assert.equal(r.status, 200)
  assert.equal(r.body.predictedStudents, null)
  assert.equal(r.body.confidence, null)
  assert.equal(r.body.basis, 'none')
  assert.match(r.body.note, /nothing to forecast from/i)
})

test('statistical methods work on the real check-in history (hand-checked numbers)', () => {
  const h = [10, 20, 30, 40].map((count, i) => ({ date: `2026-01-0${i + 1}`, count }))
  assert.equal(predictFrom(h, 'historical_average', '2026-01-05'), 25)
  assert.equal(predictFrom(h, 'moving_average', '2026-01-05'), 25)
  assert.equal(predictFrom(h, 'weighted_moving_average', '2026-01-05'), (10 * 1 + 20 * 2 + 30 * 3 + 40 * 4) / 10)
  assert.equal(predictFrom(h, 'linear_regression', '2026-01-05'), 50)
  assert.equal(predictFrom([], 'moving_average', '2026-01-05'), null)
})

test('forecasts from recorded check-ins, with a confidence that is a measured backtest error', async () => {
  // 20 past days at a perfectly steady 30 lunches → any sensible method predicts ~30 and is ~100% accurate.
  for (let i = 1; i <= 20; i++) scan('MESS-BH2', day(-i), 'lunch', 30)
  const r = await get({ messId: 'MESS-BH2', date: day(1), meal: 'lunch', method: 'moving_average' })
  assert.equal(r.body.predictedStudents, 30)
  assert.equal(r.body.basis, 'history')
  assert.equal(r.body.confidence, 100)
  assert.equal(r.body.evidence.historyDays, 20)
  assert.ok(r.body.evidence.backtestDays >= 5)
  // a different meal with no history is still "nothing", not borrowed from lunch
  assert.equal((await get({ messId: 'MESS-BH2', date: day(1), meal: 'dinner' })).body.predictedStudents, null)
})

test('weekday_average respects the weekly rhythm', async () => {
  const t2 = 'MESS-BH2'
  const target = day(1)
  const dow = new Date(`${target}T00:00:00Z`).getUTCDay()
  // dinner: 10 on the target's weekday, 40 on every other day, for 4 weeks
  for (let i = 1; i <= 28; i++) {
    const d = day(-i)
    scan(t2, d, 'dinner', new Date(`${d}T00:00:00Z`).getUTCDay() === dow ? 10 : 40)
  }
  const wd = await get({ messId: t2, date: target, meal: 'dinner', method: 'weekday_average' })
  const ma = await get({ messId: t2, date: target, meal: 'dinner', method: 'moving_average' })
  assert.equal(wd.body.predictedStudents, 10)
  assert.ok(ma.body.predictedStudents > 25, 'the plain average smears the weekly pattern')
})

test('real meal intentions are blended in, in proportion to how many students actually answered', async () => {
  const target = day(2)
  const ids = t.db.prepare("SELECT s.id FROM students s JOIN messes m ON m.hostel_id = s.hostel_id WHERE m.id = 'MESS-BH2' ORDER BY s.id LIMIT 100").all().map((r) => r.id)
  ids.forEach((id) => t.setIntentionDirect(id, target, 'lunch', 'will_eat')) // 100 of 100 enrolled say yes
  const r = await get({ messId: 'MESS-BH2', date: target, meal: 'lunch', method: 'moving_average' })
  assert.equal(r.body.basis, 'history+intentions')
  assert.equal(r.body.evidence.willEat, 100)
  assert.ok(r.body.predictedStudents > 30 && r.body.predictedStudents <= 100, `intentions pull the forecast up from 30 (got ${r.body.predictedStudents})`)
})

test('intentions with no history are reported as a floor, not as an estimate', async () => {
  const target = day(2)
  const ids = t.db.prepare("SELECT s.id FROM students s JOIN messes m ON m.hostel_id = s.hostel_id WHERE m.id = 'MESS-BH3' ORDER BY s.id LIMIT 7").all().map((r) => r.id)
  ids.forEach((id) => t.setIntentionDirect(id, target, 'lunch', 'will_eat'))
  const r = await get({ messId: 'MESS-BH3', date: target, meal: 'lunch' }, otherMgr)
  assert.equal(r.body.predictedStudents, 7)
  assert.equal(r.body.basis, 'intentions-only')
  assert.match(r.body.note, /not an estimate of the total/i)
})

test('accuracy backtest returns predicted-vs-actual rows built only from earlier days', async () => {
  const r = await t.api('/forecast/accuracy?messId=MESS-BH2&days=30&method=moving_average', { token: mgr })
  assert.equal(r.status, 200)
  const lunch = r.body.rows.filter((x) => x.meal === 'lunch')
  assert.ok(lunch.length >= 10)
  assert.ok(lunch.every((x) => x.actual === 30 && x.predicted === 30))
})

test('access: staff only, own mess only, and bad input is a clean 400', async () => {
  assert.equal((await t.api('/forecast?messId=MESS-BH2&date=2026-01-01&meal=lunch')).status, 401)
  assert.equal((await get({ messId: 'MESS-BH2', date: day(1), meal: 'lunch' }, otherMgr)).status, 403)
  assert.equal((await get({ messId: 'MESS-BH2', date: day(1), meal: 'lunch' }, sa)).status, 200)
  const stu = t.db.prepare('SELECT id FROM students WHERE password_hash IS NOT NULL LIMIT 1').get().id
  const stuTok = await t.login(stu)
  assert.equal((await get({ messId: 'MESS-BH1', date: day(1), meal: 'lunch' }, stuTok)).status, 403)
  assert.equal((await get({ messId: 'MESS-BH2', date: 'tomorrow', meal: 'lunch' })).status, 400)
  assert.equal((await get({ messId: 'MESS-BH2', date: day(1), meal: 'brunch' })).status, 400)
  assert.equal((await get({ messId: 'MESS-BH2', date: day(1), meal: 'lunch', method: 'lstm' })).status, 400)
  assert.equal((await t.api('/forecast/accuracy?messId=MESS-BH2', { token: otherMgr })).status, 403)
})
