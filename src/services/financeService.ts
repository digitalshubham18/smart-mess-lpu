import { EXPENSES, generateExpensesForMess } from '@/data/mockExpenses'
import { OPERATIONS } from '@/data/mockOperations'
import { getMessSettingsSync } from './messSettingsService'
import { withDelay } from './api'

let expenses = [...EXPENSES]

export async function listExpenses(messId: string) {
  return withDelay(expenses.filter((e) => e.messId === messId), 250)
}

export function expensesByCategory(messId: string, days = 30) {
  const messExpenses = expenses.filter((e) => e.messId === messId)
  const cutoffIndex = messExpenses.length - days * 5
  const recent = messExpenses.slice(Math.max(0, cutoffIndex))
  const totals: Record<string, number> = {}
  recent.forEach((e) => {
    totals[e.category] = (totals[e.category] ?? 0) + e.amount
  })
  return Object.entries(totals).map(([category, amount]) => ({ category, amount: Math.round(amount) }))
}

export function monthlyExpenseTrend(messId: string) {
  const byDate: Record<string, number> = {}
  expenses.filter((e) => e.messId === messId).forEach((e) => {
    byDate[e.date] = (byDate[e.date] ?? 0) + e.amount
  })
  return Object.entries(byDate).map(([date, amount]) => ({ date, amount: Math.round(amount) }))
}

export function costPerMealTrend(messId: string) {
  const dates = Array.from(new Set(OPERATIONS.filter((r) => r.messId === messId && !r.isFuture).map((r) => r.date))).slice(-30)
  return dates.map((date) => {
    const dayExpenses = expenses.filter((e) => e.messId === messId && e.date === date).reduce((s, e) => s + e.amount, 0)
    const dayMeals = OPERATIONS.filter((r) => r.messId === messId && r.date === date && !r.isFuture).reduce((s, r) => s + (r.actualStudents ?? 0), 0)
    return { date, costPerMeal: dayMeals ? Math.round((dayExpenses / dayMeals) * 100) / 100 : 0 }
  })
}

export function savingsCalculator(messId: string) {
  const wasteExpenses = expenses.filter((e) => e.messId === messId && e.category === 'waste')
  const half = Math.floor(wasteExpenses.length / 2)
  const previousMonthWaste = wasteExpenses.slice(0, half).reduce((s, e) => s + e.amount, 0)
  const currentMonthWaste = wasteExpenses.slice(half).reduce((s, e) => s + e.amount, 0)
  const monthlySavings = Math.max(0, previousMonthWaste - currentMonthWaste)
  return {
    previousMonthWaste: Math.round(previousMonthWaste),
    currentMonthWaste: Math.round(currentMonthWaste),
    monthlySavings: Math.round(monthlySavings),
    annualProjectedSavings: Math.round(monthlySavings * 12),
  }
}

/** Seeds 30 days of expense history for a newly created mess. No-op if it already has some. */
export function ensureExpensesForMess(messId: string) {
  if (expenses.some((e) => e.messId === messId)) return
  expenses = [...expenses, ...generateExpensesForMess(messId)]
}

export interface BudgetStatus {
  cap: number
  spent: number
  pct: number
  overBudget: boolean
  nearBudget: boolean
}

/** Month-to-date spend for a mess against its configured monthly budget cap (Settings page). */
export function budgetStatus(messId: string, today: string): BudgetStatus {
  const monthPrefix = today.slice(0, 7) // "YYYY-MM"
  const spent = Math.round(expenses.filter((e) => e.messId === messId && e.date.startsWith(monthPrefix)).reduce((s, e) => s + e.amount, 0))
  const cap = getMessSettingsSync(messId).monthlyBudgetCap || 0
  const pct = cap > 0 ? Math.round((spent / cap) * 100) : 0
  return { cap, spent, pct, overBudget: cap > 0 && spent > cap, nearBudget: cap > 0 && pct >= 90 && pct <= 100 }
}

/** Fully regenerates a mess's expense history from its (now current) operations data. */
export function regenerateExpensesForMess(messId: string) {
  expenses = expenses.filter((e) => e.messId !== messId)
  expenses = [...expenses, ...generateExpensesForMess(messId)]
}
