import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { db, messIdForHostel, logAudit } from '../db.js'
import { requireAuth, signMealQr, verifyMealToken, QR_TTL_SECONDS, offlineKey, OFFLINE_STEP_SECONDS, SESSION_MAX_AGE_MS } from '../auth.js'
import { processNoShows, retractNoShow, autoSettings } from '../noShows.js'
import { buildDailySummary, summaryMessage } from '../summary.js'
import { MEALS, DEFAULT_WINDOWS, windowsFor, mealStatus, localParts, snapshot, windowsEnforced, parseHm, fmt, serviceDate, findOverlap } from '../mealWindows.js'
import {
  requireRoles, enforceMessScope, canAccessStudent, isStaffRole,
  COUNTER_ROLES, FINE_ROLES,
} from '../authz.js'
import { validate, checkinSchema, processNoShowsSchema, mealWindowsSchema, autoNoShowSettingsSchema } from '../schemas.js'
import { rateLimit } from '../rateLimit.js'
import { sendEmailInBackground } from '../email.js'
import { eligibleCount, intentionTally } from '../forecasting.js'
import { pushInBackground, notifyManagers } from '../push.js'

export const attendanceRouter = Router()

const checkinLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: 'Too many check-ins too quickly — please slow down.' })

// --- The student's meal QR ---------------------------------------------------------------------------------------
// A signed token that lives for QR_TTL_SECONDS. The page re-fetches before it runs out, so what's on screen is always
// fresh; a screenshot, or a QR someone generated from a UID, fails at the counter.
attendanceRouter.get('/my-qr', requireAuth, (req, res) => {
  if (req.auth.role !== 'STUDENT') return res.status(403).json({ error: 'Only the student shows a meal QR code.', code: 'ROLE_FORBIDDEN' })
  const student = db.prepare('SELECT id, hostel_id FROM students WHERE id = ?').get(req.auth.sub)
  if (!student) return res.status(404).json({ error: "You're not on the mess roster. Please visit the warden office.", code: 'NOT_ON_MESS' })
  res.json({
    studentId: student.id,
    token: signMealQr(student.id),
    ttlSeconds: QR_TTL_SECONDS,
    expiresAt: new Date(Date.now() + QR_TTL_SECONDS * 1000).toISOString(),
    meals: snapshot(messIdForHostel(student.hostel_id)),
  })
})

// The one-time secret that lets THIS signed-in phone make meal codes with no network (see auth.js "Offline meal codes").
// It is derived from the server key + this device's session, so signing the device out kills it, and it is only handed
// to the student's own logged-in session. The phone stores it as a non-extractable WebCrypto key.
attendanceRouter.get('/my-offline-key', requireAuth, (req, res) => {
  if (req.auth.role !== 'STUDENT') return res.status(403).json({ error: 'Only the student shows a meal QR code.', code: 'ROLE_FORBIDDEN' })
  if (!req.auth.sid) return res.status(409).json({ error: 'Sign out and in again once to turn on offline codes on this device.', code: 'NEEDS_NEW_SESSION' })
  const sess = db.prepare('SELECT created_at FROM sessions WHERE id = ?').get(req.auth.sid)
  res.json({
    studentId: req.auth.sub, sid: req.auth.sid, key: offlineKey(req.auth.sid, req.auth.sub).toString('base64url'),
    stepSeconds: OFFLINE_STEP_SECONDS, serverTime: new Date().toISOString(),
    validUntil: new Date(new Date(sess?.created_at ?? Date.now()).getTime() + SESSION_MAX_AGE_MS).toISOString(),
  })
})

// --- Meal timings -------------------------------------------------------------------------------------------------
// Counter staff read them (the console only opens the scanner while the chosen meal is being served; this is the server's
// clock, not the phone's). Managers/admins change them.
attendanceRouter.get('/meal-windows', requireAuth, requireRoles(...COUNTER_ROLES), (req, res) => {
  const { messId } = req.query
  if (!messId) return res.status(400).json({ error: 'messId is required.' })
  if (!enforceMessScope(req, res, String(messId), 'meal timings')) return
  res.json(snapshot(String(messId)))
})

