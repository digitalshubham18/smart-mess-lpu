import { HOSTELS, addHostel, type AddHostelInput } from '@/data/mockHostels'
import { STUDENTS } from '@/data/mockStudents'
import { createMessForHostel } from '@/data/mockMesses'
import { addAdminForHostel } from '@/data/mockUsers'
import { ensureOperationsForMess } from '@/data/mockOperations'
import { ensureInventoryForMess } from './inventoryService'
import { ensureExpensesForMess } from './financeService'
import { ensureSettingsForMess } from './messSettingsService'
import { regenerateWasteDetailForMess } from '@/data/mockWasteDetail'
import { logEvent } from './auditService'
import { api, withDelay } from './api'
import type { Hostel, Mess, User } from '@/types'

/**
 * The hostel/mess *topology* (which hostels exist, their names/categories) still lives
 * in the frontend — it's structural config the whole app's routing/scoping depends on.
 * The *student count* shown per hostel, though, comes from the real backend's actual
 * roster (falls back to 0 per hostel if the server isn't running).
 */
export async function listHostels() {
  try {
    const { data } = await api.get<{ id: string; students: number; capacity: number; roomCapacity: number | null }[]>('/hostels')
    const byId = new Map(data.map((h) => [h.id, h]))
    // The server's capacity is the one actually enforced, so it wins over the frontend's static config.
    return withDelay(HOSTELS.map((h) => ({ ...h, capacity: byId.get(h.id)?.capacity ?? h.capacity, students: byId.get(h.id)?.students ?? 0, roomCapacity: byId.get(h.id)?.roomCapacity ?? null as number | null })), 200)
  } catch {
    // Real API not reachable — fall back to the frontend's own synthetic student count.
    return withDelay(HOSTELS.map((h) => ({ ...h, students: STUDENTS.filter((s) => s.hostelId === h.id).length, roomCapacity: null as number | null })), 200)
  }
}

export function hostelName(id: string): string {
  return HOSTELS.find((h) => h.id === id)?.name ?? id
}

export interface CreateHostelInput extends AddHostelInput {
  adminName: string
  adminEmail?: string
}

export interface CreateHostelResult {
  hostel: Hostel
  mess: Mess
  admin: User
}

/**
 * Onboarding flow for a brand-new hostel — used by the Super Admin's "Add Hostel"
 * action on the Hostels page. Creates the hostel, its dedicated 1:1 mess, and backfills
 * a full 90-day operations/inventory/expense history so the mess behaves normally from
 * day one, even before it has any students. Also mirrors the hostel/mess into the real
 * backend's database, so real students can actually be enrolled/registered against it
 * (silently skipped if the server isn't running — the frontend topology still works).
 *
 * The hostel starts with an EMPTY roster — real students are added one at a time from
 * the Students page (no synthetic/demo students are generated here). It also creates
 * ONLY the new mess's Admin account; that Admin then signs in and builds out their own
 * team (Mess Manager, Kitchen Staff, Finance Manager, Hostel Warden) from the Staff
 * page — staffing a new mess is that mess's Admin's own responsibility.
 */
export async function createHostel(input: CreateHostelInput, actor?: User | null): Promise<CreateHostelResult> {
  if (!input.adminName?.trim()) {
    await withDelay(null, 300)
    throw new Error("Enter the new Mess Admin's name — every account here belongs to a real person, never a placeholder.")
  }

  // The frontend assigns the hostel its ID/name/capacity (topology config), but the
  // real database is now the authoritative check for "does this hostel actually exist"
  // — if the backend rejects it (or is unreachable), nothing is created anywhere,
  // rather than leaving the frontend topology and the real database disagreeing.
  const hostel = addHostel({ ...input, occupancy: 0 })
  try {
    await api.post('/hostels', { id: hostel.id, name: hostel.name, category: hostel.category, capacity: hostel.capacity })
  } catch (e) {
    const idx = HOSTELS.findIndex((h) => h.id === hostel.id)
    if (idx !== -1) HOSTELS.splice(idx, 1) // roll back the frontend-side creation too
    const err = e as { response?: { data?: { error?: string } } }
    throw new Error(err?.response?.data?.error ?? "Could not reach the real API server — is it running (cd server && npm start)? The hostel wasn't created.")
  }

  const mess = createMessForHostel(hostel.id)
  const admin = addAdminForHostel(hostel.id, input.adminName, input.adminEmail)

  ensureOperationsForMess(mess.id)
  ensureInventoryForMess(mess.id)
  ensureExpensesForMess(mess.id)
  ensureSettingsForMess(mess.id)
  regenerateWasteDetailForMess(mess.id)

  logEvent(actor, 'hostel_created', `Created ${hostel.name} and its mess "${mess.name}", with ${admin.name} as Admin`, mess.id)

  const { password: _pw, ...adminUser } = admin
  return withDelay({ hostel, mess, admin: adminUser }, 500)
}

/**
 * Sets how many students may share one room in a hostel (null = no limit). The server refuses
 * if any room already holds more than that, and rejects anyone but that hostel's Admin / the
 * Super Admin. Throws the server's reason.
 */
export async function setRoomCapacity(hostelId: string, roomCapacity: number | null): Promise<void> {
  try {
    await api.patch(`/hostels/${encodeURIComponent(hostelId)}`, { roomCapacity })
  } catch (e) {
    const err = e as { response?: { data?: { error?: string } } }
    throw new Error(err.response?.data?.error ?? 'Could not update the room limit — is the API server running?')
  }
}
