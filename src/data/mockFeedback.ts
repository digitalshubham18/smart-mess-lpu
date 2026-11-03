import type { Feedback, Complaint, ComplaintStatus } from '@/types'
import { pick, randInt, rnd } from '@/lib/rng'
import { STUDENTS } from './mockStudents'
import { OPERATIONS } from './mockOperations'
import { MESSES } from './mockMesses'
import { ITEMS_BY_ID } from './mockMenus'
import { buildMenuForDate } from './mockMenus'

let fseq = 1
export const FEEDBACK: Feedback[] = []
const centralOps = OPERATIONS.filter((r) => r.messId === MESSES[0].id && !r.isFuture)

centralOps.slice(-40).forEach((r) => {
  const n = 2 + Math.floor(rnd() * 4)
  for (let i = 0; i < n; i++) {
    const student = pick(STUDENTS)
    const base = Math.round(r.avgRating ?? 4)
    FEEDBACK.push({
      id: `FB-${fseq++}`,
      studentId: student.id,
      date: r.date,
      meal: r.meal,
      rating: Math.max(1, Math.min(5, base + Math.round(rnd() * 2 - 1))),
      taste: randInt(2, 5),
      quality: randInt(2, 5),
      variety: randInt(2, 5),
      quantity: randInt(2, 5),
      comment: pick([
        'Tasted great today, please repeat this menu!',
        'Portion size was a little small.',
        'Food was cold by the time I was served.',
        'Loved the paneer dish, more of this please.',
        'A bit too spicy for my taste.',
        'Perfectly cooked, no complaints at all.',
        '',
        '',
      ]),
    })
  }
})

const CATEGORIES = ['Food Quality', 'Hygiene', 'Service Speed', 'Menu Variety', 'Portion Size', 'Staff Behaviour']
const SUBJECTS = [
  'Food was served cold', 'Long queue during lunch', 'Same menu repeated too often',
  'Insufficient dal quantity', 'Utensils were not clean', 'Great improvement this week',
  'Request for more South Indian options', 'Water cooler not working near mess',
]

let cseq = 1
export const COMPLAINTS: Complaint[] = Array.from({ length: 16 }, (_, i) => {
  const student = pick(STUDENTS)
  const statuses: ComplaintStatus[] = ['Open', 'In Progress', 'Resolved', 'Resolved', 'Rejected']
  return {
    id: `CMP-${cseq++}`,
    studentId: student.id,
    date: centralOps[randInt(0, 60)]?.date ?? centralOps[0].date,
    category: pick(CATEGORIES),
    subject: pick(SUBJECTS),
    description: 'Reported via the student feedback portal during meal service.',
    status: pick(statuses),
  }
})

export function menuNameFor(date: string, meal: Feedback['meal']): string {
  const menu = buildMenuForDate(date, meal)
  const names = menu.itemIds.map((id) => ITEMS_BY_ID[id]?.name).filter(Boolean)
  return names.slice(0, 2).join(' + ') || 'Mess Meal'
}
