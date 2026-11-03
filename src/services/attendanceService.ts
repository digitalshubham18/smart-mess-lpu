import type { AttendanceWarning, AttendanceFine, User, MealType } from '@/types'
import { api } from './api'

/**
 * Real QR check-in, no-show warnings and fines — every function here calls the real
 * backend in /server (Express + SQLite). Who *intended* to eat is also the server's own
 * record now (meal_intentions, written by mealService.setIntention) — processNoShows sends
 * only the mess, date and meal, and the server works out who was expected.
 */

function extractApiError(e: unknown, fallback: string): string {
  const err = e as { response?: { data?: { error?: string } } }
  return err?.response?.data?.error ?? fallback
}

export interface CheckInResult {
  studentId: string
  studentName: string
  meal: MealType
  date: string
  scannedAt: string
  /** 'qr' = the student's own signed code was scanned; 'manual' = counter staff typed the UID. */
  method?: 'qr' | 'card' | 'manual'
  hostelName?: string
  room?: string
  year?: number
  branch?: string
  /** Whether an official photo is on file (the image is served, behind login, from `photoUrl`). */
  hasPhoto?: boolean
  photoUrl?: string
  /** On approved leave today: still checked in, but the counter should look at who is standing there. */
  onLeave?: boolean
  leaveUntil?: string
}

/** When each meal is served, plus which is on now — from the SERVER's clock, in mess-local time. */
export interface MealWindowsSnapshot {
  timezone: string
  now: { date: string; time: string; iso: string }
  windows: { meal: MealType; start: string; end: string; open: boolean; crossesMidnight?: boolean; /** the date a check-in for this meal is recorded under right now (yesterday's, for a post-midnight scan of a meal that runs past midnight) */ date?: string }[]
  current: MealType | null
  next: { meal: MealType; start: string } | null
  enforced: boolean
}

/** A failed check-in. `network` is true only when the request never got an answer (the offline queue keys off this); `code` is the server's machine-readable reason. */
export class CheckInError extends Error {
  network: boolean
  code?: string
  status?: number
  /** Present on OUTSIDE_MEAL_WINDOW refusals: the server's current view of the meal timings. */
  meals?: MealWindowsSnapshot
  constructor(message: string, network: boolean, code?: string, status?: number, meals?: MealWindowsSnapshot) {
    super(message)
    this.meals = meals
    this.name = 'CheckInError'
    this.network = network
    this.code = code
    this.status = status
  }
}

async function postCheckIn(body: Record<string, unknown>): Promise<CheckInResult> {
  try {
    const { data } = await api.post<CheckInResult>('/attendance/checkin', body)
    return data
  } catch (e) {
    const err = e as { response?: { status?: number; data?: { error?: string; code?: string; meals?: MealWindowsSnapshot } } }
    if (!err.response) throw new CheckInError('No connection to the server.', true)
    throw new CheckInError(err.response.data?.error ?? 'Check-in failed.', false, err.response.data?.code, err.response.status, err.response.data?.meals)
  }
}

/** Check in by typed UID (the fallback when a phone is flat). `scannedAt` is set only when replaying a scan from the offline queue — the real time it happened. */
export async function checkIn(uid: string, messId: string, meal: MealType, date: string, _actor?: User | null, scannedAt?: string): Promise<CheckInResult> {
  return postCheckIn({ uid: uid.trim(), messId, meal, date, ...(scannedAt ? { scannedAt } : {}) })
}

/** Check in by what the camera read from the student's own phone. The server verifies the signature and 60-second expiry. */
export async function checkInByQr(qr: string, messId: string, meal: MealType, date: string, scannedAt?: string): Promise<CheckInResult> {
  return postCheckIn({ qr: qr.trim(), messId, meal, date, ...(scannedAt ? { scannedAt } : {}) })
}

export async function getMealWindows(messId: string): Promise<MealWindowsSnapshot> {
  try {
    const { data } = await api.get<MealWindowsSnapshot>('/attendance/meal-windows', { params: { messId } })
    return data
  } catch (e) {
    throw new Error(extractApiError(e, 'Could not load the meal timings — is the API server running?'))
  }
}

export async function saveMealWindows(messId: string, windows: { meal: MealType; start: string; end: string }[]): Promise<MealWindowsSnapshot> {
  try {
    const { data } = await api.put<MealWindowsSnapshot>('/attendance/meal-windows', { messId, windows })
    return data
  } catch (e) {
    throw new Error(extractApiError(e, 'Could not save the meal timings.'))
  }
}

export async function resetMealWindows(messId: string): Promise<MealWindowsSnapshot> {
  try {
    const { data } = await api.put<MealWindowsSnapshot>('/attendance/meal-windows', { messId, reset: true })
    return data
  } catch (e) {
    throw new Error(extractApiError(e, 'Could not reset the meal timings.'))
  }
}

