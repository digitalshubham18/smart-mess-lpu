import { useState } from 'react'
import type { ForecastMethod, MealType } from '@/types'
import { MEAL_TYPES } from '@/data/mockOperations'
import { FORECAST_METHOD_LABELS, allForecastMethods } from '@/services/forecastService'
import { useForecast } from '@/hooks/useForecast'
import { DashboardCard, StatCard } from '@/components/ui/DashboardCard'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { DatePicker } from '@/components/ui/DatePicker'
import { formatKg, formatINR, formatNumber } from '@/utils/formatters'
import { addDaysISO, TODAY_ISO, formatFull } from '@/utils/dateUtils'
import { buildMenuForDate, ITEMS_BY_ID } from '@/data/mockMenus'
import { useMessStore } from '@/store/useMessStore'
import { getMessSettingsSync } from '@/services/messSettingsService'

const tomorrow = addDaysISO(TODAY_ISO, 1)

export default function Forecast() {
  const [date, setDate] = useState(tomorrow)
  const [method, setMethod] = useState<ForecastMethod>('weekday_average')

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100">Smart Demand Forecasting</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{formatFull(date)}</p>
        </div>
        <div className="flex items-end gap-3">
          <DatePicker label="Forecast date" value={date} onChange={setDate} min={TODAY_ISO} />
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Method</span>
            <select value={method} onChange={(e) => setMethod(e.target.value as ForecastMethod)} className="rounded-lg border border-line dark:border-ink-700 bg-white dark:bg-ink-900 px-3 py-2 text-sm">
              {allForecastMethods().map((m) => (
                <option key={m} value={m}>{FORECAST_METHOD_LABELS[m]}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        {MEAL_TYPES.map((mt) => (
          <MealForecastCard key={mt.key} date={date} meal={mt.key} method={method} label={mt.label} servingSizeKg={mt.servingSizeKg} />
        ))}
      </div>
    </div>
  )
}

function MealForecastCard({ date, meal, method, label, servingSizeKg }: { date: string; meal: MealType; method: ForecastMethod; label: string; servingSizeKg: number }) {
  const messId = useMessStore((s) => s.currentMessId)
  const { data, loading, error } = useForecast(date, meal, method)
  const menu = buildMenuForDate(date, meal)
  const menuLabel = menu.itemIds.map((id) => ITEMS_BY_ID[id]?.name).filter(Boolean).join(' + ')

  return (
    <DashboardCard title={label}>
      <p className="text-xs text-slate-400 -mt-3 mb-3">{menuLabel}</p>
      {loading ? (
        <div className="text-sm text-slate-400">Computing forecast…</div>
      ) : error || !data ? (
        <div role="alert" className="text-sm text-rose-500">{error ?? 'No data available.'}</div>
      ) : data.predictedStudents == null ? (
        <p data-testid="no-forecast" className="text-sm text-slate-500 dark:text-slate-400">{data.note}</p>
      ) : (
        <>
          {data.note && <StatusBadge tone="warning">{data.note}</StatusBadge>}
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-3xl font-bold font-display text-tech-600 dark:text-tech-500">{formatNumber(data.predictedStudents)}</span>
            <span className="text-sm text-slate-400">
              students · {data.confidence == null ? 'confidence not measurable yet' : `${data.confidence}% confidence (backtested)`}
            </span>
          </div>
          {data.recommendedKg != null && data.expectedCost != null && (
            <div className="grid grid-cols-2 gap-2 mt-4">
              <StatCard label="Recommended Prep" value={formatKg(data.recommendedKg)} accent="tech" />
              <StatCard label="Expected Cost" value={formatINR(data.expectedCost)} accent="neutral" />
            </div>
          )}
          <div className="mt-4 pt-3 border-t border-line dark:border-ink-700 grid grid-cols-3 gap-2 text-xs">
            <MiniStat label="Said they'll eat" value={`${formatNumber(data.evidence.willEat)} / ${formatNumber(data.evidence.eligibleStudents)}`} />
            <MiniStat label="Recent average" value={data.evidence.historicalAverage == null ? '—' : formatNumber(data.evidence.historicalAverage)} />
            <MiniStat label="Days of history" value={formatNumber(data.evidence.historyDays)} />
          </div>
          <p className="text-[11px] text-slate-400 mt-3">
            Built from this mess's recorded check-ins{data.evidence.willEat > 0 ? ' and submitted meal intentions' : ''}. Recommended = predicted × {servingSizeKg} kg serving × (1 + {getMessSettingsSync(messId).bufferPct}% safety buffer).
          </p>
        </>
      )}
    </DashboardCard>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface dark:bg-ink-800 p-2 text-center">
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className="font-semibold text-slate-700 dark:text-slate-200">{value}</div>
    </div>
  )
}
