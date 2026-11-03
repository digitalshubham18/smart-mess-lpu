import type { Mess } from '@/types'
import { HOSTELS } from './mockHostels'
import { STUDENTS } from './mockStudents'

// `MESSES` is the live, mutable source of truth for every mess at the university.
// Other modules import this array directly (a live ES-module binding) so that
// adding/editing/deleting a mess here is immediately visible everywhere else
// (mockOperations, mockInventory, analytics, pages, etc).
//
// Every mess at LPU is hostel-based: one hostel, one mess, one dedicated team
// (Admin, Mess Manager, Kitchen Staff, Finance Manager, Hostel Warden) — see
// mockUsers.ts. A mess CAN still be widened to serve more than one hostel from
// the Messes page (Super Admin only), but the default, and the recommended
// setup, is a 1:1 hostel-to-mess mapping.
function messNameForHostel(hostel: { id: string; category: string }): string {
  if (hostel.category === 'general') return `Central Mess ${hostel.id.replace(/\D/g, '')}`
  return `${hostel.id} Mess`
}

function seedMesses(): Mess[] {
  return HOSTELS.map((h) => ({
    id: `MESS-${h.id}`,
    name: messNameForHostel(h),
    hostelIds: [h.id],
    seatingCapacity: Math.round(h.capacity * 0.6),
    location: `${h.category === 'boys' ? 'Boys' : h.category === 'girls' ? 'Girls' : 'General'} Hostel Block, Ground Floor`,
  }))
}

export const MESSES: Mess[] = seedMesses()

export function messForHostel(hostelId: string): Mess | undefined {
  return MESSES.find((m) => m.hostelIds.includes(hostelId))
}

export function messIdForHostel(hostelId: string): string {
  return messForHostel(hostelId)?.id ?? MESSES[0].id
}

export function hostelsForMess(messId: string) {
  const mess = MESSES.find((m) => m.id === messId)
  return HOSTELS.filter((h) => mess?.hostelIds.includes(h.id))
}

export function totalStudentsForMess(messId: string): number {
  // Live headcount, not a static seed number — reflects real students as they're
  // added or removed, for the initial 20 hostels and any onboarded afterwards.
  const hostelIds = hostelsForMess(messId).map((h) => h.id)
  return STUDENTS.filter((s) => hostelIds.includes(s.hostelId)).length
}

export function messName(messId: string): string {
  return MESSES.find((m) => m.id === messId)?.name ?? messId
}

export function unassignedHostels(): typeof HOSTELS {
  return HOSTELS.filter((h) => !messForHostel(h.id))
}

// --- Mutations (in-memory "database") -------------------------------------

export interface MessMutationResult {
  mess: Mess
  /** Every mess whose hostel roster changed as a side effect — including the mess itself. */
  affectedMessIds: string[]
}

export function createMess(input: { name: string; hostelIds: string[]; seatingCapacity: number; location: string }): MessMutationResult {
  // A hostel can only belong to one mess — pull it out of wherever it currently is.
  const affected = new Set<string>()
  input.hostelIds.forEach((hid) => {
    const prev = messForHostel(hid)
    if (prev) {
      prev.hostelIds = prev.hostelIds.filter((h) => h !== hid)
      affected.add(prev.id)
    }
  })
  const mess: Mess = {
    id: `M${Date.now()}`,
    name: input.name,
    hostelIds: [...input.hostelIds],
    seatingCapacity: input.seatingCapacity,
    location: input.location,
  }
  MESSES.push(mess)
  affected.add(mess.id)
  return { mess, affectedMessIds: [...affected] }
}

/** Creates the dedicated 1:1 mess for a newly onboarded hostel. Used by hostelService.createHostel. */
export function createMessForHostel(hostelId: string): Mess {
  const hostel = HOSTELS.find((h) => h.id === hostelId)
  const mess: Mess = {
    id: `MESS-${hostelId}`,
    name: hostel ? messNameForHostel(hostel) : `${hostelId} Mess`,
    hostelIds: [hostelId],
    seatingCapacity: Math.round((hostel?.capacity ?? 112) * 0.6),
    location: `${hostel?.category === 'boys' ? 'Boys' : hostel?.category === 'girls' ? 'Girls' : 'General'} Hostel Block, Ground Floor`,
  }
  MESSES.push(mess)
  return mess
}

export function updateMess(id: string, patch: Partial<Omit<Mess, 'id'>>): MessMutationResult | null {
  const mess = MESSES.find((m) => m.id === id)
  if (!mess) return null
  const affected = new Set<string>()
  if (patch.hostelIds) {
    const hostelsChanged = patch.hostelIds.length !== mess.hostelIds.length || patch.hostelIds.some((h) => !mess.hostelIds.includes(h))
    if (hostelsChanged) affected.add(id)
    patch.hostelIds.forEach((hid) => {
      const prev = messForHostel(hid)
      if (prev && prev.id !== id) {
        prev.hostelIds = prev.hostelIds.filter((h) => h !== hid)
        affected.add(prev.id)
      }
    })
  }
  Object.assign(mess, patch)
  return { mess, affectedMessIds: [...affected] }
}

export function deleteMess(id: string): boolean {
  const idx = MESSES.findIndex((m) => m.id === id)
  if (idx === -1 || MESSES.length <= 1) return false // never leave the university with zero messes
  MESSES.splice(idx, 1)
  return true
}
