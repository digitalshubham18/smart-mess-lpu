import { useMemo } from 'react'
import { BarChart, Bar, PieChart, Pie, Cell, AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, Legend } from 'recharts'
import { dailyWasteSeries, mealWiseWaste, topWasteContributors, wasteByReason, hostelWiseWasteEstimate } from '@/services/wasteService'
import { ChartCard, DashboardCard, StatCard } from '@/components/ui/DashboardCard'
import { formatKg } from '@/utils/formatters'
import { hostelsForMess } from '@/data/mockMesses'
import { STUDENTS } from '@/data/mockStudents'
import { Leaf } from 'lucide-react'
import { DemoBanner } from '@/components/ui/DemoBanner'
import { RealWasteSummary } from '@/components/waste/RealWasteSummary'
import { useMessStore } from '@/store/useMessStore'

const PIE_COLORS = ['#3554D1', '#1F8A5F', '#D97D0A', '#C0392B', '#8B93A2', '#7C3AED', '#0EA5A5', '#DB2777', '#65A30D']

export default function WasteAnalytics() {
  const messId = useMessStore((s) => s.currentMessId)
  const messHostels = useMemo(() => hostelsForMess(messId), [messId])
  const daily = useMemo(() => Object.entries(dailyWasteSeries(messId, 30)).map(([date, wasteKg]) => ({ date, wasteKg: Math.round(wasteKg) })), [messId]);
  const mealWise = useMemo(() => mealWiseWaste(messId), [messId])
  const topContributors = useMemo(() => topWasteContributors(messId, 6), [messId])
  const byReason = useMemo(() => wasteByReason(messId), [messId])
  const hostelShares = useMemo(() => {
    const messStudentCount = STUDENTS.filter((s) => messHostels.some((h) => h.id === s.hostelId)).length || 1
    return messHostels.map((h) => ({ hostelId: h.id, share: STUDENTS.filter((s) => s.hostelId === h.id).length / messStudentCount }))
  }, [messHostels])
  const hostelWaste = useMemo(() => hostelWiseWasteEstimate(messId, hostelShares), [messId, hostelShares])

  const mealWiseData = Object.entries(mealWise).map(([meal, kg]) => ({ meal, wasteKg: Math.round(kg) }))
  const totalWaste = topContributors.reduce((s, c) => s + c.wasteKg, 0)

  return (
    <div className="space-y-6">
      <RealWasteSummary messId={messId} />
      <DemoBanner what={'The charts BELOW are built from sample waste data; the card above is your real recorded entries.'} detail={'trust the card above.'} />
      <div>
        <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100">Waste Analytics</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Understand where, when, and why food waste happens.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Waste (90d)" value={formatKg(Object.values(mealWise).reduce((a, b) => a + b, 0))} icon={Leaf} accent="rose" />
        <StatCard label="Highest Waste Meal" value={mealWiseData.sort((a, b) => b.wasteKg - a.wasteKg)[0]?.meal ?? '—'} accent="amber" />
        <StatCard label="Top Contributor" value={topContributors[0]?.name ?? '—'} sub={topContributors[0] ? formatKg(topContributors[0].wasteKg) : ''} accent="rose" />
        <StatCard label="Top Waste Reason" value={byReason[0]?.reason ?? '—'} accent="neutral" />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <ChartCard title="Daily Waste Trend" subtitle="Last 30 days">
          <AreaChart data={daily}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-line dark:stroke-ink-700" />
            <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={(d) => String(d).slice(5)} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Area type="monotone" dataKey="wasteKg" stroke="#C0392B" fill="#C0392B" fillOpacity={0.15} strokeWidth={2} />
          </AreaChart>
        </ChartCard>
        <ChartCard title="Meal-wise Waste">
          <BarChart data={mealWiseData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-line dark:stroke-ink-700" />
            <XAxis dataKey="meal" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="wasteKg" fill="#3554D1" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartCard>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <ChartCard title="Reason-wise Waste">
          <PieChart>
            <Pie data={byReason} dataKey="wasteKg" nameKey="reason" outerRadius={90} label={{ fontSize: 10 }}>
              {byReason.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
            </Pie>
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 10 }} />
          </PieChart>
        </ChartCard>
        <DashboardCard title="Top Waste Contributors">
          <ol className="space-y-2.5">
            {topContributors.map((c, i) => (
              <li key={c.itemId} className="flex items-center justify-between text-sm">
                <span>{i + 1}. {c.name}</span>
                <div className="flex items-center gap-2">
                  <div className="w-24 h-1.5 rounded-full bg-surface-dim dark:bg-ink-800 overflow-hidden">
                    <div className="h-full bg-rose-500" style={{ width: `${totalWaste ? (c.wasteKg / totalWaste) * 100 : 0}%` }} />
                  </div>
                  <span className="font-semibold w-16 text-right">{formatKg(c.wasteKg)}</span>
                </div>
              </li>
            ))}
          </ol>
        </DashboardCard>
      </div>

      <DashboardCard title="Hostel-wise Waste (estimated)">
        <div className="grid md:grid-cols-4 gap-3">
          {hostelWaste.map((h) => (
            <div key={h.hostelId} className="rounded-lg bg-surface dark:bg-ink-800 p-3">
              <div className="text-xs text-slate-400">{messHostels.find((x) => x.id === h.hostelId)?.name}</div>
              <div className="font-display font-bold text-slate-700 dark:text-slate-200 mt-1">{formatKg(h.wasteKg)}</div>
            </div>
          ))}
        </div>
      </DashboardCard>
    </div>
  )
}
