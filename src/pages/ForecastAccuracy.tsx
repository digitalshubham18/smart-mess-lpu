import { useEffect, useMemo, useState } from 'react'
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend } from 'recharts'
import * as forecastService from '@/services/forecastService'
import { useMessStore } from '@/store/useMessStore'
import { forecastErrorStats } from '@/utils/calculations'
import { ChartCard, StatCard } from '@/components/ui/DashboardCard'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { formatNumber, formatPct } from '@/utils/formatters'
import { Target, TrendingUp, Activity } from 'lucide-react'

interface Row { date: string; meal: string; predicted: number; actual: number; diff: number; absError: number; pctError: number }

export default function ForecastAccuracy() {
  const messId = useMessStore((s) => s.currentMessId)
  const [range, setRange] = useState(30)

  const [raw, setRaw] = useState<forecastService.AccuracyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Real backtest from the server: each past day predicted using only the days before it.
  useEffect(() => {
    let current = true
    setLoading(true); setError('')
    forecastService.getForecastAccuracy(messId, range, 'weekday_average')
      .then((r) => { if (current) setRaw(r) })
      .catch((e) => { if (current) { setRaw([]); setError(e instanceof Error ? e.message : 'Could not load accuracy.') } })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [messId, range])

  const rows: Row[] = useMemo(() => raw.map((r) => {
    const diff = r.actual - r.predicted
    return { date: r.date, meal: r.meal, predicted: r.predicted, actual: r.actual, diff, absError: Math.abs(diff), pctError: Math.round((Math.abs(diff) / (r.actual || 1)) * 1000) / 10 }
  }), [raw])

  const stats = useMemo(() => forecastErrorStats(rows.map((r) => ({ predicted: r.predicted, actual: r.actual }))), [rows])

  const chartData = useMemo(() => {
    const byDate: Record<string, { predicted: number; actual: number }> = {}
    rows.forEach((r) => {
      byDate[r.date] ??= { predicted: 0, actual: 0 }
      byDate[r.date].predicted += r.predicted
      byDate[r.date].actual += r.actual
    })
    return Object.entries(byDate).map(([date, v]) => ({ date, ...v }))
  }, [rows])

  const columns: Column<Row>[] = [
    { key: 'date', header: 'Date', accessor: (r) => r.date, sortValue: (r) => r.date },
    { key: 'meal', header: 'Meal', accessor: (r) => r.meal, sortValue: (r) => r.meal },
    { key: 'predicted', header: 'Predicted', accessor: (r) => formatNumber(r.predicted), sortValue: (r) => r.predicted },
    { key: 'actual', header: 'Actual', accessor: (r) => formatNumber(r.actual), sortValue: (r) => r.actual },
    { key: 'diff', header: 'Difference', accessor: (r) => (r.diff > 0 ? `+${r.diff}` : r.diff), sortValue: (r) => r.diff },
    { key: 'absError', header: 'Absolute Error', accessor: (r) => formatNumber(r.absError), sortValue: (r) => r.absError },
    { key: 'pctError', header: '% Error', accessor: (r) => formatPct(r.pctError), sortValue: (r) => r.pctError },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100">Forecast Accuracy</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Predicted vs actual demand — each day predicted using only the days before it, from this mess's recorded check-ins</p>
        </div>
        <select value={range} onChange={(e) => setRange(+e.target.value)} className="rounded-lg border border-line dark:border-ink-700 bg-white dark:bg-ink-900 px-3 py-2 text-sm">
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
      {!loading && !error && rows.length === 0 && (
        <p data-testid="no-accuracy" className="text-sm rounded-xl bg-surface-dim dark:bg-ink-800 text-slate-500 px-4 py-3">No recorded check-in history for this mess in this period yet — accuracy appears once enough days of check-ins have been recorded.</p>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Forecast Accuracy" value={formatPct(stats.accuracy)} icon={Target} accent="tech" />
        <StatCard label="MAE" value={formatNumber(stats.mae)} sub="students" icon={Activity} accent="neutral" />
        <StatCard label="MAPE" value={formatPct(stats.mape)} icon={TrendingUp} accent="amber" />
        <StatCard label="RMSE" value={formatNumber(stats.rmse)} sub="students" icon={Activity} accent="neutral" />
      </div>

      <ChartCard title="Predicted vs Actual Demand" height={300}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-line dark:stroke-ink-700" />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => d.slice(5)} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="predicted" name="Predicted" stroke="#3554D1" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="actual" name="Actual" stroke="#1F8A5F" strokeWidth={2} dot={false} />
        </LineChart>
      </ChartCard>

      <DataTable data={rows} columns={columns} rowKey={(r) => `${r.date}-${r.meal}`} searchableText={(r) => `${r.date} ${r.meal}`} filename="forecast-accuracy.csv" />
    </div>
  )
}
