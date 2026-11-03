import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer } from '../test-support/harness.js'

/** The scheduled jobs, with the clock injected: 9 PM meal reminders and automatic no-shows. Mess time is IST (UTC+5:30). */
let t, sched, push, hostel, messId, students, manager, kitchen
const ist = (date, hm) => new Date(`${date}T${hm}:00+05:30`)
const D = '2026-10-21'            // the service day under test; "tomorrow" for reminders is D+1
const sub = (id, n = 1) => t.db.prepare("INSERT OR REPLACE INTO push_subscriptions (endpoint, account_type, account_id, p256dh, auth, created_at) VALUES (?, 'student', ?, 'p', 'a', datetime('now'))").run(`https://fcm.googleapis.com/fcm/send/${id}-${n}`, id)
const intent = (id, date, meal, status = 'will_eat') => t.setIntentionDirect(id, date, meal, status)
const scan = (id, date, meal) => t.db.prepare("INSERT INTO attendance (id, student_id, mess_id, date, meal, scanned_at, method) VALUES (?, ?, ?, ?, ?, ?, 'qr')").run(`a-${id}-${date}-${meal}`, id, messId, date, meal, `${date}T07:00:00.000Z`)
const warnings = (id, date, meal) => t.db.prepare('SELECT * FROM warnings WHERE student_id = ? AND date = ? AND meal = ?').all(id, date, meal)

before(async () => {
  t = await startTestServer()
  sched = await import('../src/scheduler.js')
  push = await import('../src/push.js')
  hostel = 'BH8'
  messId = 'MESS-BH8'
  students = t.db.prepare("SELECT id FROM students WHERE hostel_id = ? AND status = 'active' ORDER BY id LIMIT 8").all(hostel).map((r) => r.id)
  manager = await t.staffToken('MESS_MANAGER', hostel)
  kitchen = await t.staffToken('KITCHEN_STAFF', hostel)
})
after(async () => { await t.close() })

