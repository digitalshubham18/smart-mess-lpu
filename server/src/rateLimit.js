// TODO(production): this resets whenever the process restarts and doesn't share state
// across multiple server instances — fine for a single-process demo, but a real
// deployment behind a load balancer needs a shared store (e.g. Redis).
const buckets = new Map()

/**
 * @param {{ windowMs: number, max: number, message?: string, scope?: string }} opts
 *
 * `scope` names the bucket. Without it the bucket is per-IP *per path* — which is wrong for a
 * route with a parameter in the path (/lookup/:uid): every different UID is a different
 * path, so a sweep across UIDs would never share a bucket and never be limited. Give such
 * routes a fixed scope.
 */
export function rateLimit({ windowMs, max, message = 'Too many requests — please wait a moment and try again.', scope }) {
  return (req, res, next) => {
    const key = `${req.ip}:${scope ?? req.path}`
    const now = Date.now()
    const bucket = buckets.get(key) ?? []
    const recent = bucket.filter((t) => now - t < windowMs)
    if (recent.length >= max) {
      return res.status(429).json({ error: message })
    }
    recent.push(now)
    buckets.set(key, recent)
    next()
  }
}
