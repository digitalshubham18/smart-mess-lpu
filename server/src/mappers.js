// import { twoFactorRequiredFor } from './policy.js'

export function toStudentJSON(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone ?? '',
    hostelId: row.hostel_id,
    room: row.room,
    year: row.year,
    branch: row.branch,
    mealPreference: row.meal_preference,
    status: row.status,
    points: row.points,
    badges: JSON.parse(row.badges || '[]'),
    missedCutoffCount: row.missed_cutoff_count,
    leaveUntil: row.leave_until ?? undefined,
    // true while the student holds a temporary TMP-xxxxx ID because they have no university UID yet
    provisional: !!row.provisional,
    // whether an official photo is on file (the image itself is served, behind login, from /students/:id/photo)
    hasPhoto: !!row.photo_data,
    // whether the student (or staff on their behalf) has agreed to the photo notice — see privacy.js
    photoConsent: !!row.photo_consent_at,
  }
}

export function toUserJSON(row) {
  const student = toStudentJSON(row)
  return {
    id: `U-${row.id}`,
    name: row.name,
    email: row.email,
    role: 'STUDENT',
    avatarColor: '#3554D1',
    studentId: row.id,
    hostelId: row.hostel_id,
    createdAt: row.created_at,
    mustChangePassword: !!row.must_change_password,
_student: student,
  }
}

const AVATAR_COLORS = ['#3554D1', '#1F8A5F', '#D97D0A', '#C0392B', '#7C3AED', '#0EA5A5', '#2C46B3', '#8A5F1F']
function colorFor(id) {
  let hash = 0
  for (const ch of String(id)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

export function toStaffUserJSON(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone ?? undefined,
    role: row.role,
    avatarColor: colorFor(row.id),
    hostelId: row.hostel_id ?? undefined,
    studentId: row.student_id ?? undefined,
    createdAt: row.created_at,
    mustChangePassword: !!row.must_change_password,
    // twoFactorEnabled: !!row.totp_enabled,
    // Policy (policy.js): this role must use two-factor. While it isn't on yet the API only allows setting it up.
    // twoFactorRequired: twoFactorRequiredFor(row.role),
    // twoFactorSetupRequired: twoFactorRequiredFor(row.role) && !row.totp_enabled,
  }
}

/** "a••••@gmail.com" — enough for a person to recognise their own address, not enough to learn anyone else's. */
export function maskEmail(email) {
  const [local = '', domain = ''] = String(email).split('@')
  return `${local.slice(0, 1)}${'•'.repeat(Math.min(5, Math.max(2, local.length - 1)))}@${domain}`
}
