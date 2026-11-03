import { useEffect, useState } from 'react'
import { getWasteSummary, type WasteSummary } from '@/services/wasteLogService'
import { DashboardCard } from '@/components/ui/DashboardCard'
import { TODAY_ISO, addDaysISO, formatShort } from '@/utils/dateUtils'

const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

/** Charts of the kitchen's REAL waste entries (last 30 days) — as opposed to the sample-data charts further down this page. */
export function RealWasteSummary({ messId }: { messId: string }) {
  const [s, setS] = useState<WasteSummary | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let current = true
    getWasteSummary(messId, addDaysISO(TODAY_ISO, -29), TODAY_ISO).then((v) => { if (current) setS(v) }).catch((e) => { if (current) setError(e instanceof Error ? e.message : 'Could not load.') })
    return () => { current = false }
  }, [messId])
  const max = Math.max(1, ...(s?.byDay.map((d) => d.wasteKg) ?? [1]))
  return (
    <DashboardCard title="Recorded waste — last 30 days (real entries)">
      {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
      {!s && !error && <p className="text-xs text-slate-400">Loading…</p>}
      {s && s.byDay.length === 0 && <p className="text-xs text-slate-400" data-testid="no-real-waste">No waste has been recorded yet. Kitchen staff record it on the Food Waste page after each meal; this chart fills in from those entries.</p>}
      {s && s.byDay.length > 0 && (
        <div className="grid md:grid-cols-3 gap-5" data-testid="real-waste">
          <div className="md:col-span-2">
            <p className="text-xs font-semibold text-slate-500 mb-2">Waste per day (kg)</p>
            <ul className="space-y-1">
              {s.byDay.map((d) => (
                <li key={d.date} className="flex items-center gap-2 text-xs">
                  <span className="w-16 text-slate-500">{formatShort(d.date)}</span>
                  <span className="flex-1 h-3 rounded bg-surface-dim dark:bg-ink-800 overflow-hidden"><span className="block h-full bg-rose-400" style={{ width: `${(d.wasteKg / max) * 100}%` }} /></span>
                  <span className="w-28 text-right text-slate-600 dark:text-slate-300">{d.wasteKg} kg · {d.wastePct}%</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-4">
            <div><p className="text-xs font-semibold text-slate-500 mb-1">By meal</p>
              <ul className="text-xs space-y-0.5" data-testid="waste-by-meal">{s.byMeal.map((m) => <li key={m.meal}>{cap(m.meal)}: {m.wasteKg} kg ({m.wastePct}%)</li>)}</ul></div>
            <div><p className="text-xs font-semibold text-slate-500 mb-1">By reason</p>
              <ul className="text-xs space-y-0.5" data-testid="waste-by-reason">{s.byReason.map((r) => <li key={r.reason}>{r.reason}: {r.wasteKg} kg</li>)}</ul></div>
          </div>
        </div>
      )}
    </DashboardCard>
  )
}
