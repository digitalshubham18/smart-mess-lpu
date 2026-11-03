/* Smart Mess service worker. Two jobs:
 *  1. Web Push: show a notification when the server sends one (even with the site closed) and open the right page on tap.
 *  2. Offline app shell: keep the app's own HTML/JS/CSS so the site still OPENS with no data — which is what lets a student's
 *     phone show its offline meal code at the counter. It never touches /api/ (live data is always the server's, never a
 *     cached copy) and never caches anything but the site's own static files. */

const SHELL = 'smartmess-shell-v1'
const NAVIGATION_TIMEOUT_MS = 4000

self.addEventListener('install', (event) => {
  // Best effort: a failed pre-cache (offline install) must not stop the worker installing.
  event.waitUntil(
    (self.caches ? self.caches.open(SHELL).then((c) => c.add('/')).catch(() => {}) : Promise.resolve()).then(() => self.skipWaiting()),
  )
})
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  if (self.caches) {
    const names = await self.caches.keys()
    await Promise.all(names.filter((n) => n.startsWith('smartmess-shell-') && n !== SHELL).map((n) => self.caches.delete(n)))
  }
  await self.clients.claim()
})()))

const putIfOk = async (request, response) => {
  if (response && response.ok && response.type !== 'opaque') { try { const c = await self.caches.open(SHELL); await c.put(request, response.clone()) } catch { /* cache full / private mode: carry on */ } }
  return response
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (!self.caches || req.method !== 'GET') return
  let url
  try { url = new URL(req.url) } catch { return }
  // Only this site's own static files. The API, other origins and the worker itself are never intercepted.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return

  if (req.mode === 'navigate') {
    // Pages: the network when it answers in time (so a deploy is picked up at once), the saved shell when it doesn't.
    event.respondWith((async () => {
      try {
        const live = await Promise.race([
          self.fetch(req),
          new Promise((_, reject) => setTimeout(() => reject(new Error('slow network')), NAVIGATION_TIMEOUT_MS)),
        ])
        void putIfOk('/', live)
        return live
      } catch {
        const cached = await self.caches.match('/')
        return cached || new Response('You are offline, and the app has not been opened on this phone with internet yet.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
      }
    })())
    return
  }

  // Build output is content-hashed (/assets/app-3f9a1c.js): a saved copy never goes stale, so serve it first.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => {
      const cached = await self.caches.match(req)
      if (cached) return cached
      return putIfOk(req, await self.fetch(req))
    })())
    return
  }

  // Everything else on this site (icons, manifest): fresh if we can, saved copy if not.
  event.respondWith((async () => {
    try { return await putIfOk(req, await self.fetch(req)) }
    catch { const cached = await self.caches.match(req); if (cached) return cached; throw new Error('offline') }
  })())
})

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { body: event.data ? event.data.text() : '' } }
  const title = typeof data.title === 'string' && data.title ? data.title : 'Smart Mess'
  const tag = typeof data.tag === 'string' && data.tag ? data.tag : undefined
  event.waitUntil(self.registration.showNotification(title, {
    body: typeof data.body === 'string' ? data.body : '',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    // Same tag = the newer notification replaces the older one (one per meal), instead of stacking.
    tag,
    renotify: !!tag,
    data: { url: typeof data.url === 'string' ? data.url : '/' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  // Only ever open a path on THIS site, whatever a message says.
  let target = '/'
  try {
    const u = new URL(event.notification.data && event.notification.data.url, self.location.origin)
    if (u.origin === self.location.origin) target = u.pathname + u.search
  } catch { /* fall back to / */ }
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin) {
        await c.focus()
        if ('navigate' in c) { try { await c.navigate(target) } catch { /* some browsers refuse; the focus is enough */ } }
        return
      }
    }
    await self.clients.openWindow(target)
  })())
})
