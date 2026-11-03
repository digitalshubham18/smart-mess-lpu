import { db, hostelIdForMess, logAudit } from './db.js'

/**
 * Authorization policy, in one place.
 *
 * Authentication (requireAuth) answers "who is this?". This answers "may they do THIS,
 * to THAT mess?" — two separate questions, both enforced here on the server. The
 * frontend hiding a button is never the control; a crafted request must fail identically.
 *
 * Scope rule: SUPER_ADMIN may act on any mess. Every other staff role may act only on
 * the mess that matches their own account's hostel_id (loaded from the database on every
 * request by requireAuth — see auth.js — not trusted from the token).
 */

// Which roles may perform which class of action. These mirror what the frontend already
// exposes per role (see the route guards in src/App.tsx and CheckInConsole in
// Attendance.tsx) — the difference is that now the server enforces them too.
export const TEAM_ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN']                                   // build/remove a mess's team
export const COUNTER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER', 'KITCHEN_STAFF']      // check-in, no-show processing
export const ROSTER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER', 'HOSTEL_WARDEN']       // enroll / edit / remove students
export const FINE_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER', 'KITCHEN_STAFF', 'FINANCE_MANAGER', 'HOSTEL_WARDEN']
export const SUPER_ADMIN_ONLY = ['SUPER_ADMIN']

/** Express middleware: 403 unless the caller's role is one of `roles`. Run after requireAuth. */
export function requireRoles(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.auth?.role)) {
      return res.status(403).json({ error: "Your role doesn't have permission to do that.", code: 'ROLE_FORBIDDEN' })
    }
    next()
  }
}

/** True if this authenticated actor may act on `hostelId`. */
export function inScopeOfHostel(auth, hostelId) {
  if (!auth || !hostelId) return false
  if (auth.role === 'SUPER_ADMIN') return true
  return !!auth.hostelId && auth.hostelId === hostelId
}

/** True if this authenticated actor may act on `messId` (resolved to its hostel). */
export function inScopeOfMess(auth, messId) {
  if (auth?.role === 'SUPER_ADMIN') return !!messId && hostelIdForMess(messId) !== null
  return inScopeOfHostel(auth, hostelIdForMess(messId))
}

/** True for any account that isn't a student or a parent/guardian (i.e. someone on a mess's team). */
export function isStaffRole(role) {
  return !!role && role !== 'STUDENT' && role !== 'PARENT'
}

/**
 * May this actor read/act on this specific student's records (attendance, warnings, fines,
 * profile)? A student sees only themselves, a parent only their linked child, and staff
 * only students of their own mess (SUPER_ADMIN: all). `student` is a students-table row.
 */
export function canAccessStudent(auth, student) {
  if (!auth || !student) return false
  if (auth.role === 'STUDENT') return auth.sub === student.id
  if (auth.role === 'PARENT') return auth.studentId === student.id
  return inScopeOfHostel(auth, student.hostel_id)
}

/**
 * Enforces mess scope inside a handler. Returns true if allowed. If not, it has ALREADY
 * sent the 403 (and written an audit entry so a crafted cross-mess request is visible to
 * the Super Admin) — the caller just `return`s.
 *
 * The message deliberately doesn't reveal anything about the target beyond what the
 * caller already supplied in their own request.
 */
export function enforceHostelScope(req, res, hostelId, attempted) {
  if (inScopeOfHostel(req.auth, hostelId)) return true
  recordBlockedAttempt(req, hostelId, attempted)
  res.status(403).json({
    error: "That's outside your mess — you can only do this for your own hostel's mess.",
    code: 'OUT_OF_SCOPE',
  })
  return false
}

/** Same, for a request that names a mess rather than a hostel. */
export function enforceMessScope(req, res, messId, attempted) {
  if (inScopeOfMess(req.auth, messId)) return true
  recordBlockedAttempt(req, hostelIdForMess(messId), attempted, messId)
  res.status(403).json({
    error: "That's outside your mess — you can only do this for your own hostel's mess.",
    code: 'OUT_OF_SCOPE',
  })
  return false
}

function recordBlockedAttempt(req, targetHostelId, attempted, targetMessId) {
  try {
    const messId = targetMessId ?? (targetHostelId ? db.prepare('SELECT id FROM messes WHERE hostel_id = ?').get(targetHostelId)?.id : null)
    logAudit({
      actorId: req.auth.sub,
      actorName: req.auth.name,
      actorRole: req.auth.role,
      action: 'cross_mess_attempt_blocked',
      messId: messId ?? undefined,
      summary: `Blocked: ${attempted} targeting ${targetHostelId ?? targetMessId ?? 'an unknown mess'} from ${req.auth.hostelId ?? 'no hostel'}`,
    })
  } catch {
    // Never let audit bookkeeping turn a clean 403 into a 500.
  }
}
