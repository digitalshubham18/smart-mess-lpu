import { db, logAudit } from './db.js'
import { MEALS, windowsFor, crossesMidnight, localParts, addDays, parseHm } from './mealWindows.js'
import { sendPush, notifyManagers } from './push.js'
import { buildDailySummary, summaryMessage, hasActivity } from './summary.js'
import { sendEmailInBackground } from './email.js'
import { processNoShows, autoSettings, SYSTEM_ACTOR } from './noShows.js'
import { sweepPhotosOfLeavers } from './privacy.js'

// Background work, run by one timer (started in index.js — NOT in app.js, so tests never start a timer). Every job is
// idempotent and records what it did, so a restart, a double tick or a clock hiccup can never send or fine twice.
// One process only: SQLite is single-writer and this is not a multi-server design (see docs/DEPLOYMENT.md).

const dayNumber = (date) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000)
const reminderMinutes = () => parseHm(/^([01]\d|2[0-3]):[0-5]\d$/.test(process.env.REMINDER_TIME ?? '') ? process.env.REMINDER_TIME : '21:00')

// --- 9 PM "mark tomorrow's meals" -----------------------------------------------------------------------------------------
/**
 * Pushes a reminder to every student who has notifications on, hasn't answered all four meals for tomorrow, isn't on leave
 * tomorrow and hasn't switched reminders off. Sent once per student per day (reminder_log); if the server was down at the
 * reminder time it still goes out later that evening. Returns counts.
 */
export async function runReminders(now = new Date(), { send = sendPush } = {}) {
  const result = { due: false, considered: 0, sent: 0, alreadyDone: 0 }
  if (process.env.REMINDERS === '0') return result
  const local = localParts(now)
  if (local.minutes < reminderMinutes()) return result
  result.due = true
  const tomorrow = addDays(local.date, 1)
  const rows = db.prepare(`
    SELECT s.id AS id,
      (SELECT COUNT(*) FROM meal_intentions i WHERE i.student_id = s.id AND i.date = @tomorrow AND i.status IN ('will_eat', 'will_not')) AS answered
    FROM students s
    WHERE s.status = 'active' AND s.notify_reminder = 1 AND (s.leave_until IS NULL OR s.leave_until < @tomorrow)
      AND EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.account_type = 'student' AND p.account_id = s.id)
      AND NOT EXISTS (SELECT 1 FROM reminder_log r WHERE r.student_id = s.id AND r.date = @tomorrow AND r.kind = 'mark-meals')
  `).all({ tomorrow })
  result.considered = rows.length
  const log = db.prepare("INSERT OR IGNORE INTO reminder_log (student_id, date, kind, sent_at) VALUES (?, ?, 'mark-meals', ?)")
  const todo = []
  for (const r of rows) {
    // Logged BEFORE sending: at-most-once. A student who already answered everything is logged and skipped.
    if (log.run(r.id, tomorrow, now.toISOString()).changes !== 1) continue
    if (r.answered >= MEALS.length) { result.alreadyDone++; continue }
    todo.push(r)
  }
  for (let i = 0; i < todo.length; i += 20) {
    await Promise.all(todo.slice(i, i + 20).map(async (r) => {
      const missing = MEALS.length - r.answered
      const out = await send('student', r.id, {
        title: "Mark tomorrow's meals",
        body: `${missing === MEALS.length ? "You haven't marked any of tomorrow's meals yet." : `${missing} of tomorrow's meals ${missing === 1 ? 'is' : 'are'} still unmarked.`} It takes 10 seconds, helps the kitchen cook the right amount, and closes at 2:00 AM.`,
        tag: `reminder-${tomorrow}`, url: '/meal-intention', ttl: 6 * 3600,
      })
      result.sent += out?.sent ? 1 : 0
    }))
  }
  return result
}

// --- Automatic no-shows -------------------------------------------------------------------------------------------------
/** Minimum share of "will eat" students who must have been scanned for the pass to run by itself (default 30%). */
const minScanRatio = () => (Number.isFinite(Number(process.env.AUTO_NOSHOW_MIN_SCAN_RATIO)) && process.env.AUTO_NOSHOW_MIN_SCAN_RATIO ? Number(process.env.AUTO_NOSHOW_MIN_SCAN_RATIO) : 0.3)
const graceMinutes = () => (Number.isFinite(Number(process.env.AUTO_NOSHOW_GRACE_MIN)) && process.env.AUTO_NOSHOW_GRACE_MIN !== undefined && process.env.AUTO_NOSHOW_GRACE_MIN !== '' ? Number(process.env.AUTO_NOSHOW_GRACE_MIN) : 30)

