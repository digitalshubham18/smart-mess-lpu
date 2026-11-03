import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import type { MealType } from '@/types'
import { MEAL_TYPES } from '@/data/mockOperations'
import { WASTE_LOG_REASONS, listWasteLog, saveWasteEntry, type WasteLog, type WasteLogEntry, type WasteLogReason } from '@/services/wasteLogService'
import { useMessStore } from '@/store/useMessStore'
import { DashboardCard } from '@/components/ui/DashboardCard'
import { WasteSuggestions } from '@/components/waste/WasteSuggestions'
import { DatePicker } from '@/components/ui/DatePicker'
import { TODAY_ISO, addDaysISO, formatShort } from '@/utils/dateUtils'

const FIELD = 'rounded-lg border border-line dark:border-ink-700 bg-white dark:bg-ink-900 px-3 py-2 text-sm'
// One decimal: 9.5 kg must not read as "10 kg" on a screen whose whole point is small differences.
const formatKg = (n: number) => `${Math.round(n * 10) / 10} kg`
const mealLabel = (m: string) => MEAL_TYPES.find((x) => x.key === m)?.label ?? m

/**
 * The REAL waste log: what the kitchen cooked and what was eaten, per meal, saved on the server (and audited). The figures
 * on the Waste Analytics screen are still sample data — these are the first waste numbers in the app that are not.
 */
