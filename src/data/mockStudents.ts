import type { Student } from '@/types'
import { pick, randInt, rnd } from '@/lib/rng'
import { HOSTELS } from './mockHostels'

const FIRST_NAMES = [
  'Aarav', 'Vihaan', 'Ishaan', 'Reyansh', 'Kabir', 'Arjun', 'Sai', 'Rohan', 'Aditya', 'Nikhil',
  'Karan', 'Yash', 'Manav', 'Rahul', 'Aryan', 'Devansh', 'Pranav', 'Siddharth', 'Varun', 'Harsh',
  'Ananya', 'Diya', 'Isha', 'Kavya', 'Meera', 'Riya', 'Tanvi', 'Zoya', 'Sneha', 'Pooja',
  'Simran', 'Neha', 'Divya', 'Anjali', 'Priya', 'Aditi', 'Nisha', 'Radhika', 'Shreya', 'Kritika',
]
const LAST_NAMES = [
  'Sharma', 'Verma', 'Patel', 'Reddy', 'Nair', 'Gupta', 'Singh', 'Kumar', 'Iyer', 'Chauhan',
  'Mehta', 'Joshi', 'Rao', 'Das', 'Kapoor', 'Bose', 'Pillai', 'Menon', 'Agarwal', 'Bhatt',
]
const BRANCHES = ['Computer Science', 'Electronics', 'Mechanical', 'Civil', 'Electrical', 'Chemical', 'Biotechnology', 'Information Technology']

function missedCutoffFor(): number {
  // Most students rarely miss the cutoff; a smaller tail misses it often.
  const roll = rnd()
  if (roll < 0.55) return randInt(0, 2)
  if (roll < 0.85) return randInt(3, 6)
  return randInt(7, 15)
}

// LPU-style 8-digit registration numbers (e.g. 21000001), globally unique and
// ever-increasing — shared by the initial seed AND every student added later
// (from the Students page or studentService.addStudent), so no two students
// ever collide, no matter when or how they were added.
let seq = 21000000
export function nextStudentId(): string {
  seq += 1
  return String(seq)
}

function makeStudent(hostelId: string): Student {
  const first = pick(FIRST_NAMES)
  const last = pick(LAST_NAMES)
  const id = nextStudentId()
  return {
    id,
    name: `${first} ${last}`,
    email: `${first}.${last}${id.slice(-4)}@lpu.smartmess.edu`.toLowerCase(),
    phone: `9${randInt(100000000, 999999999)}`,
    hostelId,
    room: `${pick(['A', 'B', 'C', 'D'])}-${randInt(100, 399)}`,
    year: randInt(1, 4),
    branch: pick(BRANCHES),
    mealPreference: pick(['veg', 'non-veg', 'either'] as const),
    status: rnd() > 0.05 ? 'active' : 'inactive',
    points: randInt(0, 480),
    badges: pick([[], ['Zero Waste Hero'], ['Smart Eater'], ['Eco Champion'], ['Zero Waste Hero', 'Smart Eater']]),
    missedCutoffCount: missedCutoffFor(),
  }
}

/** Generates `count` new students for a hostel. Used only for initial demo seeding —
 *  real hostels onboarded later start with an empty roster (see hostelService.createHostel)
 *  and are populated with real students one at a time, from the Students page. */
export function makeStudentsForHostel(hostelId: string, count: number): Student[] {
  return Array.from({ length: count }, () => makeStudent(hostelId))
}

// Seed exactly 100 demo students per EXISTING hostel — 10 boys' hostels + 10 girls'
// hostels = 2,000 students. `STUDENTS` is the live, mutable roster: any hostel added
// afterwards starts empty, and every page (Students, Hostels, Dashboard, …) reads
// straight from this array, so adding/removing a student here is visible everywhere.
export const STUDENTS: Student[] = HOSTELS.flatMap((h) => makeStudentsForHostel(h.id, 100))

// Ensure the demo student account exists explicitly for auth flows.
STUDENTS[0] = {
  ...STUDENTS[0],
  id: '21000001',
  name: 'Ananya Iyer',
  email: 'ananya.iyer1@lpu.smartmess.edu',
  hostelId: 'BH1',
  room: 'A-214',
  branch: 'Computer Science',
  year: 3,
  mealPreference: 'veg',
  status: 'active',
  points: 340,
  badges: ['Smart Eater', 'Eco Champion'],
  missedCutoffCount: 4,
}
