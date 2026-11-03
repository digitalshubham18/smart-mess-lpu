import { TrendingUp } from 'lucide-react'
import { StatusBadge } from './StatusBadge'
import { formatNumber, formatKg } from '@/utils/formatters'

export function ForecastCard({
  mealLabel,
  menuLabel,
  predicted,
  confidence,
  recommendedKg,
  confirmed,
  historicalExpected,
}: {
  mealLabel: string
  menuLabel: string
  predicted: number
  confidence: number
  recommendedKg: number
  confirmed: number
  historicalExpected: number
}) {
  return (
    <div className="rounded-xl border border-line dark:border-ink-700 bg-white dark:bg-ink-900 p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{mealLabel}</div>
          <div className="font-display font-semibold text-slate-800 dark:text-slate-100 mt-0.5">{menuLabel}</div>
        </div>
        <StatusBadge tone="info">{confidence}% confidence</StatusBadge>
      </div>
      <div className="mt-3 flex items-center gap-2 text-tech-600 dark:text-tech-500">
        <TrendingUp size={20} />
        <span className="text-3xl font-bold font-display">{formatNumber(predicted)}</span>
        <span className="text-sm text-slate-400 mb-0.5">students expected</span>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-4">
        {[
          ['Confirmed', formatNumber(confirmed)],
          ['Historical avg', formatNumber(historicalExpected)],
          ['Recommended', formatKg(recommendedKg)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-surface dark:bg-ink-800 p-2.5">
            <div className="text-[10px] text-slate-400">{k}</div>
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">{v}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
