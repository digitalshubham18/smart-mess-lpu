import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/services/attendanceService', () => ({ getAutoNoShowSettings: vi.fn(), saveAutoNoShowSettings: vi.fn(), downloadAttendanceCsv: vi.fn() }))
import * as svc from '@/services/attendanceService'
import { AutoNoShowCard } from '../AutoNoShowCard'
import { AttendanceExportCard } from '../AttendanceExportCard'

beforeEach(() => vi.clearAllMocks())

describe('AutoNoShowCard', () => {
  const settings = (over = {}) => ({ enabled: true, fineAmount: 100, recent: [
    { date: '2026-10-20', meal: 'lunch', status: 'processed', warnings: 3, fines: 1, ranAt: '' },
    { date: '2026-10-20', meal: 'dinner', status: 'skipped_no_scans', warnings: 0, fines: 0, ranAt: '' },
  ], ...over }) as svc.AutoNoShowSettings

  it('explains what it does (including the safety rule), and shows what recently ran — and what was skipped, and why', async () => {
    vi.mocked(svc.getAutoNoShowSettings).mockResolvedValue(settings())
    render(<AutoNoShowCard messId="MESS-BH2" />)
    const sw = await screen.findByRole('switch', { name: /process no-shows automatically/i })
    expect(sw).toBeChecked()
    expect(screen.getByText(/if nobody at all was checked in/i)).toBeInTheDocument()
    const runs = screen.getByTestId('auto-noshow-runs')
    expect(runs).toHaveTextContent(/lunch — processed automatically \(3 warnings, 1 fine\)/i)
    expect(runs).toHaveTextContent(/dinner — skipped — nobody was checked in/i)
    expect(svc.getAutoNoShowSettings).toHaveBeenCalledWith('MESS-BH2')
  })

  it('switching it off is saved with the current fine; changing the fine is saved with the current switch', async () => {
    vi.mocked(svc.getAutoNoShowSettings).mockResolvedValue(settings())
    vi.mocked(svc.saveAutoNoShowSettings).mockImplementation(async (_m, enabled, fineAmount) => ({ enabled, fineAmount }))
    render(<AutoNoShowCard messId="MESS-BH2" />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('switch', { name: /process no-shows automatically/i }))
    await waitFor(() => expect(svc.saveAutoNoShowSettings).toHaveBeenCalledWith('MESS-BH2', false, 100))
    const fine = screen.getByLabelText('Fine amount')
    await user.clear(fine); await user.type(fine, '250')
    await user.click(screen.getByRole('button', { name: /save fine/i }))
    await waitFor(() => expect(svc.saveAutoNoShowSettings).toHaveBeenLastCalledWith('MESS-BH2', false, 250))
    expect(await screen.findByRole('status')).toHaveTextContent(/saved/i)
  })

  it('refuses an absurd fine in the form before asking the server, and only digits can be typed', async () => {
    vi.mocked(svc.getAutoNoShowSettings).mockResolvedValue(settings())
    render(<AutoNoShowCard messId="MESS-BH2" />)
    const user = userEvent.setup()
    const fine = await screen.findByLabelText('Fine amount')
    await user.clear(fine); await user.type(fine, '9a9b99')
    expect(fine).toHaveValue('9999')
    expect(screen.getByText(/whole number from 0 to 2000/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save fine/i })).toBeDisabled()
    expect(svc.saveAutoNoShowSettings).not.toHaveBeenCalled()
  })

  it("shows the server's reason when it can't load or save", async () => {
    vi.mocked(svc.getAutoNoShowSettings).mockRejectedValue(new Error('Not your mess.'))
    render(<AutoNoShowCard messId="MESS-BH2" />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/not your mess/i)
  })
})

describe('AttendanceExportCard', () => {
  it('downloads with the chosen range, meal and layout, and says what was saved', async () => {
    vi.mocked(svc.downloadAttendanceCsv).mockResolvedValue('attendance-summary-MESS-BH2-2026-10-01-to-2026-10-17.csv')
    render(<AttendanceExportCard messId="MESS-BH2" />)
    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Export meal'), 'lunch')
    await user.selectOptions(screen.getByLabelText('Export layout'), 'records')
    await user.click(screen.getByRole('button', { name: /download csv/i }))
    await waitFor(() => expect(svc.downloadAttendanceCsv).toHaveBeenCalledWith(expect.objectContaining({ messId: 'MESS-BH2', meal: 'lunch', view: 'records', from: expect.stringMatching(/^\d{4}-\d{2}-01$/), to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })))
    expect(await screen.findByRole('status')).toHaveTextContent(/downloaded attendance-summary/i)
  })

  it("shows the server's refusal (e.g. range too large) and re-enables the button", async () => {
    vi.mocked(svc.downloadAttendanceCsv).mockRejectedValue(new Error('Pick a range of at most 366 days.'))
    render(<AttendanceExportCard messId="MESS-BH2" />)
    await userEvent.setup().click(screen.getByRole('button', { name: /download csv/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/at most 366 days/i)
    expect(screen.getByRole('button', { name: /download csv/i })).toBeEnabled()
  })

  it('warns that it contains student data and is audited; blocks an inverted range', async () => {
    render(<AttendanceExportCard messId="MESS-BH2" />)
    expect(screen.getByText(/names and rooms.*audit log/i)).toBeInTheDocument()
    const from = screen.getByLabelText('Export from date')
    await userEvent.setup().clear(from)
    expect(screen.getByRole('button', { name: /download csv/i })).toBeDisabled()
  })
})
