import { api } from './api'

/**
 * Tells the server when the app breaks in someone's browser (a crash, an unhandled error), so you hear about it before a
 * student complains. Sends only: the message, the stack, and the page PATH — never the query string, the fragment, who was
 * signed in, or anything they typed. The server collapses repeats into one row (Super Admin → System errors).
 */
const sent = new Set<string>()
let budget = 10 // per page load: a render loop must not flood the server
let installed = false

export function reportError(message: string, stack?: string): void {
  try {
    const key = `${message}|${(stack ?? '').split('\n')[1] ?? ''}`
    if (!message || sent.has(key) || budget <= 0) return
    sent.add(key); budget--
    const body = JSON.stringify({ message: message.slice(0, 500), stack: (stack ?? '').slice(0, 4000), url: window.location.pathname })
    const url = `${api.defaults.baseURL ?? '/api'}/client-errors`
    if (navigator.sendBeacon?.(url, new Blob([body], { type: 'application/json' }))) return
    void fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {})
  } catch { /* reporting must never throw */ }
}

export function installErrorReporter(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', (e) => reportError(e.message || String(e.error), e.error?.stack))
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason
    // A failed API call is an expected condition (offline, a 4xx) that the screens already show; only real bugs are reported.
    if (r && typeof r === 'object' && ('isAxiosError' in r || 'response' in r)) return
    reportError(`Unhandled rejection: ${r?.message ?? String(r)}`, r?.stack)
  })
}

export function __resetErrorReporterForTests() { sent.clear(); budget = 10; installed = false }
