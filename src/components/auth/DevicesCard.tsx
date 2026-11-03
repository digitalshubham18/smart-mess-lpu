import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Smartphone, Laptop, LogOut } from 'lucide-react'
import * as authService from '@/services/authService'
import type { DeviceSession } from '@/services/authService'
import { useAuth } from '@/hooks/useAuth'

const BTN = 'rounded-xl border border-line dark:border-ink-700 text-sm font-semibold py-2 px-3 hover:bg-surface-dim dark:hover:bg-ink-800 disabled:opacity-60 flex items-center gap-1.5'

function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 90) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

/** Where you're signed in — and the button for a lost phone. */
export function DevicesCard() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [devices, setDevices] = useState<DeviceSession[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmAll, setConfirmAll] = useState(false)
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    try { setDevices(await authService.listSessions()); setError('') }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load your devices.') }
  }, [])
  useEffect(() => {
    let current = true
    authService.listSessions().then((d) => { if (current) setDevices(d) }).catch((e) => { if (current) setError(e instanceof Error ? e.message : 'Could not load your devices.') })
    return () => { current = false }
  }, [])

  async function signOutOne(d: DeviceSession) {
    setBusy(d.id); setError(''); setNote('')
    try {
      const r = await authService.revokeSession(d.id)
      if (r.current) { await logout(); navigate('/login'); return }
      setNote(`Signed out ${d.device}.`)
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not sign that device out.') } finally { setBusy(null) }
  }
  async function signOutOthers() {
    setBusy('others'); setError(''); setNote('')
    try { await authService.revokeOtherSessions(); setNote('Every other device was signed out.'); await load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not sign the other devices out.') } finally { setBusy(null) }
  }
  async function signOutEverywhere() {
    setBusy('all'); setError('')
    try { await authService.logoutEverywhere(); await logout(); navigate('/login') }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not sign out everywhere.'); setBusy(null) }
  }

  const others = (devices ?? []).filter((d) => !d.current).length

  return (
    <section aria-labelledby="devices-h" className="mt-6 pt-5 border-t border-line dark:border-ink-700">
      <h2 id="devices-h" className="font-display font-semibold text-slate-800 dark:text-slate-100">Devices signed in</h2>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Every phone or computer that's signed in to your account. Don't recognise one, or lost a phone? Sign it out here.</p>
      {error && <p role="alert" className="mt-3 text-xs text-rose-600 bg-rose-50 dark:bg-rose-500/10 rounded-lg px-3 py-2">{error}</p>}
      {note && <p role="status" className="mt-3 text-xs text-eco-700 bg-eco-50 dark:bg-eco-500/10 dark:text-eco-400 rounded-lg px-3 py-2">{note}</p>}

      {devices === null && !error && <p className="mt-3 text-xs text-slate-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" />Loading…</p>}
      {devices && (
        <ul className="mt-3 divide-y divide-line dark:divide-ink-700 rounded-xl border border-line dark:border-ink-700" data-testid="device-list">
          {devices.map((d) => {
            const mobile = /Android|iOS/.test(d.device)
            const Icon = mobile ? Smartphone : Laptop
            return (
              <li key={d.id} className="flex items-center gap-3 px-3.5 py-3">
                <Icon size={18} className="text-slate-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-700 dark:text-slate-200 flex items-center gap-2">
                    {d.device}
                    {d.current && <span className="text-[10px] font-semibold rounded-full px-2 py-0.5 bg-eco-50 text-eco-700 dark:bg-eco-500/10 dark:text-eco-400">This device</span>}
                  </div>
                  <div className="text-[11px] text-slate-400">Active {ago(d.lastActiveAt)} · signed in {ago(d.signedInAt)}{d.ip ? ` · ${d.ip}` : ''}</div>
                </div>
                {!d.current && (
                  <button onClick={() => void signOutOne(d)} disabled={busy !== null} aria-label={`Sign out ${d.device}`} className="text-xs font-semibold text-rose-600 hover:underline disabled:opacity-60">
                    {busy === d.id ? 'Signing out…' : 'Sign out'}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {others > 0 && <button onClick={() => void signOutOthers()} disabled={busy !== null} className={BTN}>{busy === 'others' && <Loader2 size={14} className="animate-spin" />}Sign out all other devices</button>}
        {!confirmAll && <button onClick={() => setConfirmAll(true)} disabled={busy !== null} className={`${BTN} text-rose-600`}><LogOut size={14} />Sign out everywhere…</button>}
      </div>
      {confirmAll && (
        <div role="alertdialog" aria-label="Confirm sign out everywhere" className="mt-3 rounded-xl border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 p-3.5 max-w-md">
          <p className="text-xs text-rose-800 dark:text-rose-200"><strong>Sign out of every device, including this one?</strong> Notifications to your phones stop too — turn them back on after you sign in again. Use this if a phone is lost or stolen.</p>
          <div className="mt-2.5 flex gap-2">
            <button onClick={() => void signOutEverywhere()} disabled={busy !== null} className="rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold py-2 px-3.5 disabled:opacity-60 flex items-center gap-1.5">{busy === 'all' && <Loader2 size={14} className="animate-spin" />}Yes, sign out everywhere</button>
            <button onClick={() => setConfirmAll(false)} className="text-sm text-slate-500 hover:underline">Cancel</button>
          </div>
        </div>
      )}
    </section>
  )
}
