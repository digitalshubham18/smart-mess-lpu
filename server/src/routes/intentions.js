import { Router } from 'express'
import { db, logAudit, messIdForHostel } from '../db.js'
import { requireAuth } from '../auth.js'
import { enforceHostelScope, canAccessStudent, COUNTER_ROLES, isStaffRole } from '../authz.js'
import { validate, setIntentionSchema } from '../schemas.js'

export const intentionsRouter = Router()

// Confirmations for a day close at 02:00 IST on that day (same rule the UI shows — the
// frontend's confirmationCutoff). Pinned to IST so it doesn't depend on the server's timezone.
export function cutoffFor(date) {
  return new Date(`${date}T02:00:00+05:30`)
}

/**
 * Record "will eat" / "will not eat" for a student. The server is the record that no-show
 * warnings and fines are computed from, so who may write it matters:
 *  - a student, for themselves only, and only until the day's cutoff;
 *  - counter/roster staff in the student's own mess, any time (this is how an approved
 *    "forgot to mark" change request is applied, and how a late correction is made).
 */
intentionsRouter.put('/:studentId', requireAuth, validate(setIntentionSchema), (req, res) => {
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.studentId)
  if (!student) return res.status(404).json({ error: 'Student not found.' })
  const { date, meal, status } = req.body

  if (req.auth.role === 'STUDENT') {
    if (req.auth.sub !== student.id) return res.status(403).json({ error: "You can only mark your own meals.", code: 'OUT_OF_SCOPE' })
    if (Date.now() >= cutoffFor(date).getTime()) {
      return res.status(403).json({ error: 'Marking for that day closed at 2:00 AM — submit a change request instead.', code: 'CUTOFF_PASSED' })
    }
  } else if (isStaffRole(req.auth.role) && COUNTER_ROLES.includes(req.auth.role)) {
    if (!enforceHostelScope(req, res, student.hostel_id, `meal intention for ${student.id}`)) return
  } else {
    return res.status(403).json({ error: "Your role doesn't have permission to do that.", code: 'ROLE_FORBIDDEN' })
  }

  db.prepare(`
    INSERT INTO meal_intentions (student_id, date, meal, status, submitted_at, submitted_by) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(student_id, date, meal) DO UPDATE SET status = excluded.status, submitted_at = excluded.submitted_at, submitted_by = excluded.submitted_by
  `).run(student.id, date, meal, status, new Date().toISOString(), req.auth.sub)

  if (req.auth.role !== 'STUDENT') {
    logAudit({ actorId: req.auth.sub, actorName: req.auth.name, actorRole: req.auth.role, action: 'meal_intention_set', messId: messIdForHostel(student.hostel_id), summary: `Set ${student.name} (${student.id}) to "${status}" for ${meal} on ${date}` })
  }
  res.json({ studentId: student.id, date, meal, status })
})

intentionsRouter.get('/:studentId', requireAuth, (req, res) => {
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.studentId)
  if (!student) return res.json([])
  if (!canAccessStudent(req.auth, student)) return res.status(403).json({ error: "You don't have access to that student's records.", code: 'OUT_OF_SCOPE' })
  const { from, to } = req.query
  let sql = 'SELECT student_id, date, meal, status, submitted_at FROM meal_intentions WHERE student_id = ?'
  const params = [student.id]
  if (from) { sql += ' AND date >= ?'; params.push(from) }
  if (to) { sql += ' AND date <= ?'; params.push(to) }
  res.json(db.prepare(sql + ' ORDER BY date, meal').all(...params))
})
