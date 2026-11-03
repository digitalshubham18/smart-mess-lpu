import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithRouter, signInAs, signOut, makeUser } from '@/test/utils'

vi.mock('@/services/attendanceService', () => ({
  checkIn: vi.fn(),
  checkInByQr: vi.fn(),
  getMealWindows: vi.fn(),
  saveMealWindows: vi.fn(),
  resetMealWindows: vi.fn(),
  getMyQr: vi.fn(),
  getAttendanceSummary: vi.fn(),
  getScanAlerts: vi.fn(),
  getCheckinEmailPref: vi.fn(),
  setCheckinEmailPref: vi.fn(),
  getNotificationPrefs: vi.fn(),
  setMealReminderPref: vi.fn(),
  getAutoNoShowSettings: vi.fn(),
  saveAutoNoShowSettings: vi.fn(),
  downloadAttendanceCsv: vi.fn(),
  getDailySummary: vi.fn(),
  listCheckIns: vi.fn().mockResolvedValue([]),
  finesForMess: vi.fn().mockResolvedValue([]),
  markFinePaid: vi.fn(),
  processNoShows: vi.fn(),
  listCheckInsForStudent: vi.fn().mockResolvedValue([]),
  warningsForStudent: vi.fn().mockResolvedValue([]),
  finesForStudent: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/services/analyticsService', () => ({ attendanceByMealSeries: vi.fn().mockReturnValue([]), hostelWiseDemand: vi.fn().mockReturnValue([]) }))
vi.mock('@/utils/scanFeedback', () => ({ playScanFeedback: vi.fn(), isSoundOn: vi.fn().mockReturnValue(true), setSoundOn: vi.fn() }))
vi.mock('@/components/ui/StudentAvatar', () => ({ StudentAvatar: ({ studentId }: { studentId: string }) => <img alt="official photo" data-testid="student-photo" data-student={studentId} /> }))
// The camera itself is covered in QrScanner.test.tsx; here a button stands in for "the camera read a QR code".
vi.mock('@/components/attendance/QrScanner', () => ({
  QrScanner: ({ active, onScan }: { active: boolean; onScan: (v: string) => void }) =>
    active ? <button onClick={() => onScan('SIGNED.QR.TOKEN-0000')}>simulate camera read</button> : <div data-testid="camera-off" />,
}))

import { playScanFeedback, isSoundOn, setSoundOn } from '@/utils/scanFeedback'
import * as attendanceService from '@/services/attendanceService'
import Attendance from '../Attendance'

const checkIn = vi.mocked(attendanceService.checkIn)
const checkInByQr = vi.mocked(attendanceService.checkInByQr)
const getMealWindows = vi.mocked(attendanceService.getMealWindows)
const getMyQr = vi.mocked(attendanceService.getMyQr)
const saveMealWindows = vi.mocked(attendanceService.saveMealWindows)
const getSummary = vi.mocked(attendanceService.getAttendanceSummary)
const getAlerts = vi.mocked(attendanceService.getScanAlerts)
const getPrefs = vi.mocked(attendanceService.getNotificationPrefs)
const setEmailPref = vi.mocked(attendanceService.setCheckinEmailPref)
const processNoShows = vi.mocked(attendanceService.processNoShows)
const finesForMess = vi.mocked(attendanceService.finesForMess)
const markFinePaid = vi.mocked(attendanceService.markFinePaid)

const snapshot = (open: 'breakfast' | 'lunch' | 'snacks' | 'dinner' | null, time = '13:05'): attendanceService.MealWindowsSnapshot => ({
  timezone: 'Asia/Kolkata',
  now: { date: '2026-10-17', time, iso: '2026-10-17T07:35:00.000Z' },
  windows: [
    { meal: 'breakfast', start: '07:00', end: '09:30', open: open === 'breakfast' },
    { meal: 'lunch', start: '12:00', end: '14:30', open: open === 'lunch' },
    { meal: 'snacks', start: '16:30', end: '18:00', open: open === 'snacks' },
    { meal: 'dinner', start: '19:30', end: '22:00', open: open === 'dinner' },
  ],
  current: open,
  next: open === null ? { meal: 'snacks', start: '16:30' } : null,
  enforced: true,
})
const okResult = (over: Partial<attendanceService.CheckInResult> = {}): attendanceService.CheckInResult => ({
  studentId: '21000050', studentName: 'Riya Sharma', meal: 'lunch', date: '2026-10-17', scannedAt: '2026-10-17T07:35:12.000Z',
  method: 'qr', hostelName: 'Boys Hostel 2', room: 'B-204', year: 2, branch: 'Computer Science', hasPhoto: true, photoUrl: '/students/21000050/photo', ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  checkIn.mockReset()
  checkInByQr.mockReset()
  getMealWindows.mockReset()
  getMealWindows.mockResolvedValue(snapshot('lunch'))
  getSummary.mockResolvedValue({ checkedIn: 312, manual: 4, eligible: 520, willEat: 480, willNot: 2, noResponse: 38 })
  getAlerts.mockResolvedValue([])
  getPrefs.mockResolvedValue({ checkinEmail: false, mealReminder: true })
  vi.mocked(attendanceService.getAutoNoShowSettings).mockResolvedValue({ enabled: true, fineAmount: 100, recent: [] })
  vi.mocked(attendanceService.getDailySummary).mockResolvedValue({ messId: 'MESS-BH1', date: '2026-10-20', activeStudents: 100, totalCheckedIn: 0, responseRate: 0, noShowWarnings: 0, meals: [], waste: { entries: 0, preparedKg: 0, wasteKg: 0, wastePct: 0 }, feedback: { count: 0, avgRating: null }, openComplaints: 0, lowStockItems: 0, message: { title: 't', body: 'b', lines: ['Checked in: 0'] } })
  vi.mocked(isSoundOn).mockReturnValue(true)
  signInAs(makeUser({ role: 'KITCHEN_STAFF', hostelId: 'BH2' }))
})
afterEach(() => { signOut() })

/** Renders the console and taps a meal, like the person at the counter does. */
async function openConsole(mealName: RegExp = /^lunch/i) {
  renderWithRouter(<Attendance />)
  const user = userEvent.setup()
  await screen.findByTestId('mess-clock')
  await user.click(screen.getByRole('button', { name: mealName }))
  return user
}

describe('Attendance check-in console — pick the meal first, then the scanner opens only if it is that meal\'s time', () => {
  it('starts with no meal chosen: no scanner, no way to check anyone in, just a prompt', async () => {
    renderWithRouter(<Attendance />)
    await screen.findByTestId('mess-clock')
    expect(screen.getByTestId('pick-meal')).toHaveTextContent(/select the meal above/i)
    expect(screen.queryByRole('button', { name: /simulate camera read/i })).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText(/enter student uid/i)).toBeDisabled()
    expect(screen.getByRole('button', { name: /mark/i })).toBeDisabled()
  })

  it('shows the server\'s mess clock and every meal\'s window, marking the one being served', async () => {
    renderWithRouter(<Attendance />)
    expect(await screen.findByTestId('mess-clock')).toHaveTextContent('13:05')
    expect(screen.getByRole('button', { name: /lunch/i })).toHaveTextContent('12:00–14:30')
    expect(screen.getByRole('button', { name: /lunch/i })).toHaveTextContent(/serving now/i)
    expect(screen.getByRole('button', { name: /dinner/i })).toHaveTextContent(/not now/i)
  })

  it('choosing the meal that is being served opens the device scanner', async () => {
    await openConsole(/^lunch/i)
    expect(await screen.findByRole('button', { name: /simulate camera read/i })).toBeInTheDocument()
    expect(screen.queryByTestId('not-meal-time')).not.toBeInTheDocument()
    expect(screen.getByText(/lunch is being served \(12:00–14:30\)/i)).toBeInTheDocument()
  })

  it('choosing a meal that is NOT being served keeps the camera off and says why, with the timing', async () => {
    await openConsole(/^dinner/i)
    const notice = await screen.findByTestId('not-meal-time')
    expect(notice).toHaveTextContent(/this is not dinner time — dinner is served 19:30–22:00 \(it's 13:05 now\)/i)
    expect(notice).toHaveTextContent(/lunch is being served now/i)
    expect(screen.queryByTestId('camera-off')).not.toBeInTheDocument() // the scanner isn't even mounted, so the camera is never requested
    expect(screen.queryByRole('button', { name: /simulate camera read/i })).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText(/enter student uid/i)).toBeDisabled()
  })

  it('between meals it names what is next', async () => {
    getMealWindows.mockResolvedValue(snapshot(null, '15:10'))
    await openConsole(/^lunch/i)
    expect(await screen.findByTestId('not-meal-time')).toHaveTextContent(/not lunch time.*next up: snacks at 16:30/i)
    expect(screen.queryByRole('button', { name: /switch to/i })).not.toBeInTheDocument()
  })

  it('offers a one-tap switch to the meal that IS being served', async () => {
    const user = await openConsole(/^dinner/i)
    await user.click(await screen.findByRole('button', { name: /switch to lunch/i }))
    expect(await screen.findByRole('button', { name: /simulate camera read/i })).toBeInTheDocument()
  })

  it('when the clock moves into the meal the scanner opens by itself (timings are re-read from the server)', async () => {
    getMealWindows.mockResolvedValue(snapshot(null, '11:59'))
    const user = await openConsole(/^lunch/i)
    expect(await screen.findByTestId('not-meal-time')).toBeInTheDocument()
    getMealWindows.mockResolvedValue(snapshot('lunch', '12:00'))
    await user.click(screen.getByRole('button', { name: /^lunch/i })) // re-selecting re-reads the server's timings
    expect(await screen.findByRole('button', { name: /simulate camera read/i })).toBeInTheDocument()
  })

  it('if the server refuses a scan for being outside the meal time, the console updates itself to match', async () => {
    const closed = snapshot(null, '14:31')
    checkInByQr.mockRejectedValueOnce(Object.assign(new Error('This is not Lunch time — Lunch was served 12:00–14:30 and has ended (it\'s 14:31).'), { code: 'OUTSIDE_MEAL_WINDOW', meals: closed }))
    await openConsole(/^lunch/i)
    await userEvent.setup().click(await screen.findByRole('button', { name: /simulate camera read/i }))
    expect(await screen.findByTestId('not-meal-time')).toBeInTheDocument()
    expect(screen.queryByTestId('scan-success')).not.toBeInTheDocument()
  })
})

describe('Attendance check-in console — what a successful scan shows', () => {
  it('a QR read is sent to the server (not interpreted by the browser) with the mess, the chosen meal and the MESS date', async () => {
    checkInByQr.mockResolvedValueOnce(okResult())
    await openConsole()
    await userEvent.setup().click(await screen.findByRole('button', { name: /simulate camera read/i }))
    await waitFor(() => expect(checkInByQr).toHaveBeenCalledTimes(1))
    expect(checkInByQr).toHaveBeenCalledWith('SIGNED.QR.TOKEN-0000', 'MESS-BH2', 'lunch', '2026-10-17')
  })

  it('shows the official photo, name, UID, hostel and room, meal, and the date and time of the scan', async () => {
    checkInByQr.mockResolvedValueOnce(okResult())
    await openConsole()
    await userEvent.setup().click(await screen.findByRole('button', { name: /simulate camera read/i }))
    const card = await screen.findByTestId('scan-success')
    expect(card).toHaveTextContent('Checked in — Riya Sharma')
    expect(card).toHaveTextContent('21000050')
    expect(card).toHaveTextContent('Boys Hostel 2')
    expect(card).toHaveTextContent('Room B-204')
    expect(card).toHaveTextContent('Computer Science')
    expect(card).toHaveTextContent(/lunch · 17 oct 2026/i)
    expect(card).toHaveTextContent(/1:05:12 pm/i) // 07:35:12 UTC shown in the mess's Asia/Kolkata time
    expect(card).toHaveTextContent(/verified from the database — signed qr scanned from the student's own phone/i)
    expect(screen.getByTestId('student-photo')).toHaveAttribute('data-student', '21000050')
    expect(screen.queryByText(/no official photo/i)).not.toBeInTheDocument()
  })

  it('warns the counter when the database has no photo for this student', async () => {
    checkInByQr.mockResolvedValueOnce(okResult({ hasPhoto: false }))
    await openConsole()
    await userEvent.setup().click(await screen.findByRole('button', { name: /simulate camera read/i }))
    expect(await screen.findByText(/no official photo is on file.*check their id card/i)).toBeInTheDocument()
  })

  it('says plainly when the identity was typed rather than scanned', async () => {
    checkIn.mockResolvedValueOnce(okResult({ method: 'manual' }))
    const user = await openConsole()
    await user.type(screen.getByPlaceholderText(/enter student uid/i), '21000050')
    await user.click(screen.getByRole('button', { name: /mark/i }))
    expect(await screen.findByText(/uid typed by counter staff \(no qr was scanned\)/i)).toBeInTheDocument()
    expect(checkIn).toHaveBeenCalledWith('21000050', 'MESS-BH2', 'lunch', '2026-10-17', expect.anything())
  })
})

describe('Attendance check-in console — refusals the staff member can read', () => {
  const scanWith = async (err: Error) => {
    checkInByQr.mockRejectedValueOnce(err)
    await openConsole()
    await userEvent.setup().click(await screen.findByRole('button', { name: /simulate camera read/i }))
  }

  it('an expired or screenshotted QR', async () => {
    await scanWith(Object.assign(new Error("That QR code has expired. Ask the student to look at their screen again — screenshots don't work."), { code: 'QR_EXPIRED' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/screenshots don't work/i)
    expect(screen.queryByTestId('scan-success')).not.toBeInTheDocument()
  })

  it('a student who has not taken mess is sent to the warden office', async () => {
    await scanWith(Object.assign(new Error("This student isn't on the mess roster any more. Please send them to the warden office."), { code: 'NOT_ON_MESS' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/warden office/i)
  })

  it('a student of another mess, and a duplicate scan, each show the server\'s reason and replace the previous message', async () => {
    checkInByQr.mockRejectedValueOnce(new Error('Aarav Patel (21000077) is not enrolled in this mess — check-in refused.'))
      .mockRejectedValueOnce(new Error('Aarav Patel already checked in for lunch at 12:30 PM.'))
    await openConsole()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /simulate camera read/i }))
    expect(await screen.findByText(/is not enrolled in this mess — check-in refused/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /simulate camera read/i }))
    expect(await screen.findByText(/already checked in for lunch/i)).toBeInTheDocument()
    expect(screen.queryByText(/not enrolled in this mess/i)).not.toBeInTheDocument()
  })

  it('a QR cannot be verified offline — it is not queued, and the person is told to type the UID instead', async () => {
    checkInByQr.mockRejectedValueOnce(Object.assign(new Error('No connection to the server.'), { network: true }))
    await openConsole()
    await userEvent.setup().click(await screen.findByRole('button', { name: /simulate camera read/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/qr code can only be verified online.*enter their uid/i)
    expect(localStorage.getItem('smartmess.checkinQueue')).toBeNull()
  })

  it('ignores an empty manual submit, and disables Mark while a check-in is in flight (no double-scan)', async () => {
    let resolve!: (v: attendanceService.CheckInResult) => void
    checkIn.mockReturnValueOnce(new Promise((r) => { resolve = r }))
    const user = await openConsole()
    await user.click(screen.getByRole('button', { name: /mark/i }))
    expect(checkIn).not.toHaveBeenCalled()
    await user.type(screen.getByPlaceholderText(/enter student uid/i), '21000050')
    await user.click(screen.getByRole('button', { name: /mark/i }))
    expect(screen.getByRole('button', { name: /mark/i })).toBeDisabled()
    resolve(okResult({ method: 'manual' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /mark/i })).toBeEnabled())
  })
})

describe('Attendance console — managers set the meal timings', () => {
  it('Kitchen staff can see the timings but not edit them', async () => {
    renderWithRouter(<Attendance />)
    await screen.findByTestId('mess-clock')
    expect(screen.queryByRole('button', { name: /edit meal timings/i })).not.toBeInTheDocument()
  })

  it('a Mess Manager can change them; the console then uses the saved timings', async () => {
    signInAs(makeUser({ role: 'MESS_MANAGER', hostelId: 'BH2' }))
    const updated = snapshot('lunch')
    updated.windows[1] = { meal: 'lunch', start: '12:30', end: '15:00', open: true }
    saveMealWindows.mockResolvedValueOnce(updated)
    renderWithRouter(<Attendance />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /edit meal timings/i }))
    const start = screen.getByLabelText('Lunch start')
    await user.clear(start)
    await user.type(start, '12:30')
    await user.click(screen.getByRole('button', { name: /save timings/i }))
    expect(await screen.findByText(/meal timings saved/i)).toBeInTheDocument()
    expect(saveMealWindows).toHaveBeenCalledWith('MESS-BH2', expect.arrayContaining([{ meal: 'lunch', start: '12:30', end: '14:30' }]))
    expect(screen.getByRole('button', { name: /^lunch/i })).toHaveTextContent('12:30–15:00')
  })

  it('shows the server\'s reason when a change is refused (e.g. overlapping meals)', async () => {
    signInAs(makeUser({ role: 'MESS_MANAGER', hostelId: 'BH2' }))
    saveMealWindows.mockRejectedValueOnce(new Error('breakfast (07:00–09:30) overlaps lunch (09:00–14:30).'))
    renderWithRouter(<Attendance />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /edit meal timings/i }))
    await user.click(screen.getByRole('button', { name: /save timings/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/overlaps lunch/i)
  })
})

describe('Attendance console — no-shows and fines', () => {
  it('runs no-show processing for the actor\'s mess and renders the summary', async () => {
    processNoShows.mockResolvedValueOnce({ checked: 40, noShows: 3, warningsIssued: 3, finesIssued: 1 })
    const user = await openConsole()
    await user.click(screen.getByRole('button', { name: /process no-shows for lunch/i }))
    expect(await screen.findByText(/40 expected · 3 no-shows/i)).toBeInTheDocument()
    expect(screen.getByText(/3 warnings/i)).toBeInTheDocument()
    expect(screen.getByText(/1 fine issued/i)).toBeInTheDocument()
    // The request names only the mess/date/meal — WHO was expected is the server's own record, not something the browser sends.
    expect(processNoShows).toHaveBeenCalledWith('MESS-BH2', '2026-10-17', 'lunch', expect.anything())
  })

  it('lists outstanding fines and shows the server\'s reason if marking one paid is refused', async () => {
    finesForMess.mockResolvedValue([{ id: 'F1', studentId: '21000050', studentName: 'Riya Sharma', messId: 'MESS-BH2', amount: 150, month: '2026-10', issuedAt: '', warningIds: [], paid: false }])
    markFinePaid.mockRejectedValueOnce(new Error("That's outside your mess — you can only do this for your own hostel's mess."))
    renderWithRouter(<Attendance />)
    expect(await screen.findByText('Riya Sharma')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: /mark paid/i }))
    expect(await screen.findByText(/outside your mess/i)).toBeInTheDocument()
  })
})

describe('Attendance — which view each role gets', () => {
  it('a student sees their own QR code, not the staff console', async () => {
    getMyQr.mockResolvedValue({ studentId: '21000012', token: 'a.b.c', ttlSeconds: 60, expiresAt: new Date(Date.now() + 60_000).toISOString(), meals: snapshot('lunch') })
    signInAs(makeUser({ role: 'STUDENT', studentId: '21000012', hostelId: 'BH1' }))
    renderWithRouter(<Attendance />)
    expect(screen.getByText(/your check-in qr code/i)).toBeInTheDocument()
    expect(await screen.findByTestId('meal-qr')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/enter student uid/i)).not.toBeInTheDocument()
  })

  it('a parent follows the child\'s attendance but is NOT given a QR to present', async () => {
    signInAs(makeUser({ role: 'PARENT', studentId: '21000012', hostelId: 'BH1' }))
    renderWithRouter(<Attendance />)
    expect(await screen.findByText(/only the student shows the meal qr code/i)).toBeInTheDocument()
    expect(screen.queryByTestId('meal-qr')).not.toBeInTheDocument()
    expect(getMyQr).not.toHaveBeenCalled()
  })

  it('a Finance Manager gets analytics only — no way to check anyone in', () => {
    signInAs(makeUser({ role: 'FINANCE_MANAGER' }))
    renderWithRouter(<Attendance />)
    expect(screen.getByText(/attendance analytics/i)).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/enter student uid/i)).not.toBeInTheDocument()
  })
})

