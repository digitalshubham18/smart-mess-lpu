import { useEffect, useState } from 'react'
import * as attendanceService from '@/services/attendanceService'
import type { DailySummary } from '@/services/attendanceService'
import { DashboardCard } from '@/components/ui/DashboardCard'

/** Today at a glance — the same numbers the managers get as a notification at the end of the day. */
export function DailySummaryCard({ messId }: { messId: string }) {
  const [s, setS] = useState<DailySummary | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let current = true
    attendanceService.getDailySummary(messId).then((v) => { if (current) setS(v) }).catch((e) => { if (current) setError(e instanceof Error ? e.message : 'Could not load.') })
    return () => { current = false }
  }, [messId])
  return (
    <DashboardCard title="Today at a glance">
      {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
      {!s && !error && <p className="text-xs text-slate-400">Loading…</p>}
      {s && (
        <>
          <ul className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1.5 text-sm" data-testid="daily-summary">
            {s.message.lines.map((l) => <li key={l} className="text-slate-600 dark:text-slate-300">{l}</li>)}
          </ul>
          <p className="mt-2 text-[11px] text-slate-400">Managers and admins also get this as a notification around 10:30 PM on days the mess was in use.</p>
        </>
      )}
    </DashboardCard>
  )
}
