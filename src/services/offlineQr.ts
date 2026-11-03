import { api } from './api'

/**
 * Offline meal code — for a phone with no data at the counter.
 *
 * While online, the signed-in student's phone fetches ONE per-device key from the server and stores it as a NON-EXTRACTABLE
 * WebCrypto key in IndexedDB (page JavaScript — including an XSS — can use it to sign but can never read it out). With no
 * network the phone then computes a short code from it every minute; the server recomputes it, checks the device is still
 * signed in, and treats it exactly like the live QR (single use, mess/meal rules, audit).
 *
 * The code format and maths must match server/src/auth.js ("Offline meal codes"): SMO1.<student>.<sid>.<step>.<mac>, where
 * step = floor(unixSeconds / 60) and mac = first 16 chars of base64url(HMAC-SHA256(key, String(step))).
 */

const DB_NAME = 'smartmess-offline'
const STORE = 'kv'
const KEY = 'qr-key'

export interface OfflineKeyRecord {
  studentId: string
  sid: string
  key: CryptoKey
  stepSeconds: number
  /** serverTime − phoneTime at the moment we last heard from the server, so a phone with a wrong clock still agrees with it. */
  offsetMs: number
  validUntil: string
  savedAt: string
}

export const supportsOfflineCodes = () =>
  typeof indexedDB !== 'undefined' && typeof crypto !== 'undefined' && !!crypto.subtle

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } finally { db.close() }
}

const b64urlToBytes = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}
const bytesToB64url = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export async function getOfflineKey(): Promise<OfflineKeyRecord | null> {
  if (!supportsOfflineCodes()) return null
  try { return (await idb<OfflineKeyRecord | undefined>('readonly', (s) => s.get(KEY))) ?? null } catch { return null }
}

export async function clearOfflineKey(): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  try { await idb('readwrite', (s) => s.delete(KEY)) } catch { /* nothing to clear */ }
}

/** Fetches (or refreshes) this device's key. Call while online. Never throws: offline mode is a bonus, not a requirement. */
export async function ensureOfflineKey({ force = false }: { force?: boolean } = {}): Promise<OfflineKeyRecord | null> {
  if (!supportsOfflineCodes()) return null
  try {
    const have = await getOfflineKey()
    const fresh = have && Date.now() - new Date(have.savedAt).getTime() < 12 * 3_600_000 && new Date(have.validUntil).getTime() > Date.now()
    if (have && fresh && !force) return have
    const { data } = await api.get<{ studentId: string; sid: string; key: string; stepSeconds: number; serverTime: string; validUntil: string }>('/attendance/my-offline-key')
    const key = await crypto.subtle.importKey('raw', b64urlToBytes(data.key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const rec: OfflineKeyRecord = { studentId: data.studentId, sid: data.sid, key, stepSeconds: data.stepSeconds, offsetMs: new Date(data.serverTime).getTime() - Date.now(), validUntil: data.validUntil, savedAt: new Date().toISOString() }
    await idb('readwrite', (s) => s.put(rec, KEY))
    return rec
  } catch {
    return (await getOfflineKey()) ?? null
  }
}

/** Keeps the stored clock offset current whenever the server tells us the time (e.g. a normal QR fetch). */
export async function noteServerTime(iso: string): Promise<void> {
  const rec = await getOfflineKey()
  if (!rec) return
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return
  try { await idb('readwrite', (s) => s.put({ ...rec, offsetMs: t - Date.now() }, KEY)) } catch { /* best effort */ }
}

export interface OfflineCode { token: string; step: number; expiresInSeconds: number }

/** The code for "now" (or `atMs`), or null if this device hasn't been set up for offline use / the key has lapsed. */
export async function makeOfflineCode(atMs = Date.now()): Promise<OfflineCode | null> {
  const rec = await getOfflineKey()
  if (!rec || new Date(rec.validUntil).getTime() < atMs) return null
  const serverNow = atMs + rec.offsetMs
  const step = Math.floor(serverNow / 1000 / rec.stepSeconds)
  const mac = bytesToB64url(await crypto.subtle.sign('HMAC', rec.key, new TextEncoder().encode(String(step)))).slice(0, 16)
  const intoStep = (serverNow / 1000) % rec.stepSeconds
  return { token: `SMO1.${rec.studentId}.${rec.sid}.${step}.${mac}`, step, expiresInSeconds: Math.max(1, Math.ceil(rec.stepSeconds - intoStep)) }
}

/** Counter side: is this scanned text an offline code (which the server — not the counter — will verify)? Returns the student id it names. */
export function parseOfflineCode(text: string): { studentId: string } | null {
  const m = /^SMO1\.([^.]+)\.[A-Za-z0-9_-]+\.\d+\.[A-Za-z0-9_-]{16}$/.exec(text.trim())
  return m ? { studentId: m[1] } : null
}
