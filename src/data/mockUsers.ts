import type { User } from '@/types'
import { HOSTELS } from './mockHostels'
import { messIdForHostel } from './mockMesses'
import { STUDENTS } from './mockStudents'

const STAFF_FIRST_NAMES = [
  'Ritu', 'Arvind', 'Suresh', 'Meera', 'Naresh', 'Deepak', 'Kavita', 'Manoj', 'Sunita', 'Rajesh',
  'Anita', 'Vikram', 'Pooja', 'Sanjay', 'Geeta', 'Anil', 'Poornima', 'Ramesh', 'Shalini', 'Ashok',
]
const STAFF_LAST_NAMES = [
  'Chawla', 'Malhotra', 'Yadav', 'Krishnan', 'Kapoor', 'Bhatia', 'Saxena', 'Mishra', 'Rana', 'Sethi',
  'Tandon', 'Bose', 'Nair', 'Iyer', 'Khanna', 'Dutta', 'Chopra', 'Shukla', 'Pandey', 'Grover',
]
const AVATAR_COLORS = ['#3554D1', '#1F8A5F', '#D97D0A', '#C0392B', '#7C3AED', '#0EA5A5', '#2C46B3', '#8A5F1F']

function nameFor(seedIndex: number): string {
  return `${STAFF_FIRST_NAMES[seedIndex % STAFF_FIRST_NAMES.length]} ${STAFF_LAST_NAMES[(seedIndex * 3 + 7) % STAFF_LAST_NAMES.length]}`
}
function colorFor(seedIndex: number): string {
  return AVATAR_COLORS[seedIndex % AVATAR_COLORS.length]
}

// 5-digit numeric staff IDs (10001, 10002, …) — globally unique and ever-increasing,
// shared by every staff account whether seeded at startup or added later by a Mess
// Admin from the Staff page. (Students get their own 8-digit sequence — see mockStudents.ts.)
let staffSeq = 10000
function nextStaffId(): string {
  staffSeq += 1
  return String(staffSeq).padStart(5, '0')
}

const STAFF_ROLE_PREFIX: Record<'ADMIN' | 'MESS_MANAGER' | 'KITCHEN_STAFF' | 'FINANCE_MANAGER' | 'HOSTEL_WARDEN', string> = {
  ADMIN: 'adm',
  MESS_MANAGER: 'mgr',
  KITCHEN_STAFF: 'kit',
  FINANCE_MANAGER: 'fin',
  HOSTEL_WARDEN: 'wrd',
}

/**
 * Every hostel at LPU is its own mess with its own dedicated team: a Mess Admin,
 * a Mess Manager, Kitchen Staff, a Finance Manager and a Hostel Warden — all
 * scoped to that one mess/hostel only. There is exactly one Super Admin for the
 * whole university, with visibility and permissions across every mess.
 *
 * `DEMO_USERS` is the full, live staff directory used for login lookups
 * (`authService.login` matches by UID or email).
 */
export const DEMO_USERS: (User & { password: string })[] = []

// The one and only Super Admin — university-wide visibility and full permissions
// across every hostel, mess, warden and manager at LPU. Created first so it gets
// the very first staff UID.
export const SUPER_ADMIN_USER: User & { password: string } = {
  id: nextStaffId(),
  name: 'Dr. Ashok Mittal',
  email: 'superadmin@lpu.smartmess.edu',
  role: 'SUPER_ADMIN',
  avatarColor: '#0EA5A5',
  password: 'demo1234',
  createdAt: '2025-01-01',
}
DEMO_USERS.push(SUPER_ADMIN_USER)

export function addStaffForHostel(hostelId: string): (User & { password: string })[] {
  const idx = HOSTELS.findIndex((h) => h.id === hostelId)
  const created: (User & { password: string })[] = []
  ;(Object.keys(STAFF_ROLE_PREFIX) as (keyof typeof STAFF_ROLE_PREFIX)[]).forEach((role, roleIdx) => {
    const prefix = STAFF_ROLE_PREFIX[role]
    const seedIndex = idx * 5 + roleIdx
    const user: User & { password: string } = {
      id: nextStaffId(),
      name: nameFor(seedIndex),
      email: `${prefix}.${hostelId.toLowerCase()}@lpu.smartmess.edu`,
      role,
      avatarColor: colorFor(seedIndex),
      hostelId,
      password: 'demo1234',
      createdAt: '2025-01-10',
    }
    DEMO_USERS.push(user)
    created.push(user)
  })
  return created
}

/**
 * Onboarding a brand-new hostel/mess (via the Super Admin's "Add Hostel" flow) only
 * ever auto-creates that mess's ADMIN account — nothing else. Building out the rest
 * of the team (Mess Manager, Kitchen Staff, Finance Manager, Hostel Warden) is
 * deliberately left as that Mess Admin's own responsibility, from the Staff page,
 * once they sign in. This mirrors how a real university actually staffs a new mess.
 *
 * `name` is required and never falls back to a placeholder — every account created
 * from this point forward belongs to a real, named person the Super Admin typed in.
 */
export function addAdminForHostel(hostelId: string, name: string, email?: string): User & { password: string } {
  const idx = HOSTELS.findIndex((h) => h.id === hostelId)
  const seedIndex = idx * 5
  const user: User & { password: string } = {
    id: nextStaffId(),
    name: name.trim(),
    email: email?.trim() || `adm.${hostelId.toLowerCase()}@lpu.smartmess.edu`,
    role: 'ADMIN',
    avatarColor: colorFor(seedIndex),
    hostelId,
    password: 'demo1234',
    createdAt: new Date().toISOString().slice(0, 10),
  }
  DEMO_USERS.push(user)
  return user
}

