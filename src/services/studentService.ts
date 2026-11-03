import type { Student, User } from '@/types'
import { api } from './api'

/**
 * Talks to the real backend in /server (Express + SQLite) — every function here is a
 * genuine HTTP request, not an in-memory array read. Run the server (`cd server && npm
 * start`) for these to work; see the README's "Real Backend" section.
 */

function extractApiError(e: unknown, fallback: string): string {
  const err = e as { response?: { data?: { error?: string } } }
  return err?.response?.data?.error ?? fallback
}

export async function listStudents(hostelId?: string): Promise<Student[]> {
  const { data } = await api.get<Student[]>('/students', { params: hostelId ? { hostelId } : undefined })
  return data
}

/**
 * Adds a student to the mess roster. Pass `uid` and the server fills name/email/phone/branch/year in from the
 * university's record (whatever else is sent for those is ignored for name and email); without `uid` it is manual
 * entry and a UID is assigned.
 */
export async function addStudent(input: Omit<Student, 'id' | 'points' | 'badges' | 'missedCutoffCount'> & { uid?: string; noUid?: boolean; noUidReason?: string }): Promise<Student> {
  try {
    const { data } = await api.post<Student>('/students', input)
    return data
  } catch (e) {
    throw new Error(extractApiError(e, 'Could not add the student — is the real API server running?'))
  }
}

export interface BulkImportResult {
  created: number
  /** Rows the server refused, with the CSV line number and the reason (invalid field, duplicate email, hostel full, out of scope…). */
  failed: { line: number; error: string; code?: string }[]
}

/**
 * Real bulk import: sends parsed CSV rows to POST /students/bulk. The server validates every row
 * independently (same rules as adding one student — role, mess scope, bed capacity, duplicate
 * email) and answers with exactly which lines failed and why. Large files are sent in
 * batches of 500 so one request never nears the server's 1000-row / body-size limits.
 */
export async function importStudents(rows: { line: number; data: Record<string, unknown> }[]): Promise<BulkImportResult> {
  const total: BulkImportResult = { created: 0, failed: [] }
  for (let i = 0; i < rows.length; i += 500) {
    try {
      const { data } = await api.post<BulkImportResult>('/students/bulk', { rows: rows.slice(i, i + 500) })
      total.created += data.created
      total.failed.push(...data.failed)
    } catch (e) {
      const err = e as { response?: { status?: number; data?: Partial<BulkImportResult> & { error?: string } } }
      // 422 = every row in this batch was refused: the body still carries the per-row reasons.
      if (err.response?.status === 422 && Array.isArray(err.response.data?.failed)) {
        total.failed.push(...err.response.data.failed)
        continue
      }
      throw new Error(extractApiError(e, 'Import failed — is the real API server running?'))
    }
  }
  return total
}

export async function updateStudent(id: string, patch: Partial<Student> & { leaveUntil?: string | null }): Promise<Student | null> {
  try {
    const { data } = await api.patch<Student>(`/students/${id}`, patch)
    return data
  } catch {
    return null
  }
}

/** Same as updateStudent but throws the server's reason (hostel full, duplicate email, not allowed) instead of returning null. */
export async function updateStudentOrThrow(id: string, patch: Partial<Student> & { leaveUntil?: string | null }): Promise<Student> {
  try {
    const { data } = await api.patch<Student>(`/students/${id}`, patch)
    return data
  } catch (e) {
    throw new Error(extractApiError(e, 'Could not save the changes.'))
  }
}

export async function deleteStudent(id: string): Promise<boolean> {
  try {
    const { data } = await api.delete<{ success: boolean }>(`/students/${id}`)
    return data.success
  } catch {
    return false
  }
}

export async function getStudent(id: string): Promise<Student | null> {
  try {
    const { data } = await api.get<Student>(`/students/${id}`)
    return data
  } catch {
    return null
  }
}

/** Shown (here and by the server) to anyone whose UID isn't on a mess roster. */
export const NOT_ON_MESS_MESSAGE = "You haven't taken mess. For any query, visit the warden office."

/** What the university's records say about a UID — what the Add-student form fills itself in from. */
export type DirectoryLookup =
  | { kind: 'found'; uid: string; name: string; email: string; phone: string; branch: string; year: number }
  /** Already taken mess. `name`/`hostelId` are only present for staff of that mess. */
  | { kind: 'onMess'; uid: string; name?: string; hostelId?: string; outOfScope?: boolean }
  | { kind: 'unknown' }
  | { kind: 'error'; message: string }

export async function lookupDirectory(uid: string): Promise<DirectoryLookup> {
  try {
    const { data } = await api.get<
      { uid: string; name?: string; email?: string; phone?: string; branch?: string; year?: number; onMess: boolean; hostelId?: string; outOfScope?: boolean }
    >(`/students/directory/${encodeURIComponent(uid.trim())}`)
    if (data.onMess) return { kind: 'onMess', uid: data.uid, name: data.name, hostelId: data.hostelId, outOfScope: data.outOfScope }
    return { kind: 'found', uid: data.uid, name: data.name ?? '', email: data.email ?? '', phone: data.phone ?? '', branch: data.branch ?? '', year: data.year ?? 1 }
  } catch (e) {
    const err = e as { response?: { status?: number; data?: { code?: string; error?: string } } }
    if (err.response?.status === 404 && err.response.data?.code === 'UID_NOT_IN_RECORDS') return { kind: 'unknown' }
    return { kind: 'error', message: extractApiError(e, 'Could not look that UID up — is the API server running?') }
  }
}

