import { db } from './db.js'

// When each meal is served. Defaults suit a campus mess; a Mess Manager / Admin can change them per mess
// (PUT /api/attendance/meal-windows). All times are mess-local — never the server's or the phone's timezone.
export const MEALS = ['breakfast', 'lunch', 'snacks', 'dinner']
export const DEFAULT_WINDOWS = {
  breakfast: { start: 7 * 60, end: 9 * 60 + 30 },
  lunch: { start: 12 * 60, end: 14 * 60 + 30 },
  snacks: { start: 16 * 60 + 30, end: 18 * 60 },
  dinner: { start: 19 * 60 + 30, end: 22 * 60 },
}
export const timezone = () => process.env.MESS_TIMEZONE || 'Asia/Kolkata'
/** Meal-time rules can be switched off for tests / a kitchen that wants free scanning. On by default. */
export const windowsEnforced = () => process.env.ENFORCE_MEAL_WINDOWS !== '0'

export const fmt = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
export const parseHm = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m }
const label = (meal) => meal[0].toUpperCase() + meal.slice(1)

/** Mess-local calendar date + minutes since midnight for an instant. */
export function localParts(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((p) => [p.type, p.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) }
}

export function windowsFor(messId) {
  const out = structuredClone(DEFAULT_WINDOWS)
  for (const r of db.prepare('SELECT meal, start_min, end_min FROM mess_meal_windows WHERE mess_id = ?').all(messId)) {
    if (out[r.meal]) out[r.meal] = { start: r.start_min, end: r.end_min }
  }
  return out
}

export const crossesMidnight = (w) => w.start > w.end
const isOpenAt = (w, m) => (crossesMidnight(w) ? m >= w.start || m < w.end : m >= w.start && m < w.end)

export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * The service day a scan belongs to. A meal that runs past midnight (say Dinner 22:00–01:00) is still that evening's dinner
 * at 00:30, so a scan then is recorded against the PREVIOUS calendar date.
 */
export function serviceDate(window, local) {
  return crossesMidnight(window) && local.minutes < window.end ? addDays(local.date, -1) : local.date
}

/** Is `meal` being served at this instant? Pure given (windows, minutes) so it is trivially testable. */
export function mealStatus(meal, windows, minutes) {
  const w = windows[meal]
  const open = isOpenAt(w, minutes)
  let message
  if (open) message = `${label(meal)} is being served (${fmt(w.start)}–${fmt(w.end)}).`
  else if (crossesMidnight(w)) message = `This is not ${label(meal)} time — ${label(meal)} is served ${fmt(w.start)}–${fmt(w.end)} (it's ${fmt(minutes)}).`
  else if (minutes < w.start) message = `This is not ${label(meal)} time — ${label(meal)} is served ${fmt(w.start)}–${fmt(w.end)} and hasn't started yet (it's ${fmt(minutes)}).`
  else message = `This is not ${label(meal)} time — ${label(meal)} was served ${fmt(w.start)}–${fmt(w.end)} and has ended (it's ${fmt(minutes)}).`
  return { open, message }
}

/** Snapshot for the UI: every meal's window and whether it is open, which meal is on now, and which comes next. */
export function snapshot(messId, at = new Date()) {
  const windows = windowsFor(messId)
  const now = localParts(at)
  const list = MEALS.map((meal) => ({
    meal, start: fmt(windows[meal].start), end: fmt(windows[meal].end), open: mealStatus(meal, windows, now.minutes).open,
    crossesMidnight: crossesMidnight(windows[meal]),
    // the date a check-in for this meal would be recorded under right now (differs from today only after midnight)
    date: serviceDate(windows[meal], now),
  }))
  const current = list.find((m) => m.open)?.meal ?? null
  const untilStart = (m) => (windows[m].start - now.minutes + 1440) % 1440
  const upcoming = MEALS.filter((m) => !list.find((x) => x.meal === m).open).sort((a, b) => untilStart(a) - untilStart(b))[0]
  return {
    timezone: timezone(),
    now: { date: now.date, time: fmt(now.minutes), iso: at.toISOString() },
    windows: list,
    current,
    next: upcoming ? { meal: upcoming, start: fmt(windows[upcoming].start) } : null,
    enforced: windowsEnforced(),
  }
}

/** Do any two meals share a minute of the day? (Handles windows that wrap past midnight.) Returns the clashing pair or null. */
export function findOverlap(windows) {
  const owner = new Array(1440).fill(null)
  for (const m of MEALS) {
    const w = windows[m]
    for (let i = 0; i < 1440; i++) {
      if (!isOpenAt(w, i)) continue
      if (owner[i]) return [owner[i], m]
      owner[i] = m
    }
  }
  return null
}
