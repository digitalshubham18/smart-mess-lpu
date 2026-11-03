import 'dotenv/config'
import express from 'express'
// Express 4 doesn't catch a rejected promise from an `async` handler: the request hangs forever and, on current
// Node, the unhandled rejection takes the whole process down. This makes every async route's failure flow to the
// error handler below like any synchronous throw. Must be imported before any route is defined.
import 'express-async-errors'
import cors from 'cors'
import helmet from 'helmet'
import { authRouter } from './routes/auth.js'
import { studentsRouter } from './routes/students.js'
import { attendanceRouter } from './routes/attendance.js'
import { hostelsRouter } from './routes/hostels.js'
import { staffRouter } from './routes/staff.js'
import { auditRouter } from './routes/audit.js'
import { intentionsRouter } from './routes/intentions.js'
import { forecastRouter } from './routes/forecast.js'
import { pushRouter } from './routes/push.js'
import { wasteRouter } from './routes/waste.js'
import { feedbackRouter } from './routes/feedback.js'
import { inventoryRouter } from './routes/inventory.js'
import { errorsRouter } from './routes/errors.js'
import { recordError } from './errorLog.js'
import { db } from './db.js'

export const app = express()

// TODO(production): CORS_ORIGIN should be your real deployed frontend's origin(s), not
// a dev default — consider a comma-separated allowlist if you ever serve more than one.
// Behind a reverse proxy / load balancer (nginx, Docker, a cloud LB) every request arrives from the proxy's IP,
// so ALL users would share one rate-limit bucket. Set TRUST_PROXY to the number of proxy hops in front of this
// server (usually 1) so req.ip is the real client. It's opt-in on purpose: trusting X-Forwarded-For when there
// is NO proxy lets any client choose their own IP and walk straight past every limiter.
if (process.env.TRUST_PROXY) {
  const v = process.env.TRUST_PROXY
  app.set('trust proxy', v === 'true' ? true : /^\d+$/.test(v) ? Number(v) : v)
}

const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173'

// Security headers. This process only ever serves JSON (plus the small avatar images
// below), never HTML, so the Content-Security-Policy can be about as strict as CSP gets:
// nothing may load, nothing may frame it. helmet also sets X-Content-Type-Options: nosniff,
// X-Frame-Options (via frame-ancestors + its own header), Strict-Transport-Security,
// Referrer-Policy, Cross-Origin-Opener-Policy, and removes X-Powered-By.
// Must come before cors() and the routes so every response — errors included — carries them.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] },
    },
    // Hide the API from being embedded anywhere (clickjacking) — belt and braces with frame-ancestors for old browsers.
    frameguard: { action: 'deny' },
  })
)

// Avatars are the one thing here a browser loads via <img src>, from the frontend's
// origin. helmet's default Cross-Origin-Resource-Policy (same-origin) would block that, so
// relax it for just these routes — and lock the images themselves down: a sandboxed,
// script-less CSP means that even if an image were ever opened as a top-level document,
// nothing in it could run.
app.use('/api', (req, res, next) => {
  if (req.path.endsWith('/photo')) {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
  }
  next()
})

// credentials:true lets the browser send the httpOnly session cookie; it requires an exact
// origin (never '*'). The custom X-SmartMess-Client header forces a CORS preflight, which only
// the configured origin passes — see the CSRF note in auth.js.
app.use(cors({ origin: corsOrigin, credentials: true, allowedHeaders: ['Content-Type', 'Authorization', 'X-SmartMess-Client'] }))
app.use(express.json({ limit: '3mb' })) // staff photo uploads are small base64 data URLs

app.use('/api/auth', authRouter)
app.use('/api/students', studentsRouter)
app.use('/api/attendance', attendanceRouter)
app.use('/api/hostels', hostelsRouter)
app.use('/api/staff', staffRouter)
app.use('/api/audit-log', auditRouter)
app.use('/api/intentions', intentionsRouter)
app.use('/api/forecast', forecastRouter)
app.use('/api/push', pushRouter)
app.use('/api/waste', wasteRouter)
app.use('/api/feedback', feedbackRouter)
app.use('/api/inventory', inventoryRouter)
app.use('/api', errorsRouter)

// Liveness: the process is up. (Used by the Docker healthcheck and a load balancer.)
app.get('/api/health', (_req, res) => res.json({ ok: true }))
// Readiness: the database answers AND the newest backup is recent — what an uptime monitor should watch. Returns 503 when
// either is wrong, with the reason, so an alert says what to fix. Exposes no personal data.
app.get('/api/health/ready', async (_req, res) => {
  const checks = {}
  try { db.prepare('SELECT 1').get(); checks.database = { ok: true } } catch { checks.database = { ok: false, detail: 'database not responding' } }
  try {
    const { newestBackupAgeHours } = await import('./backup.js')
    const maxH = Number(process.env.BACKUP_MAX_AGE_HOURS) || 36
    const age = newestBackupAgeHours()
    checks.backup = age === null ? { ok: process.env.BACKUP_CHECK === '0', detail: 'no backup found' } : { ok: age <= maxH, ageHours: Math.round(age * 10) / 10, detail: age <= maxH ? undefined : `newest backup is ${Math.round(age)}h old (limit ${maxH}h)` }
  } catch { checks.backup = { ok: false, detail: 'could not check backups' } }
  const ok = Object.values(checks).every((c) => c.ok)
  res.status(ok ? 200 : 503).json({ ok, checks })
})

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  // Errors raised by the body parser (bad JSON, body too large, unsupported charset…) are the CLIENT's
  // mistake and carry their own 4xx status. Treating them as 500s is wrong for callers and lets anyone
  // fill the error log with stack traces just by sending garbage — so answer them properly and quietly.
  const status = Number(err?.status ?? err?.statusCode)
  if (status >= 400 && status < 500 && err?.expose !== false) {
    const message = err.type === 'entity.parse.failed' ? 'Request body is not valid JSON.'
      : err.type === 'entity.too.large' ? 'Request body is too large.'
      : 'Bad request.'
    return res.status(status).json({ error: message, code: err.type ?? 'BAD_REQUEST' })
  }
  // A database constraint tripping (duplicate key, FK) means the request raced another or conflicts with existing
  // data — that's a 409 the caller can act on, not a server fault.
  if (String(err?.code).startsWith('SQLITE_CONSTRAINT')) {
    return res.status(409).json({ error: 'That conflicts with an existing record — it may have just been created by someone else. Refresh and try again.', code: 'CONFLICT' })
  }
  console.error(err)
  recordError({ kind: 'server', message: err?.message ?? String(err), stack: err?.stack, url: `${req.method} ${String(req.route?.path ?? req.path).slice(0, 120)}` })
  res.status(500).json({ error: 'Internal server error.' }) // never echo err.message — it can contain paths/SQL
})
