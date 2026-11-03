import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../auth.js'
import { isStaffRole, enforceMessScope } from '../authz.js'
import { forecast, backtest, METHODS } from '../forecasting.js'

export const forecastRouter = Router()

const MEALS = ['breakfast', 'lunch', 'snacks', 'dinner']
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
const forecastQuery = z.object({ messId: z.string().min(1), date, meal: z.enum(MEALS), method: z.enum(METHODS).default('weekday_average') })
const accuracyQuery = z.object({ messId: z.string().min(1), days: z.coerce.number().int().min(1).max(365).default(30), method: z.enum(METHODS).default('weekday_average') })

function parse(schema, req, res) {
  const r = schema.safeParse(req.query)
  if (!r.success) { res.status(400).json({ error: `${r.error.issues[0].path.join('.')}: ${r.error.issues[0].message}` }); return null }
  return r.data
}

// Forecasts steer purchasing and cooking, so they are staff-only and limited to your own mess (Super Admin: all).
forecastRouter.get('/', requireAuth, (req, res) => {
  if (!isStaffRole(req.auth.role)) return res.status(403).json({ error: 'Only mess staff can view demand forecasts.', code: 'ROLE_FORBIDDEN' })
  const q = parse(forecastQuery, req, res)
  if (!q) return
  if (!enforceMessScope(req, res, q.messId, 'demand forecast')) return
  res.json(forecast(q))
})

// Predicted-vs-actual over the recent past, every day predicted using ONLY the days before it.
forecastRouter.get('/accuracy', requireAuth, (req, res) => {
  if (!isStaffRole(req.auth.role)) return res.status(403).json({ error: 'Only mess staff can view forecast accuracy.', code: 'ROLE_FORBIDDEN' })
  const q = parse(accuracyQuery, req, res)
  if (!q) return
  if (!enforceMessScope(req, res, q.messId, 'forecast accuracy')) return
  const rows = MEALS.flatMap((meal) => backtest(q.messId, meal, q.method, { days: q.days })).sort((a, b) => (a.date + a.meal).localeCompare(b.date + b.meal))
  res.json({ messId: q.messId, method: q.method, days: q.days, rows })
})
