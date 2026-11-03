import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/services/attendanceService', () => ({ getMyQr: vi.fn() }))
vi.mock('@/components/ui/QrCodeSvg', () => ({ QrCodeSvg: ({ value }: { value: string }) => <div data-testid="qr-value">{value}</div> }))
import * as attendanceService from '@/services/attendanceService'
import { StudentQrCard } from '../StudentQrCard'

const getMyQr = vi.mocked(attendanceService.getMyQr)
const meals = (current: 'lunch' | null): attendanceService.MealWindowsSnapshot => ({
  timezone: 'Asia/Kolkata', now: { date: '2026-10-17', time: '13:00', iso: '' }, enforced: true, current,
  windows: [{ meal: 'lunch', start: '12:00', end: '14:30', open: current === 'lunch' }],
  next: current ? null : { meal: 'dinner', start: '19:30' },
})
const qr = (token: string, ttl = 60) => ({ studentId: '21000012', token, ttlSeconds: ttl, expiresAt: new Date(Date.now() + ttl * 1000).toISOString(), meals: meals('lunch') })

beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers({ shouldAdvanceTime: true }) })
afterEach(() => { vi.useRealTimers() })

describe('StudentQrCard — a signed, rotating code (never the plain UID)', () => {
  it('shows the server-issued token, not the student ID', async () => {
    getMyQr.mockResolvedValue(qr('signed.token.one'))
    render(<StudentQrCard />)
    expect(await screen.findByTestId('qr-value')).toHaveTextContent('signed.token.one')
    expect(screen.getByTestId('qr-value')).not.toHaveTextContent(/^21000012$/)
    expect(screen.getByTestId('qr-expiry')).toHaveTextContent(/refreshes automatically/i)
  })

  it('fetches a fresh code before the old one expires, so the screen never shows a dead code', async () => {
    getMyQr.mockResolvedValueOnce(qr('signed.token.one')).mockResolvedValueOnce(qr('signed.token.two'))
    render(<StudentQrCard />)
    await screen.findByText('signed.token.one')
    await act(async () => { await vi.advanceTimersByTimeAsync(46_000) }) // 60s lifetime → refreshed at ~45s
    expect(getMyQr).toHaveBeenCalledTimes(2)
    expect(await screen.findByText('signed.token.two')).toBeInTheDocument()
  })

  it('says which meal is being served, or what is next', async () => {
    getMyQr.mockResolvedValueOnce(qr('t'))
    const { unmount } = render(<StudentQrCard />)
    expect(await screen.findByTestId('meal-status')).toHaveTextContent(/lunch is being served now \(12:00–14:30\)/i)
    unmount()
    getMyQr.mockResolvedValueOnce({ ...qr('t'), meals: meals(null) })
    render(<StudentQrCard />)
    expect(await screen.findByText(/no meal is being served right now\. next: dinner at 19:30/i)).toBeInTheDocument()
  })

  it('shows the reason and a retry button when the code cannot be loaded (and never a made-up code)', async () => {
    getMyQr.mockRejectedValueOnce(new Error("You're not on the mess roster. Please visit the warden office.")).mockResolvedValueOnce(qr('after.retry'))
    render(<StudentQrCard />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/warden office/i)
    expect(screen.queryByTestId('meal-qr')).not.toBeInTheDocument()
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole('button', { name: /try again/i }))
    await waitFor(() => expect(screen.getByText('after.retry')).toBeInTheDocument())
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// No data at the counter: the phone shows a code it computes itself (services/offlineQr.ts), if it was set up while online.
describe('StudentQrCard — offline mode', () => {
  const offlineErr = () => Object.assign(new Error('You are offline.'), { network: true })

  it('with no connection it shows the offline code, labelled, with a countdown — and keeps trying to get back online', async () => {
    vi.resetModules()
    vi.doMock('@/services/offlineQr', () => ({
      ensureOfflineKey: vi.fn().mockResolvedValue(null), noteServerTime: vi.fn(),
      makeOfflineCode: vi.fn().mockResolvedValue({ token: 'SMO1.21000012.sid.29000000.AbCdEfGhIjKlMnOp', step: 29000000, expiresInSeconds: 37 }),
    }))
    const { StudentQrCard: Card } = await import('../StudentQrCard')
    const svc = await import('@/services/attendanceService')
    vi.mocked(svc.getMyQr).mockRejectedValueOnce(offlineErr())
    render(<Card />)
    expect(await screen.findByTestId('offline-qr')).toBeInTheDocument()
    expect(screen.getByTestId('qr-value')).toHaveTextContent(/^SMO1\./)
    expect(screen.getByTestId('offline-badge')).toHaveTextContent(/offline code.*37s/i)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // connection returns → the normal live QR replaces it
    vi.mocked(svc.getMyQr).mockResolvedValue(qr('signed.live.token'))
    await act(async () => { await vi.advanceTimersByTimeAsync(10_500) })
    expect(await screen.findByText('signed.live.token')).toBeInTheDocument()
    expect(screen.queryByTestId('offline-qr')).not.toBeInTheDocument()
    vi.doUnmock('@/services/offlineQr')
  })

  it('offline on a phone that was never set up: says exactly what to do instead of a bare error', async () => {
    vi.resetModules()
    vi.doMock('@/services/offlineQr', () => ({ ensureOfflineKey: vi.fn(), noteServerTime: vi.fn(), makeOfflineCode: vi.fn().mockResolvedValue(null) }))
    const { StudentQrCard: Card } = await import('../StudentQrCard')
    const svc = await import('@/services/attendanceService')
    vi.mocked(svc.getMyQr).mockRejectedValue(offlineErr())
    render(<Card />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/offline.*hasn't been set up.*open this page once with internet.*printed id card/i)
    expect(screen.queryByTestId('offline-qr')).not.toBeInTheDocument()
    vi.doUnmock('@/services/offlineQr')
  })

  it('a server refusal (not a missing connection) is still shown as an error, never as an offline code', async () => {
    vi.resetModules()
    const makeOfflineCode = vi.fn().mockResolvedValue({ token: 'SMO1.x', step: 1, expiresInSeconds: 5 })
    vi.doMock('@/services/offlineQr', () => ({ ensureOfflineKey: vi.fn(), noteServerTime: vi.fn(), makeOfflineCode }))
    const { StudentQrCard: Card } = await import('../StudentQrCard')
    const svc = await import('@/services/attendanceService')
    vi.mocked(svc.getMyQr).mockRejectedValue(new Error('Only students have a QR code.'))
    render(<Card />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/only students/i)
    expect(makeOfflineCode).not.toHaveBeenCalled()
    vi.doUnmock('@/services/offlineQr')
  })

  it('online, it quietly sets the phone up for offline use and says so', async () => {
    vi.resetModules()
    const ensure = vi.fn().mockResolvedValue({ studentId: '21000012' })
    vi.doMock('@/services/offlineQr', () => ({ ensureOfflineKey: ensure, noteServerTime: vi.fn(), makeOfflineCode: vi.fn() }))
    const { StudentQrCard: Card } = await import('../StudentQrCard')
    const svc = await import('@/services/attendanceService')
    vi.mocked(svc.getMyQr).mockResolvedValue(qr('signed.token.one'))
    render(<Card />)
    expect(await screen.findByTestId('offline-ready')).toHaveTextContent(/works with no internet/i)
    expect(ensure).toHaveBeenCalled()
    vi.doUnmock('@/services/offlineQr')
  })
})
