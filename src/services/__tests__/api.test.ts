import { describe, it, expect, vi, beforeEach } from 'vitest'
import { api, AUTH_EXPIRED_EVENT } from '../api'

type Handler = (v: unknown) => unknown
const reqHandlers = (api.interceptors.request as unknown as { handlers: { fulfilled: Handler }[] }).handlers
const resHandlers = (api.interceptors.response as unknown as { handlers: { rejected: Handler }[] }).handlers

beforeEach(() => localStorage.clear())

describe('api client — cookie session transport', () => {
  it('sends credentials (the httpOnly session cookie) and never an Authorization header or stored token', () => {
    expect(api.defaults.withCredentials).toBe(true)
    localStorage.setItem('smartmess.token', 'leftover-from-old-version')
    const cfg = reqHandlers.reduce((c, h) => h.fulfilled(c) as { headers: Record<string, string> }, { headers: {} as Record<string, string> })
    expect(cfg.headers.Authorization).toBeUndefined()
  })

  it('tags every request with the client header the server uses for CSRF defense', () => {
    const cfg = reqHandlers.reduce((c, h) => h.fulfilled(c) as { headers: Record<string, string> }, { headers: {} as Record<string, string> })
    expect(cfg.headers['X-SmartMess-Client']).toBe('web')
  })

  it('a 401 while signed in clears the cached profile and fires the session-expired event with the server\'s reason', async () => {
    localStorage.setItem('smartmess.user', '{"id":"1"}')
    const heard = vi.fn()
    window.addEventListener(AUTH_EXPIRED_EVENT, heard as EventListener)
    await expect(resHandlers[0].rejected({ response: { status: 401, data: { error: 'Your session is no longer valid.' } } })).rejects.toBeTruthy()
    window.removeEventListener(AUTH_EXPIRED_EVENT, heard as EventListener)
    expect(localStorage.getItem('smartmess.user')).toBeNull()
    expect(heard).toHaveBeenCalledTimes(1)
    expect((heard.mock.calls[0][0] as CustomEvent).detail).toBe('Your session is no longer valid.')
  })

  it('a 401 while NOT signed in (a wrong password on the login form) is not reported as an expired session', async () => {
    const heard = vi.fn()
    window.addEventListener(AUTH_EXPIRED_EVENT, heard as EventListener)
    await expect(resHandlers[0].rejected({ response: { status: 401, data: { error: 'Incorrect password.' } } })).rejects.toBeTruthy()
    window.removeEventListener(AUTH_EXPIRED_EVENT, heard as EventListener)
    expect(heard).not.toHaveBeenCalled()
  })

  it('other errors pass through untouched', async () => {
    localStorage.setItem('smartmess.user', '{"id":"1"}')
    await expect(resHandlers[0].rejected({ response: { status: 403, data: {} } })).rejects.toBeTruthy()
    expect(localStorage.getItem('smartmess.user')).not.toBeNull()
  })
})
