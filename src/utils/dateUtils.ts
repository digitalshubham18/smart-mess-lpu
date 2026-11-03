import { format, addDays, subDays, isWeekend as isWeekendFn, differenceInCalendarDays, parseISO } from 'date-fns'

export function toISODate(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

export function addDaysISO(dateISO: string, days: number): string {
  return toISODate(addDays(parseISO(dateISO), days))
}

export function subDaysISO(dateISO: string, days: number): string {
  return toISODate(subDays(parseISO(dateISO), days))
}

export function formatShort(dateISO: string): string {
  return format(parseISO(dateISO), 'd MMM')
}

export function formatWeekday(dateISO: string): string {
  return format(parseISO(dateISO), 'EEEE')
}

export function formatFull(dateISO: string): string {
  return format(parseISO(dateISO), 'EEEE, d MMMM yyyy')
}

export function isWeekend(dateISO: string): boolean {
  return isWeekendFn(parseISO(dateISO))
}

export function daysBetween(a: string, b: string): number {
  return differenceInCalendarDays(parseISO(b), parseISO(a))
}

export const TODAY_ISO = toISODate(new Date())
