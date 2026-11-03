import type { Expense } from '@/types'
import { randInt } from '@/lib/rng'
import { OPERATIONS } from './mockOperations'
import { MESSES } from './mockMesses'
import { addDaysISO, TODAY_ISO } from '@/utils/dateUtils'

let seq = 1

export function generateExpensesForMess(messId: string): Expense[] {
  const records: Expense[] = []
  for (let offset = -29; offset <= 0; offset++) {
    const date = addDaysISO(TODAY_ISO, offset)
    const dayOps = OPERATIONS.filter((r) => r.messId === messId && r.date === date && !r.isFuture)
    const ingredientCost = dayOps.reduce((s, r) => s + (r.preparedKg ?? 0) * 55, 0)
    records.push({ id: `EXP-${seq++}`, messId, date, category: 'ingredients', amount: Math.round(ingredientCost), description: 'Daily ingredient procurement' })
    records.push({ id: `EXP-${seq++}`, messId, date, category: 'labor', amount: randInt(9000, 12000), description: 'Kitchen and service staff wages' })
    records.push({ id: `EXP-${seq++}`, messId, date, category: 'utilities', amount: randInt(2200, 3800), description: 'Gas and electricity' })
    records.push({ id: `EXP-${seq++}`, messId, date, category: 'transport', amount: randInt(800, 2000), description: 'Supplier delivery and logistics' })
    const wasteCost = dayOps.reduce((s, r) => s + (r.wasteCost ?? 0), 0)
    records.push({ id: `EXP-${seq++}`, messId, date, category: 'waste', amount: Math.round(wasteCost), description: 'Estimated cost of food wasted' })
  }
  return records
}

export const EXPENSES: Expense[] = MESSES.flatMap((m) => generateExpensesForMess(m.id))
