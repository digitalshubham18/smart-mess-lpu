import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { db, logAudit } from '../db.js'
import { requireAuth } from '../auth.js'
import { requireRoles, enforceMessScope } from '../authz.js'
import { validate, wasteEntrySchema } from '../schemas.js'

export const wasteRouter = Router()

// The first non-demo waste numbers in the app: what the kitchen actually recorded after a meal. One entry per mess/date/meal;
// saving again for the same meal corrects it (and the audit log keeps who changed what).
const WRITE_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER', 'KITCHEN_STAFF']
const READ_ROLES = [...WRITE_ROLES, 'FINANCE_MANAGER']
const row = (r) => ({ id: r.id, messId: r.mess_id, date: r.date, meal: r.meal, preparedKg: r.prepared_kg, consumedKg: r.consumed_kg, wasteKg: r.waste_kg, wastePct: r.prepared_kg > 0 ? Math.round((r.waste_kg / r.prepared_kg) * 1000) / 10 : 0, reason: r.reason, note: r.note ?? '', recordedBy: r.recorded_by_name, recordedAt: r.recorded_at })

wasteRouter.get('/', requireAuth, requireRoles(...READ_ROLES), (req, res) => {
  const messId = String(req.query.messId ?? '')
  if (!messId) return res.status(400).json({ error: 'messId is required.' })
  if (!enforceMessScope(req, res, messId, 'waste log')) return
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from)) ? String(req.query.from) : '0000-00-00'
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to)) ? String(req.query.to) : '9999-99-99'
  const entries = db.prepare('SELECT * FROM waste_log WHERE mess_id = ? AND date >= ? AND date <= ? ORDER BY date DESC, recorded_at DESC LIMIT 400').all(messId, from, to).map(row)
  const total = entries.reduce((t, e) => ({ prepared: t.prepared + e.preparedKg, waste: t.waste + e.wasteKg }), { prepared: 0, waste: 0 })
  res.json({ entries, totals: { entries: entries.length, preparedKg: Math.round(total.prepared * 10) / 10, wasteKg: Math.round(total.waste * 10) / 10, wastePct: total.prepared > 0 ? Math.round((total.waste / total.prepared) * 1000) / 10 : 0 } })
})

wasteRouter.put('/', requireAuth, requireRoles(...WRITE_ROLES), validate(wasteEntrySchema), (req, res) => {
  const b = req.body
  if (!enforceMessScope(req, res, b.messId, `waste entry for ${b.meal} ${b.date}`)) return
  const waste = Math.round((b.preparedKg - b.consumedKg) * 100) / 100
  const prior = db.prepare('SELECT * FROM waste_log WHERE mess_id = ? AND date = ? AND meal = ?').get(b.messId, b.date, b.meal)
  db.prepare(`INSERT INTO waste_log (id, mess_id, date, meal, prepared_kg, consumed_kg, waste_kg, reason, note, recorded_by, recorded_by_name, recorded_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(mess_id, date, meal) DO UPDATE SET prepared_kg = excluded.prepared_kg, consumed_kg = excluded.consumed_kg, waste_kg = excluded.waste_kg,
                reason = excluded.reason, note = excluded.note, recorded_by = excluded.recorded_by, recorded_by_name = excluded.recorded_by_name, recorded_at = excluded.recorded_at`)
    .run(randomUUID(), b.messId, b.date, b.meal, b.preparedKg, b.consumedKg, waste, b.reason, b.note ?? null, req.auth.sub, req.auth.name, new Date().toISOString())
  logAudit({ actorId: req.auth.sub, actorName: req.auth.name, actorRole: req.auth.role, action: prior ? 'waste_entry_corrected' : 'waste_entry_recorded', messId: b.messId,
    summary: `${prior ? 'Corrected' : 'Recorded'} ${b.meal} waste for ${b.date}: prepared ${b.preparedKg} kg, consumed ${b.consumedKg} kg, wasted ${waste} kg (${b.reason})${prior ? ` — was ${prior.waste_kg} kg` : ''}` })
  res.status(prior ? 200 : 201).json(row(db.prepare('SELECT * FROM waste_log WHERE mess_id = ? AND date = ? AND meal = ?').get(b.messId, b.date, b.meal)))
})