// ---------------------------------------------------------------------------------------------------- reminders
test('reminders: nothing before 9 PM; at 9 PM a student with notifications on and unmarked meals gets one push, once', async () => {
  const [a] = students
  sub(a)
  const sent = []
  const send = async (type, id, msg) => { sent.push({ type, id, msg }); return { sent: 1 } }
  const early = await sched.runReminders(ist(D, '20:59'), { send })
  assert.equal(early.due, false)
  assert.equal(sent.length, 0)
  const r = await sched.runReminders(ist(D, '21:00'), { send })
  assert.equal(r.due, true)
  const mine = sent.filter((s) => s.id === a)
  assert.equal(mine.length, 1)
  assert.equal(mine[0].type, 'student')
  assert.match(mine[0].msg.title, /mark tomorrow/i)
  assert.match(mine[0].msg.body, /any of tomorrow's meals/i)
  assert.match(mine[0].msg.body, /2:00 AM/)
  assert.equal(mine[0].msg.url, '/meal-intention')
  assert.equal(mine[0].msg.tag, 'reminder-2026-10-22')
  // a second tick (or a restart) at 9:01 PM sends nothing more
  await sched.runReminders(ist(D, '21:01'), { send })
  assert.equal(sent.filter((s) => s.id === a).length, 1, 'at most one reminder per student per day')
})

test('reminders: counts what is missing; skips students who answered everything, are on leave, switched them off, are inactive, or have no device', async () => {
  const [, partial, done, leave, optout, inactive, nodevice] = students
  for (const id of [partial, done, leave, optout, inactive]) sub(id)
  const tomorrow = '2026-10-23'
  const day = '2026-10-22'          // "now" is the 22nd, so tomorrow = the 23rd
  intent(partial, tomorrow, 'breakfast', 'will_eat'); intent(partial, tomorrow, 'lunch', 'will_not'); intent(partial, tomorrow, 'dinner', 'unconfirmed')
  for (const m of ['breakfast', 'lunch', 'snacks', 'dinner']) intent(done, tomorrow, m, m === 'snacks' ? 'will_not' : 'will_eat')
  t.db.prepare('UPDATE students SET leave_until = ? WHERE id = ?').run('2026-10-25', leave)
  t.db.prepare('UPDATE students SET notify_reminder = 0 WHERE id = ?').run(optout)
  t.db.prepare("UPDATE students SET status = 'inactive' WHERE id = ?").run(inactive)
  const sent = []
  await sched.runReminders(ist(day, '21:30'), { send: async (type, id, msg) => { sent.push({ id, msg }); return { sent: 1 } } })
  const ids = sent.map((s) => s.id)
  assert.ok(ids.includes(partial))
  assert.match(sent.find((s) => s.id === partial).msg.body, /2 of tomorrow's meals are still unmarked/, '"unconfirmed" counts as not marked')
  for (const [name, id] of Object.entries({ done, leave, optout, inactive, nodevice })) assert.ok(!ids.includes(id), `${name} is not reminded`)
  t.db.prepare("UPDATE students SET status = 'active' WHERE id = ?").run(inactive)
})

test('reminders: a server that was down at 9 PM still sends later that evening, but never after midnight rolls the day over', async () => {
  const x = students[7]
  sub(x)
  const sent = []
  const send = async (_t, id) => { sent.push(id); return { sent: 1 } }
  await sched.runReminders(ist('2026-10-24', '23:40'), { send })
  assert.ok(sent.includes(x), 'late catch-up on the same evening')
  const after = await sched.runReminders(ist('2026-10-25', '00:30'), { send })
  assert.equal(after.due, false)
})

test('reminders: can be switched off for the whole system; students can switch them off for themselves', async () => {
  process.env.REMINDERS = '0'
  assert.equal((await sched.runReminders(ist('2026-11-02', '21:30'), { send: async () => assert.fail('must not send') })).due, false)
  delete process.env.REMINDERS
  const tok = await t.login(students[0]).catch(() => null)
  if (!tok) {
    t.db.prepare('UPDATE students SET password_hash = (SELECT password_hash FROM staff WHERE id = ?) WHERE id = ?').run('10001', students[0])
  }
  const st = await t.login(students[0])
  assert.equal((await t.api('/attendance/my-notifications', { token: st })).body.mealReminder, true, 'on by default')
  const off = await t.api('/attendance/my-notifications', { token: st, method: 'PUT', body: { mealReminder: false } })
  assert.equal(off.body.mealReminder, false)
  assert.equal(off.body.checkinEmail, false, 'the other preference is untouched')
  assert.equal((await t.api('/attendance/my-notifications', { token: st, method: 'PUT', body: {} })).status, 400)
  await t.api('/attendance/my-notifications', { token: st, method: 'PUT', body: { mealReminder: true } })
})

test('reminders: a real push is sent through the push transport', async () => {
  const got = []
  push.setPushTransport(async (s, payload) => { got.push(JSON.parse(payload)) })
  const y = students[3]
  t.db.prepare("UPDATE students SET leave_until = NULL, notify_reminder = 1 WHERE id = ?").run(y)
  sub(y)
  await sched.runReminders(ist('2026-11-10', '21:05'))
  const mine = got.filter((g) => g.tag === 'reminder-2026-11-11')
  assert.ok(mine.length >= 1)
  assert.equal(mine[0].url, '/meal-intention')
})

// ---------------------------------------------------------------------------------------- automatic no-shows
test('auto no-shows: nothing until the window has closed plus the grace period; then warns exactly the students who said they would eat and did not', async () => {
  const [a, b, c, leaveStudent] = students
  for (const id of [a, b, c, leaveStudent]) intent(id, D, 'lunch')
  t.db.prepare('UPDATE students SET leave_until = ? WHERE id = ?').run(D, leaveStudent)
  scan(a, D, 'lunch')   // a ate; someone must have scanned for the pass to run at all
  // lunch is 12:00–14:30; default grace 30 minutes
  assert.equal(sched.runAutoNoShows(ist(D, '14:40')).warnings, 0, 'still inside the window + grace')
  assert.equal(warnings(b, D, 'lunch').length, 0)
  const r = sched.runAutoNoShows(ist(D, '15:05'))
  assert.equal(warnings(a, D, 'lunch').length, 0, 'ate → no warning')
  assert.equal(warnings(b, D, 'lunch').length, 1)
  assert.equal(warnings(c, D, 'lunch').length, 1)
  assert.equal(warnings(leaveStudent, D, 'lunch').length, 0, 'on approved leave → excluded')
  assert.equal(r.warnings, 2)
  const run = t.db.prepare("SELECT * FROM no_show_runs WHERE mess_id = ? AND date = ? AND meal = 'lunch'").get(messId, D)
  assert.equal(run.status, 'processed')
  assert.equal(run.warnings, 2)
  const audit = t.db.prepare("SELECT actor_id, actor_role FROM audit_log WHERE action = 'no_show_warning_issued' AND summary LIKE ?").get(`%${b}%`)
  assert.equal(audit.actor_id, 'system', 'the audit log says the system did it')
  // running again changes nothing
  const again = sched.runAutoNoShows(ist(D, '15:30'))
  assert.equal(again.warnings, 0)
  assert.equal(warnings(b, D, 'lunch').length, 1)
  t.db.prepare('UPDATE students SET leave_until = NULL WHERE id = ?').run(leaveStudent)
})

test('auto no-shows: if NOBODY was scanned at a meal the counter was not running — nobody is warned, and a manager is told', async () => {
  const [a, b] = students
  intent(a, D, 'dinner'); intent(b, D, 'dinner')
  const r = sched.runAutoNoShows(ist('2026-10-22', '02:00')) // dinner (19:30–22:00) closed hours ago
  assert.equal(warnings(a, D, 'dinner').length, 0)
  assert.equal(warnings(b, D, 'dinner').length, 0)
  const run = t.db.prepare("SELECT status FROM no_show_runs WHERE mess_id = ? AND date = ? AND meal = 'dinner'").get(messId, D)
  assert.equal(run.status, 'skipped_no_scans')
  assert.ok(r.skipped >= 1)
  assert.ok(t.db.prepare("SELECT 1 FROM audit_log WHERE action = 'no_show_auto_skipped' AND summary LIKE ?").get(`%dinner%${D}%`), 'a manager can see it was skipped, and why')
})

test('auto no-shows: the third warning in a month adds the fine, using the mess\'s own fine amount', async () => {
  const s = students[4]
  const month = '2026-09'
  for (const [i, d] of ['2026-09-03', '2026-09-04'].entries()) t.db.prepare("INSERT INTO warnings (id, student_id, mess_id, date, meal, issued_at, reason) VALUES (?, ?, ?, ?, 'lunch', ?, 'x')").run(`w-${s}-${i}`, s, messId, d, `${d}T10:00:00Z`)
  const day = '2026-09-10'
  intent(s, day, 'lunch'); scan(students[5], day, 'lunch')
  const set = await t.api('/attendance/auto-no-shows', { token: manager, method: 'PUT', body: { messId, enabled: true, fineAmount: 250 } })
  assert.equal(set.status, 200)
  sched.runAutoNoShows(ist('2026-09-11', '09:00'))
  const fine = t.db.prepare('SELECT * FROM fines WHERE student_id = ? AND month = ?').get(s, month)
  assert.ok(fine, 'a fine was issued')
  assert.equal(fine.amount, 250)
})

test('auto no-shows: a mess can turn it off; the manual button then still works; settings are manager-only and mess-scoped', async () => {
  const off = await t.api('/attendance/auto-no-shows', { token: manager, method: 'PUT', body: { messId, enabled: false, fineAmount: 100 } })
  assert.equal(off.body.enabled, false)
  const [a, b] = students
  const day = '2026-08-12'
  intent(a, day, 'lunch'); scan(b, day, 'lunch')
  sched.runAutoNoShows(ist('2026-08-13', '09:00'))
  assert.equal(warnings(a, day, 'lunch').length, 0, 'switched off → the scheduler leaves it alone')
  const manual = await t.api('/attendance/process-no-shows', { token: kitchen, body: { messId, date: day, meal: 'lunch', fineAmount: 0 } })
  assert.equal(manual.status, 200)
  assert.equal(manual.body.warningsIssued, 1)
  assert.equal(t.db.prepare("SELECT status FROM no_show_runs WHERE mess_id = ? AND date = ? AND meal = 'lunch'").get(messId, day).status, 'manual')
  assert.equal((await t.api('/attendance/auto-no-shows', { token: kitchen, method: 'PUT', body: { messId, enabled: true, fineAmount: 1 } })).status, 403, 'kitchen staff cannot change it')
  const other = await t.staffToken('MESS_MANAGER', 'BH9')
  assert.equal((await t.api(`/attendance/auto-no-shows?messId=${messId}`, { token: other })).status, 403, "another mess's manager cannot see or change it")
  assert.equal((await t.api('/attendance/auto-no-shows', { token: manager, method: 'PUT', body: { messId, enabled: true, fineAmount: 99999 } })).status, 400, 'fine is capped')
  await t.api('/attendance/auto-no-shows', { token: manager, method: 'PUT', body: { messId, enabled: true, fineAmount: 100 } })
})

test('auto no-shows: a meal run by hand is never processed a second time by the scheduler', async () => {
  const [a, b] = students
  const day = '2026-08-20'
  intent(a, day, 'lunch'); scan(b, day, 'lunch')
  await t.api('/attendance/process-no-shows', { token: manager, body: { messId, date: day, meal: 'lunch', fineAmount: 0 } })
  const before = warnings(a, day, 'lunch').length
  sched.runAutoNoShows(ist('2026-08-21', '09:00'))
  assert.equal(warnings(a, day, 'lunch').length, before)
})

test('auto no-shows: a counter that was offline and syncs late takes the wrongly-issued warning (and its unpaid fine) back', async () => {
  const [, , , , , , victim, other] = students
  const day = '2026-07-15'
  // two earlier warnings this month, so the automatic one becomes the 3rd and triggers a fine
  for (const [i, d] of ['2026-07-01', '2026-07-02'].entries()) t.db.prepare("INSERT INTO warnings (id, student_id, mess_id, date, meal, issued_at, reason) VALUES (?, ?, ?, ?, 'snacks', ?, 'x')").run(`rw-${victim}-${i}`, victim, messId, d, `${d}T10:00:00Z`)
  intent(victim, day, 'lunch'); scan(other, day, 'lunch')
  sched.runAutoNoShows(ist('2026-07-16', '09:00'))
  assert.equal(warnings(victim, day, 'lunch').length, 1)
  assert.ok(t.db.prepare("SELECT 1 FROM fines WHERE student_id = ? AND month = '2026-07'").get(victim))
  // the counter's queued scan reaches the server later, carrying its real time
  const r = await t.api('/attendance/checkin', { token: kitchen, body: { uid: victim, messId, meal: 'lunch', date: day, scannedAt: new Date(Date.now() - 60_000).toISOString() } })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  assert.equal(warnings(victim, day, 'lunch').length, 0, 'the warning is withdrawn')
  assert.equal(t.db.prepare("SELECT 1 FROM fines WHERE student_id = ? AND month = '2026-07'").get(victim), undefined, 'and so is the unpaid fine it triggered')
  assert.ok(t.db.prepare("SELECT 1 FROM audit_log WHERE action = 'no_show_retracted'").get())
})

test('auto no-shows: a PAID fine is never silently reversed — the audit log tells a person to refund it', async () => {
  const [, , , , , , , , ] = students
  const v = t.db.prepare("SELECT id FROM students WHERE hostel_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1").get(hostel).id
  const w = t.db.prepare("SELECT id FROM students WHERE hostel_id = ? AND id != ? ORDER BY id DESC LIMIT 1").get(hostel, v).id
  const day = '2026-06-15'
  for (const [i, d] of ['2026-06-01', '2026-06-02'].entries()) t.db.prepare("INSERT INTO warnings (id, student_id, mess_id, date, meal, issued_at, reason) VALUES (?, ?, ?, ?, 'snacks', ?, 'x')").run(`pw-${v}-${i}`, v, messId, d, `${d}T10:00:00Z`)
  intent(v, day, 'lunch'); scan(w, day, 'lunch')
  sched.runAutoNoShows(ist('2026-06-16', '09:00'))
  t.db.prepare("UPDATE fines SET paid = 1 WHERE student_id = ? AND month = '2026-06'").run(v)
  await t.api('/attendance/checkin', { token: kitchen, body: { uid: v, messId, meal: 'lunch', date: day, scannedAt: new Date(Date.now() - 60_000).toISOString() } })
  assert.equal(warnings(v, day, 'lunch').length, 0)
  assert.ok(t.db.prepare("SELECT 1 FROM fines WHERE student_id = ? AND month = '2026-06' AND paid = 1").get(v), 'the paid fine is still there')
  assert.ok(t.db.prepare("SELECT 1 FROM audit_log WHERE action = 'no_show_retracted' AND summary LIKE '%refund%'").get())
})

test('housekeeping: old revoked sessions and stale reminder rows are cleaned out', async () => {
  const old = new Date(Date.now() - 60 * 86_400_000).toISOString()
  t.db.prepare("INSERT INTO sessions (id, account_type, account_id, created_at, last_seen_at, revoked_at) VALUES ('old1', 'staff', '10001', ?, ?, ?)").run(old, old, old)
  t.db.prepare("INSERT INTO reminder_log (student_id, date, kind, sent_at) VALUES ('x', '2020-01-01', 'mark-meals', ?)").run(old)
  const r = sched.runHousekeeping()
  assert.ok(r.sessions >= 1)
  assert.equal(t.db.prepare("SELECT 1 FROM sessions WHERE id = 'old1'").get(), undefined)
  assert.equal(t.db.prepare("SELECT 1 FROM reminder_log WHERE date = '2020-01-01'").get(), undefined)
})

test('auto no-shows: too few check-ins (counter only partly used) is skipped, not blamed on the students who were missed', async () => {
  const day = '2026-05-12'
  const group = students.slice(0, 8)
  for (const id of group) intent(id, day, 'lunch')
  scan(group[0], day, 'lunch')               // 1 scan for 8 who said they'd eat = 12% < 30%
  sched.runAutoNoShows(ist('2026-05-13', '09:00'))
  for (const id of group.slice(1)) assert.equal(warnings(id, day, 'lunch').length, 0)
  const run = t.db.prepare("SELECT status, checked FROM no_show_runs WHERE mess_id = ? AND date = ? AND meal = 'lunch'").get(messId, day)
  assert.equal(run.status, 'skipped_low_turnout')
  assert.equal(run.checked, 8)
  assert.ok(t.db.prepare("SELECT 1 FROM audit_log WHERE action = 'no_show_auto_skipped' AND summary LIKE '%only 1 check-in for 8%'").get())
  // the same meal with healthy turnout IS processed
  const day2 = '2026-05-14'
  for (const id of group) intent(id, day2, 'lunch')
  for (const id of group.slice(0, 4)) scan(id, day2, 'lunch')   // 50%
  sched.runAutoNoShows(ist('2026-05-15', '09:00'))
  assert.equal(warnings(group[7], day2, 'lunch').length, 1)
})

test('scheduler: only one process holds the lease; a second copy stays idle until it lapses', async () => {
  const t0 = Date.now()
  assert.equal(sched.acquireLease(t0, 'proc-A'), true)
  assert.equal(sched.acquireLease(t0 + 1000, 'proc-B'), false, 'A is alive')
  assert.equal(sched.acquireLease(t0 + 60_000, 'proc-A'), true, 'A renews')
  assert.equal(sched.acquireLease(t0 + 61_000, 'proc-B'), false)
  assert.equal(sched.acquireLease(t0 + 60_000 + 4 * 60_000, 'proc-B'), true, 'A stopped renewing → B takes over')
})
