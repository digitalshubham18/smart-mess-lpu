import { useMemo } from 'react'
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend } from 'recharts'
import { collegeOverviewSummary } from '@/services/analyticsService'
import { ChartCard, StatCard } from '@/components/ui/DashboardCard'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatINR, formatNumber, formatPct } from '@/utils/formatters'
import { TODAY_ISO, formatFull } from '@/utils/dateUtils'
import { Building2, Target, Leaf, Users } from 'lucide-react'
import type { MessOverview } from '@/services/analyticsService'
import { DemoBanner } from '@/components/ui/DemoBanner'

export default function CollegeOverview() {
  const rows = useMemo(() => collegeOverviewSummary(TODAY_ISO), [])

  const totals = rows.reduce(
    (acc, r) => ({
      students: acc.students + r.totalStudents,
      expected: acc.expected + r.todayExpected,
      actual: acc.actual + r.todayActual,
      wasteCost: acc.wasteCost + r.wasteCost90d,
    }),
    { students: 0, expected: 0, actual: 0, wasteCost: 0 }
  )
  const avgAccuracy = rows.length ? Math.round((rows.reduce((s, r) => s + r.forecastAccuracy, 0) / rows.length) * 10) / 10 : 0

  const chartData = rows.map((r) => ({ name: r.messName, 'Forecast Accuracy %': r.forecastAccuracy, 'Waste %': r.wastePct }))

  const columns: Column<MessOverview>[] = [
    { key: 'messName', header: 'Mess', accessor: (r) => r.messName, sortValue: (r) => r.messName },
    { key: 'totalStudents', header: 'Students', accessor: (r) => formatNumber(r.totalStudents), sortValue: (r) => r.totalStudents },
    { key: 'todayExpected', header: 'Expected Today', accessor: (r) => formatNumber(r.todayExpected), sortValue: (r) => r.todayExpected },
    { key: 'todayActual', header: 'Actual Today', accessor: (r) => formatNumber(r.todayActual), sortValue: (r) => r.todayActual },
    {
      key: 'forecastAccuracy', header: 'Forecast Accuracy', accessor: (r) => (
        <StatusBadge tone={r.forecastAccuracy >= 90 ? 'success' : r.forecastAccuracy >= 80 ? 'warning' : 'danger'}>{formatPct(r.forecastAccuracy)}</StatusBadge>
      ), sortValue: (r) => r.forecastAccuracy,
    },
    {
      key: 'wastePct', header: 'Waste Rate', accessor: (r) => (
        <StatusBadge tone={r.wastePct <= 7 ? 'success' : r.wastePct <= 12 ? 'warning' : 'danger'}>{formatPct(r.wastePct)}</StatusBadge>
      ), sortValue: (r) => r.wastePct,
    },
    { key: 'wasteCost90d', header: 'Waste Cost (90d)', accessor: (r) => formatINR(r.wasteCost90d), sortValue: (r) => r.wasteCost90d },
  ]

  return (
    <div className="space-y-6">
      <DemoBanner what={'The university-wide figures are sample data.'} />
      <div>
        <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100">College Overview</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Every mess, side by side — {formatFull(TODAY_ISO)}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Students (all messes)" value={formatNumber(totals.students)} icon={Users} accent="tech" />
        <StatCard label="Expected Today (all messes)" value={formatNumber(totals.expected)} icon={Building2} accent="neutral" />
        <StatCard label="Avg. Forecast Accuracy" value={formatPct(avgAccuracy)} icon={Target} accent="tech" />
        <StatCard label="Waste Cost — 90d (all messes)" value={formatINR(totals.wasteCost)} icon={Leaf} accent="rose" />
      </div>

      <ChartCard title="Forecast Accuracy vs Waste Rate by Mess" height={280}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-line dark:stroke-ink-700" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="Forecast Accuracy %" fill="#1F8A5F" radius={[4, 4, 0, 0]} />
          <Bar dataKey="Waste %" fill="#C0392B" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ChartCard>

      <DataTable data={rows} columns={columns} rowKey={(r) => r.messId} searchableText={(r) => r.messName} filename="college-overview.csv" />
    </div>
  )
}
