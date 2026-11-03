import type { User } from '@/types'
import type { StaffRole } from '@/data/mockUsers'
import { api } from './api'

/**
 * Real staff accounts — every function here calls the backend in /server (bcrypt +
 * JWT, same as students). Staffing a mess (Mess Manager, Kitchen Staff, Finance
 * Manager, Hostel Warden) is that mess's own Admin's responsibility; only the Super
 * Admin creates a new mess's Admin account (still done via the frontend's hostel
 * onboarding flow — see hostelService.createHostel).
 */

function extractApiError(e: unknown, fallback: string): string {
  const err = e as { response?: { data?: { error?: string } } }
  return err?.response?.data?.error ?? fallback
}

/** Lists every staff account (Admin included) scoped to one hostel/mess. */
export async function listStaffForHostel(hostelId: string): Promise<User[]> {
  const { data } = await api.get<User[]>('/staff', { params: { hostelId } })
  return data
}

/** A newly created account, with the one-time temporary password the server generated (it only stores a hash). */
export type WithTempPassword = User & { tempPassword?: string; emailSent?: boolean }

export async function createStaffMember(input: { hostelId: string; role: StaffRole; name: string; email?: string; phone?: string }): Promise<WithTempPassword> {
  try {
    const { data } = await api.post<WithTempPassword>('/staff', input)
    return data
  } catch (e) {
    throw new Error(extractApiError(e, 'Could not add the staff member — is the real API server running?'))
  }
}

export async function deleteStaffMember(id: string): Promise<boolean> {
  try {
    const { data } = await api.delete<{ success: boolean }>(`/staff/${id}`)
    return data.success
  } catch (e) {
    throw new Error(extractApiError(e, 'Could not remove that staff member.'))
  }
}

/** Creates (or fetches, if one already exists) a read-only Parent/Guardian account for a student. */
export async function grantParentAccess(studentId: string): Promise<WithTempPassword> {
  try {
    const { data } = await api.post<WithTempPassword>(`/staff/parent-access/${studentId}`)
    return data // tempPassword is present only when the account was just created
  } catch (e) {
    throw new Error(extractApiError(e, 'Could not generate parent access.'))
  }
}

/** Issues a NEW temporary password (old one stops working, sessions are revoked). For team members and parent accounts. */
export async function resetStaffPassword(id: string): Promise<{ id: string; tempPassword: string; emailSent?: boolean }> {
  try {
    const { data } = await api.post<{ id: string; tempPassword: string; emailSent?: boolean }>(`/staff/${id}/reset-password`)
    return data
  } catch (e) {
    throw new Error(extractApiError(e, 'Could not reset that password.'))
  }
}

/** Lost authenticator: clears two-factor so the person must set it up again at their next sign-in (and ends their sessions). */
export async function resetStaffTwoFactor(id: string): Promise<void> {
  try { await api.post(`/staff/${id}/reset-2fa`, {}) }
  catch (e) { throw new Error(extractApiError(e, 'Could not reset two-factor for that account.')) }
}

/** Uploads (or replaces) a staff member's own photo — unlike a student's official photo, this one is editable. */
export async function uploadStaffPhoto(id: string, dataUrl: string): Promise<void> {
  try {
    await api.post(`/staff/${id}/photo`, { dataUrl })
  } catch (e) {
    throw new Error(extractApiError(e, 'Could not upload that photo — try a smaller image.'))
  }
}

export async function removeStaffPhoto(id: string): Promise<void> {
  await api.delete(`/staff/${id}/photo`)
}