export type StaffRole = 'MESS_MANAGER' | 'KITCHEN_STAFF' | 'FINANCE_MANAGER' | 'HOSTEL_WARDEN'

/** Lists every staff account (Admin included) scoped to one hostel/mess. */
export function listStaffForHostel(hostelId: string): (User & { password: string })[] {
  return DEMO_USERS.filter((u) => u.hostelId === hostelId && u.role !== 'STUDENT')
}

/**
 * A Mess Admin (or the Super Admin, on a mess's behalf) creates a staff account for
 * their own mess — Mess Manager, Kitchen Staff, Finance Manager or Hostel Warden.
 * Admin and Super Admin accounts are never created here: only the Super Admin can
 * create a new mess's Admin (see addAdminForHostel), and there is only ever one
 * Super Admin for the whole university.
 */
export function addStaffMember(input: { hostelId: string; role: StaffRole; name: string; email?: string; phone?: string }): User & { password: string } {
  const prefix = STAFF_ROLE_PREFIX[input.role]
  const user: User & { password: string } = {
    id: nextStaffId(),
    name: input.name.trim(),
    email: input.email?.trim() || `${prefix}.${input.hostelId.toLowerCase()}.${staffSeq}@lpu.smartmess.edu`,
    role: input.role,
    avatarColor: colorFor(DEMO_USERS.length),
    hostelId: input.hostelId,
    phone: input.phone,
    password: 'demo1234',
    createdAt: new Date().toISOString().slice(0, 10),
  }
  DEMO_USERS.push(user)
  return user
}

export function removeStaffMember(id: string): boolean {
  const idx = DEMO_USERS.findIndex((u) => u.id === id && u.role !== 'ADMIN' && u.role !== 'SUPER_ADMIN')
  if (idx === -1) return false
  DEMO_USERS.splice(idx, 1)
  return true
}

/**
 * Creates a read-only Parent/Guardian account linked to one student — no editing powers
 * anywhere in the app, just visibility into that student's meal plan status and points.
 * Idempotent: calling it again for the same student returns the existing account instead
 * of creating a duplicate.
 */
export function createParentAccount(studentId: string, studentName: string, hostelId: string): User & { password: string } {
  const existing = DEMO_USERS.find((u) => u.role === 'PARENT' && u.studentId === studentId)
  if (existing) return existing
  const user: User & { password: string } = {
    id: `P${studentId}`,
    name: `${studentName}'s Parent/Guardian`,
    email: `parent.${studentId}@lpu.smartmess.edu`,
    role: 'PARENT',
    avatarColor: '#64748B',
    studentId,
    hostelId,
    password: 'demo1234',
    createdAt: new Date().toISOString().slice(0, 10),
  }
  DEMO_USERS.push(user)
  return user
}

// Seed one full staff team (Admin, Mess Manager, Kitchen Staff, Finance Manager, Hostel Warden)
// per hostel — 10 boys' + 10 girls' hostels × 5 roles = 100 mess-level staff accounts.
const seededTeams = HOSTELS.map((h) => addStaffForHostel(h.id))

// A small, curated subset of accounts to feature as one-click demo buttons on the
// Login page (the full 101-account directory would be unusable as buttons — every
// UID above still works for sign-in, it's just not all individually listed there).
export const FEATURED_STAFF_UIDS = [SUPER_ADMIN_USER.id, ...seededTeams[0].map((u) => u.id)]

// Every other seeded student is on the real, enrolled roster (mockStudents.ts) but has
// deliberately NOT created a login yet — exactly like a real newly-enrolled student, they
// must go through Register and claim their account with their real UID + name before they
// can sign in (see authService.register/login). This one account is pre-claimed purely so
// the Login page has a single one-click student demo button; everyone else demonstrates
// the real registration flow instead of a shortcut.
const FEATURED_STUDENT_RECORD = STUDENTS.find((s) => s.id === '21000001')
if (FEATURED_STUDENT_RECORD) {
  DEMO_USERS.push({
    id: `U-${FEATURED_STUDENT_RECORD.id}`,
    name: FEATURED_STUDENT_RECORD.name,
    email: FEATURED_STUDENT_RECORD.email,
    role: 'STUDENT',
    avatarColor: '#3554D1',
    studentId: FEATURED_STUDENT_RECORD.id,
    hostelId: FEATURED_STUDENT_RECORD.hostelId,
    password: 'demo1234',
    createdAt: '2025-01-10',
  })
}
export const FEATURED_STUDENT_UID = FEATURED_STUDENT_RECORD?.id ?? '21000001'

export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Mess Admin',
  MESS_MANAGER: 'Mess Manager',
  KITCHEN_STAFF: 'Kitchen Staff',
  STUDENT: 'Student',
  FINANCE_MANAGER: 'Finance Manager',
  HOSTEL_WARDEN: 'Hostel Warden',
  PARENT: 'Parent/Guardian',
}

export const ROLE_HOME: Record<string, string> = {
  SUPER_ADMIN: '/dashboard',
  ADMIN: '/dashboard',
  MESS_MANAGER: '/dashboard',
  KITCHEN_STAFF: '/kitchen',
  STUDENT: '/dashboard',
  FINANCE_MANAGER: '/finance',
  HOSTEL_WARDEN: '/dashboard',
  PARENT: '/dashboard',
}

export function messIdForStaff(user: User): string | undefined {
  if (!user.hostelId) return undefined
  return messIdForHostel(user.hostelId)
}