describe('Attendance console — offline check-in queue', () => {
  beforeEach(() => { finesForMess.mockResolvedValue([]) })
  const offline = () => Object.assign(new Error('No connection to the server.'), { network: true })
  const okResult2 = okResult({ studentId: '21000101', studentName: 'Aarav Sharma', method: 'manual' })

  async function scanOffline(uid = '21000101') {
    checkIn.mockRejectedValueOnce(offline())
    const user = await openConsole()
    await user.type(screen.getByPlaceholderText(/enter student uid/i), uid)
    await user.click(screen.getByRole('button', { name: /^mark$/i }))
    return user
  }

  it('a scan that never reaches the server is saved (not lost), clearly NOT shown as confirmed, and listed as waiting', async () => {
    await scanOffline()
    expect(await screen.findByText(/saved offline — 21000101 will be checked in automatically/i)).toBeInTheDocument()
    expect(screen.queryByTestId('scan-success')).not.toBeInTheDocument()
    expect(screen.getByText(/not confirmed yet/i)).toBeInTheDocument()
    expect(screen.getByTestId('offline-queue')).toHaveTextContent('1 scan waiting to sync')
    expect(screen.getByPlaceholderText(/enter student uid/i)).toHaveValue('') // ready for the next student in line
    expect(JSON.parse(localStorage.getItem('smartmess.checkinQueue')!)[0]).toMatchObject({ uid: '21000101', messId: 'MESS-BH2' })
  })

  it('a refusal FROM the server (not enrolled, outside your mess…) is final — it is never queued', async () => {
    checkIn.mockRejectedValueOnce(Object.assign(new Error('Aarav is not enrolled in this mess — check-in refused.'), { network: false, code: 'NOT_ENROLLED' }))
    const user = await openConsole()
    await user.type(screen.getByPlaceholderText(/enter student uid/i), '21000999')
    await user.click(screen.getByRole('button', { name: /^mark$/i }))
    expect(await screen.findByText(/not enrolled in this mess/i)).toBeInTheDocument()
    expect(screen.queryByTestId('offline-queue')).not.toBeInTheDocument()
    expect(localStorage.getItem('smartmess.checkinQueue')).toBeNull()
  })

  it('"Sync now" replays the scan with its ORIGINAL timestamp and clears the banner', async () => {
    const user = await scanOffline()
    await screen.findByTestId('offline-queue')
    const queued = JSON.parse(localStorage.getItem('smartmess.checkinQueue')!)[0] // the meal is whatever the console had selected (time-of-day dependent)
    checkIn.mockResolvedValueOnce(okResult2)
    await user.click(screen.getByRole('button', { name: /sync now/i }))
    await waitFor(() => expect(screen.queryByTestId('offline-queue')).not.toBeInTheDocument())
    expect(checkIn).toHaveBeenLastCalledWith('21000101', 'MESS-BH2', queued.meal, queued.date, expect.anything(), queued.scannedAt)
  })

  it('syncing automatically when the browser comes back online', async () => {
    await scanOffline()
    await screen.findByTestId('offline-queue')
    checkIn.mockResolvedValueOnce(okResult2)
    window.dispatchEvent(new Event('online'))
    await waitFor(() => expect(screen.queryByTestId('offline-queue')).not.toBeInTheDocument())
  })

  it('still offline on sync: the scan stays queued and nothing is lost', async () => {
    const user = await scanOffline()
    await screen.findByTestId('offline-queue')
    checkIn.mockRejectedValueOnce(offline())
    await user.click(screen.getByRole('button', { name: /sync now/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /sync now/i })).toBeEnabled())
    expect(screen.getByTestId('offline-queue')).toHaveTextContent('1 scan waiting to sync')
  })

  it('a queued scan the server refuses on replay shows up with the reason, and can be dismissed', async () => {
    const user = await scanOffline()
    await screen.findByTestId('offline-queue')
    checkIn.mockRejectedValueOnce(Object.assign(new Error('Aarav Sharma (21000101) is not enrolled in this mess — check-in refused.'), { network: false, code: 'NOT_ENROLLED' }))
    await user.click(screen.getByRole('button', { name: /sync now/i }))
    expect(await screen.findByText(/was not recorded: .*not enrolled in this mess/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(screen.queryByTestId('offline-queue')).not.toBeInTheDocument()
  })

  it('a replay the server calls "already checked in" counts as done, not as an error', async () => {
    const user = await scanOffline()
    await screen.findByTestId('offline-queue')
    checkIn.mockRejectedValueOnce(Object.assign(new Error('Aarav already checked in for lunch'), { network: false, code: 'ALREADY_CHECKED_IN' }))
    await user.click(screen.getByRole('button', { name: /sync now/i }))
    await waitFor(() => expect(screen.queryByTestId('offline-queue')).not.toBeInTheDocument())
  })

  it('on opening the console with scans left from an earlier offline session, they are picked up and synced', async () => {
    localStorage.setItem('smartmess.checkinQueue', JSON.stringify([{ clientId: 'c1', uid: '21000101', messId: 'MESS-BH2', meal: 'lunch', date: '2026-10-06', scannedAt: new Date().toISOString(), queuedAt: new Date().toISOString() }]))
    checkIn.mockResolvedValueOnce(okResult2)
    renderWithRouter(<Attendance />)
    await waitFor(() => expect(checkIn).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(localStorage.getItem('smartmess.checkinQueue')).toBe('[]'))
  })
})

describe('Attendance console — live count', () => {
  it('shows how many are checked in against how many said they would eat, once a meal is chosen', async () => {
    await openConsole()
    const box = await screen.findByTestId('live-count')
    expect(box).toHaveTextContent('312')
    expect(box).toHaveTextContent(/checked in for lunch/i)
    expect(box).toHaveTextContent('480 said they')
    expect(box).toHaveTextContent('520 on this mess')
    expect(box).toHaveTextContent("38 haven't answered")
    expect(box).toHaveTextContent('4 typed by hand')
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '65') // 312 / 480
    expect(getSummary).toHaveBeenCalledWith('MESS-BH2', '2026-10-17', 'lunch')
  })

  it('refreshes the count after each successful check-in', async () => {
    checkInByQr.mockResolvedValueOnce(okResult())
    await openConsole()
    await screen.findByTestId('live-count')
    const calls = getSummary.mock.calls.length
    getSummary.mockResolvedValue({ checkedIn: 313, manual: 4, eligible: 520, willEat: 480, willNot: 2, noResponse: 38 })
    await userEvent.setup().click(await screen.findByRole('button', { name: /simulate camera read/i }))
    await waitFor(() => expect(getSummary.mock.calls.length).toBeGreaterThan(calls))
    expect(await screen.findByTestId('live-count')).toHaveTextContent('313')
  })

  it('has no live count until a meal is chosen', async () => {
    renderWithRouter(<Attendance />)
    await screen.findByTestId('mess-clock')
    expect(screen.queryByTestId('live-count')).not.toBeInTheDocument()
  })
})

