import type { AttendanceSummary } from '@/services/attendanceService'

/** The counter's running tally: how many have been checked in against how many said they'd eat. */
export function LiveCount({ summary, label }: { summary: AttendanceSummary | null; label: string }) {
  if (!summary) return null
  const { checkedIn, willEat, eligible, noResponse, manual } = summary
  const pct = willEat > 0 ? Math.min(100, Math.round((checkedIn / willEat) * 100)) : 0
  return (
    <div data-testid="live-count" className="rounded-xl border border-line dark:border-ink-700 bg-white dark:bg-ink-900 p-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          <span className="font-display text-3xl font-bold text-tech-600 dark:text-tech-500 mr-1.5">{checkedIn}</span>
          checked in for {label}
          {willEat > 0 && <> · <strong>{willEat}</strong> said they'd eat</>}
        </p>
        <p className="text-xs text-slate-400">{eligible} on this mess · {noResponse} haven't answered{manual > 0 ? ` · ${manual} typed by hand` : ''}</p>
      </div>
      {willEat > 0 && (
        <div className="mt-2 h-1.5 rounded-full bg-surface-dim dark:bg-ink-800 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Checked in of those who said they'd eat">
          <div className="h-full bg-eco-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}
