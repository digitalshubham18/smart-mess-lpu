import type { MealType } from '@/types'
import { OPERATIONS, MEAL_TYPES } from '@/data/mockOperations'
import { MENU_ITEMS, buildMenuForDate, ITEMS_BY_ID } from '@/data/mockMenus'
import { forecastErrorStats, wastePercent, sustainabilityScore, sustainabilityBadge, co2SavedKgEstimate, waterSavedLitresEstimate } from '@/utils/calculations'
import { hostelsForMess, totalStudentsForMess, MESSES } from '@/data/mockMesses'
import { withDelay } from './api'

const past = (messId: string) => OPERATIONS.filter((r) => r.messId === messId && !r.isFuture)

export interface DashboardKPIs {
  expectedToday: number
  predictedDemandToday: number
  actualAttendanceToday: number
  mealsPrepared: number
  mealsConsumed: number
  foodWastedKg: number
  wastePct: number
  wasteCost: number
  moneySaved: number
  forecastAccuracy: number
}

export async function getDashboardKPIs(messId: string, date: string): Promise<DashboardKPIs> {
  const today = OPERATIONS.filter((r) => r.messId === messId && r.date === date && !r.isFuture)
  const expectedToday = today.reduce((s, r) => s + r.predictedStudents, 0)
  const actualAttendanceToday = today.reduce((s, r) => s + (r.actualStudents ?? 0), 0)
  const mealsPrepared = today.reduce((s, r) => s + (r.preparedKg ?? 0), 0)
  const mealsConsumed = today.reduce((s, r) => s + (r.consumedKg ?? 0), 0)
  const foodWastedKg = today.reduce((s, r) => s + (r.wasteKg ?? 0), 0)
  const wasteCost = today.reduce((s, r) => s + (r.wasteCost ?? 0), 0)
  const accStats = forecastErrorStats(past(messId).slice(-28).map((r) => ({ predicted: r.predictedStudents, actual: r.actualStudents ?? 0 })))
  const yesterdayWasteCost = OPERATIONS.filter((r) => r.messId === messId && r.date < date && !r.isFuture).slice(-4).reduce((s, r) => s + (r.wasteCost ?? 0), 0)
  const moneySaved = Math.max(0, Math.round((yesterdayWasteCost - wasteCost) * 4.3))

  return withDelay(
    {
      expectedToday,
      predictedDemandToday: expectedToday,
      actualAttendanceToday,
      mealsPrepared: Math.round(mealsPrepared),
      mealsConsumed: Math.round(mealsConsumed),
      foodWastedKg: Math.round(foodWastedKg),
      wastePct: Math.round(wastePercent(mealsPrepared, foodWastedKg) * 10) / 10,
      wasteCost: Math.round(wasteCost),
      moneySaved,
      forecastAccuracy: accStats.accuracy,
    },
    300
  )
}

export function forecastVsActualSeries(messId: string, days = 30) {
  const dates = Array.from(new Set(past(messId).slice(-days * 4).map((r) => r.date)))
  return dates.map((date) => {
    const recs = OPERATIONS.filter((r) => r.messId === messId && r.date === date && !r.isFuture)
    return {
      date,
      predicted: recs.reduce((s, r) => s + r.predictedStudents, 0),
      actual: recs.reduce((s, r) => s + (r.actualStudents ?? 0), 0),
    }
  })
}

export function wasteTrendSeries(messId: string, days = 30) {
  const dates = Array.from(new Set(past(messId).slice(-days * 4).map((r) => r.date)))
  return dates.map((date) => ({
    date,
    wasteKg: OPERATIONS.filter((r) => r.messId === messId && r.date === date && !r.isFuture).reduce((s, r) => s + (r.wasteKg ?? 0), 0),
  }))
}

export function mealPopularityRanking(messId: string) {
  const totals: Record<string, { attendance: number; count: number; rating: number; ratingCount: number; date: string; meal: MealType }> = {}
  past(messId).forEach((r) => {
    if (r.actualStudents == null) return
    totals[r.menuId] ??= { attendance: 0, count: 0, rating: 0, ratingCount: 0, date: r.date, meal: r.meal }
    totals[r.menuId].attendance += r.actualStudents
    totals[r.menuId].count += 1
    if (r.avgRating != null) {
      totals[r.menuId].rating += r.avgRating
      totals[r.menuId].ratingCount += 1
    }
  })
  return Object.entries(totals)
    .map(([menuId, v]) => ({
      menuId,
      label: menuLabel(v.date, v.meal),
      avgAttendance: Math.round(v.attendance / v.count),
      avgRating: v.ratingCount ? Math.round((v.rating / v.ratingCount) * 10) / 10 : null,
    }))
    .sort((a, b) => b.avgAttendance - a.avgAttendance)
}

