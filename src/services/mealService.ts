import type { MealIntention, MealType, Menu, MealChangeRequest, ChangeRequestStatus, User } from '@/types'
import { OPERATIONS, MEAL_TYPES, recordsForDate } from '@/data/mockOperations'
import { buildMenuForDate, ITEMS_BY_ID, MENU_ITEMS } from '@/data/mockMenus'
import { STUDENTS } from '@/data/mockStudents'
import { messIdForHostel } from '@/data/mockMesses'
import { logEvent } from './auditService'
import { pick, rnd } from '@/lib/rng'
import { api, withDelay } from './api'
import { notifyStudent } from './notificationService'
import { useChangeRequestsStore } from '@/store/useChangeRequestsStore'

export { MEAL_TYPES }

// In-memory intentions store, seeded so the dashboard has something to show immediately.
const intentions = new Map<string, MealIntention>()

function keyFor(studentId: string, date: string, meal: MealType) {
  return `${studentId}|${date}|${meal}`
}

// Seed intentions for tomorrow across the sample student list so forecasts
// have confirmations to draw on, matching the numbers pinned in mockOperations.
;(function seedIntentions() {
  const tomorrow = OPERATIONS.find((r) => r.isFuture)?.date
  if (!tomorrow) return
  STUDENTS.forEach((s) => {
    ;(['breakfast', 'lunch', 'snacks', 'dinner'] as MealType[]).forEach((meal) => {
      const status = pick(['will_eat', 'will_eat', 'will_eat', 'will_not', 'unconfirmed'] as const)
      intentions.set(keyFor(s.id, tomorrow, meal), {
        id: keyFor(s.id, tomorrow, meal),
        studentId: s.id,
        date: tomorrow,
        meal,
        status,
        submittedAt: status === 'unconfirmed' ? undefined : new Date().toISOString(),
      })
    })
  })

  // Give the featured demo account (S-1000) a mix of confirmed / unconfirmed
  // meals so both the "mark & lock" and "forgot to mark" flows are visible immediately.
  const demoMix: Record<MealType, MealIntention['status']> = { breakfast: 'unconfirmed', lunch: 'will_eat', snacks: 'unconfirmed', dinner: 'will_not' }
  ;(Object.keys(demoMix) as MealType[]).forEach((meal) => {
    const status = demoMix[meal]
    intentions.set(keyFor('S-1000', tomorrow, meal), {
      id: keyFor('S-1000', tomorrow, meal),
      studentId: 'S-1000',
      date: tomorrow,
      meal,
      status,
      submittedAt: status === 'unconfirmed' ? undefined : new Date().toISOString(),
    })
  })
})()

function isOnLeave(studentId: string, date: string): boolean {
  const student = STUDENTS.find((s) => s.id === studentId)
  return !!student?.leaveUntil && student.leaveUntil >= date
}

export async function getIntention(studentId: string, date: string, meal: MealType): Promise<MealIntention | null> {
  if (isOnLeave(studentId, date)) {
    return withDelay({ id: keyFor(studentId, date, meal), studentId, date, meal, status: 'will_not' }, 150)
  }
  return withDelay(intentions.get(keyFor(studentId, date, meal)) ?? null, 150)
}

/**
 * Writes "will eat / will not eat" to the SERVER. That record — not anything the browser sends
 * later — is what no-show warnings and fines are computed from, and the server enforces the
 * 2:00 AM cutoff and who may write it. Throws the server's reason if it refuses.
 * A 404 (a demo-only student who isn't on the real roster) is not an error.
 */
async function syncIntentionToServer(studentId: string, date: string, meal: MealType, status: MealIntention['status']) {
  try {
    await api.put(`/intentions/${encodeURIComponent(studentId)}`, { date, meal, status })
  } catch (e) {
    const err = e as { response?: { status?: number; data?: { error?: string } } }
    if (err.response?.status === 404) return
    throw new Error(err.response?.data?.error ?? 'Could not save your choice — is the API server running?')
  }
}

export async function setIntention(studentId: string, date: string, meal: MealType, status: MealIntention['status']): Promise<MealIntention> {
  await syncIntentionToServer(studentId, date, meal, status) // refused (cutoff, scope)? → throws before local state changes
  const record: MealIntention = { id: keyFor(studentId, date, meal), studentId, date, meal, status, submittedAt: new Date().toISOString() }
  intentions.set(keyFor(studentId, date, meal), record)
  return record
}

