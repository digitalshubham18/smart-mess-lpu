import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../api', () => ({ api: { get: vi.fn(), post: vi.fn() } }))
import { api } from '../api'
import * as push from '../pushService'

const get = api.get as unknown as ReturnType<typeof vi.fn>
const post = api.post as unknown as ReturnType<typeof vi.fn>

const FAKE_SUB = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'P'.repeat(30), auth: 'A'.repeat(12) } }),
  unsubscribe: vi.fn().mockResolvedValue(true),
}
const pm = { getSubscription: vi.fn(), subscribe: vi.fn() }
const registration = { pushManager: pm }
const requestPermission = vi.fn()

function env({ secure = true, ua = 'Mozilla/5.0 (Linux; Android 14) Chrome/120', standalone = false, hasPush = true } = {}) {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: secure })
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: ua })
  Object.defineProperty(navigator, 'standalone', { configurable: true, value: standalone })
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as never
  if (hasPush) {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register: vi.fn().mockResolvedValue(registration), ready: Promise.resolve(registration), getRegistration: vi.fn().mockResolvedValue(registration) },
    })
    ;(window as unknown as { PushManager: unknown }).PushManager = class {}
    ;(window as unknown as { Notification: unknown }).Notification = Object.assign(vi.fn(), { permission: 'default', requestPermission })
  } else {
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined })
    delete (window as unknown as { PushManager?: unknown }).PushManager
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  pm.getSubscription.mockResolvedValue(null)
  pm.subscribe.mockResolvedValue(FAKE_SUB)
  requestPermission.mockResolvedValue('granted')
  env()
})
afterEach(() => { delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker })

describe('push support — and a reason a student can act on when it is missing', () => {
  it('is supported on a secure page in a push-capable browser', () => { expect(push.pushSupport()).toEqual({ supported: true }) })

  it('needs https', () => {
    env({ secure: false })
    expect(push.pushSupport()).toMatchObject({ supported: false, reason: expect.stringMatching(/secure \(https\)/i) })
  })

  it('on an iPhone, tells them to add the site to the Home Screen first (iOS only allows push for installed web apps)', () => {
    env({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1', standalone: false })
    expect(push.pushSupport().reason).toMatch(/Add to Home Screen/i)
  })

  it('…and is supported once it is opened from the Home Screen', () => {
    env({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1', standalone: true })
    expect(push.pushSupport().supported).toBe(true)
  })

  it('says so plainly when the browser has no push', () => {
    env({ hasPush: false })
    expect(push.pushSupport().reason).toMatch(/doesn't support push/i)
  })
})

describe('turning notifications on', () => {
  it("asks permission, subscribes with the server's public key, and registers the device with the server", async () => {
    get.mockResolvedValueOnce({ data: { publicKey: 'BAQ-_8w' } })
    post.mockResolvedValueOnce({ data: { subscribed: true } })
    await push.enablePush()
    expect(requestPermission).toHaveBeenCalled()
    expect(navigator.serviceWorker.register).toHaveBeenCalledWith('/sw.js', { scope: '/' })
    const args = pm.subscribe.mock.calls[0][0]
    expect(args.userVisibleOnly).toBe(true)
    expect(Array.from(args.applicationServerKey as Uint8Array)).toEqual([4, 4, 62, 255, 204]) // 'BAQ-_8w' base64url-decoded: '-' is 62 and '_' is 63 in the url-safe alphabet
    expect(post).toHaveBeenCalledWith('/push/subscribe', { subscription: FAKE_SUB.toJSON(), userAgent: expect.any(String) })
  })

  it('a blocked permission explains how to unblock, and nothing is sent to the server', async () => {
    requestPermission.mockResolvedValueOnce('denied')
    await expect(push.enablePush()).rejects.toThrow(/blocked for this site.*site settings/i)
    expect(post).not.toHaveBeenCalled()
  })

  it('reuses an existing browser subscription instead of making a second one', async () => {
    pm.getSubscription.mockResolvedValue(FAKE_SUB)
    get.mockResolvedValueOnce({ data: { publicKey: 'BAQ-_8w' } })
    post.mockResolvedValueOnce({ data: {} })
    await push.enablePush()
    expect(pm.subscribe).not.toHaveBeenCalled()
  })

  it("shows the server's reason when it refuses the device (e.g. too many devices)", async () => {
    get.mockResolvedValueOnce({ data: { publicKey: 'BAQ-_8w' } })
    post.mockRejectedValueOnce({ response: { data: { error: 'You already get notifications on 5 devices — turn them off on one of those first.' } } })
    await expect(push.enablePush()).rejects.toThrow(/already get notifications on 5 devices/)
  })

  it('refuses up front where push is not possible', async () => {
    env({ hasPush: false })
    await expect(push.enablePush()).rejects.toThrow(/doesn't support push/i)
  })
})

describe('"is it on here?", turning off, and signing out', () => {
  it('is on only when the browser has a subscription AND the server knows it for this account', async () => {
    pm.getSubscription.mockResolvedValue(FAKE_SUB)
    get.mockResolvedValueOnce({ data: { subscribed: true, devices: 1 } })
    expect(await push.isSubscribedHere()).toBe(true)
    expect(get).toHaveBeenCalledWith('/push/status', { params: { endpoint: FAKE_SUB.endpoint } })
    get.mockResolvedValueOnce({ data: { subscribed: false, devices: 0 } }) // e.g. someone else signed in on this phone since
    expect(await push.isSubscribedHere()).toBe(false)
    pm.getSubscription.mockResolvedValue(null)
    expect(await push.isSubscribedHere()).toBe(false)
  })

  it('turning off removes the device on the server and in the browser', async () => {
    pm.getSubscription.mockResolvedValue(FAKE_SUB)
    post.mockResolvedValueOnce({ data: {} })
    await push.disablePush()
    expect(post).toHaveBeenCalledWith('/push/unsubscribe', { endpoint: FAKE_SUB.endpoint })
    expect(FAKE_SUB.unsubscribe).toHaveBeenCalled()
  })

  it('signing out detaches the device so a shared phone stops buzzing for the last person', async () => {
    pm.getSubscription.mockResolvedValue(FAKE_SUB)
    post.mockResolvedValueOnce({ data: {} })
    await push.detachOnLogout()
    expect(post).toHaveBeenCalledWith('/push/unsubscribe', { endpoint: FAKE_SUB.endpoint })
    expect(FAKE_SUB.unsubscribe).toHaveBeenCalled()
  })

  it('signing out NEVER fails or hangs because of push, whatever goes wrong', async () => {
    pm.getSubscription.mockResolvedValue(FAKE_SUB)
    post.mockRejectedValue(new Error('network down'))
    await expect(push.detachOnLogout()).resolves.toBeUndefined()
    env({ hasPush: false })
    await expect(push.detachOnLogout()).resolves.toBeUndefined()
  })
})