describe('Attendance console — sound, vibration and a full-screen flash after every scan', () => {
  const scan = async () => userEvent.setup().click(await screen.findByRole('button', { name: /simulate camera read/i }))

  it('a good scan: success tone and a green flash', async () => {
    checkInByQr.mockResolvedValueOnce(okResult())
    await openConsole()
    await scan()
    await screen.findByTestId('scan-success')
    expect(playScanFeedback).toHaveBeenCalledWith('success')
    expect(screen.getByTestId('scan-flash')).toHaveAttribute('data-kind', 'success')
  })

  it('a refusal: error tone and a red flash', async () => {
    checkInByQr.mockRejectedValueOnce(Object.assign(new Error("That isn't a valid Smart Mess meal QR code."), { code: 'QR_INVALID' }))
    await openConsole()
    await scan()
    await screen.findByRole('alert')
    expect(playScanFeedback).toHaveBeenCalledWith('error')
    expect(screen.getByTestId('scan-flash')).toHaveAttribute('data-kind', 'error')
  })

  it('a check-in that needs a human eye (on leave, or no photo on file) gets the warning tone and an amber flash — not the all-clear', async () => {
    checkInByQr.mockResolvedValueOnce(okResult({ hasPhoto: false }))
    await openConsole()
    await scan()
    await screen.findByTestId('scan-success')
    expect(playScanFeedback).toHaveBeenCalledWith('warn')
    expect(playScanFeedback).not.toHaveBeenCalledWith('success')
    expect(screen.getByTestId('scan-flash')).toHaveAttribute('data-kind', 'warn')
  })

  it('the sound switch is remembered', async () => {
    renderWithRouter(<Attendance />)
    await screen.findByTestId('mess-clock')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /sound on/i }))
    expect(setSoundOn).toHaveBeenCalledWith(false)
    expect(await screen.findByRole('button', { name: /sound off/i })).toBeInTheDocument()
  })
})

