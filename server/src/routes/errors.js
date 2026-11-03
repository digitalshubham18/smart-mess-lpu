import { Router } from 'express'
import { requireAuth } from '../auth.js'
import { requireRoles } from '../authz.js'
import { rateLimit } from '../rateLimit.js'
import { db } from '../db.js'
import { recordError, cleanUrl } from '../errorLog.js'

export const errorsRouter = Router()

// Browsers report here — before sign-in too (a crash on the login page matters), so no auth, but tightly limited and capped.
const reportLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, scope: 'client-errors', message: 'Too many reports.' })
errorsRouter.post('/client-errors', reportLimiter, (req, res) => {
  const b = req.body ?? {}
  if (typeof b.message !== 'string' || !b.message.trim()) return res.status(400).json({ error: 'message is required.' })
  recordError({ kind: 'client', message: b.message, stack: typeof b.stack === 'string' ? b.stack : '', url: cleanUrl(b.url) })
  res.status(204).end() // nothing to tell the browser
})

errorsRouter.get('/errors', requireAuth, requireRoles('SUPER_ADMIN'), (_req, res) => {
  const rows = db.prepare('SELECT id, kind, message, stack, url, count, first_seen AS firstSeen, last_seen AS lastSeen FROM error_reports WHERE dismissed = 0 ORDER BY last_seen DESC LIMIT 200').all()
  res.json({ errors: rows, open: rows.length })
})
errorsRouter.delete('/errors/:id', requireAuth, requireRoles('SUPER_ADMIN'), (req, res) => {
  const r = db.prepare('UPDATE error_reports SET dismissed = 1 WHERE id = ?').run(Number(req.params.id))
  res.json({ success: r.changes > 0 })
})
