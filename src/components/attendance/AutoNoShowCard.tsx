import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import * as attendanceService from '@/services/attendanceService'
import type { AutoNoShowSettings } from '@/services/attendanceService'
import { DashboardCard } from '@/components/ui/DashboardCard'

const STATUS: Record<string, string> = {
  processed: 'Processed automatically',
  manual: 'Run by hand',
  skipped_no_scans: 'Skipped — nobody was checked in',
}

/** Turns the automatic no-show pass on/off for this mess and sets the fine. It runs by itself shortly after each meal's window closes. */
export function AutoNoShowCard({ messId }: { messId: string }) {
  const [s, setS] = useState<AutoNoShowSettings | null>(null)
  const [fine, setFine] = useState('100')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let current = true
    attendanceService.getAutoNoShowSettings(messId).then((v) => { if (current) { setS(v); setFine(String(v.fineAmount)) } }).catch((e) => { if (current) setError(e instanceof Error ? e.message : 'Could not load this setting.') })
    return () => { current = false }
  }, [messId])

  async function save(enabled: boolean, amount: number) {
    setBusy(true); setError(''); setSaved(false)
    try { const v = await attendanceService.saveAutoNoShowSettings(messId, enabled, amount); setS((p) => ({ ...v, recent: p?.recent })); setFine(String(v.fineAmount)); setSaved(true) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save.') }
    finally { setBusy(false) }
  }
  const amount = Number(fine)
  const valid = Number.isInteger(amount) && amount >= 0 && amount <= 2000

  return (
    <DashboardCard title="Automatic no-shows">
      {!s && !error && <p className="text-xs text-slate-400">Loading…</p>}
      {error && <p role="alert" className="text-xs text-rose-600 mb-2">{error}</p>}
      {s && (
        <div className="space-y-3">
          <label className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
            <input type="checkbox" role="switch" checked={s.enabled} disabled={busy || !valid} onChange={(e) => void save(e.target.checked, amount)} className="mt-1 h-4 w-4 rounded accent-tech-500" aria-label="Process no-shows automatically" />
            <span><strong>Process no-shows automatically.</strong> Shortly after each meal's serving window closes, anyone who said "will eat" but wasn't checked in gets a warning (3 in a month = a fine). If nobody at all was checked in for a meal, nothing is issued and you're told — the counter probably wasn't in use.</span>
          </label>
          <div className="flex items-end gap-3">
            <label className="flex flex-col gap-1"><span className="text-xs font-medium text-slate-500 dark:text-slate-400">Fine for 3 warnings (₹)</span>
              <input value={fine} onChange={(e) => { setFine(e.target.value.replace(/\D/g, '').slice(0, 4)); setSaved(false) }} inputMode="numeric" aria-label="Fine amount" className="w-28 rounded-lg border border-line dark:border-ink-700 bg-white dark:bg-ink-900 px-3 py-2 text-sm" />
            </label>
            <button onClick={() => void save(s.enabled, amount)} disabled={busy || !valid || amount === s.fineAmount} className="rounded-lg border border-line dark:border-ink-700 text-sm font-semibold py-2 px-3.5 disabled:opacity-60 flex items-center gap-1.5">{busy && <Loader2 size={14} className="animate-spin" />}Save fine</button>
            {saved && <span role="status" className="text-xs text-eco-600 pb-2.5">Saved</span>}
          </div>
          {!valid && <p className="text-xs text-rose-600">Enter a whole number from 0 to 2000.</p>}
          {s.recent && s.recent.length > 0 && (
            <ul className="text-[11px] text-slate-500 dark:text-slate-400 space-y-0.5 border-t border-line dark:border-ink-700 pt-2" data-testid="auto-noshow-runs">
              {s.recent.map((r) => <li key={`${r.date}-${r.meal}`}>{r.date} · {r.meal} — {STATUS[r.status] ?? r.status}{r.status !== 'skipped_no_scans' ? ` (${r.warnings} warning${r.warnings === 1 ? '' : 's'}${r.fines ? `, ${r.fines} fine${r.fines === 1 ? '' : 's'}` : ''})` : ''}</li>)}
            </ul>
          )}
        </div>
      )}
    </DashboardCard>
  )
}
