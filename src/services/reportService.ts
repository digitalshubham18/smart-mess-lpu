import type { DailyReportSummary } from '@/types'
import { OPERATIONS } from '@/data/mockOperations'
import { forecastErrorStats, wastePercent } from '@/utils/calculations'
import { withDelay } from './api'

export type ReportPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly'

const PERIOD_DAYS: Record<ReportPeriod, number> = { daily: 1, weekly: 7, monthly: 30, yearly: 90 }

export async function generateReport(messId: string, period: ReportPeriod, endDate: string): Promise<DailyReportSummary> {
  const days = PERIOD_DAYS[period]
  const records = OPERATIONS.filter((r) => r.messId === messId && r.date <= endDate && !r.isFuture).slice(-days * 4)

  const totalStudents = records.reduce((s, r) => s + (r.actualStudents ?? 0), 0)
  const totalPreparedKg = records.reduce((s, r) => s + (r.preparedKg ?? 0), 0)
  const totalConsumedKg = records.reduce((s, r) => s + (r.consumedKg ?? 0), 0)
  const totalWasteKg = records.reduce((s, r) => s + (r.wasteKg ?? 0), 0)
  const wasteCost = records.reduce((s, r) => s + (r.wasteCost ?? 0), 0)
  const stats = forecastErrorStats(records.map((r) => ({ predicted: r.predictedStudents, actual: r.actualStudents ?? 0 })))
  const totalCost = Math.round(totalPreparedKg * 75)
  const savings = Math.round(wasteCost * 0.35)

  return withDelay(
    {
      date: endDate,
      totalStudents,
      totalMeals: records.length,
      totalPreparedKg: Math.round(totalPreparedKg),
      totalConsumedKg: Math.round(totalConsumedKg),
      totalWasteKg: Math.round(totalWasteKg),
      wastePct: Math.round(wastePercent(totalPreparedKg, totalWasteKg) * 10) / 10,
      forecastAccuracy: stats.accuracy,
      totalCost,
      wasteCost: Math.round(wasteCost),
      savings,
    },
    400
  )
}

export function toCSV(rows: Record<string, string | number>[]): string {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  const lines = [headers.join(',')]
  rows.forEach((row) => lines.push(headers.map((h) => String(row[h] ?? '')).join(',')))
  return lines.join('\n')
}

export function downloadCSV(filename: string, rows: Record<string, string | number>[]) {
  const csv = toCSV(rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function downloadJSON(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function printReport() {
  window.print()
}
