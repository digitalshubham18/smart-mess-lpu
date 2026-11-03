/**
 * Offline check-in queue. When the counter's connection drops mid-meal, a scan that fails to
 * REACH the server is saved here (localStorage) with the real time it was scanned, and replayed
 * once the connection is back — so the line keeps moving and nobody loses their check-in.
 *
 * Rules that keep this honest:
 *  - Only a request that never got an answer (no network / timeout) is queued. If the server
 *    answered — "not enrolled", "already checked in", "outside your mess" — that's the final
 *    answer and nothing is queued.
 *  - On replay, "already checked in" counts as synced (the scan, or an earlier attempt that
 *    timed out after succeeding, already landed). Any other refusal moves the scan to a
 *    visible "rejected" list with the server's reason — never silently dropped.
 *  - The server bounds the claimed scan time (not in the future, not older than 48h), so the
 *    queue can't be used to backdate attendance. Scans older than that are rejected up front.
 *  - An OFFLINE meal code from a student's phone can be queued too (it is checked by the server against the scan time);
 *    the counter can't verify it itself, so it shows "not confirmed yet", exactly like a typed UID.
 *  - It can only help once the staff member is signed in again; the server re-checks role and
 *    mess scope on every replayed scan exactly as it does for a live one.
 */
import type { MealType } from '@/types'

const QUEUE_KEY = 'smartmess.checkinQueue'
const REJECTED_KEY = 'smartmess.checkinRejected'
const MAX_QUEUE = 500
const MAX_AGE_MS = 48 * 60 * 60 * 1000

export interface QueuedScan {
  clientId: string
  uid: string
  /** Set when the scan was a student's OFFLINE meal code (SMO1…): the server verifies it as of `scannedAt` when it syncs.
   *  A live 60-second QR is never queued — it would be long expired by the time the counter reconnects. */
  qr?: string
  messId: string
  meal: MealType
  date: string
  scannedAt: string
  queuedAt: string
}
export interface RejectedScan extends QueuedScan { reason: string }

function read<T>(key: string): T[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}
function write(key: string, value: unknown[]) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage full/blocked — nothing more we can do */ }
}

export const getQueue = () => read<QueuedScan>(QUEUE_KEY)
export const getRejected = () => read<RejectedScan>(REJECTED_KEY)
export const pendingCount = () => getQueue().length

/** True for "the request never got an answer" (no connection, DNS, timeout) — NOT for any HTTP response. */
export function isNetworkError(e: unknown): boolean {
  const err = e as { network?: boolean; response?: unknown; code?: string; message?: string }
  if (err?.network === true) return true
  return !err?.response && (err?.code === 'ERR_NETWORK' || err?.code === 'ECONNABORTED' || /network error|timeout/i.test(err?.message ?? ''))
}

export function enqueue(scan: Omit<QueuedScan, 'clientId' | 'queuedAt'>): QueuedScan | null {
  const queue = getQueue()
  // Scanning the same student for the same meal twice while offline queues one scan, not two.
  const dup = queue.find((q) => q.uid === scan.uid && q.messId === scan.messId && q.meal === scan.meal && q.date === scan.date)
  if (dup) return dup
  if (queue.length >= MAX_QUEUE) return null
  const entry: QueuedScan = { ...scan, clientId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, queuedAt: new Date().toISOString() }
  write(QUEUE_KEY, [...queue, entry])
  return entry
}

export function dismissRejected(clientId: string) {
  write(REJECTED_KEY, getRejected().filter((r) => r.clientId !== clientId))
}

let syncing = false

/**
 * Replays the queue oldest-first through `send` (which should call the real check-in with the
 * scan's own `scannedAt`). Stops at the first network failure — the rest wait for the next try.
 */
export async function syncQueue(send: (scan: QueuedScan) => Promise<unknown>): Promise<{ synced: number; rejected: number; remaining: number }> {
  if (syncing) return { synced: 0, rejected: 0, remaining: pendingCount() }
  syncing = true
  let synced = 0
  let rejectedCount = 0
  try {
    const queue = getQueue()
    const keep: QueuedScan[] = []
    const rejected = getRejected()
    for (let i = 0; i < queue.length; i++) {
      const scan = queue[i]
      if (Date.now() - new Date(scan.scannedAt).getTime() > MAX_AGE_MS) {
        rejected.push({ ...scan, reason: 'This scan is more than 48 hours old and can no longer be synced — mark it again at the counter if needed.' })
        rejectedCount++
        continue
      }
      try {
        await send(scan)
        synced++
      } catch (e) {
        const err = e as { code?: string; message?: string }
        if (isNetworkError(e)) {
          keep.push(scan, ...queue.slice(i + 1)) // still offline — keep this and everything after it, in order
          break
        }
        if (err.code === 'ALREADY_CHECKED_IN') { synced++; continue }
        rejected.push({ ...scan, reason: err.message ?? 'The server refused this scan.' })
        rejectedCount++
      }
    }
    write(QUEUE_KEY, keep)
    write(REJECTED_KEY, rejected)
    return { synced, rejected: rejectedCount, remaining: keep.length }
  } finally {
    syncing = false
  }
}
