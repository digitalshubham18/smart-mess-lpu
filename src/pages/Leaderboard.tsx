import { useMemo } from 'react'
import { Trophy, Medal, Leaf } from 'lucide-react'
import { MESSES } from '@/data/mockMesses'
import { collegeOverviewSummary, getSustainability } from '@/services/analyticsService'
import { TODAY_ISO } from '@/utils/dateUtils'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { StatusBadge, ProgressBar } from '@/components/ui/StatusBadge'
import { formatNumber } from '@/utils/formatters'
import { DemoBanner } from '@/components/ui/DemoBanner'

interface Row {
  rank: number
  messId: string
  messName: string
  students: number
  score: number
  badge: string
  wastePct: number
  forecastAccuracy: number
}

const MEDAL_COLORS = ['text-amber-500', 'text-slate-400', 'text-amber-700']

export default function Leaderboard() {
  const rows: Row[] = useMemo(() => {
    const overview = collegeOverviewSummary(TODAY_ISO)
    const combined = MESSES.map((m) => {
      const o = overview.find((x) => x.messId === m.id)
      const sus = getSustainability(m.id)
      return {
        messId: m.id,
        messName: m.name,
        students: o?.totalStudents ?? 0,
        score: sus.score,
        badge: sus.badge,
        wastePct: o?.wastePct ?? 0,
        forecastAccuracy: o?.forecastAccuracy ?? 0,
      }
    }).sort((a, b) => b.score - a.score)
    return combined.map((r, i) => ({ ...r, rank: i + 1 }))
  }, [])

  const columns: Column<Row>[] = [
    {
      key: 'rank', header: '#', accessor: (r) => (
        r.rank <= 3
          ? <Medal size={16} className={MEDAL_COLORS[r.rank - 1]} />
          : <span className="text-slate-400 text-xs">{r.rank}</span>
      ), sortValue: (r) => r.rank,
    },
    { key: 'mess', header: 'Mess', accessor: (r) => r.messName, sortValue: (r) => r.messName },
    { key: 'students', header: 'Students', accessor: (r) => formatNumber(r.students), sortValue: (r) => r.students },
    {
      key: 'score', header: 'Sustainability Score', accessor: (r) => (
        <div className="flex items-center gap-2 w-32">
          <ProgressBar value={r.score} max={100} tone={r.score >= 70 ? 'success' : r.score >= 40 ? 'warning' : 'danger'} />
          <span className="text-xs font-semibold w-8 shrink-0">{r.score}</span>
        </div>
      ), sortValue: (r) => r.score,
    },
    { key: 'badge', header: 'Badge', accessor: (r) => <StatusBadge tone="success">{r.badge}</StatusBadge>, sortValue: (r) => r.badge },
    { key: 'wastePct', header: 'Waste %', accessor: (r) => `${r.wastePct}%`, sortValue: (r) => r.wastePct },
    { key: 'accuracy', header: 'Forecast Accuracy', accessor: (r) => `${r.forecastAccuracy}%`, sortValue: (r) => r.forecastAccuracy },
  ]

  const top = rows[0]

  return (
    <div className="space-y-6">
      <DemoBanner what={'Rankings are computed from sample data.'} />
      <div>
        <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <Trophy size={20} className="text-amber-500" /> Mess Leaderboard
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Every mess at LPU, ranked by sustainability score — waste reduction, forecast accuracy, food utilization and participation combined.</p>
      </div>

      {top && (
        <div className="rounded-xl bg-ink-950 text-white p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
            <Trophy size={22} className="text-amber-400" />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-400">Top performing mess</div>
            <div className="font-display text-lg font-bold">{top.messName}</div>
            <div className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5"><Leaf size={12} className="text-eco-500" /> Score {top.score} · {top.badge}</div>
          </div>
        </div>
      )}

      <DataTable data={rows} columns={columns} rowKey={(r) => r.messId} searchableText={(r) => r.messName} pageSize={20} filename="mess-leaderboard.csv" />
    </div>
  )
}