attendanceRouter.put('/meal-windows', requireAuth, requireRoles('SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER'), validate(mealWindowsSchema), (req, res) => {
  const { messId, reset, windows } = req.body
  if (!enforceMessScope(req, res, messId, 'meal timing change')) return
  const merged = windowsFor(messId)
  if (reset) for (const m of MEALS) merged[m] = { ...DEFAULT_WINDOWS[m] }
  for (const w of windows ?? []) merged[w.meal] = { start: parseHm(w.start), end: parseHm(w.end) }
  for (const m of MEALS) {
    // start > end is allowed on purpose: it means the meal runs past midnight (e.g. Dinner 22:00–01:00).
    if (merged[m].start === merged[m].end) return res.status(400).json({ error: `${m}: the start and end times must be different.`, code: 'BAD_WINDOW' })
  }
  const clash = findOverlap(merged)
  if (clash) {
    const [x, y] = clash
    return res.status(400).json({ error: `${x} (${fmt(merged[x].start)}–${fmt(merged[x].end)}) overlaps ${y} (${fmt(merged[y].start)}–${fmt(merged[y].end)}).`, code: 'OVERLAPPING_WINDOWS' })
  }
  db.transaction(() => {
    db.prepare('DELETE FROM mess_meal_windows WHERE mess_id = ?').run(messId)
    if (!reset) {
      const ins = db.prepare('INSERT INTO mess_meal_windows (mess_id, meal, start_min, end_min) VALUES (?, ?, ?, ?)')
      for (const m of MEALS) ins.run(messId, m, merged[m].start, merged[m].end)
    }
  })()
  logAudit({ actorId: req.auth.sub, actorName: req.auth.name, actorRole: req.auth.role, action: 'meal_windows_changed', messId, summary: reset ? 'Reset meal timings to the defaults' : `Changed meal timings: ${MEALS.map((m) => `${m} ${fmt(merged[m].start)}–${fmt(merged[m].end)}`).join(', ')}` })
  res.json(snapshot(messId))
})

// --- Check-in -----------------------------------------------------------------------------------------------------
// Counter staff only (Super Admin / Admin / Mess Manager / Kitchen Staff), and only for THEIR mess. The scope check runs
// before any student lookup, so a request aimed at another mess learns nothing — not even whether the UID exists.
// Order of refusals: scope → meal timing → who is it (token signature / UID) → on THIS mess and active → not already done.
const LOGGED_REFUSALS = new Set(['QR_INVALID', 'QR_ALREADY_USED', 'CARD_REVOKED', 'NOT_ENROLLED', 'NOT_ON_MESS', 'MESS_INACTIVE'])
const TAMPER_CODES = new Set(['QR_INVALID', 'QR_ALREADY_USED', 'CARD_REVOKED']) // worth waking a manager for; "wrong mess" and "inactive" are routine
const spikePer2Min = () => Number(process.env.SCAN_SPIKE_PER_2MIN) || 45
const manualPer5Min = () => Number(process.env.SCAN_SPIKE_MANUAL_PER_5MIN) || 12
const METHOD_LABEL = { qr: 'QR scan', card: 'ID-card scan', manual: 'typed UID' }