/**
 * For every mess with automatic processing on, runs no-show processing for each meal whose serving window closed (plus a
 * grace period for late scans), once. Looks back two days so a short outage is caught up. A meal at which NOBODY was
 * checked in is skipped, not processed: no scans at all means the counter wasn't running (power cut, no one used the app),
 * and warning everyone who ticked "will eat" would be wrong — a manager is told instead.
 */
export function runAutoNoShows(now = new Date()) {
  const out = { processed: 0, skipped: 0, warnings: 0, fines: 0 }
  const local = localParts(now)
  const nowAbs = dayNumber(local.date) * 1440 + local.minutes
  const messes = db.prepare('SELECT id FROM messes').all()
  for (const { id: messId } of messes) {
    const settings = autoSettings(messId)
    if (!settings.enabled) continue
    const windows = windowsFor(messId)
    for (let back = 2; back >= 0; back--) {
      const date = addDays(local.date, -back)
      for (const meal of MEALS) {
        const w = windows[meal]
        const endAbs = dayNumber(date) * 1440 + (crossesMidnight(w) ? 1440 : 0) + w.end
        if (nowAbs < endAbs + graceMinutes()) continue
        if (db.prepare('SELECT 1 FROM no_show_runs WHERE mess_id = ? AND date = ? AND meal = ?').get(messId, date, meal)) continue
        const scans = db.prepare('SELECT COUNT(*) n FROM attendance WHERE mess_id = ? AND date = ? AND meal = ?').get(messId, date, meal).n
        const expected = db.prepare(`SELECT COUNT(*) n FROM meal_intentions i JOIN students s ON s.id = i.student_id
          WHERE i.date = ? AND i.meal = ? AND i.status = 'will_eat' AND s.hostel_id = (SELECT hostel_id FROM messes WHERE id = ?)
          AND (s.leave_until IS NULL OR s.leave_until < i.date)`).get(date, meal, messId).n // people on approved leave can't be warned, so they don't count as expected
        // Safety: only act if the counter was really in use. No scans = it wasn't running. Very few scans compared with the
        // number who said they'd eat = it was only partly used (or an outage), and warning everyone it missed would be unfair.
        const ratio = expected > 0 ? scans / expected : 1
        const minRatio = minScanRatio()
        if (scans === 0 || ratio < minRatio) {
          const status = scans === 0 ? 'skipped_no_scans' : 'skipped_low_turnout'
          db.prepare('INSERT INTO no_show_runs (mess_id, date, meal, ran_at, status, checked) VALUES (?, ?, ?, ?, ?, ?)').run(messId, date, meal, now.toISOString(), status, expected)
          out.skipped++
          if (expected > 0) {
            const why = scans === 0 ? "nobody was checked in at all (counter not in use?)" : `only ${scans} check-in${scans === 1 ? '' : 's'} for ${expected} who said they'd eat (below ${Math.round(minRatio * 100)}% — counter partly used, or an outage?)`
            logAudit({ ...SYSTEM_ACTOR, action: 'no_show_auto_skipped', messId, summary: `Did not process ${meal} no-shows for ${date}: ${why}. Run it by hand if the counter really was open.` })
            notifyManagers(messId, `noshow-skip-${date}-${meal}`, { title: 'No-shows not processed', body: `${meal[0].toUpperCase() + meal.slice(1)} on ${date}: ${scans === 0 ? 'nobody was checked in' : 'too few check-ins'}, so no warnings were issued automatically. Review in Attendance.`, tag: `noshow-skip-${date}-${meal}`, url: '/attendance' })
          }
          continue
        }
        const r = processNoShows({ messId, date, meal, fineAmount: settings.fineAmount, actor: SYSTEM_ACTOR })
        db.prepare("INSERT INTO no_show_runs (mess_id, date, meal, ran_at, status, checked, warnings, fines) VALUES (?, ?, ?, ?, 'processed', ?, ?, ?)").run(messId, date, meal, now.toISOString(), r.checked, r.warningsIssued, r.finesIssued)
        out.processed++; out.warnings += r.warningsIssued; out.fines += r.finesIssued
      }
    }
  }
  return out
}

// --- End-of-day summary for managers ---------------------------------------------------------------------------------------
const summaryMinutes = () => parseHm(/^([01]\d|2[0-3]):[0-5]\d$/.test(process.env.SUMMARY_TIME ?? '') ? process.env.SUMMARY_TIME : '22:30')
/**
 * Once a day after SUMMARY_TIME, each mess's Mess Manager and Admin get a push (and an email, if SMTP is set up) with the
 * day in numbers. A mess that did nothing today sends nothing. Logged first, so a restart can't send it twice.
 */
