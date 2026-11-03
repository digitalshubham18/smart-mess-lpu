// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac, webcrypto } from 'node:crypto'

// jsdom has no WebCrypto subtle; Node's is the same API the browser has.
if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })

vi.mock('../api', () => ({ api: { get: vi.fn() } }))
import { api } from '../api'
import { ensureOfflineKey, getOfflineKey, makeOfflineCode, clearOfflineKey, parseOfflineCode, noteServerTime, supportsOfflineCodes } from '../offlineQr'

const KEY_BYTES = Buffer.from('0123456789abcdef0123456789abcdef')
const keyResponse = (over: Record<string, unknown> = {}) => ({ data: { studentId: '21000012', sid: 'sid-abc_123', key: KEY_BYTES.toString('base64url'), stepSeconds: 60, serverTime: new Date().toISOString(), validUntil: new Date(Date.now() + 7 * 86_400_000).toISOString(), ...over } })
const get = api.get as unknown as ReturnType<typeof vi.fn>

/** What server/src/auth.js computes — the browser's code must equal this byte for byte. */
const serverCode = (sid: string, studentId: string, atMs: number) => {
  const step = Math.floor(atMs / 1000 / 60)
  const mac = createHmac('sha256', KEY_BYTES).update(String(step)).digest('base64url').slice(0, 16)
  return `SMO1.${studentId}.${sid}.${step}.${mac}`
}

beforeEach(async () => { get.mockReset(); await clearOfflineKey() })

describe('offline meal code (phone side)', () => {
  it('is supported here, and a device that was never set up has no code', async () => {
    expect(supportsOfflineCodes()).toBe(true)
    expect(await makeOfflineCode()).toBeNull()
  })

  it('fetches the key once, stores it, and the code it makes equals what the server will recompute', async () => {
    get.mockResolvedValueOnce(keyResponse())
    const rec = await ensureOfflineKey()
    expect(rec?.studentId).toBe('21000012')
    expect(get).toHaveBeenCalledWith('/attendance/my-offline-key')
    const now = Date.now()
    const code = await makeOfflineCode(now)
    expect(code?.token).toBe(serverCode('sid-abc_123', '21000012', now))
    expect(code!.expiresInSeconds).toBeGreaterThanOrEqual(1)
    expect(code!.expiresInSeconds).toBeLessThanOrEqual(60)
  })

  it('stores the key NON-EXTRACTABLE: page script can sign with it but can never read it out', async () => {
    get.mockResolvedValueOnce(keyResponse())
    await ensureOfflineKey()
    const rec = await getOfflineKey()
    expect(rec!.key.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('raw', rec!.key)).rejects.toThrow()
    expect(JSON.stringify(rec)).not.toContain(KEY_BYTES.toString('base64url'))
  })

  it('does not hit the network again while the stored key is fresh; force refreshes it', async () => {
    get.mockResolvedValue(keyResponse())
    await ensureOfflineKey()
    await ensureOfflineKey()
    expect(get).toHaveBeenCalledTimes(1)
    await ensureOfflineKey({ force: true })
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('a phone with a wrong clock still agrees with the server (the offset from the last server time is applied)', async () => {
    const serverNow = Date.now()
    get.mockResolvedValueOnce(keyResponse({ serverTime: new Date(serverNow + 5 * 60_000).toISOString() })) // phone is 5 min slow
    await ensureOfflineKey()
    const code = await makeOfflineCode(Date.now())
    const expectedStep = Math.floor((Date.now() + 5 * 60_000) / 1000 / 60)
    expect(code!.token.split('.')[3]).toBe(String(expectedStep))
    await noteServerTime(new Date(Date.now() + 2 * 60_000).toISOString()) // a later normal QR fetch refines it
    const later = await makeOfflineCode(Date.now())
    expect(later!.token.split('.')[3]).toBe(String(Math.floor((Date.now() + 2 * 60_000) / 1000 / 60)))
  })

  it('an expired key makes no code (the phone must go online to renew it)', async () => {
    get.mockResolvedValueOnce(keyResponse({ validUntil: new Date(Date.now() - 1000).toISOString() }))
    await ensureOfflineKey()
    expect(await makeOfflineCode()).toBeNull()
  })

  it('if the key cannot be fetched (offline, or the server says sign in again) it never throws and reports none', async () => {
    get.mockRejectedValueOnce(new Error('Network Error'))
    await expect(ensureOfflineKey()).resolves.toBeNull()
    get.mockRejectedValueOnce({ response: { status: 409, data: { code: 'NEEDS_NEW_SESSION' } } })
    await expect(ensureOfflineKey()).resolves.toBeNull()
  })

  it('signing out clears the key', async () => {
    get.mockResolvedValueOnce(keyResponse())
    await ensureOfflineKey()
    await clearOfflineKey()
    expect(await getOfflineKey()).toBeNull()
    expect(await makeOfflineCode()).toBeNull()
  })
})

describe('offline meal code (counter side)', () => {
  it('recognises an offline code and names the student; anything else is not one', () => {
    expect(parseOfflineCode('SMO1.21000012.sid-abc_123.29000000.AbCdEfGhIjKlMnOp')).toEqual({ studentId: '21000012' })
    expect(parseOfflineCode('  SMO1.21000012.sid-abc_123.29000000.AbCdEfGhIjKlMnOp ')).toEqual({ studentId: '21000012' })
    for (const bad of ['eyJhbGciOi.live.jwt', 'SMO1.garbage', 'SMO1.21000012.sid.notanumber.AbCdEfGhIjKlMnOp', 'SMO1.21000012.sid.1.short', '']) expect(parseOfflineCode(bad)).toBeNull()
  })
})