describe('Attendance console — the counter is warned about approved leave, and told when a printed card was used', () => {
  it('on approved leave: still checked in, with a clear warning', async () => {
    checkInByQr.mockResolvedValueOnce(okResult({ onLeave: true, leaveUntil: '2026-10-21' }))
    await openConsole()
    await userEvent.setup().click(await screen.findByRole('button', { name: /simulate camera read/i }))
    expect(await screen.findByTestId('scan-success')).toBeInTheDocument()
    expect(screen.getByTestId('leave-warning')).toHaveTextContent(/approved leave until 2026-10-21.*really them/i)
    expect(playScanFeedback).toHaveBeenCalledWith('warn')
  })

  it('a printed ID card says so, and reminds the counter to compare the photo', async () => {
    checkInByQr.mockResolvedValueOnce(okResult({ method: 'card' }))
    await openConsole()
    await userEvent.setup().click(await screen.findByRole('button', { name: /simulate camera read/i }))
    expect(await screen.findByText(/printed id card scanned.*compare the photo/i)).toBeInTheDocument()
  })
})

describe('Attendance console — meals that run past midnight', () => {
  it('uses the SERVICE date the server gives for the chosen meal, not the calendar date', async () => {
    const snap = snapshot('dinner', '00:30')
    snap.now = { date: '2026-10-17', time: '00:30', iso: '2026-10-16T19:00:00.000Z' }
    snap.windows[3] = { meal: 'dinner', start: '22:00', end: '01:00', open: true, crossesMidnight: true, date: '2026-10-16' }
    getMealWindows.mockResolvedValue(snap)
    checkInByQr.mockResolvedValueOnce(okResult({ meal: 'dinner', date: '2026-10-16' }))
    await openConsole(/^dinner/i)
    await userEvent.setup().click(await screen.findByRole('button', { name: /simulate camera read/i }))
    await waitFor(() => expect(checkInByQr).toHaveBeenCalledWith('SIGNED.QR.TOKEN-0000', 'MESS-BH2', 'dinner', '2026-10-16'))
    expect(getSummary).toHaveBeenCalledWith('MESS-BH2', '2026-10-16', 'dinner')
  })
})

