import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../api', () => ({ api: { defaults: { baseURL: 'https://mess.example.edu/api' } } }))
import { reportError, installErrorReporter, __resetErrorReporterForTests } from '../errorReporter'
import { ErrorBoundary } from '@/components/layout/ErrorBoundary'

let beacon: ReturnType<typeof vi.fn>
beforeEach(() => { __resetErrorReporterForTests(); beacon = vi.fn().mockReturnValue(true); Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true }); window.history.pushState({}, '', '/attendance?token=SECRET#frag') })
afterEach(() => vi.restoreAllMocks())

const sentBody = async (i = 0) => JSON.parse(await (beacon.mock.calls[i][1] as Blob).text())

describe('error reporter', () => {
  it('sends the message, stack and page PATH only — never the query string, fragment or anything about the user', async () => {
    reportError('boom', 'Error: boom\n    at x (app.js:1:1)')
    expect(beacon).toHaveBeenCalledTimes(1)
    expect(beacon.mock.calls[0][0]).toBe('https://mess.example.edu/api/client-errors')
    const body = await sentBody()
    expect(body).toEqual({ message: 'boom', stack: 'Error: boom\n    at x (app.js:1:1)', url: '/attendance' })
    expect(JSON.stringify(body)).not.toContain('SECRET')
  })
  it('does not repeat itself and cannot flood: the same error once, at most 10 different ones per page load', () => {
    reportError('same', 'a\nb'); reportError('same', 'a\nb')
    expect(beacon).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 30; i++) reportError(`different ${i}`, 'a\nb')
    expect(beacon).toHaveBeenCalledTimes(10)
  })
  it('falls back to fetch when sendBeacon is unavailable, and never throws', () => {
    Object.defineProperty(navigator, 'sendBeacon', { value: undefined, configurable: true })
    const f = vi.fn().mockRejectedValue(new Error('offline')); vi.stubGlobal('fetch', f)
    expect(() => reportError('x', 'a\nb')).not.toThrow()
    expect(f).toHaveBeenCalledWith('https://mess.example.edu/api/client-errors', expect.objectContaining({ method: 'POST', keepalive: true }))
    vi.unstubAllGlobals()
  })
  it('window errors and unhandled rejections are reported — but a failed API call (expected: offline, 4xx) is not', () => {
    installErrorReporter()
    window.dispatchEvent(new ErrorEvent('error', { message: 'Uncaught TypeError: x is undefined', error: new TypeError('x is undefined') }))
    expect(beacon).toHaveBeenCalledTimes(1)
    const rej = (reason: unknown) => { const e = new Event('unhandledrejection') as Event & { reason: unknown }; e.reason = reason; window.dispatchEvent(e) }
    rej({ isAxiosError: true, message: 'Network Error' })
    rej({ response: { status: 500 } })
    expect(beacon).toHaveBeenCalledTimes(1)
    rej(new Error('a real bug'))
    expect(beacon).toHaveBeenCalledTimes(2)
  })
})

describe('ErrorBoundary', () => {
  it('turns a crash into a calm page with a way out (not a blank screen), and reports it', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function Bomb(): never { throw new Error('render exploded') }
    render(<ErrorBoundary><Bomb /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toHaveTextContent(/something went wrong/i)
    expect(screen.getByRole('alert')).toHaveTextContent(/printed id card still works/i)
    expect(screen.getByRole('button', { name: /reload the app/i })).toBeInTheDocument()
    expect(beacon).toHaveBeenCalledTimes(1)
  })
  it('renders its children untouched when nothing is wrong', () => {
    render(<ErrorBoundary><p>fine</p></ErrorBoundary>)
    expect(screen.getByText('fine')).toBeInTheDocument()
  })
})
