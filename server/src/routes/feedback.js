import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { db, logAudit } from '../db.js'
import { requireAuth } from '../auth.js'
import { requireRoles, enforceMessScope } from '../authz.js'
import { rateLimit } from '../rateLimit.js'
import { validate, feedbackSchema, feedbackRespondSchema } from '../schemas.js'
import { MEALS, localParts, addDays } from '../mealWindows.js'
import { pushInBackground } from '../push.js'

export const feedbackRouter = Router()

// Ratings are ANONYMOUS to staff (a student can be honest about the food); complaints are NAMED (a manager has to be able to
// answer one, and a student who complains about a person must be accountable for it).
const READ_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER', 'KITCHEN_STAFF', 'HOSTEL_WARDEN']
const RESPOND_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER', 'HOSTEL_WARDEN']
const submitLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, scope: 'feedback', message: 'Too many submissions — please wait a few minutes.' })

feedbackRouter.post('/', requireAuth, requireRoles('STUDENT'), submitLimiter, validate(feedbackSchema), (req, res) => {
  const b = req.body
  const today = localParts().date
  if (b.date > today || b.date < addDays(today, -2)) return res.status(400).json({ error: 'You can give feedback on a meal from today or the last two days.', code: 'DATE_OUT_OF_RANGE' })
  const student = db.prepare('SELECT hostel_id FROM students WHERE id = ?').get(req.auth.sub)
  const messId = db.prepare('SELECT id FROM messes WHERE hostel_id = ?').get(student?.hostel_id)?.id
  if (!messId) return res.status(409).json({ error: 'You are not assigned to a mess yet.', code: 'NO_MESS' })
  const id = randomUUID(), now = new Date().toISOString()
  if (b.kind === 'feedback') {
    // One rating per meal; sending again within the window replaces it (people change their mind).
    db.prepare(`INSERT INTO feedback (id, mess_id, student_id, kind, date, meal, rating, category, comment, created_at) VALUES (?, ?, ?, 'feedback', ?, ?, ?, ?, ?, ?)
                ON CONFLICT(student_id, date, meal) WHERE kind = 'feedback' DO UPDATE SET rating = excluded.rating, category = excluded.category, comment = excluded.comment, created_at = excluded.created_at`)
      .run(id, messId, req.auth.sub, b.date, b.meal, b.rating, b.category, b.comment ?? null, now)
  } else {
    // A flood of complaints is a way to bury a real one: cap the open ones per student.
    if (db.prepare("SELECT COUNT(*) n FROM feedback WHERE student_id = ? AND kind = 'complaint' AND status != 'resolved'").get(req.auth.sub).n >= 5) {
      return res.status(429).json({ error: 'You already have 5 open complaints. Wait for those to be answered first.', code: 'TOO_MANY_OPEN' })
    }
    db.prepare("INSERT INTO feedback (id, mess_id, student_id, kind, date, meal, rating, category, comment, created_at) VALUES (?, ?, ?, 'complaint', ?, ?, ?, ?, ?, ?)")
      .run(id, messId, req.auth.sub, b.date, b.meal, b.rating ?? null, b.category, b.comment, now)
    logAudit({ actorId: req.auth.sub, actorName: req.auth.name, actorRole: 'STUDENT', action: 'complaint_filed', messId, summary: `Complaint about ${b.meal} on ${b.date} (${b.category})` })
  }
  res.status(201).json({ success: true, kind: b.kind })
})

feedbackRouter.get('/mine', requireAuth, requireRoles('STUDENT'), (req, res) => {
  const rows = db.prepare('SELECT id, kind, date, meal, rating, category, comment, status, response, responded_at AS respondedAt, created_at AS createdAt FROM feedback WHERE student_id = ? ORDER BY created_at DESC LIMIT 60').all(req.auth.sub)
  res.json(rows)
})

feedbackRouter.get('/', requireAuth, requireRoles(...READ_ROLES), (req, res) => {
  const messId = String(req.query.messId ?? '')
  if (!messId) return res.status(400).json({ error: 'messId is required.' })
  if (!enforceMessScope(req, res, messId, 'feedback')) return
  const ymd = /^\d{4}-\d{2}-\d{2}$/
  const from = ymd.test(String(req.query.from)) ? String(req.query.from) : addDays(localParts().date, -29)
  const to = ymd.test(String(req.query.to)) ? String(req.query.to) : localParts().date
  const items = db.prepare(`SELECT f.id, f.kind, f.date, f.meal, f.rating, f.category, f.comment, f.status, f.response, f.responded_at AS respondedAt, f.created_at AS createdAt,
      CASE WHEN f.kind = 'complaint' THEN s.name END AS studentName, CASE WHEN f.kind = 'complaint' THEN s.room END AS studentRoom
    FROM feedback f JOIN students s ON s.id = f.student_id WHERE f.mess_id = ? AND f.date >= ? AND f.date <= ? ORDER BY f.created_at DESC LIMIT 300`).all(messId, from, to)
  const rated = items.filter((i) => i.kind === 'feedback')
  const avg = (xs) => (xs.length ? Math.round((xs.reduce((t, i) => t + i.rating, 0) / xs.length) * 10) / 10 : null)
  res.json({
    items,
    summary: {
      count: rated.length, avgRating: avg(rated),
      byMeal: MEALS.map((meal) => ({ meal, count: rated.filter((i) => i.meal === meal).length, avgRating: avg(rated.filter((i) => i.meal === meal)) })),
      byCategory: Object.entries(rated.reduce((m, i) => ({ ...m, [i.category]: (m[i.category] ?? 0) + 1 }), {})).map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
      openComplaints: items.filter((i) => i.kind === 'complaint' && i.status !== 'resolved').length,
    },
  })
})

feedbackRouter.patch('/:id', requireAuth, requireRoles(...RESPOND_ROLES), validate(feedbackRespondSchema), (req, res) => {
  const row = db.prepare("SELECT * FROM feedback WHERE id = ? AND kind = 'complaint'").get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Complaint not found.' })
  if (!enforceMessScope(req, res, row.mess_id, `complaint ${row.id}`)) return
  const { status, response } = req.body
  db.prepare('UPDATE feedback SET status = COALESCE(?, status), response = COALESCE(?, response), responded_by = ?, responded_at = ? WHERE id = ?')
    .run(status ?? null, response ?? null, req.auth.name, new Date().toISOString(), row.id)
  logAudit({ actorId: req.auth.sub, actorName: req.auth.name, actorRole: req.auth.role, action: 'complaint_updated', messId: row.mess_id, summary: `Complaint about ${row.meal} on ${row.date}: ${status ? `status → ${status}` : 'replied'}` })
  pushInBackground('student', row.student_id, { title: status === 'resolved' ? 'Your complaint was resolved' : 'Update on your complaint', body: response ? response.slice(0, 120) : `Status: ${status.replace('_', ' ')}`, tag: `complaint-${row.id}`, url: '/feedback' })
  res.json({ success: true })
})