describe('Attendance console — alerts for managers only', () => {
  it('a Mess Manager sees refused-scan and unusual-volume alerts', async () => {
    signInAs(makeUser({ role: 'MESS_MANAGER', hostelId: 'BH2' }))
    getAlerts.mockResolvedValue([
      { id: 'A1', at: '2026-10-17T07:00:00.000Z', action: 'checkin_refused', actorName: 'Suresh K', summary: 'Refused lunch check-in for an unrecognised QR: QR_INVALID' },
      { id: 'A2', at: '2026-10-17T07:01:00.000Z', action: 'checkin_spike', actorName: 'Suresh K', summary: 'Unusual check-in volume from Suresh K: 52 check-ins in 2 minutes' },
    ])
    renderWithRouter(<Attendance />)
    expect(await screen.findByText(/unrecognised qr: qr_invalid/i)).toBeInTheDocument()
    expect(screen.getByText(/52 check-ins in 2 minutes/i)).toBeInTheDocument()
  })

  it('says so when there is nothing suspicious', async () => {
    signInAs(makeUser({ role: 'MESS_MANAGER', hostelId: 'BH2' }))
    renderWithRouter(<Attendance />)
    expect(await screen.findByTestId('no-alerts')).toBeInTheDocument()
  })

  it('counter staff never see (or request) the alerts', async () => {
    renderWithRouter(<Attendance />)
    await screen.findByTestId('mess-clock')
    expect(screen.queryByText(/scan alerts/i)).not.toBeInTheDocument()
    expect(getAlerts).not.toHaveBeenCalled()
  })
})