function menuLabel(date: string, meal: MealType): string {
  const menu = buildMenuForDate(date, meal)
  return menu.itemIds.map((id) => ITEMS_BY_ID[id]?.name).filter(Boolean).slice(0, 2).join(' + ') || `${meal} menu`
}

export function attendanceByMealSeries(messId: string, days = 14) {
  const dates = Array.from(new Set(past(messId).slice(-days * 4).map((r) => r.date)))
  return dates.map((date) => {
    const row: Record<string, number | string> = { date }
    MEAL_TYPES.forEach((mt) => {
      const rec = OPERATIONS.find((r) => r.messId === messId && r.date === date && r.meal === mt.key)
      row[mt.label] = rec?.actualStudents ?? 0
    })
    return row
  })
}

export function hostelWiseDemand(messId: string) {
  const hostels = hostelsForMess(messId)
  const total = hostels.reduce((s, h) => s + h.occupancy, 0) || 1
  const messTotal = totalStudentsForMess(messId)
  return hostels.map((h) => ({ hostel: h.name, students: Math.round((h.occupancy / total) * messTotal) }))
}

/** Same as hostelWiseDemand but across every mess in the college — used by pages that show all hostels regardless of which mess is currently selected. */
export function hostelWiseDemandAll() {
  return MESSES.flatMap((m) => hostelWiseDemand(m.id))
}

export interface MessWasteSummary {
  messId: string
  messName: string
  totalWasteKg: number
  totalWasteCost: number
  wastePct: number
}

/** Aggregates waste across every mess in the college — used for the Admin's "university-wide" view. */
export function collegeWideWasteSummary(): { perMess: MessWasteSummary[]; totalWasteKg: number; totalWasteCost: number } {
  const perMess = MESSES.map((m) => {
    const data = past(m.id)
    const totalWasteKg = data.reduce((s, r) => s + (r.wasteKg ?? 0), 0)
    const totalWasteCost = data.reduce((s, r) => s + (r.wasteCost ?? 0), 0)
    const totalPreparedKg = data.reduce((s, r) => s + (r.preparedKg ?? 0), 0)
    return {
      messId: m.id,
      messName: m.name,
      totalWasteKg: Math.round(totalWasteKg),
      totalWasteCost: Math.round(totalWasteCost),
      wastePct: Math.round(wastePercent(totalPreparedKg, totalWasteKg) * 10) / 10,
    }
  })
  return {
    perMess: perMess.sort((a, b) => b.totalWasteKg - a.totalWasteKg),
    totalWasteKg: perMess.reduce((s, m) => s + m.totalWasteKg, 0),
    totalWasteCost: perMess.reduce((s, m) => s + m.totalWasteCost, 0),
  }
}

/** Aggregates today's KPIs across every mess — used for the Admin's "university-wide today" view. */
export async function getCollegeWideKPIsToday(date: string) {
  const perMess = await Promise.all(MESSES.map((m) => getDashboardKPIs(m.id, date)))
  return perMess.reduce(
    (acc, k) => ({
      expectedToday: acc.expectedToday + k.expectedToday,
      actualAttendanceToday: acc.actualAttendanceToday + k.actualAttendanceToday,
      mealsPrepared: acc.mealsPrepared + k.mealsPrepared,
      mealsConsumed: acc.mealsConsumed + k.mealsConsumed,
      foodWastedKg: acc.foodWastedKg + k.foodWastedKg,
      wasteCost: acc.wasteCost + k.wasteCost,
      moneySaved: acc.moneySaved + k.moneySaved,
    }),
    { expectedToday: 0, actualAttendanceToday: 0, mealsPrepared: 0, mealsConsumed: 0, foodWastedKg: 0, wasteCost: 0, moneySaved: 0 }
  )
}

export interface MessOverview {
  messId: string
  messName: string
  totalStudents: number
  forecastAccuracy: number
  todayExpected: number
  todayActual: number
  wastePct: number
  wasteCost90d: number
}

