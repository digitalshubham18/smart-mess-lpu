import type { MealType } from '@/types'
import { api } from './api'

/** The REAL waste log (server/src/routes/waste.js): what the kitchen recorded after each meal. Unlike the rest of the waste
 *  screens' figures, these are not demo data. */

export const WASTE_LOG_REASONS = ['Overproduction', 'Plate waste', 'Spoilage', 'Quality issue', 'Low attendance', 'Other'] as const
export type WasteLogReason = typeof WASTE_LOG_REASONS[number]

export interface WasteLogEntry {
  id: string; messId: string; date: string; meal: MealType
  preparedKg: number; consumedKg: number; wasteKg: number; wastePct: number
  reason: WasteLogReason; note: string; recordedBy: string; recordedAt: string
}
export interface WasteLog { entries: WasteLogEntry[]; totals: { entries: number; preparedKg: number; wasteKg: number; wastePct: number } }

function reason(e: unknown, fallback: string): string {
  const err = e as { response?: { data?: { error?: string; details?: { message?: string }[] } } }
  return err?.response?.data?.error ?? fallback
}

export async function listWasteLog(messId: string, from?: string, to?: string): Promise<WasteLog> {
  try { return (await api.get<WasteLog>('/waste', { params: { messId, ...(from ? { from } : {}), ...(to ? { to } : {}) } })).data }
  catch (e) { throw new Error(reason(e, 'Could not load the waste log.')) }
}

export async function saveWasteEntry(input: { messId: string; date: string; meal: MealType; preparedKg: number; consumedKg: number; reason: WasteLogReason; note?: string }): Promise<WasteLogEntry> {
  try { return (await api.put<WasteLogEntry>('/waste', input)).data }
  catch (e) { throw new Error(reason(e, 'Could not save the waste entry.')) }
}

export interface WasteSummary {
  byDay: { date: string; preparedKg: number; wasteKg: number; wastePct: number }[]
  byMeal: { meal: MealType; entries: number; preparedKg: number; wasteKg: number; wastePct: number }[]
  byReason: { reason: string; entries: number; wasteKg: number }[]
}
export async function getWasteSummary(messId: string, from?: string, to?: string): Promise<WasteSummary> {
  try { return (await api.get<WasteSummary>('/waste/summary', { params: { messId, ...(from ? { from } : {}), ...(to ? { to } : {}) } })).data }
  catch (e) { throw new Error(reason(e, 'Could not load the waste summary.')) }
}

export interface WasteSuggestion { meal: MealType; entries: number; avgWastePct: number; avgWasteKg: number; topReason: string; reducePct: number; advice: string }
/** "Cook less" advice, built only from the kitchen's own recorded entries (3+ per meal in the last 14 days). */
export async function getWasteSuggestions(messId: string): Promise<WasteSuggestion[]> {
  try { return (await api.get<{ suggestions: WasteSuggestion[] }>('/waste/suggestions', { params: { messId } })).data.suggestions }
  catch (e) { throw new Error(reason(e, 'Could not load the suggestions.')) }
}