describe('Attendance console — "Check this device"', () => {
  const media = (impl: () => Promise<unknown>) => Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(impl) } })

  it('reports a device that can scan: secure page, camera, permission, and which decoder it will use', async () => {
    media(async () => ({ getTracks: () => [{ stop: vi.fn() }], getVideoTracks: () => [{ label: 'Back Camera' }] }))
    renderWithRouter(<Attendance />)
    await screen.findByTestId('mess-clock')
    await userEvent.setup().click(screen.getByRole('button', { name: /check this device/i }))
    const box = await screen.findByTestId('self-test')
    expect(await within(box).findByText(/allowed \(back camera\)/i)).toBeInTheDocument()
    expect(box).toHaveTextContent(/secure page/i)
    expect(box).toHaveTextContent(/qr decoder/i)
    expect(within(box).getByRole('button', { name: /try a real read/i })).toBeInTheDocument()
  })

  it('explains a blocked camera and does not offer a read test', async () => {
    media(async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }) })
    renderWithRouter(<Attendance />)
    await screen.findByTestId('mess-clock')
    await userEvent.setup().click(screen.getByRole('button', { name: /check this device/i }))
    const box = await screen.findByTestId('self-test')
    expect(await within(box).findByText(/blocked\. allow the camera for this site/i)).toBeInTheDocument()
    expect(within(box).queryByRole('button', { name: /try a real read/i })).not.toBeInTheDocument()
  })
})

