import webpush from 'web-push'
import { db, messIdForHostel } from './db.js'

// Web Push (RFC 8030/8291/8292): the server posts an encrypted message to the push service the *browser* chose (Google,
// Mozilla, Apple, Microsoft — all free), and that service wakes the device's service worker, even with the site closed.
// No third-party account is needed; the server proves who it is with a VAPID key pair.

// --- VAPID keys --------------------------------------------------------------------------------------------------
// Set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in the environment for production. Otherwise a pair is generated on first boot and
// kept in the database so subscriptions survive restarts (changing the key later orphans every existing subscription).
let vapid = null
export function getVapid() {
  if (vapid) return vapid
  const envPub = process.env.VAPID_PUBLIC_KEY
  const envPriv = process.env.VAPID_PRIVATE_KEY
  if (envPub && envPriv) {
    vapid = { publicKey: envPub, privateKey: envPriv }
  } else {
    const get = (k) => db.prepare('SELECT value FROM app_secrets WHERE key = ?').get(k)?.value
    let publicKey = get('vapid_public')
    let privateKey = get('vapid_private')
    if (!publicKey || !privateKey) {
      ;({ publicKey, privateKey } = webpush.generateVAPIDKeys())
      db.prepare('INSERT OR REPLACE INTO app_secrets (key, value) VALUES (?, ?)').run('vapid_public', publicKey)
      db.prepare('INSERT OR REPLACE INTO app_secrets (key, value) VALUES (?, ?)').run('vapid_private', privateKey)
    }
    vapid = { publicKey, privateKey }
  }
  return vapid
}
export const vapidPublicKey = () => getVapid().publicKey

// --- Endpoint safety ---------------------------------------------------------------------------------------------
// The server will POST to whatever endpoint a client registers. Accepting any URL would turn this into a way to make the
// server call internal addresses (SSRF), so only the real browser push services are allowed — https, no credentials, no port.
const PUSH_HOST_SUFFIXES = ['fcm.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com']
export function isAllowedPushEndpoint(raw) {
  let u
  try { u = new URL(raw) } catch { return false }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false
  const host = u.hostname.toLowerCase()
  return PUSH_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`))
}

// --- Delivery ----------------------------------------------------------------------------------------------------
let transport = async (subscription, payload, options) => {
  const { publicKey, privateKey } = getVapid()
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@lpu.smartmess.edu', publicKey, privateKey)
  return webpush.sendNotification(subscription, payload, options)
}
/** Tests swap this out so no real push service is called. */
export function setPushTransport(fn) { transport = fn }

/**
 * Sends to every device the account has subscribed. A push service answering 404/410 means that device is gone (app
 * uninstalled, permission revoked), so its subscription is deleted. Never throws — a failed notification must not break
 * the request that triggered it.
 */
export async function sendPush(accountType, accountId, message) {
  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE account_type = ? AND account_id = ?').all(accountType, accountId)
  const result = { sent: 0, removed: 0, failed: 0 }
  const body = JSON.stringify({ url: '/attendance', ...message })
  for (const s of subs) {
    try {
      await transport({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: message.ttl ?? 3600, urgency: message.urgency ?? 'normal' })
      result.sent++
    } catch (e) {
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(s.endpoint)
        result.removed++
      } else {
        result.failed++
        console.error(`[push:FAILED] ${accountType}:${accountId} -> ${new URL(s.endpoint).host}: ${e?.statusCode ?? ''} ${e?.message ?? e}`)
      }
    }
  }
  return result
}

/** Fire-and-forget, like sendEmailInBackground. */
export function pushInBackground(accountType, accountId, message) {
  setImmediate(() => { void sendPush(accountType, accountId, message).catch(() => {}) })
}

// Alerts for the people who run a mess: its Mess Manager(s) and the hostel Admin. One push per kind per mess per 10 minutes —
// a burst of 50 suspicious scans is one buzz on their phone, not fifty.
const lastManagerPush = new Map()
export function notifyManagers(messId, kind, message) {
  const key = `${messId}:${kind}`
  const now = Date.now()
  if (now - (lastManagerPush.get(key) ?? 0) < 10 * 60 * 1000) return
  lastManagerPush.set(key, now)
  const hostel = db.prepare('SELECT hostel_id FROM messes WHERE id = ?').get(messId)?.hostel_id
  if (!hostel) return
  const staff = db.prepare("SELECT id FROM staff WHERE hostel_id = ? AND role IN ('MESS_MANAGER', 'ADMIN')").all(hostel)
  for (const m of staff) pushInBackground('staff', m.id, { url: '/attendance', urgency: 'high', ...message })
}
export const _resetManagerThrottle = () => lastManagerPush.clear() // tests only
export { messIdForHostel }