export default function FoodWaste() {
  const messId = useMessStore((s) => s.currentMessId)
  const [date, setDate] = useState(TODAY_ISO)
  const [meal, setMeal] = useState<MealType>('lunch')
  const [prepared, setPrepared] = useState('')
  const [consumed, setConsumed] = useState('')
  const [reason, setReason] = useState<WasteLogReason>('Overproduction')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [log, setLog] = useState<WasteLog | null>(null)
  const [loadError, setLoadError] = useState('')

  const from = addDaysISO(TODAY_ISO, -13)
  const load = useCallback(async () => {
    try { setLog(await listWasteLog(messId, from, TODAY_ISO)); setLoadError('') }
    catch (e) { setLoadError(e instanceof Error ? e.message : 'Could not load the waste log.') }
  }, [messId, from])
  useEffect(() => { void load() }, [load])

  // Choosing a meal/day that already has an entry loads it for correction instead of starting blank.
  const existing = log?.entries.find((e) => e.date === date && e.meal === meal)
  useEffect(() => {
    if (existing) { setPrepared(String(existing.preparedKg)); setConsumed(String(existing.consumedKg)); setReason(existing.reason); setNote(existing.note) }
    else { setPrepared(''); setConsumed(''); setNote('') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.id, date, meal])

  const p = Number(prepared), c = Number(consumed)
  const valid = prepared !== '' && consumed !== '' && Number.isFinite(p) && Number.isFinite(c) && p >= 0 && c >= 0 && c <= p
  const waste = valid ? Math.round((p - c) * 100) / 100 : 0

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    setSaving(true); setError(''); setSaved('')
    try {
      await saveWasteEntry({ messId, date, meal, preparedKg: p, consumedKg: c, reason, ...(note.trim() ? { note: note.trim() } : {}) })
      setSaved(`${existing ? 'Corrected' : 'Recorded'} ${mealLabel(meal)} waste for ${formatShort(date)}.`)
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save the entry.') }
    finally { setSaving(false) }
  }

  const day: Record<string, WasteLogEntry | undefined> = {}
  for (const en of log?.entries ?? []) if (en.date === date) day[en.meal] = en

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">Food Waste
          <span className="text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 bg-eco-50 text-eco-700 dark:bg-eco-500/10 dark:text-eco-400">Recorded by the server</span>
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">After each meal, record how much was prepared and how much was eaten. Saving the same meal again corrects it; every change is logged.</p>
      </div>

      {log && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="waste-totals">
          <Stat label="Entries (14 days)" value={String(log.totals.entries)} />
          <Stat label="Prepared" value={formatKg(log.totals.preparedKg)} />
          <Stat label="Wasted" value={formatKg(log.totals.wasteKg)} />
          <Stat label="Waste rate" value={`${log.totals.wastePct}%`} />
        </div>
      )}
      {loadError && <p role="alert" className="text-xs text-rose-600">{loadError}</p>}
      <WasteSuggestions messId={messId} refreshKey={log?.totals.entries} />

      <div className="grid md:grid-cols-2 gap-6">
        <DashboardCard title={existing ? 'Correct this entry' : 'Record waste entry'}>
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <DatePicker label="Date" value={date} onChange={setDate} max={TODAY_ISO} />
              <label className="flex flex-col gap-1"><span className="text-xs font-medium text-slate-500 dark:text-slate-400">Meal</span>
                <select value={meal} onChange={(e) => setMeal(e.target.value as MealType)} aria-label="Meal" className={FIELD}>{MEAL_TYPES.map((mt) => <option key={mt.key} value={mt.key}>{mt.label}</option>)}</select>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1"><span className="text-xs font-medium text-slate-500 dark:text-slate-400">Prepared (kg)</span>
                <input type="number" min="0" step="0.1" value={prepared} onChange={(e) => setPrepared(e.target.value)} aria-label="Prepared (kg)" className={FIELD} /></label>
              <label className="flex flex-col gap-1"><span className="text-xs font-medium text-slate-500 dark:text-slate-400">Eaten (kg)</span>
                <input type="number" min="0" step="0.1" value={consumed} onChange={(e) => setConsumed(e.target.value)} aria-label="Eaten (kg)" className={FIELD} /></label>
            </div>
            <label className="flex flex-col gap-1"><span className="text-xs font-medium text-slate-500 dark:text-slate-400">Main reason for the waste</span>
              <select value={reason} onChange={(e) => setReason(e.target.value as WasteLogReason)} aria-label="Reason" className={FIELD}>{WASTE_LOG_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
            <label className="flex flex-col gap-1"><span className="text-xs font-medium text-slate-500 dark:text-slate-400">Note (optional)</span>
              <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} aria-label="Note" className={FIELD} /></label>
            {prepared !== '' && consumed !== '' && (
              c > p
                ? <p role="alert" className="text-xs text-rose-600">Eaten can't be more than prepared.</p>
                : valid && <p className="text-xs text-slate-400" data-testid="waste-preview">Waste = {formatKg(waste)} · {p > 0 ? ((waste / p) * 100).toFixed(1) : '0.0'}% waste rate</p>
            )}
            <button type="submit" disabled={!valid || saving} className="w-full rounded-lg bg-tech-500 hover:bg-tech-600 text-white text-sm font-semibold py-2.5 disabled:opacity-60 flex items-center justify-center gap-2">
              {saving && <Loader2 size={14} className="animate-spin" />}{existing ? 'Save correction' : 'Save entry'}
            </button>
            {saved && <p role="status" className="text-xs text-eco-600 flex items-center gap-1"><CheckCircle2 size={12} />{saved}</p>}
            {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
          </form>
        </DashboardCard>

        <div className="grid grid-cols-2 gap-3 content-start">
          {MEAL_TYPES.map((mt) => {
            const en = day[mt.key]
            return (
              <DashboardCard key={mt.key} title={mt.label}>
                {en ? (
                  <div className="text-xs space-y-1" data-testid={`waste-${mt.key}`}>
                    <p className="font-display text-lg font-bold text-slate-800 dark:text-slate-100">{formatKg(en.wasteKg)} <span className="text-xs font-normal text-slate-400">wasted</span></p>
                    <p className="text-slate-500 dark:text-slate-400">{formatKg(en.preparedKg)} prepared · {en.wastePct}% · {en.reason}</p>
                    <p className="text-[11px] text-slate-400">by {en.recordedBy}</p>
                  </div>
                ) : <p className="text-xs text-slate-400">No entry recorded for {formatShort(date)}.</p>}
              </DashboardCard>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line dark:border-ink-700 bg-white dark:bg-ink-900 p-3.5">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="font-display text-lg font-bold text-slate-800 dark:text-slate-100">{value}</div>
    </div>
  )
}
