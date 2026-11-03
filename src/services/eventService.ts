import type { CalendarEvent, EventType, User } from '@/types'
import { CALENDAR_EVENTS } from '@/data/mockEvents'
import { logEvent } from './auditService'
import { withDelay } from './api'

let seq = CALENDAR_EVENTS.length + 1

export async function listEvents(): Promise<CalendarEvent[]> {
  return withDelay([...CALENDAR_EVENTS], 150)
}

export async function addEvent(input: { title: string; date: string; type: EventType; demandImpactPct: number }, actor?: User | null): Promise<CalendarEvent> {
  const event: CalendarEvent = { id: `EV-${seq++}`, ...input }
  CALENDAR_EVENTS.push(event)
  logEvent(actor, 'event_added', `Added calendar event "${event.title}" on ${event.date}`)
  return withDelay(event, 250)
}

export async function updateEvent(id: string, patch: Partial<Omit<CalendarEvent, 'id'>>, actor?: User | null): Promise<CalendarEvent | null> {
  const idx = CALENDAR_EVENTS.findIndex((e) => e.id === id)
  if (idx === -1) return withDelay(null, 200)
  CALENDAR_EVENTS[idx] = { ...CALENDAR_EVENTS[idx], ...patch }
  logEvent(actor, 'event_updated', `Edited calendar event "${CALENDAR_EVENTS[idx].title}" (${CALENDAR_EVENTS[idx].date})`)
  return withDelay(CALENDAR_EVENTS[idx], 250)
}

export async function deleteEvent(id: string, actor?: User | null): Promise<boolean> {
  const idx = CALENDAR_EVENTS.findIndex((e) => e.id === id)
  if (idx === -1) return withDelay(false, 200)
  const [removed] = CALENDAR_EVENTS.splice(idx, 1)
  logEvent(actor, 'event_deleted', `Deleted calendar event "${removed.title}" (${removed.date})`)
  return withDelay(true, 200)
}
