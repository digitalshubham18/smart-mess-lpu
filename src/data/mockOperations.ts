import type { MealType, ForecastMethod } from '@/types'
import { rnd, pick } from '@/lib/rng'
import { addDaysISO, TODAY_ISO, formatWeekday, isWeekend } from '@/utils/dateUtils'
import { buildMenuForDate, menuPopularity, isMenuVeg, ITEMS_BY_ID } from './mockMenus'
import { eventOnDate } from './mockEvents'
import { MESSES, totalStudentsForMess } from './mockMesses'

/** @deprecated kept for any leftover references — prefer totalStudentsForMess(messId) */
export const TOTAL_STUDENTS = MESSES.reduce((s, m) => s + totalStudentsForMess(m.id), 0)

export interface MealConfig {
  key: MealType
  label: string
  baseRate: number
  servingSizeKg: number
  cutoffLabel: string
  cutoffHour: number
}

export const MEAL_TYPES: MealConfig[] = [
  { key: 'breakfast', label: 'Breakfast', baseRate: 0.52, servingSizeKg: 0.32, cutoffLabel: '2:00 AM', cutoffHour: 2 },
  { key: 'lunch', label: 'Lunch', baseRate: 0.83, servingSizeKg: 0.55, cutoffLabel: '2:00 AM', cutoffHour: 2 },
  { key: 'snacks', label: 'Snacks', baseRate: 0.38, servingSizeKg: 0.22, cutoffLabel: '2:00 AM', cutoffHour: 2 },
  { key: 'dinner', label: 'Dinner', baseRate: 0.78, servingSizeKg: 0.52, cutoffLabel: '2:00 AM', cutoffHour: 2 },
]

export interface DayMealRecord {
  messId: string
  date: string
  weekday: string
  meal: MealType
  menuId: string
  menuVeg: boolean
  menuPopularity: number
  isFuture: boolean
  event?: string
  forecastMethod: ForecastMethod
  confirmedIntentions: number
  historicalExpected: number
  predictedStudents: number
  confidence: number
  safetyBufferPct: number
  requiredKg: number
  recommendedKg: number
  actualStudents: number | null
  preparedKg: number | null
  consumedKg: number | null
  leftoverKg: number | null
  wasteKg: number | null
  wasteCost: number | null
  avgRating: number | null
}

const WASTE_REASONS = ['Overproduction', 'Low attendance', 'Poor taste', 'Poor menu preference', 'Spoilage', 'Cooking error', 'Excess serving', 'Storage issue', 'Other'] as const

const OFFSET_START = -90
const OFFSET_END = 1

function buildRecord(offset: number, mt: MealConfig, messId: string): DayMealRecord {
  const date = addDaysISO(TODAY_ISO, offset)
  const weekday = formatWeekday(date)
  const isFuture = offset === OFFSET_END
  const menu = buildMenuForDate(date, mt.key)
  const pop = menuPopularity(menu)
  const veg = isMenuVeg(menu)
  const event = eventOnDate(date)
  const messTotal = totalStudentsForMess(messId)

  let dayMod = 1
  if (weekday === 'Sunday' && mt.key === 'breakfast') dayMod = 0.68
  if (isWeekend(date)) dayMod *= mt.key === 'lunch' ? 0.95 : 1.02
  if (weekday === 'Monday' && mt.key === 'lunch') dayMod *= 1.12
  if (event) dayMod *= 1 + event.demandImpactPct / 100

  const noise = 0.94 + rnd() * 0.12
  const baseAttendance = messTotal * mt.baseRate * dayMod * pop * noise

  const confirmedIntentions = Math.round(baseAttendance * (0.82 + rnd() * 0.1))
  const historicalExpected = Math.round(baseAttendance * (1.02 + rnd() * 0.05))
  const predictedStudents = Math.round(confirmedIntentions * 1.08 * 0.55 + historicalExpected * 0.45)
  const confidence = Math.round(84 + rnd() * 10)
  const safetyBufferPct = mt.key === 'dinner' ? 4 : 5

  const requiredKg = predictedStudents * mt.servingSizeKg
  const recommendedKg = requiredKg * (1 + safetyBufferPct / 100)

  let actualStudents: number | null = null
  let preparedKg: number | null = null
  let consumedKg: number | null = null
  let leftoverKg: number | null = null
  let wasteKg: number | null = null
  let wasteCost: number | null = null
  let avgRating: number | null = null

  if (!isFuture) {
    actualStudents = Math.round(predictedStudents * (0.94 + rnd() * 0.12))
    preparedKg = Math.round(recommendedKg * 10) / 10
    const consumedRatio = 0.9 + rnd() * 0.08
    consumedKg = Math.round(Math.min(preparedKg, actualStudents * mt.servingSizeKg * consumedRatio) * 10) / 10
    leftoverKg = Math.max(0, Math.round((preparedKg - consumedKg) * 10) / 10)
    wasteKg = leftoverKg // in this model, unconsumed leftover is treated as waste
    const avgCostPerKg = menu.itemIds.reduce((s, id) => s + (ITEMS_BY_ID[id]?.costPerKg ?? 60), 0) / (menu.itemIds.length || 1)
    wasteCost = Math.round(wasteKg * (avgCostPerKg / 4)) // /4 approximates blended per-serving cost vs per-kg ingredient cost
    avgRating = Math.round((3.3 + pop * 1.0 + rnd() * 0.4) * 10) / 10
    if (avgRating > 5) avgRating = 5
  }

  return {
    messId, date, weekday, meal: mt.key, menuId: menu.id, menuVeg: veg, menuPopularity: pop, isFuture,
    event: event?.title,
    forecastMethod: 'weighted_moving_average',
    confirmedIntentions, historicalExpected, predictedStudents, confidence, safetyBufferPct,
    requiredKg: Math.round(requiredKg * 10) / 10, recommendedKg: Math.round(recommendedKg * 10) / 10,
    actualStudents, preparedKg, consumedKg, leftoverKg, wasteKg, wasteCost, avgRating,
  }
}