/** One row per mess — the data behind the Admin's College Overview page. */
export function collegeOverviewSummary(date: string): MessOverview[] {
  return MESSES.map((m) => {
    const data = past(m.id)
    const stats = forecastErrorStats(data.slice(-30).map((r) => ({ predicted: r.predictedStudents, actual: r.actualStudents ?? 0 })))
    const today = OPERATIONS.filter((r) => r.messId === m.id && r.date === date && !r.isFuture)
    const todayExpected = today.reduce((s, r) => s + r.predictedStudents, 0)
    const todayActual = today.reduce((s, r) => s + (r.actualStudents ?? 0), 0)
    const prepared = data.reduce((s, r) => s + (r.preparedKg ?? 0), 0)
    const waste = data.reduce((s, r) => s + (r.wasteKg ?? 0), 0)
    const wasteCost = data.reduce((s, r) => s + (r.wasteCost ?? 0), 0)
    return {
      messId: m.id,
      messName: m.name,
      totalStudents: totalStudentsForMess(m.id),
      forecastAccuracy: stats.accuracy,
      todayExpected,
      todayActual,
      wastePct: Math.round(wastePercent(prepared, waste) * 10) / 10,
      wasteCost90d: Math.round(wasteCost),
    }
  })
}

export interface AIInsight {
  id: string
  text: string
  tone: 'info' | 'warning' | 'success'
}

export function generateAIInsights(messId: string): AIInsight[] {
  const insights: AIInsight[] = []
  const data = past(messId)

  // Monday lunch pattern
  const mondayLunch = data.filter((r) => r.meal === 'lunch' && r.weekday === 'Monday' && r.actualStudents != null)
  const otherLunch = data.filter((r) => r.meal === 'lunch' && r.weekday !== 'Monday' && r.actualStudents != null)
  if (mondayLunch.length && otherLunch.length) {
    const avgMon = mondayLunch.reduce((s, r) => s + (r.actualStudents ?? 0), 0) / mondayLunch.length
    const avgOther = otherLunch.reduce((s, r) => s + (r.actualStudents ?? 0), 0) / otherLunch.length
    const diff = Math.round(((avgMon - avgOther) / avgOther) * 100)
    if (Math.abs(diff) > 5) {
      insights.push({ id: 'monday-lunch', tone: 'info', text: `Monday lunch demand is consistently ${Math.abs(diff)}% ${diff > 0 ? 'higher' : 'lower'} than the weekly average.` })
    }
  }

  // dinner vs breakfast waste
  const dinnerWaste = data.filter((r) => r.meal === 'dinner').reduce((s, r) => s + (r.wasteKg ?? 0), 0)
  const breakfastWaste = data.filter((r) => r.meal === 'breakfast').reduce((s, r) => s + (r.wasteKg ?? 0), 0)
  if (breakfastWaste > 0) {
    const diff = Math.round(((dinnerWaste - breakfastWaste) / breakfastWaste) * 100)
    if (diff > 10) insights.push({ id: 'dinner-waste', tone: 'warning', text: `Dinner produces ${diff}% more waste than breakfast.` })
  }

  // menu popularity
  const ranking = mealPopularityRanking(messId)
  const topMenuId = ranking[0]?.menuId
  const paneerRecord = data.find((r) => r.menuId === topMenuId)
  if (paneerRecord) {
    insights.push({ id: 'top-menu', tone: 'success', text: `The ${paneerRecord.weekday} ${paneerRecord.meal} menu on ${paneerRecord.date} has the highest student participation recorded so far.` })
  }

  // rice reduction opportunity
  const recentLunch = data.filter((r) => r.meal === 'lunch').slice(-7)
  const avgWaste = recentLunch.reduce((s, r) => s + (r.wasteKg ?? 0), 0) / (recentLunch.length || 1)
  if (avgWaste > 15) {
    insights.push({ id: 'rice-reduction', tone: 'info', text: `Reducing tomorrow's rice preparation by approximately ${Math.round(avgWaste * 0.4)} kg could reduce expected waste without affecting attendance.` })
  }

  // hostel dinner participation
  const hostelDemand = hostelWiseDemand(messId).sort((a, b) => b.students - a.students)
  if (hostelDemand[0]) {
    insights.push({ id: 'hostel-dinner', tone: 'info', text: `${hostelDemand[0].hostel} has the highest overall meal participation among the hostels this mess serves.` })
  }

  if (insights.length < 2) insights.push({ id: 'stable', tone: 'success', text: 'Forecast accuracy and waste levels have been stable over the last two weeks.' })

  return insights.slice(0, 6)
}

export interface Recommendation {
  id: string
  kind: 'prepare_less' | 'prepare_more' | 'menu_alert' | 'purchase_alert'
  title: string
  detail: string
}

