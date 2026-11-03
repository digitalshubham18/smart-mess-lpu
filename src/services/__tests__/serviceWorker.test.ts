import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Runs the REAL public/sw.js against a fake worker scope, so what ships is what is tested.
const source = fs.readFileSync(path.resolve(__dirname, '../../../public/sw.js'), 'utf8')

type Handler = (e: Record<string, unknown>) => void
type FakeClient = { url: string; focus: ReturnType<typeof vi.fn>; navigate?: ReturnType<typeof vi.fn> }

function load(clients: FakeClient[] = []) {
  const handlers: Record<string, Handler> = {}
  const showNotification = vi.fn().mockResolvedValue(undefined)
  const openWindow = vi.fn().mockResolvedValue(undefined)
  const self = {
    addEventListener: (type: string, fn: Handler) => { handlers[type] = fn },
    skipWaiting: vi.fn(),
    registration: { showNotification },
    clients: { claim: vi.fn(), matchAll: vi.fn().mockResolvedValue(clients), openWindow },
    location: { origin: 'https://mess.example.edu' },
  }
  new Function('self', source)(self)
  return { handlers, showNotification, openWindow }
}

const pushEvent = (json: unknown) => {
  const waits: Promise<unknown>[] = []
  return { data: { json: () => json, text: () => String(json) }, waitUntil: (p: Promise<unknown>) => { waits.push(p) }, waits }
}
const clickEvent = (url: unknown) => {
  const waits: Promise<unknown>[] = []
  return { notification: { close: vi.fn(), data: { url } }, waitUntil: (p: Promise<unknown>) => { waits.push(p) }, waits }
}

describe('service worker — receiving a push', () => {
  it('shows the notification with the title, body and page it was sent with', async () => {
    const { handlers, showNotification } = load()
    const e = pushEvent({ title: 'Lunch check-in recorded', body: 'Checked in at 13:05.', tag: 'checkin-2026-10-17-lunch', url: '/attendance' })
    handlers.push(e)
    await Promise.all(e.waits)
    expect(showNotification).toHaveBeenCalledWith('Lunch check-in recorded', expect.objectContaining({
      body: 'Checked in at 13:05.', tag: 'checkin-2026-10-17-lunch', renotify: true, data: { url: '/attendance' },
    }))
  })

  it('survives a malformed or empty message and still shows something sensible', () => {
    const { handlers, showNotification } = load()
    handlers.push({ data: { json: () => { throw new Error('not json') }, text: () => 'plain text body' }, waitUntil: vi.fn() })
    expect(showNotification).toHaveBeenCalledWith('Smart Mess', expect.objectContaining({ body: 'plain text body' }))
    handlers.push({ data: null, waitUntil: vi.fn() })
    expect(showNotification).toHaveBeenLastCalledWith('Smart Mess', expect.objectContaining({ body: '' }))
  })

  it('ignores non-string fields rather than showing "[object Object]"', () => {
    const { handlers, showNotification } = load()
    handlers.push({ data: { json: () => ({ title: { evil: 1 }, body: 42, tag: {} }), text: () => '' }, waitUntil: vi.fn() })
    expect(showNotification).toHaveBeenCalledWith('Smart Mess', expect.objectContaining({ body: '', tag: undefined, renotify: false }))
  })
})

