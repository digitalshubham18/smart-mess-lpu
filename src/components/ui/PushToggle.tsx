import { useCallback, useEffect, useState } from 'react'
import { Bell, BellOff, Loader2 } from 'lucide-react'
import * as pushService from '@/services/pushService'

type State = 'loading' | 'unsupported' | 'blocked' | 'off' | 'on'

/**
 * Turn notifications on/off for THIS device. Asking for permission happens only when the person taps the button, and
 * every way it can fail (blocked, not supported, iPhone not added to the Home Screen) says what to do about it.
 */
export function PushToggle({ title, description }: { title: string; description: string }) {
  const [state, setState] = useState<State>('loading')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    const support = pushService.pushSupport()
    if (!support.supported) { setReason(support.reason ?? ''); setState('unsupported'); return }
    if (pushService.permission() === 'denied') { setState('blocked'); return }
    setState((await pushService.isSubscribedHere()) ? 'on' : 'off')
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  async function run(fn: () => Promise<void>, ok?: string) {
    setBusy(true); setError(''); setMessage('')
    try { await fn(); if (ok) setMessage(ok) } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') } finally { setBusy(false); await refresh() }
  }

  return (
    <div className="mt-4 pt-3 border-t border-line dark:border-ink-700 text-left" data-testid="push-toggle">
      <div className="flex items-start gap-2.5">
        {state === 'on' ? <Bell size={16} className="text-eco-600 mt-0.5 shrink-0" /> : <BellOff size={16} className="text-slate-400 mt-0.5 shrink-0" />}
        <div className="min-w-0 text-xs text-slate-600 dark:text-slate-300">
          <p><strong>{title}</strong>{state === 'on' && <span className="ml-1.5 text-eco-700 dark:text-eco-400 font-semibold">On for this device</span>}</p>
          <p className="text-slate-500 dark:text-slate-400 mt-0.5">{description}</p>

          {state === 'loading' && <p className="mt-2 text-slate-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Checking…</p>}
          {state === 'unsupported' && <p role="note" className="mt-2 rounded-lg bg-surface-dim dark:bg-ink-800 px-3 py-2">{reason}</p>}
          {state === 'blocked' && <p role="note" className="mt-2 rounded-lg bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 px-3 py-2">Notifications are blocked for this site. Allow them in your browser's site settings (the lock icon next to the address), then come back.</p>}
          {state === 'off' && <button onClick={() => void run(pushService.enablePush, 'Notifications are on for this device.')} disabled={busy} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-tech-500 text-white font-semibold px-3 py-1.5 disabled:opacity-60">{busy && <Loader2 size={12} className="animate-spin" />}Turn on notifications</button>}
          {state === 'on' && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button onClick={() => void run(pushService.sendTest, 'Test sent — it should appear in a few seconds.')} disabled={busy} className="rounded-lg border border-line dark:border-ink-700 font-semibold px-3 py-1.5 disabled:opacity-60">Send a test</button>
              <button onClick={() => void run(pushService.disablePush, 'Notifications are off for this device.')} disabled={busy} className="rounded-lg border border-line dark:border-ink-700 font-semibold px-3 py-1.5 disabled:opacity-60">Turn off</button>
            </div>
          )}
          {message && <p role="status" className="mt-2 text-eco-700 dark:text-eco-400">{message}</p>}
          {error && <p role="alert" className="mt-2 text-rose-600">{error}</p>}
        </div>
      </div>
    </div>
  )
}
