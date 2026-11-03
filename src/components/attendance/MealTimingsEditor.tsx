import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { MealType } from '@/types'
import * as attendanceService from '@/services/attendanceService'
import { MEAL_TYPES } from '@/data/mockOperations'

/** Managers set when each meal is served — the console only opens the scanner inside these windows (and the server refuses scans outside them). */
export function MealTimingsEditor({ messId, snapshot, onSaved }: { messId: string; snapshot: attendanceService.MealWindowsSnapshot; onSaved: (s: attendanceService.MealWindowsSnapshot) => void }) {
  const [draft, setDraft] = useState<Record<string, { start: string; end: string }>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setDraft(Object.fromEntries(snapshot.windows.map((w) => [w.meal, { start: w.start, end: w.end }])))
  }, [snapshot])

  async function run(fn: () => Promise<attendanceService.MealWindowsSnapshot>) {
    setBusy(true); setError(''); setSaved(false)
    try { onSaved(await fn()); setSaved(true) } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.') } finally { setBusy(false) }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500 dark:text-slate-400">Times are {snapshot.timezone} (the mess's local time), 24-hour. Scans outside a meal's window are refused.</p>
      {MEAL_TYPES.map((m) => (
        <div key={m.key} className="flex items-center gap-2 text-sm">
          <span className="w-24 font-medium text-slate-700 dark:text-slate-200">{m.label}</span>
          <input type="time" aria-label={`${m.label} start`} value={draft[m.key]?.start ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [m.key]: { ...d[m.key], start: e.target.value } }))} className="rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-2 py-1.5 text-sm" />
          <span className="text-slate-400">to</span>
          <input type="time" aria-label={`${m.label} end`} value={draft[m.key]?.end ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [m.key]: { ...d[m.key], end: e.target.value } }))} className="rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-2 py-1.5 text-sm" />
        </div>
      ))}
      {error && <p role="alert" className="text-xs text-rose-600 bg-rose-50 dark:bg-rose-500/10 rounded-lg px-3 py-2">{error}</p>}
      {saved && <p role="status" className="text-xs text-eco-700 dark:text-eco-400">Meal timings saved.</p>}
      <div className="flex gap-2">
        <button disabled={busy} onClick={() => void run(() => attendanceService.saveMealWindows(messId, (Object.entries(draft) as [MealType, { start: string; end: string }][]).map(([meal, w]) => ({ meal, ...w }))))} className="flex items-center gap-1.5 rounded-lg bg-tech-500 text-white text-xs font-semibold px-4 py-2 disabled:opacity-60">{busy && <Loader2 size={12} className="animate-spin" />}Save timings</button>
        <button disabled={busy} onClick={() => void run(() => attendanceService.resetMealWindows(messId))} className="rounded-lg border border-line dark:border-ink-700 text-xs font-semibold px-4 py-2 disabled:opacity-60">Reset to defaults</button>
      </div>
    </div>
  )
}