describe('service worker — tapping a notification', () => {
  let focus: ReturnType<typeof vi.fn>
  let navigate: ReturnType<typeof vi.fn>
  beforeEach(() => { focus = vi.fn().mockResolvedValue(undefined); navigate = vi.fn().mockResolvedValue(undefined) })

  it('focuses a tab already open on this site and takes it to the right page', async () => {
    const { handlers, openWindow } = load([{ url: 'https://mess.example.edu/dashboard', focus, navigate }])
    const e = clickEvent('/attendance')
    handlers.notificationclick(e)
    await Promise.all(e.waits)
    expect(e.notification.close).toHaveBeenCalled()
    expect(focus).toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith('/attendance')
    expect(openWindow).not.toHaveBeenCalled()
  })

  it('opens a new window when the site is not open', async () => {
    const { handlers, openWindow } = load([])
    const e = clickEvent('/attendance')
    handlers.notificationclick(e)
    await Promise.all(e.waits)
    expect(openWindow).toHaveBeenCalledWith('/attendance')
  })

  it("never opens another site, whatever a message says (it falls back to this site's home)", async () => {
    const { handlers, openWindow } = load([])
    for (const url of ['https://evil.example/phish', '//evil.example/x', 'javascript:alert(1)']) {
      const e = clickEvent(url)
      handlers.notificationclick(e)
      await Promise.all(e.waits)
    }
    expect(openWindow.mock.calls.map((c) => c[0])).toEqual(['/', '/', '/'])
  })

  it('does not focus a tab that belongs to a different site', async () => {
    const { handlers, openWindow } = load([{ url: 'https://other.example/', focus, navigate }])
    const e = clickEvent('/attendance')
    handlers.notificationclick(e)
    await Promise.all(e.waits)
    expect(focus).not.toHaveBeenCalled()
    expect(openWindow).toHaveBeenCalledWith('/attendance')
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// The offline app shell: the site must OPEN with no data (that is what lets a student's phone show its offline meal code),
// but live API data is never served from a saved copy.
describe('service worker — the offline app shell', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  type Resp = { ok: boolean; type?: string; status?: number; clone: () => Resp; marker?: string }
  const resp = (marker: string, ok = true): Resp => { const r: Resp = { ok, type: 'basic', marker, clone: () => r }; return r }

  function loadWithCache(opts: { network?: (url: string) => Promise<Resp>; seeded?: Record<string, Resp> } = {}) {
    const store = new Map<string, Resp>(Object.entries(opts.seeded ?? {}))
    const caches = {
      open: vi.fn().mockResolvedValue({ put: vi.fn(async (k: string | { url: string }, v: Resp) => { store.set(typeof k === 'string' ? k : new URL(k.url).pathname, v) }), add: vi.fn().mockResolvedValue(undefined) }),
      match: vi.fn(async (k: string | { url: string }) => store.get(typeof k === 'string' ? k : new URL(k.url).pathname)),
      keys: vi.fn().mockResolvedValue(['smartmess-shell-v0', 'other-app-cache', 'smartmess-shell-v1']),
      delete: vi.fn().mockResolvedValue(true),
    }
    const fetchFn = vi.fn(opts.network ?? (async () => resp('network')))
    const handlers: Record<string, Handler> = {}
    const self = {
      addEventListener: (t: string, fn: Handler) => { handlers[t] = fn }, skipWaiting: vi.fn(),
      registration: { showNotification: vi.fn() }, clients: { claim: vi.fn(), matchAll: vi.fn(), openWindow: vi.fn() },
      location: { origin: 'https://mess.example.edu' }, caches, fetch: fetchFn,
    }
    vi.stubGlobal('Response', class { status: number; body: string; constructor(body: string, init?: { status?: number }) { this.body = body; this.status = init?.status ?? 200 } })
    new Function('self', source)(self)
    return { handlers, caches, fetchFn, store }
  }
  const fetchEvent = (url: string, { mode = 'no-cors', method = 'GET' } = {}) => {
    let responded: Promise<unknown> | undefined
    return { request: { url, mode, method }, respondWith: (p: Promise<unknown>) => { responded = p }, get responded() { return responded } }
  }

  it('never touches the API, other sites, non-GET requests, or the worker file itself', () => {
    const { handlers } = loadWithCache()
    for (const e of [
      fetchEvent('https://mess.example.edu/api/attendance/my-qr'),
      fetchEvent('https://mess.example.edu/api/auth/login', { method: 'POST' }),
      fetchEvent('https://api.other.example/data'),
      fetchEvent('https://mess.example.edu/sw.js'),
    ]) { handlers.fetch(e); expect(e.responded).toBeUndefined() }
  })

  it('a page load uses the network when it answers, and saves the shell as it goes', async () => {
    const { handlers, store, fetchFn } = loadWithCache({ network: async () => resp('fresh-html') })
    const e = fetchEvent('https://mess.example.edu/attendance', { mode: 'navigate' })
    handlers.fetch(e)
    expect(((await e.responded) as Resp).marker).toBe('fresh-html')
    expect(fetchFn).toHaveBeenCalled()
    await Promise.resolve()
    expect(store.get('/')?.marker).toBe('fresh-html')
  })

  it('with no network a page load is answered from the saved shell, so the app still opens', async () => {
    const { handlers } = loadWithCache({ network: async () => { throw new Error('offline') }, seeded: { '/': resp('saved-shell') } })
    const e = fetchEvent('https://mess.example.edu/attendance', { mode: 'navigate' })
    handlers.fetch(e)
    expect(((await e.responded) as Resp).marker).toBe('saved-shell')
  })

  it('a page load that has never been opened online fails clearly (503), not with a browser error page', async () => {
    const { handlers } = loadWithCache({ network: async () => { throw new Error('offline') } })
    const e = fetchEvent('https://mess.example.edu/', { mode: 'navigate' })
    handlers.fetch(e)
    expect(((await e.responded) as unknown as { status: number }).status).toBe(503)
  })

  it('hashed build files are served from the saved copy first, and saved the first time they are fetched', async () => {
    const { handlers, fetchFn, store } = loadWithCache({ network: async () => resp('js-from-network') })
    const first = fetchEvent('https://mess.example.edu/assets/app-3f9a1c.js')
    handlers.fetch(first)
    expect(((await first.responded) as Resp).marker).toBe('js-from-network')
    await Promise.resolve()
    expect(store.get('/assets/app-3f9a1c.js')?.marker).toBe('js-from-network')
    fetchFn.mockClear()
    const second = fetchEvent('https://mess.example.edu/assets/app-3f9a1c.js')
    handlers.fetch(second)
    expect(((await second.responded) as Resp).marker).toBe('js-from-network')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('does not save error responses (a 404/500 must never become the offline shell)', async () => {
    const { handlers, store } = loadWithCache({ network: async () => resp('boom', false) })
    const e = fetchEvent('https://mess.example.edu/assets/gone.js')
    handlers.fetch(e)
    await e.responded
    await Promise.resolve()
    expect(store.has('/assets/gone.js')).toBe(false)
  })

  it('on activation it deletes only its own OLD caches', async () => {
    const { handlers, caches } = loadWithCache()
    const waits: Promise<unknown>[] = []
    handlers.activate({ waitUntil: (p: Promise<unknown>) => waits.push(p) })
    await Promise.all(waits)
    expect(caches.delete).toHaveBeenCalledTimes(1)
    expect(caches.delete).toHaveBeenCalledWith('smartmess-shell-v0')
  })
})