const YMD = /^\d{4}-\d{2}-\d{2}$/
// Totals for charts: per day, per meal, per reason — computed from the REAL entries.
wasteRouter.get('/summary', requireAuth, requireRoles(...READ_ROLES), (req, res) => {
  const messId = String(req.query.messId ?? '')
  if (!messId) return res.status(400).json({ error: 'messId is required.' })
  if (!enforceMessScope(req, res, messId, 'waste summary')) return
  const from = YMD.test(String(req.query.from)) ? String(req.query.from) : '0000-00-00'
  const to = YMD.test(String(req.query.to)) ? String(req.query.to) : '9999-99-99'
  const pct = (w, p) => (p > 0 ? Math.round((w / p) * 1000) / 10 : 0)
  const r1 = (n) => Math.round(n * 10) / 10
  const group = (col) => db.prepare(`SELECT ${col} AS k, SUM(prepared_kg) p, SUM(waste_kg) w, COUNT(*) n FROM waste_log WHERE mess_id = ? AND date >= ? AND date <= ? GROUP BY ${col} ORDER BY ${col === 'date' ? 'date' : 'w DESC'}`).all(messId, from, to)
  res.json({
    byDay: group('date').map((r) => ({ date: r.k, preparedKg: r1(r.p), wasteKg: r1(r.w), wastePct: pct(r.w, r.p) })),
    byMeal: group('meal').map((r) => ({ meal: r.k, entries: r.n, preparedKg: r1(r.p), wasteKg: r1(r.w), wastePct: pct(r.w, r.p) })),
    byReason: group('reason').map((r) => ({ reason: r.k, entries: r.n, wasteKg: r1(r.w) })),
  })
})

// "Cook less": per meal, if the last 14 days of REAL entries show consistent waste, say by how much. Needs at least 3
// entries for a meal — three days is a pattern, one bad day is not. The advice is capped so nobody under-cooks on a guess.
wasteRouter.get('/suggestions', requireAuth, requireRoles(...READ_ROLES), (req, res) => {
  const messId = String(req.query.messId ?? '')
  if (!messId) return res.status(400).json({ error: 'messId is required.' })
  if (!enforceMessScope(req, res, messId, 'waste suggestions')) return
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10)
  const out = []
  for (const meal of ['breakfast', 'lunch', 'snacks', 'dinner']) {
    const rows = db.prepare('SELECT prepared_kg p, waste_kg w, reason FROM waste_log WHERE mess_id = ? AND meal = ? AND date >= ? ORDER BY date DESC').all(messId, meal, since)
    if (rows.length < 3) continue
    const p = rows.reduce((t, r) => t + r.p, 0), w = rows.reduce((t, r) => t + r.w, 0)
    const avgPct = p > 0 ? (w / p) * 100 : 0
    const reasons = rows.reduce((m, r) => ({ ...m, [r.reason]: (m[r.reason] ?? 0) + 1 }), {})
    const topReason = Object.entries(reasons).sort((a, b) => b[1] - a[1])[0][0]
    if (avgPct < 8) continue
    // Cooking less only fixes over-production and low attendance; plate waste or quality problems need a different fix.
    const cookLess = topReason === 'Overproduction' || topReason === 'Low attendance'
    const reducePct = cookLess ? Math.min(25, Math.round(avgPct * 0.8)) : 0
    out.push({
      meal, entries: rows.length, avgWastePct: Math.round(avgPct * 10) / 10, avgWasteKg: Math.round((w / rows.length) * 10) / 10, topReason, reducePct,
      advice: cookLess
        ? `${meal[0].toUpperCase() + meal.slice(1)} averaged ${Math.round(avgPct)}% waste over ${rows.length} recorded meals (mostly ${topReason.toLowerCase()}). Try cooking about ${reducePct}% less than the forecast and see if waste falls.`
        : `${meal[0].toUpperCase() + meal.slice(1)} averaged ${Math.round(avgPct)}% waste, mostly "${topReason}" — cooking less won't fix that; look at the recipe or serving.`,
    })
  }
  res.json({ basedOnDays: 14, suggestions: out })
})
