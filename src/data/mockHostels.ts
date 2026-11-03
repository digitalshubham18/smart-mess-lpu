import type { Hostel } from '@/types'

// Lovely Professional University — 10 boys' hostels + 10 girls' hostels, seeded at
// ~100 occupied beds each (capacity slightly above occupancy, like a real campus).
// `HOSTELS` is the live, mutable source of truth: everything else (messes, students,
// staff, operations, inventory…) is generated FROM this array, so adding a hostel
// here (via `addHostel`) is all it takes to bring a brand-new hostel + its own mess
// online with a full 100-student roster and staff team — see hostelService.createHostel.
function seedHostels(): Hostel[] {
  const list: Hostel[] = []
  for (let i = 1; i <= 10; i++) {
    list.push({ id: `BH${i}`, name: `Boys Hostel ${i} (BH-${i})`, category: 'boys', capacity: 112, occupancy: 100 })
  }
  for (let i = 1; i <= 10; i++) {
    list.push({ id: `GH${i}`, name: `Girls Hostel ${i} (GH-${i})`, category: 'girls', capacity: 112, occupancy: 100 })
  }
  return list
}

export const HOSTELS: Hostel[] = seedHostels()

export function hostelName(id: string): string {
  return HOSTELS.find((h) => h.id === id)?.name ?? id
}

// --- Mutations (in-memory "database") --------------------------------------

/** Next available sequence number for a given hostel-id prefix, e.g. "BH" -> 11 after BH1..BH10. */
function nextSeq(prefix: 'BH' | 'GH' | 'NH'): number {
  const nums = HOSTELS.filter((h) => h.id.startsWith(prefix)).map((h) => Number(h.id.slice(prefix.length)) || 0)
  return (nums.length ? Math.max(...nums) : 0) + 1
}

export interface AddHostelInput {
  category: 'boys' | 'girls' | 'general'
  name?: string
  capacity?: number
  occupancy?: number
}

/** Adds a brand-new hostel to the university. Does NOT create its mess/students/staff — see hostelService.createHostel for the full onboarding flow. */
export function addHostel(input: AddHostelInput): Hostel {
  const prefix: 'BH' | 'GH' | 'NH' = input.category === 'boys' ? 'BH' : input.category === 'girls' ? 'GH' : 'NH'
  const seq = nextSeq(prefix)
  const id = `${prefix}${seq}`
  const occupancy = input.occupancy ?? 100
  const hostel: Hostel = {
    id,
    name: input.name?.trim() || `${input.category === 'boys' ? 'Boys' : input.category === 'girls' ? 'Girls' : 'General'} Hostel ${seq} (${prefix}-${seq})`,
    category: input.category,
    capacity: input.capacity ?? Math.max(occupancy + 12, occupancy),
    occupancy,
  }
  HOSTELS.push(hostel)
  return hostel
}
