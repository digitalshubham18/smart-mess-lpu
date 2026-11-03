import { Router } from 'express'
import { z } from 'zod'
import { db } from '../db.js'
import { requireAuth } from '../auth.js'
import { rateLimit } from '../rateLimit.js'
import { validate } from '../schemas.js'
import { vapidPublicKey, isAllowedPushEndpoint, sendPush } from '../push.js'

export const pushRouter = Router()

const MAX_DEVICES_PER_ACCOUNT = 5
const subscribeSchema = z.object({
  subscription: z.object({
    endpoint: z.string().url().max(1000),
    keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
  }),
  userAgent: z.string().max(300).optional(),
})
const endpointSchema = z.object({ endpoint: z.string().url().max(1000) })
// Per IP, and a whole hostel often shares one campus IP — so these are generous; the real bound is the 5-devices-per-account cap.
const limiter = rateLimit({ windowMs: 60 * 1000, max: 300, scope: 'push', message: 'Too many notification requests — please wait a minute.' })
const testLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, scope: 'push-test', message: 'Too many test notifications — please wait a minute.' })

const accountOf = (auth) => ({ type: auth.role === 'STUDENT' ? 'student' : 'staff', id: auth.sub })

// The public half of the VAPID key: the browser needs it to subscribe. (It is public by design — not a secret.)
pushRouter.get('/public-key', requireAuth, (_req, res) => res.json({ publicKey: vapidPublicKey() }))

// Is THIS device subscribed for the signed-in account?
pushRouter.get('/status', requireAuth, limiter, (req, res) => {
  const { type, id } = accountOf(req.auth)
  const endpoint = typeof req.query.endpoint === 'string' ? req.query.endpoint : null
  const devices = db.prepare('SELECT COUNT(*) n FROM push_subscriptions WHERE account_type = ? AND account_id = ?').get(type, id).n
  const thisDevice = endpoint ? !!db.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint = ? AND account_type = ? AND account_id = ?').get(endpoint, type, id) : false
  res.json({ subscribed: thisDevice, devices })
})

pushRouter.post('/subscribe', requireAuth, limiter, validate(subscribeSchema), (req, res) => {
  const { type, id } = accountOf(req.auth)
  const { subscription, userAgent } = req.body
  if (!isAllowedPushEndpoint(subscription.endpoint)) {
    return res.status(400).json({ error: "That isn't a recognised browser push service address.", code: 'BAD_PUSH_ENDPOINT' })
  }
  const existing = db.prepare('SELECT account_type, account_id FROM push_subscriptions WHERE endpoint = ?').get(subscription.endpoint)
  if (!existing) {
    const count = db.prepare('SELECT COUNT(*) n FROM push_subscriptions WHERE account_type = ? AND account_id = ?').get(type, id).n
    if (count >= MAX_DEVICES_PER_ACCOUNT) {
      return res.status(409).json({ error: `You already get notifications on ${MAX_DEVICES_PER_ACCOUNT} devices — turn them off on one of those first.`, code: 'TOO_MANY_DEVICES' })
    }
  }
  // Whoever signs in on this device and subscribes owns it from now on (a shared phone must not keep notifying the last user).
  db.prepare(`INSERT INTO push_subscriptions (endpoint, account_type, account_id, p256dh, auth, user_agent, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(endpoint) DO UPDATE SET account_type = excluded.account_type, account_id = excluded.account_id,
                p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, created_at = excluded.created_at`)
    .run(subscription.endpoint, type, id, subscription.keys.p256dh, subscription.keys.auth, userAgent ?? null, new Date().toISOString())
  res.status(201).json({ subscribed: true })
})

// You can only remove your own devices.
pushRouter.post('/unsubscribe', requireAuth, limiter, validate(endpointSchema), (req, res) => {
  const { type, id } = accountOf(req.auth)
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND account_type = ? AND account_id = ?').run(req.body.endpoint, type, id)
  res.json({ subscribed: false })
})

// "Send me a test": the quickest way to confirm a device really receives notifications.
pushRouter.post('/test', requireAuth, testLimiter, async (req, res) => {
  const { type, id } = accountOf(req.auth)
  const r = await sendPush(type, id, { title: 'Smart Mess test notification', body: 'If you can read this, notifications are working on this device.', tag: 'smartmess-test', url: '/attendance' })
  if (r.sent === 0) return res.status(409).json({ error: r.removed || r.failed ? 'The notification could not be delivered to your device — turn notifications off and on again.' : 'No device is subscribed yet.', code: 'NO_DELIVERY', ...r })
  res.json(r)
})