export async function runDailySummaries(now = new Date(), { send = sendPush } = {}) {
  const out = { due: false, sent: 0, quiet: 0 }
  if (process.env.DAILY_SUMMARY === '0') return out
  const local = localParts(now)
  if (local.minutes < summaryMinutes()) return out
  out.due = true
  for (const { id: messId, hostel_id: hostel } of db.prepare('SELECT id, hostel_id FROM messes').all()) {
    if (db.prepare('INSERT OR IGNORE INTO daily_summary_log (mess_id, date, sent_at) VALUES (?, ?, ?)').run(messId, local.date, now.toISOString()).changes !== 1) continue
    const s = buildDailySummary(messId, local.date)
    if (!hasActivity(s)) { out.quiet++; continue }
    const msg = summaryMessage(s)
    for (const m of db.prepare("SELECT id, name, email FROM staff WHERE hostel_id = ? AND role IN ('MESS_MANAGER', 'ADMIN')").all(hostel)) {
      await send('staff', m.id, { title: msg.title, body: msg.body, tag: `summary-${local.date}`, url: '/attendance', ttl: 12 * 3600 })
      if (process.env.SMTP_HOST && m.email) sendEmailInBackground({ to: m.email, subject: `LPU Smart Mess — ${msg.title}`, text: `Hi ${m.name},\n\n${msg.lines.map((l) => `• ${l}`).join('\n')}\n\nOpen the app for details.` })
      out.sent++
    }
  }
  return out
}

// --- Housekeeping -------------------------------------------------------------------------------------------------------
export function runHousekeeping(now = new Date()) {
  const cutoff = new Date(now.getTime() - 30 * 86_400_000).toISOString()
  const sessions = db.prepare('DELETE FROM sessions WHERE (revoked_at IS NOT NULL AND revoked_at < ?) OR created_at < ?').run(cutoff, new Date(now.getTime() - 40 * 86_400_000).toISOString()).changes
  const reminders = db.prepare('DELETE FROM reminder_log WHERE date < ?').run(addDays(localParts(now).date, -14)).changes
  db.prepare('DELETE FROM daily_summary_log WHERE date < ?').run(addDays(localParts(now).date, -14))
  const photos = sweepPhotosOfLeavers()
  return { sessions, reminders, photosErased: photos }
}

// --- The timer ----------------------------------------------------------------------------------------------------------
let timer = null
let lastHousekeeping = ''
// --- One scheduler at a time ---------------------------------------------------------------------------------------------
const HOLDER = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`
const LEASE_MS = 3 * 60_000
/** Takes (or renews) the lease. False if another live process holds it — then this one must not run any job. */
export function acquireLease(nowMs = Date.now(), holder = HOLDER) {
  return db.transaction(() => {
    const row = db.prepare('SELECT holder, expires_at FROM scheduler_lease WHERE id = 1').get()
    if (row && row.holder !== holder && row.expires_at > nowMs) return false
    db.prepare('INSERT INTO scheduler_lease (id, holder, expires_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET holder = excluded.holder, expires_at = excluded.expires_at').run(holder, nowMs + LEASE_MS)
    return true
  }).immediate()
}

export async function tick(now = new Date()) {
  if (!acquireLease(now.getTime())) return // another copy of the server is running the jobs
  try { await runReminders(now) } catch (e) { console.error('[scheduler] reminders failed:', e) }
  try { runAutoNoShows(now) } catch (e) { console.error('[scheduler] auto no-shows failed:', e) }
  try { await runDailySummaries(now) } catch (e) { console.error('[scheduler] daily summary failed:', e) }
  const day = localParts(now).date
  if (day !== lastHousekeeping) {
    lastHousekeeping = day
    try { const r = runHousekeeping(now); if (r.photosErased) console.log(`[scheduler] erased ${r.photosErased} photo(s) of students who left the mess`) } catch (e) { console.error('[scheduler] housekeeping failed:', e) }
  }
}
export function startScheduler() {
  if (timer || process.env.SCHEDULER === '0') return
  void tick()
  timer = setInterval(() => void tick(), 60_000)
  timer.unref?.()
  console.log('[scheduler] running: reminders, automatic no-shows, retention sweep')
}
export function stopScheduler() { if (timer) clearInterval(timer); timer = null }