export function generateRecommendations(messId: string): Recommendation[] {
  const recs: Recommendation[] = []
  const data = past(messId)

  const lunchLast7 = data.filter((r) => r.meal === 'lunch').slice(-7)
  const avgWasteRatio = lunchLast7.reduce((s, r) => s + wastePercent(r.preparedKg ?? 1, r.wasteKg ?? 0), 0) / (lunchLast7.length || 1)
  if (avgWasteRatio > 8) {
    recs.push({ id: 'rec-1', kind: 'prepare_less', title: 'Reduce rice preparation', detail: `Reduce rice preparation by ~${Math.round(avgWasteRatio)}% based on recent lunch waste trends.` })
  }

  const dalPopularity = MENU_ITEMS.find((m) => m.name === 'Dal Tadka')?.popularity ?? 1
  if (dalPopularity > 1.1) {
    recs.push({ id: 'rec-2', kind: 'prepare_more', title: 'Increase dal preparation', detail: 'Increase dal preparation by ~8% — recent attendance has consistently exceeded the forecast on dal days.' })
  }

  const highWasteMenus = data.filter((r) => wastePercent(r.preparedKg ?? 1, r.wasteKg ?? 0) > 15)
  if (highWasteMenus.length > 3) {
    recs.push({ id: 'rec-3', kind: 'menu_alert', title: 'Menu historically generates high waste', detail: `${highWasteMenus.length} meals in the last 90 days generated over 15% waste — consider reviewing these menus.` })
  }

  recs.push({ id: 'rec-4', kind: 'purchase_alert', title: 'Restock before shortage', detail: 'Purchase 50 kg of rice before the projected stockout in the next 10 days.' })

  return recs
}

export interface Anomaly {
  id: string
  severity: 'low' | 'medium' | 'high'
  text: string
}

export function detectAnomalies(messId: string): Anomaly[] {
  const anomalies: Anomaly[] = []
  const lunch = past(messId).filter((r) => r.meal === 'lunch').slice(-14)
  if (lunch.length >= 5) {
    const avg = lunch.slice(0, -1).reduce((s, r) => s + (r.actualStudents ?? 0), 0) / (lunch.length - 1)
    const latest = lunch[lunch.length - 1]
    if (latest.actualStudents != null && Math.abs(latest.actualStudents - avg) / avg > 0.2) {
      anomalies.push({
        id: 'attendance-drop',
        severity: 'high',
        text: `Unusual attendance ${latest.actualStudents < avg ? 'drop' : 'spike'} detected for lunch on ${latest.date}: ${latest.actualStudents} vs a typical ~${Math.round(avg)}.`,
      })
    }
  }
  const dinner = past(messId).filter((r) => r.meal === 'dinner').slice(-14)
  if (dinner.length >= 5) {
    const avgWaste = dinner.slice(0, -1).reduce((s, r) => s + (r.wasteKg ?? 0), 0) / (dinner.length - 1)
    const latest = dinner[dinner.length - 1]
    if (latest.wasteKg != null && avgWaste > 0 && latest.wasteKg / avgWaste > 1.6) {
      anomalies.push({ id: 'waste-spike', severity: 'medium', text: `Unusually high food waste detected for dinner on ${latest.date}: ${Math.round(latest.wasteKg)} kg vs a typical ~${Math.round(avgWaste)} kg.` })
    }
  }
  return anomalies
}

export function getSustainability(messId: string) {
  const stats = forecastErrorStats(past(messId).slice(-30).map((r) => ({ predicted: r.predictedStudents, actual: r.actualStudents ?? 0 })))
  const last30 = past(messId).slice(-120)
  const totalPrepared = last30.reduce((s, r) => s + (r.preparedKg ?? 0), 0)
  const totalWaste = last30.reduce((s, r) => s + (r.wasteKg ?? 0), 0)
  const utilization = totalPrepared ? ((totalPrepared - totalWaste) / totalPrepared) * 100 : 100
  const wasteReduction = Math.max(0, 100 - wastePercent(totalPrepared, totalWaste) * 6)
  const participation = 78 // illustrative, derived from average attendance/enrolled ratio
  const score = sustainabilityScore({
    wasteReductionScore: Math.round(wasteReduction),
    forecastAccuracy: stats.accuracy,
    foodUtilization: Math.round(utilization),
    studentParticipation: participation,
  })
  const wasteSavedKg = Math.round(totalPrepared * 0.03)
  return {
    score,
    badge: sustainabilityBadge(score),
    wasteReduction: Math.round(wasteReduction),
    forecastAccuracy: stats.accuracy,
    foodUtilization: Math.round(utilization),
    studentParticipation: participation,
    co2SavedKg: co2SavedKgEstimate(wasteSavedKg),
    waterSavedLitres: waterSavedLitresEstimate(wasteSavedKg),
    foodSavedKg: wasteSavedKg,
  }
}