attendanceRouter.post('/checkin', requireAuth, requireRoles(...COUNTER_ROLES), checkinLimiter, validate(checkinSchema), (req, res) => {
  const { uid, qr, messId, meal, date } = req.body
  if (!enforceMessScope(req, res, messId, `meal check-in for ${uid ?? 'a scanned QR'}`)) return
  const actor = { actorId: req.auth.sub, actorName: req.auth.name, actorRole: req.auth.role }

  // Refusals that look like tampering, a revoked card or a wrong-mess scan are recorded so a manager can see them.
  const refuse = (status, payload, student) => {
    if (LOGGED_REFUSALS.has(payload.code)) {
      const who = student ? `${student.name} (${student.id})` : qr ? 'an unrecognised QR' : `typed UID ${uid}`
      logAudit({ ...actor, action: 'checkin_refused', messId, summary: `Refused ${meal} check-in for ${who}: ${payload.code}` })
      if (TAMPER_CODES.has(payload.code)) notifyManagers(messId, 'tamper', { title: 'Suspicious meal scan', body: `${payload.code === 'CARD_REVOKED' ? 'A revoked ID card' : payload.code === 'QR_ALREADY_USED' ? 'A QR code that was already used' : 'A forged or unrecognised QR code'} was presented at the counter. See Scan alerts.`, tag: 'scan-tamper' })
    }
    return res.status(status).json(payload)
  }

  // When did this scan happen? Offline-queued scans carry their real time, within sane bounds — never in the future
  // (beyond clock skew), not older than 48h — so the queue can't be used to backdate.
  let scannedAt = new Date().toISOString()
  let offline = false
  if (req.body.scannedAt) {
    const t = new Date(req.body.scannedAt).getTime()
    if (t > Date.now() + 5 * 60 * 1000) return res.status(400).json({ error: 'scannedAt is in the future.', code: 'BAD_SCAN_TIME' })
    if (t < Date.now() - 48 * 60 * 60 * 1000) return res.status(400).json({ error: 'That scan is more than 48 hours old and can no longer be synced.', code: 'SCAN_TOO_OLD' })
    scannedAt = new Date(t).toISOString()
    offline = true
  }

  // Is this meal being served at the moment of the scan (mess-local time)? The console checks too, but this is the rule.
  if (windowsEnforced()) {
    const local = localParts(new Date(scannedAt))
    const windows = windowsFor(messId)
    const status = mealStatus(meal, windows, local.minutes)
    // A meal that runs past midnight is still the previous evening's meal at 00:30, so its service date is yesterday's.
    if (status.open && serviceDate(windows[meal], local) !== date) return res.status(400).json({ error: `That scan is for ${date} but this ${meal} belongs to ${serviceDate(windows[meal], local)} at the mess.`, code: 'DATE_MISMATCH' })
    if (!status.open) return res.status(409).json({ error: status.message, code: 'OUTSIDE_MEAL_WINDOW', meals: snapshot(messId, new Date(scannedAt)) })
  }

  // Who is it?
  let student
  let method = 'manual'
  let token = null
  if (qr) {
    try { token = verifyMealToken(qr, new Date(scannedAt).getTime()) } catch (e) {
      return refuse(400, e.code === 'QR_EXPIRED'
        ? { error: 'That QR code has expired. Ask the student to look at their screen again — screenshots don\'t work.', code: 'QR_EXPIRED' }
        : { error: "That isn't a valid Smart Mess meal QR code.", code: 'QR_INVALID' })
    }
    if (token.kind === 'card') {
      method = 'card'
      student = db.prepare('SELECT * FROM students WHERE card_id = ?').get(token.cardId)
      if (!student) return refuse(404, { error: 'This ID card is no longer valid — it was replaced or the student has left the mess. Please send them to the warden office.', code: 'CARD_REVOKED' })
    } else {
      method = 'qr'
      student = db.prepare('SELECT * FROM students WHERE id = ?').get(token.studentId)
    }
  } else {
    student = db.prepare('SELECT * FROM students WHERE id = ?').get(uid.trim())
  }

  if (!student) {
    return refuse(404, {
      error: qr ? "This student isn't on the mess roster any more. Please send them to the warden office." : `No student found for UID "${uid}".`,
      code: 'NOT_ON_MESS',
    })
  }
  if (messIdForHostel(student.hostel_id) !== messId) {
    return refuse(403, { error: `${student.name} (${student.id}) is not enrolled in this mess — check-in refused.`, code: 'NOT_ENROLLED' }, student)
  }
  if (student.status !== 'active') {
    return refuse(403, { error: `${student.name} (${student.id}) does not have an active mess membership — please send them to the warden office.`, code: 'MESS_INACTIVE' }, student)
  }
  const existing = db.prepare('SELECT * FROM attendance WHERE student_id = ? AND date = ? AND meal = ?').get(student.id, date, meal)
  if (existing) {
    const time = new Date(existing.scanned_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: process.env.MESS_TIMEZONE || 'Asia/Kolkata' })
    return res.status(409).json({ error: `${student.name} already checked in for ${meal} at ${time}.`, code: 'ALREADY_CHECKED_IN' })
  }

  // Record it. A live QR is burned in the same transaction, so it cannot be used for a second check-in even two counters at once.
  try {
    db.transaction(() => {
      if (token?.kind === 'qr') {
        db.prepare('DELETE FROM used_qr WHERE used_at < ?').run(new Date(Date.now() - 10 * 60 * 1000).toISOString())
        db.prepare('INSERT INTO used_qr (jti, used_at) VALUES (?, ?)').run(token.jti, new Date().toISOString())
      }
      db.prepare('INSERT INTO attendance (id, student_id, mess_id, date, meal, scanned_at, scanned_by, method) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), student.id, messId, date, meal, scannedAt, req.auth?.sub ?? null, method)
    })()
  } catch (e) {
    if (String(e?.message).includes('used_qr')) return refuse(409, { error: 'That QR code has already been used. Ask the student to refresh their screen for a new one.', code: 'QR_ALREADY_USED' }, student)
    if (String(e?.message).includes('UNIQUE')) return res.status(409).json({ error: `${student.name} already checked in for ${meal}.`, code: 'ALREADY_CHECKED_IN' })
    throw e
  }

  // A scan that arrives late (offline counter) may prove a no-show that was already issued wrong: take it back.
  if (offline) retractNoShow(student, date, meal, actor)

  const onLeave = !!student.leave_until && student.leave_until >= date
  logAudit({ ...actor, action: 'meal_checked_in', messId, summary: `Checked in ${student.name} (${student.id}) for ${meal} on ${date} by ${METHOD_LABEL[method]}${onLeave ? ` — while on approved leave until ${student.leave_until}` : ''}${offline ? ' (synced from offline queue)' : ''}` })

  // Unusual volume from one counter account: a stolen login, or someone typing UIDs to check in people who aren't there.
  if (!offline) detectSpike(req.auth, messId)

  // Push to the student's own devices (only exists if they turned notifications on for a device — that IS the opt-in).
  {
    const at = new Date(scannedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: process.env.MESS_TIMEZONE || 'Asia/Kolkata' })
    pushInBackground('student', student.id, {
      title: `${meal[0].toUpperCase()}${meal.slice(1)} check-in recorded`,
      body: `Checked in at ${at}${method === 'manual' ? ' (the counter typed your UID)' : ''}. Not you? Tell the warden office.`,
      tag: `checkin-${date}-${meal}`,
      url: '/attendance',
    })
  }

  // Opt-in email to the student, so a check-in they didn't make gets noticed.
  if (student.notify_checkin && student.email) {
    const when = new Date(scannedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: process.env.MESS_TIMEZONE || 'Asia/Kolkata' })
    sendEmailInBackground({
      to: student.email,
      subject: `Smart Mess: ${meal} check-in recorded`,
      text: `Hi ${student.name},\n\nYou were checked in for ${meal} on ${when}${method === 'manual' ? ' (the counter staff typed in your UID)' : ''}.\n\nIf this wasn't you, please tell the warden office.\n`,
    })
  }

  const hostel = db.prepare('SELECT name FROM hostels WHERE id = ?').get(student.hostel_id)
  res.status(201).json({
    studentId: student.id, studentName: student.name, meal, date, scannedAt, method,
    hostelId: student.hostel_id, hostelName: hostel?.name ?? student.hostel_id, room: student.room, year: student.year, branch: student.branch,
    hasPhoto: !!student.photo_data,
    // Where the counter fetches the official photo from (login required).
    photoUrl: `/students/${student.id}/photo`,
    // Approved leave doesn't block a meal (they may be back early) but the counter should look at the person standing there.
    onLeave, ...(onLeave ? { leaveUntil: student.leave_until } : {}),
  })
})

