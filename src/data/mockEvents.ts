import type { CalendarEvent } from '@/types'
import { addDaysISO, TODAY_ISO } from '@/utils/dateUtils'

export const CALENDAR_EVENTS: CalendarEvent[] = [
  { id: 'EV-1', title: 'Mid-Semester Examinations', date: addDaysISO(TODAY_ISO, -18), type: 'exam', demandImpactPct: -12 },
  { id: 'EV-2', title: 'Founders Day Festival', date: addDaysISO(TODAY_ISO, -9), type: 'festival', demandImpactPct: 18 },
  { id: 'EV-3', title: 'Republic Day Holiday', date: addDaysISO(TODAY_ISO, -25), type: 'holiday', demandImpactPct: -35 },
  { id: 'EV-4', title: 'Inter-College Sports Meet', date: addDaysISO(TODAY_ISO, -4), type: 'sports', demandImpactPct: 8 },
  { id: 'EV-5', title: 'Weekend Vacation Rush', date: addDaysISO(TODAY_ISO, -30), type: 'vacation', demandImpactPct: -28 },
  { id: 'EV-6', title: 'End-Semester Examinations', date: addDaysISO(TODAY_ISO, 6), type: 'exam', demandImpactPct: -14 },
  { id: 'EV-7', title: 'Spring Cultural Fest', date: addDaysISO(TODAY_ISO, 14), type: 'festival', demandImpactPct: 22 },
  { id: 'EV-8', title: 'Diwali Vacation Begins', date: addDaysISO(TODAY_ISO, 21), type: 'vacation', demandImpactPct: -40 },
]

export function eventOnDate(dateISO: string): CalendarEvent | undefined {
  return CALENDAR_EVENTS.find((e) => e.date === dateISO)
}
