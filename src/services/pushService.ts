import { api } from './api'

function extractApiError(e: unknown, fallback: string): string {
  const err = e as { response?: { data?: { error?: string } } }
  return err?.response?.data?.error ?? fallback
}

// Web Push from the browser's side: register the service worker (public/sw.js), ask permission, subscribe with the server's
// public VAPID key, and tell the server where to send. The browser's own push service (Google / Mozilla / Apple) delivers it.

export interface PushSupport { supported: boolean; reason?: string }

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const isStandalone = () => (navigator as unknown as { standalone?: boolean }).standalone === true || window.matchMedia?.('(display-mode: standalone)').matches

/** Can THIS browser do push at all — and if not, why, in words a student can act on. */
export function pushSupport(): PushSupport {
  if (window.isSecureContext === false) return { supported: false, reason: 'Notifications need a secure (https) page.' }
  if (isIos() && !isStandalone()) {
    return { supported: false, reason: 'On iPhone and iPad, first add this site to your Home Screen (Share → Add to Home Screen), then open it from there and turn notifications on.' }
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return { supported: false, reason: "This browser doesn't support push notifications." }
  }
  return { supported: true }
}

export const permission = (): NotificationPermission | 'unsupported' => ('Notification' in window ? Notification.permission : 'unsupported')

function urlBase64ToUint8Array(b64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4)
  const raw = atob((b64url + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(() => navigator.serviceWorker.ready)
}

/** The browser's subscription for this device, if any. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupport().supported) return null
  const reg = await navigator.serviceWorker.getRegistration('/')
  return reg ? reg.pushManager.getSubscription() : null
}

/** True only if this device has a browser subscription AND the server knows it for the signed-in account. */
export async function isSubscribedHere(): Promise<boolean> {
  const sub = await currentSubscription()
  if (!sub) return false
  try {
    const { data } = await api.get<{ subscribed: boolean }>('/push/status', { params: { endpoint: sub.endpoint } })
    return data.subscribed
  } catch {
    return false
  }
}

export async function enablePush(): Promise<void> {
  const support = pushSupport()
  if (!support.supported) throw new Error(support.reason)
  // Permission is asked for in response to the person's tap — browsers refuse (and people resent) surprise prompts.
  const result = await Notification.requestPermission()
  if (result !== 'granted') throw new Error(result === 'denied' ? 'Notifications are blocked for this site. Allow them in your browser\'s site settings, then try again.' : 'Notifications were not allowed.')
  try {
    const reg = await registration()
    const { data } = await api.get<{ publicKey: string }>('/push/public-key')
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(data.publicKey) }))
    await api.post('/push/subscribe', { subscription: sub.toJSON(), userAgent: navigator.userAgent.slice(0, 300) })
  } catch (e) {
    throw new Error(extractApiError(e, 'Could not turn on notifications on this device.'))
  }
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  try { await api.post('/push/unsubscribe', { endpoint: sub.endpoint }) } catch (e) { throw new Error(extractApiError(e, 'Could not turn off notifications.')) }
  await sub.unsubscribe().catch(() => false)
}

export async function sendTest(): Promise<void> {
  try { await api.post('/push/test', {}) } catch (e) { throw new Error(extractApiError(e, 'Could not send a test notification.')) }
}

/** On sign-out: stop this device receiving the signed-out person's notifications. Best effort — never blocks logging out. */
export async function detachOnLogout(): Promise<void> {
  try {
    if (!pushSupport().supported) return
    const sub = await currentSubscription()
    if (!sub) return
    await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => undefined)
    await sub.unsubscribe().catch(() => false)
  } catch { /* logging out must always work */ }
}
