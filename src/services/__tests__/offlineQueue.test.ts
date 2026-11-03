import { describe, it, expect, vi, beforeEach } from 'vitest'
import { enqueue, getQueue, getRejected, syncQueue, isNetworkError, dismissRejected, pendingCount } from '../offlineQueue'

// Timestamps are RELATIVE to now: the queue (correctly) refuses scans older than 48h, so a hardcoded date turns
// into a failing test the day the real clock passes it.
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
const scan = (uid: string, over: Record<string, unknown> = {}) => ({ uid, messId: 'MESS-BH2', meal: 'lunch' as const, date: ago(0).slice(0, 10), scannedAt: ago(0), ...over })
const netErr = () => Object.assign(new Error('No connection to the server.'), { network: true })
const refusal = (message: string, code?: string) => Object.assign(new Error(message), { network: false, code })

beforeEach(() => localStorage.clear())

describe('offlineQueue', () => {
  it('queues scans with their real time and persists them across reloads (localStorage)', () => {
    const at = ago(31)
    enqueue(scan('21000101', { scannedAt: at }))
    expect(pendingCount()).toBe(1)
    expect(JSON.parse(localStorage.getItem('smartmess.checkinQueue')!)[0].scannedAt).toBe(at)
  })

  it('scanning the same student/meal twice while offline queues ONE scan', () => {
    enqueue(scan('21000101'))
    enqueue(scan('21000101'))
    enqueue(scan('21000101', { meal: 'dinner' }))
    expect(getQueue().map((q) => q.meal)).toEqual(['lunch', 'dinner'])
  })

  it('replays oldest-first, passing the original timestamp, and empties the queue on success', async () => {
    const t1 = ago(60), t2 = ago(55)
    enqueue(scan('A', { scannedAt: t1 }))
    enqueue(scan('B', { scannedAt: t2 }))
    const send = vi.fn().mockResolvedValue({})
    const r = await syncQueue(send)
    expect(r).toEqual({ synced: 2, rejected: 0, remaining: 0 })
    expect(send.mock.calls.map((c) => c[0].uid)).toEqual(['A', 'B'])
    expect(send.mock.calls[0][0].scannedAt).toBe(t1)
    expect(getQueue()).toEqual([])
  })

  it('stops at the first network failure and keeps that scan AND everything after it, in order', async () => {
    ;['A', 'B', 'C'].forEach((u) => enqueue(scan(u)))
    const send = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(netErr())
    const r = await syncQueue(send)
    expect(r).toEqual({ synced: 1, rejected: 0, remaining: 2 })
    expect(send).toHaveBeenCalledTimes(2) // C was never even tried
    expect(getQueue().map((q) => q.uid)).toEqual(['B', 'C'])
  })

  it('"already checked in" counts as synced (idempotent replay), not as a failure', async () => {
    enqueue(scan('A'))
    const r = await syncQueue(vi.fn().mockRejectedValue(refusal('already checked in', 'ALREADY_CHECKED_IN')))
    expect(r).toEqual({ synced: 1, rejected: 0, remaining: 0 })
    expect(getRejected()).toEqual([])
  })

  it('any other server refusal moves the scan to a visible rejected list with the reason — never silently dropped', async () => {
    enqueue(scan('A'))
    enqueue(scan('B'))
    const send = vi.fn().mockRejectedValueOnce(refusal('A is not enrolled in this mess', 'NOT_ENROLLED')).mockResolvedValueOnce({})
    const r = await syncQueue(send)
    expect(r).toEqual({ synced: 1, rejected: 1, remaining: 0 })
    expect(getRejected()[0]).toMatchObject({ uid: 'A', reason: 'A is not enrolled in this mess' })
    dismissRejected(getRejected()[0].clientId)
    expect(getRejected()).toEqual([])
  })

  it('a scan older than 48h is rejected up front (the server would refuse it) without calling the server', async () => {
    enqueue(scan('OLD', { scannedAt: new Date(Date.now() - 49 * 3600e3).toISOString() }))
    const send = vi.fn()
    const r = await syncQueue(send)
    expect(send).not.toHaveBeenCalled()
    expect(r.rejected).toBe(1)
    expect(getRejected()[0].reason).toMatch(/48 hours/)
  })

  it('two overlapping syncs never double-send', async () => {
    enqueue(scan('A'))
    let release!: () => void
    const send = vi.fn(() => new Promise<void>((res) => { release = res }))
    const first = syncQueue(send)
    const second = await syncQueue(send)
    expect(second).toEqual({ synced: 0, rejected: 0, remaining: 1 })
    release()
    await first
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('survives corrupted storage', () => {
    localStorage.setItem('smartmess.checkinQueue', '{not json')
    expect(getQueue()).toEqual([])
    expect(() => enqueue(scan('A'))).not.toThrow()
  })

  it('isNetworkError: no response = network; any HTTP response = not', () => {
    expect(isNetworkError(netErr())).toBe(true)
    expect(isNetworkError({ code: 'ERR_NETWORK' })).toBe(true)
    expect(isNetworkError({ code: 'ECONNABORTED', message: 'timeout of 15000ms exceeded' })).toBe(true)
    expect(isNetworkError({ response: { status: 403 } })).toBe(false)
    expect(isNetworkError(refusal('nope', 'NOT_ENROLLED'))).toBe(false)
  })
})

describe("offlineQueue — a student phone's OFFLINE code can wait for the server, a live QR cannot", () => {
  it('keeps the code with the scan, and replays it (with the real scan time) for the server to verify', async () => {
    const at = ago(20)
    const saved = enqueue(scan('21000012', { qr: 'SMO1.21000012.sid.29000000.AbCdEfGhIjKlMnOp', scannedAt: at }))
    expect(saved?.qr).toMatch(/^SMO1\./)
    const seen: Array<{ qr?: string; scannedAt: string }> = []
    const r = await syncQueue(async (q) => { seen.push({ qr: q.qr, scannedAt: q.scannedAt }) })
    expect(seen).toEqual([{ qr: 'SMO1.21000012.sid.29000000.AbCdEfGhIjKlMnOp', scannedAt: at }])
    expect(r).toEqual({ synced: 1, rejected: 0, remaining: 0 })
  })

  it('a server refusal of a queued code (forged / revoked device) lands in the rejected list with the reason, not silently lost', async () => {
    enqueue(scan('21000012', { qr: 'SMO1.21000012.sid.29000000.AbCdEfGhIjKlMnOp' }))
    const r = await syncQueue(async () => { throw refusal('That QR code is not valid.', 'QR_INVALID') })
    expect(r.rejected).toBe(1)
    expect(getRejected()[0].reason).toMatch(/not valid/i)
    expect(getRejected()[0].qr).toBeTruthy()
  })
})