describe('Student view — check-in emails are opt-in', () => {
  it('starts off, and turning it on is saved', async () => {
    getMyQr.mockResolvedValue({ studentId: '21000012', token: 'a.b.c', ttlSeconds: 60, expiresAt: new Date(Date.now() + 60_000).toISOString(), meals: snapshot('lunch') })
    setEmailPref.mockResolvedValue(true)
    signInAs(makeUser({ role: 'STUDENT', studentId: '21000012', hostelId: 'BH1' }))
    renderWithRouter(<Attendance />)
    const toggle = await screen.findByRole('switch', { name: /email me when i'm checked in/i })
    await waitFor(() => expect(toggle).toBeEnabled())
    expect(toggle).not.toBeChecked()
    await userEvent.setup().click(toggle)
    await waitFor(() => expect(setEmailPref).toHaveBeenCalledWith(true))
    await waitFor(() => expect(toggle).toBeChecked())
  })

  it("the 9 PM \"mark tomorrow's meals\" reminder is on by default, and switching it off is saved", async () => {
    getMyQr.mockResolvedValue({ studentId: '21000012', token: 'a.b.c', ttlSeconds: 60, expiresAt: new Date(Date.now() + 60_000).toISOString(), meals: snapshot('lunch') })
    vi.mocked(attendanceService.setMealReminderPref).mockResolvedValue(false)
    signInAs(makeUser({ role: 'STUDENT', studentId: '21000012', hostelId: 'BH1' }))
    renderWithRouter(<Attendance />)
    const toggle = await screen.findByRole('switch', { name: /remind me at 9 pm to mark tomorrow's meals/i })
    await waitFor(() => expect(toggle).toBeEnabled())
    expect(toggle).toBeChecked()
    await userEvent.setup().click(toggle)
    await waitFor(() => expect(attendanceService.setMealReminderPref).toHaveBeenCalledWith(false))
    await waitFor(() => expect(toggle).not.toBeChecked())
  })
})
