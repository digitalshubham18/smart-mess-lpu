import { Leaf } from 'lucide-react'
import { StatusBadge } from './StatusBadge'
import { formatKg, formatINR } from '@/utils/formatters'

export function WasteCard({
  mealLabel,
  preparedKg,
  wasteKg,
  wastePct,
  cost,
}: {
  mealLabel: string
  preparedKg: number
  wasteKg: number
  wastePct: number
  cost: number
}) {
  const tone = wastePct > 12 ? 'danger' : wastePct > 7 ? 'warning' : 'success'
  return (
    <div className="rounded-xl border border-line dark:border-ink-700 bg-white dark:bg-ink-900 p-5">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{mealLabel}</div>
        <StatusBadge tone={tone}>{wastePct.toFixed(1)}% waste</StatusBadge>
      </div>
      <div className="mt-3 flex items-center gap-2 text-rose-500">
        <Leaf size={20} />
        <span className="text-2xl font-bold font-display">{formatKg(wasteKg)}</span>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span>Prepared {formatKg(preparedKg)}</span>
        <span className="font-semibold text-slate-700 dark:text-slate-200">{formatINR(cost)}</span>
      </div>
    </div>
  )
}
