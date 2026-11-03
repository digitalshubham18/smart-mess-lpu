import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import type { MealType } from '@/types'
import * as attendanceService from '@/services/attendanceService'
import { DashboardCard } from '@/components/ui/DashboardCard'
import { TODAY_ISO } from '@/utils/dateUtils'

const FIELD = 'rounded-lg border border-line dark:border-ink-700 bg-white dark:bg-ink-900 px-3 py-2 text-sm'
const monthStart = () => `${TODAY_ISO.slice(0, 7)}-01`

/** Attendance as a CSV for managers and finance: every check-in, or one row per student with meal counts (for billing). */
export function AttendanceExportCard({ messId }: { messId: string }) {
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(TODAY_ISO)
  const [meal, setMeal] = useState<MealType | ''>('')
  const [view, setView] = useState<'records' | 'summary'>('summary')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  async function download() {
    setBusy(true); setError(''); setDone('')
    try { setDone(await attendanceService.downloadAttendanceCsv({ messId, from, to, meal, view })) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not download the file.') }
    finally { setBusy(false) }
  }

  return (
    <DashboardCard title="Export attendance (CSV)">
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">Opens in Excel or Google Sheets. Contains student names and rooms — handle it like any student record. Every export is written to the audit log.</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <label className="flex flex-col gap-1"><span className="text-xs font-medium text-slate-500 dark:text-slate-400">From</span><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={FIELD} aria-label="Export from date" /></label>
        <label className="flex flex-col gap-1"><span className="text-xs font-medium text-slate-500 dark:text-slate-400">To</span><input type="date" value={to} min={from} max={TODAY_ISO} onChange={(e) => setTo(e.target.value)} className={FIELD} aria-label="Export to date" /></label>
        <label className="flex flex-col gap-1"><span className="text-xs font-medium text-slate-500 dark:text-slate-400">Meal</span>
          <select value={meal} onChange={(e) => setMeal(e.target.value as MealType | '')} className={FIELD} aria-label="Export meal">
            <option value="">All meals</option><option value="breakfast">Breakfast</option><option value="lunch">Lunch</option><option value="snacks">Snacks</option><option value="dinner">Dinner</option>
          </select>
        </label>
        <label className="flex flex-col gap-1"><span className="text-xs font-medium text-slate-500 dark:text-slate-400">Layout</span>
          <select value={view} onChange={(e) => setView(e.target.value as 'records' | 'summary')} className={FIELD} aria-label="Export layout">
            <option value="summary">One row per student (meal counts)</option><option value="records">One row per check-in</option>
          </select>
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button onClick={() => void download()} disabled={busy || !from || !to || to < from} className="inline-flex items-center gap-2 rounded-lg bg-tech-500 hover:bg-tech-600 text-white text-sm font-semibold py-2 px-4 disabled:opacity-60">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}Download CSV
        </button>
        {done && <span role="status" className="text-xs text-eco-600">Downloaded {done}</span>}
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-rose-600">{error}</p>}
    </DashboardCard>
  )
}
