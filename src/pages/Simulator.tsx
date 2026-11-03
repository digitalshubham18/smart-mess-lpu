import { useMemo, useState } from 'react'
import { getRecord } from '@/data/mockOperations'
import { useMessStore } from '@/store/useMessStore'
import { addDaysISO, TODAY_ISO } from '@/utils/dateUtils'
import { DashboardCard, StatCard } from '@/components/ui/DashboardCard'
import { formatINR, formatKg, formatNumber } from '@/utils/formatters'
import { DemoBanner } from '@/components/ui/DemoBanner'

const tomorrow = addDaysISO(TODAY_ISO, 1)

export default function Simulator() {
  const messId = useMessStore((s) => s.currentMessId)
  const base = getRecord(messId, tomorrow, 'lunch')!
  const [attendanceDelta, setAttendanceDelta] = useState(0)
  const [priceDelta, setPriceDelta] = useState(0)
  const [buffer, setBuffer] = useState(base.safetyBufferPct)
  const [popularityDelta, setPopularityDelta] = useState(0)

  const result = useMemo(() => {
    const predicted = Math.round(base.predictedStudents * (1 + attendanceDelta / 100) * (1 + popularityDelta / 100))
    const servingSizeKg = 0.55
    const required = predicted * servingSizeKg
    const recommended = required * (1 + buffer / 100)
    const baseCostPerKg = 85 * (1 + priceDelta / 100)
    const expectedCost = recommended * baseCostPerKg
    const expectedWaste = recommended * 0.02
    const baselineCost = base.recommendedKg * 85
    const potentialSavings = Math.max(0, baselineCost - expectedCost)
    return { predicted, recommended, expectedCost, expectedWaste, potentialSavings }
  }, [attendanceDelta, priceDelta, buffer, popularityDelta, base])

  return (
    <div className="space-y-6">
      <DemoBanner what={'The simulator runs on sample figures.'} />
      <div>
        <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100">What-If Simulator</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Adjust the levers below to see how tomorrow's lunch forecast reacts.</p>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <DashboardCard title="Levers">
          <div className="space-y-6">
            <Slider label="Student attendance" value={attendanceDelta} onChange={setAttendanceDelta} min={-20} max={20} step={5} suffix="%" />
            <Slider label="Food price change" value={priceDelta} onChange={setPriceDelta} min={-15} max={25} step={5} suffix="%" />
            <Slider label="Safety buffer" value={buffer} onChange={setBuffer} min={0} max={20} step={1} suffix="%" />
            <Slider label="Menu popularity" value={popularityDelta} onChange={setPopularityDelta} min={-20} max={20} step={5} suffix="%" />
          </div>
        </DashboardCard>

        <DashboardCard title="Simulated Outcome">
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Predicted Demand" value={formatNumber(result.predicted)} sub="students" accent="tech" />
            <StatCard label="Food Preparation" value={formatKg(result.recommended)} accent="neutral" />
            <StatCard label="Expected Waste" value={formatKg(result.expectedWaste)} accent="rose" />
            <StatCard label="Expected Cost" value={formatINR(result.expectedCost)} accent="amber" />
          </div>
          <div className="mt-4 rounded-lg bg-eco-50 dark:bg-eco-500/10 p-3 text-sm text-eco-700 dark:text-eco-500">
            Potential savings vs. current plan: <strong>{formatINR(result.potentialSavings)}</strong>
          </div>
        </DashboardCard>
      </div>
    </div>
  )
}

function Slider({ label, value, onChange, min, max, step, suffix }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; suffix: string }) {
  return (
    <div>
      <div className="flex justify-between text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
        <span>{label}</span>
        <span className="text-slate-700 dark:text-slate-200 font-semibold">{value > 0 ? `+${value}` : value}{suffix}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} className="w-full accent-tech-500" />
    </div>
  )
}