export async function intentionSummary(messId: string, date: string, meal: MealType) {
  let will_eat = 0, will_not = 0, unconfirmed = 0
  const messStudents = STUDENTS.filter((s) => messIdForHostel(s.hostelId) === messId)
  messStudents.forEach((s) => {
    const status = isOnLeave(s.id, date) ? 'will_not' : intentions.get(keyFor(s.id, date, meal))?.status ?? 'unconfirmed'
    if (status === 'will_eat') will_eat++
    else if (status === 'will_not') will_not++
    else unconfirmed++
  })
  return withDelay({ will_eat, will_not, unconfirmed, total: messStudents.length }, 200)
}

/**
 * UIDs of every student in this mess who intended to eat this meal — used by the real
 * attendance backend (attendanceService.processNoShows) to know who to check for a
 * no-show, since intentions themselves live here in the frontend's demo system, not in
 * the real database.
 */
export function studentsWhoIntendedToEat(messId: string, date: string, meal: MealType): string[] {
  return STUDENTS.filter((s) => messIdForHostel(s.hostelId) === messId)
    .filter((s) => !isOnLeave(s.id, date) && intentions.get(keyFor(s.id, date, meal))?.status === 'will_eat')
    .map((s) => s.id)
}

/**
 * Meal-intention confirmations for a given day close at 2:00 AM on that same
 * day — students effectively have until the early hours of the meal day
 * itself to mark their intention. Computed as an absolute timestamp so it
 * behaves correctly regardless of which meal or what the current time is.
 */
export function confirmationCutoff(dateISO: string): Date {
  return new Date(`${dateISO}T02:00:00`)
}

export function isConfirmationClosed(dateISO: string): boolean {
  return new Date() >= confirmationCutoff(dateISO)
}

// ---------------------------------------------------------------------------
// Late-correction requests: if a student missed the 2 AM cutoff (or already
// locked in a choice and needs to change it), they can raise a request here.
// A higher authority (mess admin / manager) reviews and approves or rejects
// it; approval applies the requested status via setIntention.
// ---------------------------------------------------------------------------
const changeRequests: MealChangeRequest[] = []
let crSeq = 1

;(function seedChangeRequests() {
  const tomorrow = OPERATIONS.find((r) => r.isFuture)?.date
  if (!tomorrow) return
  const sample = STUDENTS.slice(1, 3)
  sample.forEach((s, i) => {
    const meal: MealType = i === 0 ? 'breakfast' : 'dinner'
    changeRequests.push({
      id: `CR-${crSeq++}`,
      messId: messIdForHostel(s.hostelId),
      studentId: s.id,
      studentName: s.name,
      date: tomorrow,
      meal,
      previousStatus: 'unconfirmed',
      requestedStatus: 'will_eat',
      reason: 'Forgot to mark before the cutoff — please add me for this meal.',
      status: 'pending',
      createdAt: new Date().toISOString(),
    })
  })
  syncPendingCount()
})()

function syncPendingCount() {
  useChangeRequestsStore.getState().setPendingCount(pendingChangeRequestCount())
}

const STATUS_LABEL: Record<'will_eat' | 'will_not', string> = {
  will_eat: 'Going', will_not: "Won't eat",
}

export async function submitChangeRequest(input: {
  studentId: string
  studentName: string
  date: string
  meal: MealType
  requestedStatus: 'will_eat' | 'will_not'
  reason: string
}): Promise<MealChangeRequest> {
  const previous = intentions.get(keyFor(input.studentId, input.date, input.meal))
  const student = STUDENTS.find((s) => s.id === input.studentId)
  const record: MealChangeRequest = {
    id: `CR-${crSeq++}`,
    messId: student ? messIdForHostel(student.hostelId) : '',
    studentId: input.studentId,
    studentName: input.studentName,
    date: input.date,
    meal: input.meal,
    previousStatus: previous?.status ?? 'unconfirmed',
    requestedStatus: input.requestedStatus,
    reason: input.reason,
    status: 'pending',
    createdAt: new Date().toISOString(),
  }
  changeRequests.unshift(record)
  syncPendingCount()
  return withDelay(record, 350)
}

export async function listChangeRequests(messId?: string): Promise<MealChangeRequest[]> {
  const filtered = messId ? changeRequests.filter((r) => r.messId === messId) : changeRequests
  return withDelay([...filtered], 200)
}

export async function listChangeRequestsForStudent(studentId: string): Promise<MealChangeRequest[]> {
  return withDelay(changeRequests.filter((r) => r.studentId === studentId), 150)
}

