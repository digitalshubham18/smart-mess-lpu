import type { Attendance } from '@/types'
import { rnd, pick } from '@/lib/rng'
import { STUDENTS } from './mockStudents'
import { OPERATIONS } from './mockOperations'
import { MESSES } from './mockMesses'

let seq = 1
// Any single mess's records span the same date range as every other mess, so use one to derive the recent-day window.
const recentDays = Array.from(new Set(OPERATIONS.filter((r) => r.messId === MESSES[0].id && !r.isFuture).slice(-56).map((r) => r.date)))

export const ATTENDANCE: Attendance[] = []

recentDays.forEach((date) => {
  ;(['breakfast', 'lunch', 'snacks', 'dinner'] as const).forEach((meal) => {
    const attendingCount = Math.round(STUDENTS.length * (0.35 + rnd() * 0.4))
    const attendees = [...STUDENTS].sort(() => rnd() - 0.5).slice(0, attendingCount)
    attendees.forEach((s) => {
      const hour = { breakfast: 8, lunch: 13, snacks: 17, dinner: 20 }[meal]
      ATTENDANCE.push({
        id: `ATT-${seq++}`,
        date,
        meal,
        studentId: s.id,
        hostelId: s.hostelId,
        scannedAt: `${date}T${String(hour).padStart(2, '0')}:${String(Math.floor(rnd() * 59)).padStart(2, '0')}:00`,
      })
    })
  })
})

export function attendanceFor(studentId: string): Attendance[] {
  return ATTENDANCE.filter((a) => a.studentId === studentId).sort((a, b) => (a.date < b.date ? 1 : -1))
}

export function hasScannedToday(studentId: string, meal: string, date: string): boolean {
  return ATTENDANCE.some((a) => a.studentId === studentId && a.meal === meal && a.date === date)
}
