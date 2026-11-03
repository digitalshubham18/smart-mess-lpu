import { createHash } from 'node:crypto'
import { db } from './db.js'

// Error reporting without a third-party service: browsers and the server report here, identical errors collapse into one
// row with a count, and the Super Admin reads them in the app. Optionally a new kind of error is also posted to a chat
// webhook (ERROR_WEBHOOK_URL, https only). Reports carry NO personal data: no user, no query string, no request bodies.
const MAX_ROWS = 500
const clip = (v, n) => String(v ?? '').slice(0, n)
const fingerprintOf = (kind, message, stack) =>
  createHash('sha1').update(`${kind}|${clip(message, 200).replace(/\d+/g, 'N')}|${clip(stack, 4000).split('\n').find((l) => /\bat\b|@/.test(l)) ?? ''}`.replace(/\d+/g, 'N')).digest('hex').slice(0, 16)

let webhookWindow = []
async function notifyWebhook(row) {
  const url = process.env.ERROR_WEBHOOK_URL
  if (!url || !/^https:\/\//.test(url)) return
  const now = Date.now()
  webhookWindow = webhookWindow.filter((t) => now - t < 3_600_000)
  if (webhookWindow.length >= 10) return // at most 10 chat messages an hour, however bad it gets
  webhookWindow.push(now)
  try {
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `[Smart Mess] new ${row.kind} error: ${clip(row.message, 200)}${row.url ? ` (${row.url})` : ''}` }), signal: AbortSignal.timeout(3000) })
  } catch { /* the webhook is a convenience; never let it cause errors */ }
}

/** Records one occurrence. Returns { isNew }. Never throws (reporting an error must not create another). */
export function recordError({ kind, message, stack, url }) {
  try {
    const now = new Date().toISOString()
    const msg = clip(message, 500) || '(no message)'
    const fp = fingerprintOf(kind, msg, stack)
    const hit = db.prepare('UPDATE error_reports SET count = count + 1, last_seen = ?, dismissed = 0 WHERE fingerprint = ?').run(now, fp)
    if (hit.changes > 0) return { isNew: false }
    db.prepare('INSERT INTO error_reports (fingerprint, kind, message, stack, url, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)').run(fp, kind, msg, clip(stack, 4000) || null, clip(url, 300) || null, now, now)
    db.prepare('DELETE FROM error_reports WHERE id NOT IN (SELECT id FROM error_reports ORDER BY last_seen DESC LIMIT ?)').run(MAX_ROWS)
    void notifyWebhook({ kind, message: msg, url })
    return { isNew: true }
  } catch { return { isNew: false } }
}

/** Only the path: query strings and fragments can hold tokens or personal details. */
export function cleanUrl(u) {
  try { return new URL(String(u), 'http://x').pathname.slice(0, 200) } catch { return '' }
}