export async function resolveChangeRequest(id: string, decision: 'approved' | 'rejected', resolverName: string, actor?: User | null): Promise<MealChangeRequest | null> {
  const req = changeRequests.find((r) => r.id === id)
  if (!req) return withDelay(null, 200)
  req.status = decision
  req.resolvedBy = resolverName
  req.resolvedAt = new Date().toISOString()
  if (decision === 'approved') {
    try {
      await setIntention(req.studentId, req.date, req.meal, req.requestedStatus)
    } catch {
      // The request itself is demo data; if the server won't take the override (e.g. the student isn't in this
      // staff member's mess) the local record is still updated so the demo UI stays consistent.
      const rec: MealIntention = { id: keyFor(req.studentId, req.date, req.meal), studentId: req.studentId, date: req.date, meal: req.meal, status: req.requestedStatus, submittedAt: new Date().toISOString() }
      intentions.set(keyFor(req.studentId, req.date, req.meal), rec)
    }
    notifyStudent(
      req.studentId,
      'Meal request approved',
      `Your request for ${req.meal} on ${req.date} was approved by ${resolverName} — you're now marked as "${STATUS_LABEL[req.requestedStatus]}".`
    )
  } else {
    notifyStudent(
      req.studentId,
      'Meal request rejected',
      `Your request for ${req.meal} on ${req.date} was rejected by ${resolverName}. Your original status was kept.`
    )
  }
  logEvent(actor, 'change_request_resolved', `${decision === 'approved' ? 'Approved' : 'Rejected'} ${req.studentName}'s ${req.meal} change request for ${req.date}`, req.messId)
  syncPendingCount()
  return withDelay(req, 350)
}

export async function cancelChangeRequest(id: string, studentId: string): Promise<boolean> {
  const req = changeRequests.find((r) => r.id === id && r.studentId === studentId && r.status === 'pending')
  if (!req) return withDelay(false, 200)
  req.status = 'cancelled'
  req.resolvedBy = 'Cancelled by student'
  req.resolvedAt = new Date().toISOString()
  syncPendingCount()
  return withDelay(true, 250)
}

export function pendingChangeRequestCount(): number {
  return changeRequests.filter((r) => r.status === 'pending').length
}

/** How many times each student has ever raised a "forgot to mark" request — feeds the warden repeat-offender view. */
export function lateMarkRequestCounts(): Record<string, number> {
  const counts: Record<string, number> = {}
  changeRequests.forEach((r) => {
    if (r.previousStatus === 'unconfirmed') counts[r.studentId] = (counts[r.studentId] ?? 0) + 1
  })
  return counts
}

const menuOverrides = new Map<string, string[]>()

function overrideKey(date: string, meal: MealType) {
  return `${date}|${meal}`
}

export async function getMenu(date: string, meal: MealType): Promise<Menu> {
  const override = menuOverrides.get(overrideKey(date, meal))
  const base = buildMenuForDate(date, meal)
  return withDelay(override ? { ...base, itemIds: override, isSpecial: true } : base, 150)
}

export async function setMenuItems(date: string, meal: MealType, itemIds: string[], label?: string): Promise<Menu> {
  menuOverrides.set(overrideKey(date, meal), itemIds)
  const menu: Menu = { id: `MENU-${date}-${meal}`, date, meal, itemIds, isSpecial: true, label }
  return withDelay(menu, 250)
}

export async function duplicateWeek(sourceStartDate: string, targetStartDate: string): Promise<void> {
  for (let i = 0; i < 7; i++) {
    const src = addDaysISOLocal(sourceStartDate, i)
    const tgt = addDaysISOLocal(targetStartDate, i)
    for (const mt of ['breakfast', 'lunch', 'snacks', 'dinner'] as MealType[]) {
      const menu = await getMenu(src, mt)
      menuOverrides.set(overrideKey(tgt, mt), menu.itemIds)
    }
  }
  return withDelay(undefined, 400)
}

function addDaysISOLocal(dateISO: string, days: number): string {
  const d = new Date(dateISO)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export async function getMenuItems(menu: Menu) {
  return withDelay(menu.itemIds.map((id) => ITEMS_BY_ID[id]).filter(Boolean), 100)
}

export async function getTodayOverview(messId: string, date: string) {
  return withDelay(recordsForDate(messId, date), 200)
}

export function allMenuItems() {
  return MENU_ITEMS
}

export async function rateMenuHint(): Promise<string> {
  return withDelay(pick(['Great choice!', 'Thanks for rating.', 'Feedback recorded.']), 100)
}

export { rnd as _rnd }