/** The student's own meal QR: a signed token that expires in `ttlSeconds` — the page fetches a fresh one before it does. */
export interface MyQr { studentId: string; token: string; ttlSeconds: number; expiresAt: string; meals: MealWindowsSnapshot }
/** The QR couldn't be fetched because there is no connection (as opposed to the server saying no). */
export class QrNetworkError extends Error {
  readonly network = true
  constructor() { super('You are offline.') }
}
export async function getMyQr(): Promise<MyQr> {
  try {
    const { data } = await api.get<MyQr>('/attendance/my-qr')
    return data
  } catch (e) {
    // No response at all = no data / server unreachable: the caller can fall back to the offline code.
    if (!(e as { response?: unknown })?.response) throw new QrNetworkError()
    throw new Error(extractApiError(e, 'Could not load your QR code — is the API server running?'))
  }
}

interface AttendanceRow {
  id: string
  student_id: string
  mess_id: string
  date: string
  meal: string
  scanned_at: string
  scanned_by: string | null
}

export async function hasCheckedIn(studentId: string, date: string, meal: MealType): Promise<boolean> {
  const { data } = await api.get<AttendanceRow[]>('/attendance', { params: { studentId, date, meal } })
  return data.length > 0
}

export async function listCheckIns(messId: string, date: string, meal: MealType): Promise<AttendanceRow[]> {
  const { data } = await api.get<AttendanceRow[]>('/attendance', { params: { messId, date, meal } })
  return data
}

export async function listCheckInsForStudent(studentId: string): Promise<AttendanceRow[]> {
  const { data } = await api.get<AttendanceRow[]>('/attendance', { params: { studentId } })
  return data
}

export interface NoShowSummary {
  checked: number
  noShows: number
  warningsIssued: number
  finesIssued: number
}

/**
 * Runs no-show processing for a meal right now. The server also does this by itself once a meal's window has closed
 * (see getAutoNoShowSettings), so this is for running it early or where automatic processing is off. The server reads who
 * was expected from its own meal_intentions and uses the mess's own fine setting — the request carries neither.
 */
export async function processNoShows(messId: string, date: string, meal: MealType, _actor?: User | null): Promise<NoShowSummary> {
  const { data } = await api.post<NoShowSummary>('/attendance/process-no-shows', { messId, date, meal })
  return data
}

export interface AutoNoShowRun { date: string; meal: MealType; status: 'processed' | 'skipped_no_scans' | 'manual'; warnings: number; fines: number; ranAt: string }
export interface AutoNoShowSettings { enabled: boolean; fineAmount: number; recent?: AutoNoShowRun[] }
export async function getAutoNoShowSettings(messId: string): Promise<AutoNoShowSettings> {
  try { return (await api.get<AutoNoShowSettings>('/attendance/auto-no-shows', { params: { messId } })).data }
  catch (e) { throw new Error(extractApiError(e, 'Could not load the automatic no-show settings.')) }
}
export async function saveAutoNoShowSettings(messId: string, enabled: boolean, fineAmount: number): Promise<AutoNoShowSettings> {
  try { return (await api.put<AutoNoShowSettings>('/attendance/auto-no-shows', { messId, enabled, fineAmount })).data }
  catch (e) { throw new Error(extractApiError(e, 'Could not save the automatic no-show settings.')) }
}

/** Downloads the attendance CSV (one row per check-in, or one row per student with meal counts). */
export async function downloadAttendanceCsv(opts: { messId: string; from: string; to: string; meal?: MealType | ''; view: 'records' | 'summary' }): Promise<string> {
  try {
    const res = await api.get<Blob>('/attendance/export', { params: { messId: opts.messId, from: opts.from, to: opts.to, view: opts.view, ...(opts.meal ? { meal: opts.meal } : {}) }, responseType: 'blob' })
    const name = /filename="([^"]+)"/.exec(String(res.headers?.['content-disposition'] ?? ''))?.[1] ?? `attendance-${opts.view}-${opts.from}-to-${opts.to}.csv`
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return name
  } catch (e) {
    // A failed download comes back as a Blob, so the server's reason has to be read out of it.
    const blob = (e as { response?: { data?: unknown } })?.response?.data
    if (blob instanceof Blob) { try { throw new Error(JSON.parse(await blob.text()).error) } catch (inner) { if (inner instanceof Error && inner.message) throw inner } }
    throw new Error(extractApiError(e, 'Could not download the attendance file.'))
  }
}

export async function warningsForStudent(studentId: string): Promise<AttendanceWarning[]> {
  const { data } = await api.get<{ id: string; student_id: string; mess_id: string; date: string; meal: MealType; issued_at: string; reason: string }[]>(
    `/attendance/warnings/${studentId}`
  )
  return data.map((w) => ({ id: w.id, studentId: w.student_id, messId: w.mess_id, date: w.date, meal: w.meal, issuedAt: w.issued_at, reason: w.reason }))
}

