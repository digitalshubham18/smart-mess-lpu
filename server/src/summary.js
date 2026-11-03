import { db } from './db.js'
import { MEALS } from './mealWindows.js'

/** The day at one mess in numbers — the same figures the end-of-day push/email and the Attendance "Today" card show. */
export function buildDailySummary(messId, date) {
  const hostel = db.prepare('SELECT hostel_id FROM messes WHERE id = ?').get(messId)?.hostel_id
  const active = db.prepare("SELECT COUNT(*) n FROM students WHERE hostel_id = ? AND status = 'active'").get(hostel)?.n ?? 0
  const meals = MEALS.map((meal) => ({
    meal,
    willEat: db.prepare("SELECT COUNT(*) n FROM meal_intentions i JOIN students s ON s.id = i.student_id WHERE i.date = ? AND i.meal = ? AND i.status = 'will_eat' AND s.hostel_id = ?").get(date, meal, hostel).n,
    checkedIn: db.prepare('SELECT COUNT(*) n FROM attendance WHERE mess_id = ? AND date = ? AND meal = ?').get(messId, date, meal).n,
  }))
  const answered = db.prepare("SELECT COUNT(DISTINCT i.student_id) n FROM meal_intentions i JOIN students s ON s.id = i.student_id WHERE i.date = ? AND i.status IN ('will_eat', 'will_not') AND s.hostel_id = ?").get(date, hostel).n
  const waste = db.prepare('SELECT COALESCE(SUM(prepared_kg), 0) p, COALESCE(SUM(waste_kg), 0) w, COUNT(*) n FROM waste_log WHERE mess_id = ? AND date = ?').get(messId, date)
  const fb = db.prepare("SELECT COUNT(*) n, AVG(rating) a FROM feedback WHERE mess_id = ? AND date = ? AND kind = 'feedback'").get(messId, date)
  return {
    messId, date, activeStudents: active, meals,
    totalCheckedIn: meals.reduce((t, m) => t + m.checkedIn, 0),
    responseRate: active > 0 ? Math.round((answered / active) * 100) : 0,
    noShowWarnings: db.prepare('SELECT COUNT(*) n FROM warnings WHERE mess_id = ? AND date = ?').get(messId, date).n,
    waste: { entries: waste.n, preparedKg: Math.round(waste.p * 10) / 10, wasteKg: Math.round(waste.w * 10) / 10, wastePct: waste.p > 0 ? Math.round((waste.w / waste.p) * 1000) / 10 : 0 },
    feedback: { count: fb.n, avgRating: fb.a === null ? null : Math.round(fb.a * 10) / 10 },
    openComplaints: db.prepare("SELECT COUNT(*) n FROM feedback WHERE mess_id = ? AND kind = 'complaint' AND status != 'resolved'").get(messId).n,
    lowStockItems: db.prepare('SELECT COUNT(*) n FROM inventory_items WHERE mess_id = ? AND archived = 0 AND reorder_level > 0 AND quantity <= reorder_level').get(messId).n,
  }
}

/** True if there is anything worth telling a manager about (a quiet day, or a mess not using the system, sends nothing). */
export const hasActivity = (s) => s.totalCheckedIn > 0 || s.meals.some((m) => m.willEat > 0) || s.waste.entries > 0 || s.feedback.count > 0

export function summaryMessage(s) {
  const eaten = s.meals.map((m) => `${m.meal[0].toUpperCase()}${m.meal.slice(1, 3)} ${m.checkedIn}`).join(' · ')
  const parts = [`Checked in: ${s.totalCheckedIn} (${eaten})`, `${s.responseRate}% of students marked their meals`, `${s.noShowWarnings} no-show warning${s.noShowWarnings === 1 ? '' : 's'}`]
  if (s.waste.entries) parts.push(`Waste ${s.waste.wasteKg} kg (${s.waste.wastePct}%)`)
  else parts.push('No waste recorded today')
  if (s.feedback.count) parts.push(`Rating ${s.feedback.avgRating}/5 from ${s.feedback.count}`)
  if (s.openComplaints) parts.push(`${s.openComplaints} open complaint${s.openComplaints === 1 ? '' : 's'}`)
  if (s.lowStockItems) parts.push(`${s.lowStockItems} item${s.lowStockItems === 1 ? '' : 's'} low on stock`)
  return { title: `Today at the mess — ${s.date}`, body: parts.join(' · '), lines: parts }
}
