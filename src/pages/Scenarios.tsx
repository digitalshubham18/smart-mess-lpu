import { useMemo } from 'react'
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend } from 'recharts'
import { getRecord } from '@/data/mockOperations'
import { useMessStore } from '@/store/useMessStore'
import { addDaysISO, TODAY_ISO } from '@/utils/dateUtils'
import { ChartCard, DashboardCard } from '@/components/ui/DashboardCard'
import { formatNumber } from '@/utils/formatters'
import { DemoBanner } from '@/components/ui/DemoBanner'

const SCENARIOS = [
  { key: 'normal', label: 'Normal Day', impact: 0 },
  { key: 'exam', label: 'Exam Day', impact: -13 },
  { key: 'holiday', label: 'Holiday', impact: -35 },
  { key: 'festival', label: 'Festival', impact: 20 },
  { key: 'rainy', label: 'Rainy Day', impact: -8 },
  { key: 'event', label: 'College Event', impact: 10 },
]

const tomorrow = addDaysISO(TODAY_ISO, 1)

export default function Scenarios() {
  const messId = useMessStore((s) => s.currentMessId)
  const base = getRecord(messId, tomorrow, 'lunch')!

  const data = useMemo(
    () => SCENARIOS.map((s) => ({ scenario: s.label, predicted: Math.round(base.predictedStudents * (1 + s.impact / 100)) })),
    [base]
  )

  return (
    <div className="space-y-6">
      <DemoBanner what={'Scenarios run on sample figures.'} />
      <div>
        <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100">Scenario Planner</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Compare predicted lunch demand for {tomorrow} across common scenarios.</p>
      </div>

      <ChartCard title="Predicted Demand by Scenario" height={320}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-line dark:stroke-ink-700" />
          <XAxis dataKey="scenario" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="predicted" name="Predicted students" fill="#3554D1" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ChartCard>

      <div className="grid md:grid-cols-3 gap-4">
        {SCENARIOS.map((s) => (
          <DashboardCard key={s.key} title={s.label}>
            <div className="text-2xl font-bold font-display text-tech-600 dark:text-tech-500">
              {formatNumber(Math.round(base.predictedStudents * (1 + s.impact / 100)))}
            </div>
            <p className="text-xs text-slate-400 mt-1">{s.impact > 0 ? `+${s.impact}` : s.impact}% vs. baseline forecast</p>
          </DashboardCard>
        ))}
      </div>
    </div>
  )
}