function detectSpike(auth, messId) {
  const since = (ms) => new Date(Date.now() - ms).toISOString()
  const total = db.prepare('SELECT COUNT(*) n FROM attendance WHERE scanned_by = ? AND scanned_at > ?').get(auth.sub, since(2 * 60 * 1000)).n
  const manual = db.prepare("SELECT COUNT(*) n FROM attendance WHERE scanned_by = ? AND method = 'manual' AND scanned_at > ?").get(auth.sub, since(5 * 60 * 1000)).n
  const reasons = []
  if (total > spikePer2Min()) reasons.push(`${total} check-ins in 2 minutes`)
  if (manual > manualPer5Min()) reasons.push(`${manual} typed-UID check-ins in 5 minutes`)
  if (!reasons.length) return
  const recent = db.prepare("SELECT 1 FROM audit_log WHERE action = 'checkin_spike' AND actor_id = ? AND at > ?").get(auth.sub, since(10 * 60 * 1000))
  if (recent) return // one alert per counter per 10 minutes, not one per scan
  logAudit({ actorId: auth.sub, actorName: auth.name, actorRole: auth.role, action: 'checkin_spike', messId, summary: `Unusual check-in volume from ${auth.name}: ${reasons.join(' and ')}` })
  notifyManagers(messId, 'spike', { title: 'Unusual check-in volume', body: `${auth.name}'s counter: ${reasons.join(' and ')}. See Scan alerts.`, tag: 'scan-spike' })
}

