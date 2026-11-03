import { Router } from 'express'
import { db } from '../db.js'
import { requireAuth } from '../auth.js'
import { requireRoles, SUPER_ADMIN_ONLY } from '../authz.js'

export const auditRouter = Router()

// The audit trail records every mess's activity (and blocked cross-mess attempts), so it's
// a university-level view — the Super Admin's, same as the page that displays it.
auditRouter.get('/', requireAuth, requireRoles(...SUPER_ADMIN_ONLY), (req, res) => {
  const { messId, limit, actorId, action, from, to } = req.query
  let sql = 'SELECT * FROM audit_log WHERE 1=1'
  const params = []
  if (messId) { sql += ' AND mess_id = ?'; params.push(messId) }
  if (actorId) { sql += ' AND actor_id = ?'; params.push(actorId) }
  if (action) { sql += ' AND action = ?'; params.push(action) }
  if (from) { sql += ' AND at >= ?'; params.push(from) }
  if (to) { sql += ' AND at <= ?'; params.push(to) }
  sql += ' ORDER BY at DESC LIMIT ?'
  params.push(Math.min(500, Number(limit) || 200))
  res.json(db.prepare(sql).all(...params))
})