function generateOperationsForMess(messId: string): DayMealRecord[] {
  const records: DayMealRecord[] = []
  for (let offset = OFFSET_START; offset <= OFFSET_END; offset++) {
    MEAL_TYPES.forEach((mt) => records.push(buildRecord(offset, mt, messId)))
  }
  return records
}

export const OPERATIONS: DayMealRecord[] = []
MESSES.forEach((mess) => OPERATIONS.push(...generateOperationsForMess(mess.id)))

// Pin the flagship demo scenario onto tomorrow's lunch at the Central Mess (spec section 60 walkthrough)
const tomorrowLunch = OPERATIONS.find((r) => r.messId === MESSES[0].id && r.date === addDaysISO(TODAY_ISO, 1) && r.meal === 'lunch')!
tomorrowLunch.confirmedIntentions = 1120
tomorrowLunch.historicalExpected = 1160
tomorrowLunch.predictedStudents = 1180
tomorrowLunch.confidence = 92
tomorrowLunch.requiredKg = Math.round(1180 * 0.55 * 10) / 10
tomorrowLunch.recommendedKg = 1225 * 0.55 // ~ meals->kg via serving size, kept consistent with "1,225 meals" demo figure
tomorrowLunch.safetyBufferPct = 4

/** Backfills 90 days of history + tomorrow's forecast for a newly created mess. No-op if it already has data. */
export function ensureOperationsForMess(messId: string) {
  if (OPERATIONS.some((r) => r.messId === messId)) return
  OPERATIONS.push(...generateOperationsForMess(messId))
}

/**
 * Fully regenerates a mess's 90-day history + forecast from scratch, using its
 * current student total. Used when hostels are reassigned in/out of a mess,
 * since its historical demand figures would otherwise stay stale.
 */
export function regenerateOperationsForMess(messId: string) {
  for (let i = OPERATIONS.length - 1; i >= 0; i--) {
    if (OPERATIONS[i].messId === messId) OPERATIONS.splice(i, 1)
  }
  OPERATIONS.push(...generateOperationsForMess(messId))
}

export function getRecord(messId: string, date: string, meal: MealType): DayMealRecord | undefined {
  return OPERATIONS.find((r) => r.messId === messId && r.date === date && r.meal === meal)
}

export function recordsForDate(messId: string, date: string): DayMealRecord[] {
  return OPERATIONS.filter((r) => r.messId === messId && r.date === date)
}

export function pastRecords(messId: string): DayMealRecord[] {
  return OPERATIONS.filter((r) => r.messId === messId && !r.isFuture)
}

export function allPastRecords(): DayMealRecord[] {
  return OPERATIONS.filter((r) => !r.isFuture)
}

export { WASTE_REASONS }