// --- Live numbers for the counter ---------------------------------------------------------------------------------
attendanceRouter.get('/summary', requireAuth, requireRoles(...COUNTER_ROLES), (req, res) => {
  const { messId, date, meal } = req.query
  if (!messId || !date || !MEALS.includes(String(meal))) return res.status(400).json({ error: 'messId, date and meal are required.' })
  if (!enforceMessScope(req, res, String(messId), 'attendance summary')) return
  const d = String(date), m = String(meal), id = String(messId)
  const checkedIn = db.prepare('SELECT COUNT(*) n FROM attendance WHERE mess_id = ? AND date = ? AND meal = ?').get(id, d, m).n
  const manual = db.prepare("SELECT COUNT(*) n FROM attendance WHERE mess_id = ? AND date = ? AND meal = ? AND method = 'manual'").get(id, d, m).n
  const eligible = eligibleCount(id, d)
  const { willEat, willNot } = intentionTally(id, d, m)
  res.json({ checkedIn, manual, eligible, willEat, willNot, noResponse: Math.max(0, eligible - willEat - willNot) })
})

// --- Things a manager should look at: tampering/revoked-card refusals and unusual scanning volume ----------------------
attendanceRouter.get('/alerts', requireAuth, requireRoles('SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER'), (req, res) => {
  const { messId } = req.query
  if (!messId) return res.status(400).json({ error: 'messId is required.' })
  if (!enforceMessScope(req, res, String(messId), 'scan alerts')) return
  const limit = Math.min(Number(req.query.limit) || 20, 100)
  const rows = db.prepare("SELECT id, at, action, actor_name AS actorName, summary FROM audit_log WHERE mess_id = ? AND action IN ('checkin_refused', 'checkin_spike') ORDER BY at DESC, rowid DESC LIMIT ?").all(String(messId), limit)
  res.json(rows)
})

// --- CSV export (managers and finance) ------------------------------------------------------------------------------------
// One row per check-in (view=records) or one row per student with meal counts (view=summary), for a date range at ONE mess.
// Student names and rooms are personal data, so the roles are limited, the mess scope is enforced, and every export is audited.
const EXPORT_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER', 'FINANCE_MANAGER']
const MAX_EXPORT_DAYS = 366
const exportLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, scope: 'attendance-export', message: 'Too many exports — please wait a minute.' })
/** A cell that starts with = + - @ (or a tab/CR) is run as a formula by Excel/Sheets — a student's name must not be able to do that. */
export function csvCell(v) {
  let t = v === null || v === undefined ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}
const csvLine = (cells) => `${cells.map(csvCell).join(',')}\r\n`
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

