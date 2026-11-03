import { useCallback, useEffect, useState } from 'react'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import * as svc from '@/services/errorsService'
import type { ReportedError } from '@/services/errorsService'
import { DashboardCard } from '@/components/ui/DashboardCard'

/** Super Admin: what has been breaking, newest first. The same bug is one row with a count, however many people hit it. */
export default function SystemErrors() {
  useDocumentTitle('System errors')
  const [rows, setRows] = useState<ReportedError[] | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<number | null>(null)
  const load = useCallback(() => { svc.listErrors().then((r) => { setRows(r); setError('') }).catch((e) => setError(e instanceof Error ? e.message : 'Could not load.')) }, [])
  useEffect(() => { load() }, [load])
  async function dismiss(id: number) { try { await svc.dismissError(id); load() } catch (e) { setError(e instanceof Error ? e.message : 'Could not dismiss.') } }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100">System errors</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Crashes reported by people's browsers and by the server. No personal data is included. Dismiss one once it's dealt with — it comes back if it happens again.</p>
      </div>
      {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
      <DashboardCard title={`Open (${rows?.length ?? 0})`}>
        {rows?.length === 0 && <p className="text-xs text-slate-400" data-testid="no-errors">Nothing reported. 🎉</p>}
        <ul className="divide-y divide-line dark:divide-ink-700">
          {rows?.map((r) => (
            <li key={r.id} className="py-3 text-sm" data-testid="error-row">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[10px] font-bold uppercase rounded px-1.5 py-0.5 ${r.kind === 'server' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>{r.kind}</span>
                <span className="font-medium text-slate-700 dark:text-slate-200 break-all">{r.message}</span>
                <span className="text-xs text-slate-400">×{r.count} · last {new Date(r.lastSeen).toLocaleString()}{r.url ? ` · ${r.url}` : ''}</span>
              </div>
              <div className="mt-1 flex gap-3 text-xs">
                {r.stack && <button onClick={() => setOpen(open === r.id ? null : r.id)} className="text-tech-600 hover:underline">{open === r.id ? 'Hide' : 'Show'} details</button>}
                <button onClick={() => void dismiss(r.id)} className="text-slate-500 hover:underline" aria-label={`Dismiss error ${r.id}`}>Dismiss</button>
              </div>
              {open === r.id && r.stack && <pre className="mt-2 overflow-x-auto rounded-lg bg-surface-dim dark:bg-ink-800 p-3 text-[11px] text-slate-600 dark:text-slate-300">{r.stack}</pre>}
            </li>
          ))}
        </ul>
      </DashboardCard>
    </div>
  )
}