export async function finesForStudent(studentId: string): Promise<AttendanceFine[]> {
  const { data } = await api.get<
    { id: string; student_id: string; mess_id: string; amount: number; month: string; issued_at: string; warningIds: string[]; paid: boolean }[]
  >(`/attendance/fines/${studentId}`)
  return data.map((f) => ({ id: f.id, studentId: f.student_id, messId: f.mess_id, amount: f.amount, month: f.month, issuedAt: f.issued_at, warningIds: f.warningIds, paid: f.paid }))
}

export interface MessFineRow extends AttendanceFine {
  studentName: string
}

/** Mess-wide outstanding fines — for staff to review and mark as paid once collected. */
export async function finesForMess(messId: string, paid?: boolean): Promise<MessFineRow[]> {
  const { data } = await api.get<
    { id: string; student_id: string; mess_id: string; amount: number; month: string; issued_at: string; warningIds: string[]; paid: boolean; student_name: string }[]
  >('/attendance/fines', { params: { messId, ...(paid === undefined ? {} : { paid }) } })
  return data.map((f) => ({ id: f.id, studentId: f.student_id, messId: f.mess_id, amount: f.amount, month: f.month, issuedAt: f.issued_at, warningIds: f.warningIds, paid: f.paid, studentName: f.student_name }))
}

export function monthWarningCount(warnings: AttendanceWarning[], month: string): number {
  return warnings.filter((w) => w.date.slice(0, 7) === month).length
}

export async function markFinePaid(fineId: string): Promise<boolean> {
  try {
    const { data } = await api.post<{ success: boolean }>(`/attendance/fines/${fineId}/pay`)
    return data.success
  } catch (e) {
    throw new Error(extractApiError(e, 'Could not mark that fine as paid.'))
  }
}

/** Live numbers for one meal at one mess: who has been checked in, and how that compares with who said they'd eat. */
export interface AttendanceSummary { checkedIn: number; manual: number; eligible: number; willEat: number; willNot: number; noResponse: number }
export async function getAttendanceSummary(messId: string, date: string, meal: MealType): Promise<AttendanceSummary> {
  try {
    const { data } = await api.get<AttendanceSummary>('/attendance/summary', { params: { messId, date, meal } })
    return data
  } catch (e) {
    throw new Error(extractApiError(e, 'Could not load the live count.'))
  }
}

/** Refused-scan and unusual-volume alerts for the manager (forged QR, wrong mess, revoked card, one counter scanning far too fast). */
export interface ScanAlert { id: string; at: string; action: 'checkin_refused' | 'checkin_spike'; actorName: string; summary: string }
export async function getScanAlerts(messId: string, limit = 10): Promise<ScanAlert[]> {
  try {
    const { data } = await api.get<ScanAlert[]>('/attendance/alerts', { params: { messId, limit } })
    return data
  } catch (e) {
    throw new Error(extractApiError(e, 'Could not load the scan alerts.'))
  }
}

export interface NotificationPrefs { checkinEmail: boolean; mealReminder: boolean }
export async function getNotificationPrefs(): Promise<NotificationPrefs> {
  try {
    const { data } = await api.get<NotificationPrefs>('/attendance/my-notifications')
    return { checkinEmail: !!data.checkinEmail, mealReminder: data.mealReminder !== false }
  } catch (e) {
    throw new Error(extractApiError(e, 'Could not load your notification setting.'))
  }
}
async function putPrefs(body: Partial<NotificationPrefs>): Promise<NotificationPrefs> {
  try {
    const { data } = await api.put<NotificationPrefs>('/attendance/my-notifications', body)
    return { checkinEmail: !!data.checkinEmail, mealReminder: data.mealReminder !== false }
  } catch (e) {
    throw new Error(extractApiError(e, 'Could not save your notification setting.'))
  }
}
export async function getCheckinEmailPref(): Promise<boolean> { return (await getNotificationPrefs()).checkinEmail }
export async function setCheckinEmailPref(on: boolean): Promise<boolean> { return (await putPrefs({ checkinEmail: on })).checkinEmail }
export async function getMealReminderPref(): Promise<boolean> { return (await getNotificationPrefs()).mealReminder }
export async function setMealReminderPref(on: boolean): Promise<boolean> { return (await putPrefs({ mealReminder: on })).mealReminder }

export interface DailySummary {
  messId: string; date: string; activeStudents: number; totalCheckedIn: number; responseRate: number; noShowWarnings: number
  meals: { meal: MealType; willEat: number; checkedIn: number }[]
  waste: { entries: number; preparedKg: number; wasteKg: number; wastePct: number }
  feedback: { count: number; avgRating: number | null }
  openComplaints: number; lowStockItems: number
  message: { title: string; body: string; lines: string[] }
}
export async function getDailySummary(messId: string): Promise<DailySummary> {
  try { return (await api.get<DailySummary>('/attendance/daily-summary', { params: { messId } })).data }
  catch (e) { throw new Error(extractApiError(e, 'Could not load today\'s summary.')) }
}
