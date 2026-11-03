import { useState } from 'react'
import { Download, Printer, FileJson } from 'lucide-react'
import { generateReport, type ReportPeriod, downloadCSV, downloadJSON, printReport } from '@/services/reportService'
import { generateAIInsights } from '@/services/analyticsService'
import { mealPopularityRanking } from '@/services/analyticsService'
import { DashboardCard, StatCard } from '@/components/ui/DashboardCard'
import { DatePicker } from '@/components/ui/DatePicker'
import { formatINR, formatKg, formatNumber, formatPct } from '@/utils/formatters'
import { TODAY_ISO } from '@/utils/dateUtils'
import { useMessStore } from '@/store/useMessStore'
import type { DailyReportSummary } from '@/types'
import { DemoBanner } from '@/components/ui/DemoBanner'

export default function Reports() {
  const messId = useMessStore((s) => s.currentMessId)
  const [period, setPeriod] = useState<ReportPeriod>('daily')
  const [date, setDate] = useState(TODAY_ISO)
  const [report, setReport] = useState<DailyReportSummary | null>(null)
  const [loading, setLoading] = useState(false)

  async function generate() {
    setLoading(true)
    const r = await generateReport(messId, period, date)
    setReport(r)
    setLoading(false)
  }

  const insights = report ? generateAIInsights(messId).slice(0, 3) : []
  const popular = report ? mealPopularityRanking(messId).slice(0, 3) : []

  return (
    <div className="space-y-6">
      <DemoBanner what={'The reports are generated from sample data.'} detail={'for real attendance use the CSV export on the Attendance page.'} />
      <div>
        <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100">Reports</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Generate daily, weekly, monthly, or yearly summaries.</p>
      </div>

      <DashboardCard title="Generate Report">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-500">Period</span>
            <select value={period} onChange={(e) => setPeriod(e.target.value as ReportPeriod)} className="rounded-lg border border-line dark:border-ink-700 bg-white dark:bg-ink-900 px-3 py-2 text-sm">
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </label>
          <DatePicker label="As of" value={date} onChange={setDate} max={TODAY_ISO} />
          <button onClick={generate} disabled={loading} className="rounded-lg bg-tech-500 text-white text-sm font-semibold px-4 py-2.5 disabled:opacity-60">
            {loading ? 'Generating…' : 'Generate Report'}
          </button>
        </div>
      </DashboardCard>

      {report && (
        <div className="space-y-5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h2 className="font-display font-semibold text-slate-800 dark:text-slate-100">{period[0].toUpperCase() + period.slice(1)} Report — {report.date}</h2>
            <div className="flex gap-2">
              <button onClick={() => downloadCSV(`report-${period}-${report.date}.csv`, [report as any])} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-line dark:border-ink-700">
                <Download size={13} /> CSV
              </button>
              <button onClick={() => downloadJSON(`report-${period}-${report.date}.json`, report)} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-line dark:border-ink-700">
                <FileJson size={13} /> JSON
              </button>
              <button onClick={printReport} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-line dark:border-ink-700">
                <Printer size={13} /> Print
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Total Students" value={formatNumber(report.totalStudents)} />
            <StatCard label="Total Meals" value={formatNumber(report.totalMeals)} />
            <StatCard label="Food Prepared" value={formatKg(report.totalPreparedKg)} />
            <StatCard label="Food Consumed" value={formatKg(report.totalConsumedKg)} />
            <StatCard label="Food Wasted" value={formatKg(report.totalWasteKg)} accent="rose" />
            <StatCard label="Waste %" value={formatPct(report.wastePct)} accent="rose" />
            <StatCard label="Forecast Accuracy" value={formatPct(report.forecastAccuracy)} accent="tech" />
            <StatCard label="Total Cost" value={formatINR(report.totalCost)} />
            <StatCard label="Waste Cost" value={formatINR(report.wasteCost)} accent="rose" />
            <StatCard label="Savings" value={formatINR(report.savings)} accent="eco" />
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            <DashboardCard title="Most Popular Menus">
              <ol className="space-y-1.5 text-sm">
                {popular.map((p, i) => <li key={p.menuId}>{i + 1}. {p.label}</li>)}
              </ol>
            </DashboardCard>
            <DashboardCard title="Recommendations">
              <ul className="space-y-1.5 text-sm text-slate-600 dark:text-slate-300 list-disc list-inside">
                {insights.map((ins) => <li key={ins.id}>{ins.text}</li>)}
              </ul>
            </DashboardCard>
          </div>
        </div>
      )}
    </div>
  )
}
