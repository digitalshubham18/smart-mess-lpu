import type { MealType, WasteReason } from '@/types'
import { OPERATIONS, getRecord, WASTE_REASONS } from '@/data/mockOperations'
import { WASTE_DETAIL, topWasteContributors, wasteByReason } from '@/data/mockWasteDetail'
import { getMessSettingsSync } from './messSettingsService'
import { withDelay } from './api'

export { WASTE_REASONS, topWasteContributors, wasteByReason }

export interface WasteEntryInput {
  messId: string
  date: string
  meal: MealType
  preparedKg: number
  consumedKg: number
  wasteKg?: number
  reason: WasteReason
}

export async function recordWaste(input: WasteEntryInput) {
  const record = getRecord(input.messId, input.date, input.meal)
  const wasteKg = input.wasteKg ?? Math.max(0, input.preparedKg - input.consumedKg)
  if (record) {
    record.preparedKg = input.preparedKg
    record.consumedKg = input.consumedKg
    record.leftoverKg = wasteKg
    record.wasteKg = wasteKg
    record.actualStudents = record.actualStudents ?? Math.round(input.consumedKg / 0.5)
    record.wasteCost = Math.round(wasteKg * (getMessSettingsSync(input.messId).avgCostPerKg / 4))
  }
  return withDelay(record, 350)
}

export function dailyWasteSeries(messId: string, days = 30) {
  return OPERATIONS.filter((r) => r.messId === messId && !r.isFuture)
    .slice(-days * 4)
    .reduce((acc: Record<string, number>, r) => {
      if (r.wasteKg == null) return acc
      acc[r.date] = (acc[r.date] ?? 0) + r.wasteKg
      return acc
    }, {})
}

export function mealWiseWaste(messId: string) {
  const totals: Record<MealType, number> = { breakfast: 0, lunch: 0, snacks: 0, dinner: 0 }
  OPERATIONS.filter((r) => r.messId === messId && !r.isFuture).forEach((r) => {
    if (r.wasteKg != null) totals[r.meal] += r.wasteKg
  })
  return totals
}

export function hostelWiseWasteEstimate(messId: string, hostelShares: { hostelId: string; share: number }[]) {
  const totalWaste = OPERATIONS.filter((r) => r.messId === messId && !r.isFuture).reduce((s, r) => s + (r.wasteKg ?? 0), 0)
  return hostelShares.map((h) => ({ hostelId: h.hostelId, wasteKg: Math.round(totalWaste * h.share) }))
}

export function predictedWasteForTomorrow(messId: string) {
  const tomorrow = OPERATIONS.find((r) => r.messId === messId && r.isFuture && r.meal === 'lunch')
  if (!tomorrow) return null
  const predictedLeftover = Math.round(tomorrow.recommendedKg * 0.035 * 10) / 10
  const predictedWaste = Math.round(tomorrow.recommendedKg * 0.02 * 10) / 10
  return { date: tomorrow.date, meal: tomorrow.meal, predictedLeftover, predictedWaste }
}

export { WASTE_DETAIL }