attendanceRouter.get('/export', requireAuth, requireRoles(...EXPORT_ROLES), exportLimiter, (req, res) => {
  const messId = String(req.query.messId ?? ''), from = String(req.query.from ?? ''), to = String(req.query.to ?? '')
  const view = req.query.view === 'summary' ? 'summary' : 'records'
  const meal = req.query.meal ? String(req.query.meal) : null
  const ymd = /^\d{4}-\d{2}-\d{2}$/
  if (!messId || !ymd.test(from) || !ymd.test(to)) return res.status(400).json({ error: 'messId, from and to (YYYY-MM-DD) are required.' })
  if (meal && !MEALS.includes(meal)) return res.status(400).json({ error: 'Unknown meal.' })
  if (to < from) return res.status(400).json({ error: '"to" must not be before "from".' })
  if (dayDiff(from, to) + 1 > MAX_EXPORT_DAYS) return res.status(400).json({ error: `Pick a range of at most ${MAX_EXPORT_DAYS} days.`, code: 'RANGE_TOO_LARGE' })
  if (!enforceMessScope(req, res, messId, 'attendance export')) return

  const tz = process.env.MESS_TIMEZONE || 'Asia/Kolkata'
  const when = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)).replace(',', '')
  const params = [messId, from, to, ...(meal ? [meal] : [])]
  const mealSql = meal ? ' AND a.meal = ?' : ''

  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="attendance-${view}-${messId}-${from}-to-${to}.csv"`)
  res.setHeader('Cache-Control', 'private, no-store')
  res.write('\ufeff') // lets Excel read the UTF-8 names correctly
  let rows = 0
  if (view === 'records') {
    res.write(csvLine(['Date', 'Meal', 'Student ID', 'Name', 'Hostel', 'Room', 'Branch', 'Year', 'Method', `Checked in at (${tz})`, 'Checked in by']))
    const it = db.prepare(`
      SELECT a.date, a.meal, a.student_id, s.name, s.hostel_id, s.room, s.branch, s.year, a.method, a.scanned_at, COALESCE(st.name, a.scanned_by, '') AS by_name
      FROM attendance a JOIN students s ON s.id = a.student_id LEFT JOIN staff st ON st.id = a.scanned_by
      WHERE a.mess_id = ? AND a.date >= ? AND a.date <= ?${mealSql} ORDER BY a.date, a.meal, a.scanned_at`).iterate(...params)
    for (const r of it) { res.write(csvLine([r.date, r.meal, r.student_id, r.name, r.hostel_id, r.room, r.branch, r.year, r.method, when(r.scanned_at), r.by_name])); rows++ }
  } else {
    res.write(csvLine(['Student ID', 'Name', 'Hostel', 'Room', ...MEALS.map((m) => m[0].toUpperCase() + m.slice(1)), 'Total meals', 'No-show warnings']))
    const it = db.prepare(`
      SELECT s.id, s.name, s.hostel_id, s.room,
        SUM(a.meal = 'breakfast') AS breakfast, SUM(a.meal = 'lunch') AS lunch, SUM(a.meal = 'snacks') AS snacks, SUM(a.meal = 'dinner') AS dinner, COUNT(*) AS total,
        (SELECT COUNT(*) FROM warnings w WHERE w.student_id = s.id AND w.mess_id = a.mess_id AND w.date >= ? AND w.date <= ?${meal ? ' AND w.meal = ?' : ''}) AS warns
      FROM attendance a JOIN students s ON s.id = a.student_id
      WHERE a.mess_id = ? AND a.date >= ? AND a.date <= ?${mealSql} GROUP BY s.id ORDER BY s.name`).iterate(from, to, ...(meal ? [meal] : []), ...params)
    for (const r of it) { res.write(csvLine([r.id, r.name, r.hostel_id, r.room, r.breakfast, r.lunch, r.snacks, r.dinner, r.total, r.warns])); rows++ }
  }
  logAudit({ actorId: req.auth.sub, actorName: req.auth.name, actorRole: req.auth.role, action: 'attendance_exported', messId, summary: `Exported ${rows} attendance ${view === 'records' ? 'check-in' : 'summary'} row${rows === 1 ? '' : 's'} for ${from} to ${to}${meal ? ` (${meal})` : ''}` })
  res.end()
})

// "Today at a glance" — the same numbers the end-of-day push carries.
attendanceRouter.get('/daily-summary', requireAuth, requireRoles(...COUNTER_ROLES, 'FINANCE_MANAGER'), (req, res) => {
  const messId = String(req.query.messId ?? '')
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date)) ? String(req.query.date) : localParts().date
  if (!messId) return res.status(400).json({ error: 'messId is required.' })
  if (!enforceMessScope(req, res, messId, 'daily summary')) return
  const summary = buildDailySummary(messId, date)
  res.json({ ...summary, message: summaryMessage(summary) })
})

// --- The student's own notification preference ----------------------------------------------------------------------
attendanceRouter.get('/my-notifications', requireAuth, (req, res) => {
  if (req.auth.role !== 'STUDENT') return res.status(403).json({ error: 'Only students have check-in notifications.', code: 'ROLE_FORBIDDEN' })
  const row = db.prepare('SELECT notify_checkin, notify_reminder FROM students WHERE id = ?').get(req.auth.sub)
  res.json({ checkinEmail: !!row?.notify_checkin, mealReminder: row ? !!row.notify_reminder : true })
})
attendanceRouter.put('/my-notifications', requireAuth, (req, res) => {
  if (req.auth.role !== 'STUDENT') return res.status(403).json({ error: 'Only students have check-in notifications.', code: 'ROLE_FORBIDDEN' })
  const { checkinEmail, mealReminder } = req.body ?? {}
  if (checkinEmail !== undefined && typeof checkinEmail !== 'boolean') return res.status(400).json({ error: 'checkinEmail must be true or false.' })
  if (mealReminder !== undefined && typeof mealReminder !== 'boolean') return res.status(400).json({ error: 'mealReminder must be true or false.' })
  if (checkinEmail === undefined && mealReminder === undefined) return res.status(400).json({ error: 'checkinEmail must be true or false.' })
  if (checkinEmail !== undefined) db.prepare('UPDATE students SET notify_checkin = ? WHERE id = ?').run(checkinEmail ? 1 : 0, req.auth.sub)
  if (mealReminder !== undefined) db.prepare('UPDATE students SET notify_reminder = ? WHERE id = ?').run(mealReminder ? 1 : 0, req.auth.sub)
  const row = db.prepare('SELECT notify_checkin, notify_reminder FROM students WHERE id = ?').get(req.auth.sub)
  res.json({ checkinEmail: !!row.notify_checkin, mealReminder: !!row.notify_reminder })
})

// Three legitimate shapes: a student/parent asking about one student (self / linked child);
// staff asking about one student in their mess; staff asking about their mess as a whole.
// Anything broader than that is Super Admin only.
attendanceRouter.get('/', requireAuth, (req, res) => {
  const { messId, studentId, date, meal } = req.query
  if (studentId) {
    const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId)
    if (!student) return res.json([])
    if (!canAccessStudent(req.auth, student)) return res.status(403).json({ error: "You don't have access to that student's attendance.", code: 'OUT_OF_SCOPE' })
  } else if (messId) {
    if (!isStaffRole(req.auth.role)) return res.status(403).json({ error: 'Only mess staff can view a mess-wide attendance list.', code: 'ROLE_FORBIDDEN' })
    if (!enforceMessScope(req, res, messId, 'attendance list')) return
  } else if (req.auth.role !== 'SUPER_ADMIN') {
    return res.status(400).json({ error: 'Specify a messId or studentId.' })
  }
  let sql = 'SELECT * FROM attendance WHERE 1=1'
  const params = []
  if (messId) { sql += ' AND mess_id = ?'; params.push(messId) }
  if (studentId) { sql += ' AND student_id = ?'; params.push(studentId) }
  if (date) { sql += ' AND date = ?'; params.push(date) }
  if (meal) { sql += ' AND meal = ?'; params.push(meal) }
  sql += ' ORDER BY scanned_at DESC'
  res.json(db.prepare(sql).all(...params))
})

// Manual no-show processing (the counter's button). The scheduler runs the same thing by itself once a meal's window has
// closed (scheduler.js), so this is for running it early or for a mess that has automatic processing turned off.
attendanceRouter.post('/process-no-shows', requireAuth, requireRoles(...COUNTER_ROLES), validate(processNoShowsSchema), (req, res) => {
  const { messId, date, meal } = req.body
  const fineAmount = req.body.fineAmount ?? autoSettings(messId).fineAmount
  // This issues warnings and fines against students, so it must only ever run for the actor's own mess.
  if (!enforceMessScope(req, res, messId, `no-show processing (${meal} ${date})`)) return
  const r = processNoShows({ messId, date, meal, fineAmount, actor: { actorId: req.auth.sub, actorName: req.auth.name, actorRole: req.auth.role } })
  db.prepare(`INSERT INTO no_show_runs (mess_id, date, meal, ran_at, status, checked, warnings, fines) VALUES (?, ?, ?, ?, 'manual', ?, ?, ?)
              ON CONFLICT(mess_id, date, meal) DO UPDATE SET status = 'manual', ran_at = excluded.ran_at, checked = excluded.checked, warnings = no_show_runs.warnings + excluded.warnings, fines = no_show_runs.fines + excluded.fines`)
    .run(messId, date, meal, new Date().toISOString(), r.checked, r.warningsIssued, r.finesIssued)
  res.json(r)
})

// Automatic no-show processing: on/off and the fine, per mess. Managers and admins only.
attendanceRouter.get('/auto-no-shows', requireAuth, requireRoles('SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER'), (req, res) => {
  const messId = String(req.query.messId ?? '')
  if (!messId) return res.status(400).json({ error: 'messId is required.' })
  if (!enforceMessScope(req, res, messId, 'automatic no-show settings')) return
  const recent = db.prepare('SELECT date, meal, status, warnings, fines, ran_at AS ranAt FROM no_show_runs WHERE mess_id = ? ORDER BY ran_at DESC LIMIT 8').all(messId)
  res.json({ ...autoSettings(messId), recent })
})
attendanceRouter.put('/auto-no-shows', requireAuth, requireRoles('SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER'), validate(autoNoShowSettingsSchema), (req, res) => {
  const { messId, enabled, fineAmount } = req.body
  if (!enforceMessScope(req, res, messId, 'automatic no-show settings change')) return
  db.prepare(`INSERT INTO mess_auto_settings (mess_id, auto_no_shows, fine_amount, updated_at) VALUES (?, ?, ?, ?)
              ON CONFLICT(mess_id) DO UPDATE SET auto_no_shows = excluded.auto_no_shows, fine_amount = excluded.fine_amount, updated_at = excluded.updated_at`)
    .run(messId, enabled ? 1 : 0, fineAmount, new Date().toISOString())
  logAudit({ actorId: req.auth.sub, actorName: req.auth.name, actorRole: req.auth.role, action: 'auto_no_shows_changed', messId, summary: `Automatic no-show processing ${enabled ? `ON (fine ₹${fineAmount})` : 'OFF'}` })
  res.json(autoSettings(messId))
})

function studentRecordsGuard(req, res) {
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.studentId)
  if (!student) { res.json([]); return false }
  if (!canAccessStudent(req.auth, student)) {
    res.status(403).json({ error: "You don't have access to that student's records.", code: 'OUT_OF_SCOPE' })
    return false
  }
  return true
}

attendanceRouter.get('/warnings/:studentId', requireAuth, (req, res) => {
  if (!studentRecordsGuard(req, res)) return
  res.json(db.prepare('SELECT * FROM warnings WHERE student_id = ? ORDER BY issued_at DESC').all(req.params.studentId))
})

attendanceRouter.get('/fines/:studentId', requireAuth, (req, res) => {
  if (!studentRecordsGuard(req, res)) return
  const rows = db.prepare('SELECT * FROM fines WHERE student_id = ? ORDER BY issued_at DESC').all(req.params.studentId)
  res.json(rows.map((f) => ({ ...f, paid: !!f.paid, warningIds: JSON.parse(f.warning_ids) })))
})

// Mess-wide outstanding fines — for staff to review and mark as paid once collected.
attendanceRouter.get('/fines', requireAuth, requireRoles(...FINE_ROLES), (req, res) => {
  const { messId, paid } = req.query
  if (messId) { if (!enforceMessScope(req, res, messId, 'fines list')) return }
  else if (req.auth.role !== 'SUPER_ADMIN') return res.status(400).json({ error: 'Specify a messId.' })
  let sql = `
    SELECT f.*, s.name AS student_name FROM fines f JOIN students s ON s.id = f.student_id WHERE 1=1
  `
  const params = []
  if (messId) { sql += ' AND f.mess_id = ?'; params.push(messId) }
  if (paid === 'false') sql += ' AND f.paid = 0'
  if (paid === 'true') sql += ' AND f.paid = 1'
  sql += ' ORDER BY f.issued_at DESC'
  const rows = db.prepare(sql).all(...params)
  res.json(rows.map((f) => ({ ...f, paid: !!f.paid, warningIds: JSON.parse(f.warning_ids) })))
})

// Marking a fine paid is a staff action (they collect payment, then record it) — never
// self-service by the student whose fine it is, and only for fines issued by their own mess.
attendanceRouter.post('/fines/:id/pay', requireAuth, requireRoles(...FINE_ROLES), (req, res) => {
  const fine = db.prepare('SELECT * FROM fines WHERE id = ?').get(req.params.id)
  if (!fine) return res.status(404).json({ error: 'Fine not found.' })
  if (!enforceMessScope(req, res, fine.mess_id, `marking fine ${fine.id} paid`)) return
  const result = db.prepare('UPDATE fines SET paid = 1 WHERE id = ?').run(req.params.id)
  if (result.changes > 0) {
    logAudit({ actorId: req.auth.sub, actorName: req.auth.name, actorRole: req.auth.role, action: 'fine_paid', messId: fine.mess_id, summary: `Marked a ₹${fine.amount} no-show fine as paid` })
  }
  res.json({ success: result.changes > 0 })
})
