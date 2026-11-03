import { useEffect, useState } from 'react'
import { ShieldAlert, Activity } from 'lucide-react'
import * as attendanceService from '@/services/attendanceService'
import { DashboardCard } from '@/components/ui/DashboardCard'
import { PushToggle } from '@/components/ui/PushToggle'

/** For managers: scans that looked like tampering, a revoked card or the wrong mess, and one counter scanning unusually fast. */
export function ScanAlertsCard({ messId, refreshKey }: { messId: string; refreshKey: number }) {
  const [alerts, setAlerts] = useState<attendanceService.ScanAlert[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let current = true
    attendanceService.getScanAlerts(messId, 8)
      .then((a) => { if (current) { setAlerts(a); setError('') } })
      .catch((e) => { if (current) setError(e instanceof Error ? e.message : 'Could not load alerts.') })
    return () => { current = false }
  }, [messId, refreshKey])

  return (
    <DashboardCard title="Scan alerts">
      {error ? (
        <p role="alert" className="text-sm text-rose-500">{error}</p>
      ) : !alerts ? (
        <p className="text-sm text-slate-400 py-3 text-center">Loading…</p>
      ) : alerts.length === 0 ? (
        <p data-testid="no-alerts" className="text-sm text-slate-400 py-3 text-center">Nothing suspicious — no forged codes, revoked cards or unusual scanning volume.</p>
      ) : (
        <ul className="divide-y divide-line dark:divide-ink-700 max-h-64 overflow-y-auto">
          {alerts.map((a) => (
            <li key={a.id} className="py-2 flex items-start gap-2 text-sm">
              {a.action === 'checkin_spike' ? <Activity size={15} className="mt-0.5 text-amber-500 shrink-0" /> : <ShieldAlert size={15} className="mt-0.5 text-rose-500 shrink-0" />}
              <div className="min-w-0">
                <p className="text-slate-700 dark:text-slate-200">{a.summary}</p>
                <p className="text-[11px] text-slate-400">{a.actorName} · {new Date(a.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <PushToggle title="Alert this device" description="Get a push notification when a forged QR, a replayed or revoked card, or unusual scanning volume is detected at your mess (at most one every 10 minutes)." />
    </DashboardCard>
  )
}