export interface StudentLookup {
  /** Initials plus dots ("R•••• S••••"), never the real name — see the note on the server's lookup route. */
  maskedName: string
  /** "a••••@gmail.com" — where the sign-up code will be sent (the address on file, not one the student types). */
  maskedEmail: string
  hostelName: string
  messId: string
  messName: string
  /** True if this UID already has a login account — used to block double sign-up. */
  alreadyRegistered: boolean
}

/**
 * Looks up a student by their UID on the real, already-enrolled roster (a real GET
 * request to the backend — unauthenticated, since a student needs this before they
 * have a token). Used by the Register page to auto-fetch a student's actual hostel
 * and mess before they set a password.
 */
export async function findByUid(uid: string): Promise<StudentLookup | null> {
  const trimmed = uid.trim()
  if (!trimmed) return null
  try {
    const { data } = await api.get<StudentLookup | null>(`/students/lookup/${encodeURIComponent(trimmed)}`)
    return data
  } catch (e) {
    // null means "not on the mess" — a dead server must not be reported as that.
    throw new Error(extractApiError(e, 'Could not check your UID — is the API server running?'))
  }
}

/** Moves a student to a different hostel/mess (room change, hostel swap, etc). Super Admin only. */
export async function transferStudent(id: string, newHostelId: string, _reason: string, _actor?: User | null, newRoom?: string): Promise<Student> {
  try {
    const { data } = await api.post<Student>(`/students/${id}/transfer`, { hostelId: newHostelId, room: newRoom })
    return data
  } catch (e) {
    // e.g. "BH1 is at full capacity (112/112 beds)" — the caller shows this to the person.
    throw new Error(extractApiError(e, 'Could not transfer the student.'))
  }
}

/** Sets or clears a student's "on leave" period (inclusive end date, or null to clear). */
export async function setLeave(id: string, leaveUntil: string | null): Promise<Student | null> {
  return updateStudent(id, { leaveUntil: leaveUntil ?? undefined })
}

/** A student added with a temporary ID finally has a real UID: the server swaps it everywhere (check-ins, fines, history follow them). */
export async function assignUid(tempId: string, uid: string): Promise<Student> {
  try {
    const { data } = await api.post<Student>(`/students/${encodeURIComponent(tempId)}/assign-uid`, { uid })
    return data
  } catch (e) {
    throw new Error(extractApiError(e, 'Could not assign the UID.'))
  }
}

/** Sets the student's official photo (JPEG/PNG/WebP data URL). Only the staff who run the roster can; the student cannot change their own. */
export async function uploadStudentPhoto(id: string, dataUrl: string, consent = false): Promise<void> {
  try {
    await api.post(`/students/${encodeURIComponent(id)}/photo`, { dataUrl, ...(consent ? { consent: true } : {}) })
  } catch (e) {
    throw new Error(extractApiError(e, 'Could not save the photo.'))
  }
}

export async function removeStudentPhoto(id: string): Promise<void> {
  try {
    await api.delete(`/students/${encodeURIComponent(id)}/photo`)
  } catch (e) {
    throw new Error(extractApiError(e, 'Could not remove the photo.'))
  }
}

/** A permanent, printable meal QR for a student with no phone login (or a lost phone). `reissue` replaces the card: the old one stops working at once. */
export interface IdCard { token: string; studentId: string; name: string; hostelName: string; room: string; provisional: boolean; hasPhoto: boolean; reissued: boolean }
export async function getIdCard(id: string, reissue = false): Promise<IdCard> {
  try {
    const { data } = await api.post<IdCard>(`/students/${encodeURIComponent(id)}/id-card`, { reissue })
    return data
  } catch (e) {
    throw new Error(extractApiError(e, 'Could not create the ID card.'))
  }
}

// --- Photo privacy (DPDP): the notice, the student's own consent, and withdrawing it -------------------------------------
export interface PhotoNotice { version: string; title: string; points: { heading: string; text: string }[] }
export async function getPhotoNotice(): Promise<PhotoNotice> {
  try { return (await api.get<PhotoNotice>('/students/photo-notice')).data }
  catch (e) { throw new Error(extractApiError(e, 'Could not load the privacy notice.')) }
}
export interface MyPrivacy { photoOnFile: boolean; consentGiven: boolean; consentAt: string | null; consentMethod: 'student_app' | 'staff_attested' | null; consentNoticeVersion: string | null; currentNoticeVersion: string }
export async function getMyPrivacy(): Promise<MyPrivacy> {
  try { return (await api.get<MyPrivacy>('/students/me/privacy')).data }
  catch (e) { throw new Error(extractApiError(e, 'Could not load your privacy settings.')) }
}
export async function givePhotoConsent(): Promise<MyPrivacy> {
  try { return (await api.post<MyPrivacy>('/students/me/photo-consent', {})).data }
  catch (e) { throw new Error(extractApiError(e, 'Could not record your consent.')) }
}
/** Deletes the photo and the consent record, immediately. */
export async function withdrawPhotoConsent(): Promise<MyPrivacy> {
  try { return (await api.delete<MyPrivacy>('/students/me/photo-consent')).data }
  catch (e) { throw new Error(extractApiError(e, 'Could not withdraw your consent.')) }
}
