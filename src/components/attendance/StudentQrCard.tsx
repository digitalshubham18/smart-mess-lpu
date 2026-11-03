import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, ShieldCheck, WifiOff } from 'lucide-react'
import * as attendanceService from '@/services/attendanceService'
import { MEAL_TYPES } from '@/data/mockOperations'
import { QrCodeSvg } from '@/components/ui/QrCodeSvg'
import { ensureOfflineKey, makeOfflineCode, noteServerTime, type OfflineCode } from '@/services/offlineQr'
import { useT } from '@/i18n/useLanguage'

const label = (m: string) => MEAL_TYPES.find((x) => x.key === m)?.label ?? m

/**
 * The student's meal QR. It is NOT their UID: it is a token the server signs and that expires in about a minute, so this
 * page asks for a fresh one before the old one runs out. A screenshot, or a QR generated from a UID, is worthless at the
 * counter a minute later.
 *
 * With no data at the counter the phone can't fetch one. If it was set up while online (this page does that by itself), it
 * shows an OFFLINE code it computes from a per-device key instead; the server checks it later, exactly like the live one.
 */
export function StudentQrCard() {
  const t = useT()
  const [qr, setQr] = useState<attendanceService.MyQr | null>(null)
  const [error, setError] = useState('')
  const [secondsLeft, setSecondsLeft] = useState(0)
  const timer = useRef<number | undefined>(undefined)
  const loadRef = useRef<() => void>(() => {})
  const [offline, setOffline] = useState<OfflineCode | null>(null)
  const [offlineReady, setOfflineReady] = useState(false)

  const load = useCallback(async () => {
    window.clearTimeout(timer.current)
    try {
      const next = await attendanceService.getMyQr()
      setQr(next)
      setOffline(null)
      setError('')
      // Online: make sure this phone also holds what it needs to show a code with no network (never blocks or breaks the live code).
      void ensureOfflineKey().then((k) => setOfflineReady(!!k))
      void noteServerTime(next.meals.now.iso)
      // Refresh with ~15 s to spare so the code on screen is never one that is about to die.
      timer.current = window.setTimeout(() => loadRef.current(), Math.max(5, next.ttlSeconds - 15) * 1000)
    } catch (e) {
      // No connection at all (not "the server said no"): fall back to the offline code if this phone has one.
      if ((e as { network?: boolean })?.network === true) {
        const code = await makeOfflineCode()
        if (code) {
          setQr(null); setError(''); setOffline(code)
          timer.current = window.setTimeout(() => loadRef.current(), 10_000) // keep trying to get back online
          return
        }
        setOffline(null)
        setError("You're offline, and this phone hasn't been set up for offline codes yet. Open this page once with internet (it sets itself up), or show your printed ID card.")
      } else {
        setOffline(null)
        setError(e instanceof Error ? e.message : 'Could not load your QR code.')
      }
      timer.current = window.setTimeout(() => loadRef.current(), 10_000)
    }
  }, [])
  useEffect(() => { loadRef.current = () => void load() }, [load])

  useEffect(() => {
    void load()
    const onVisible = () => { if (document.visibilityState === 'visible') void load() } // back from another app: get a fresh one
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.clearTimeout(timer.current); document.removeEventListener('visibilitychange', onVisible) }
  }, [load])

  useEffect(() => {
    if (!qr) return
    const tick = () => setSecondsLeft(Math.max(0, Math.round((Date.parse(qr.expiresAt) - Date.now()) / 1000)))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [qr])

  // Offline: recompute every second so the countdown is true and a new code appears the moment the minute turns over.
  useEffect(() => {
    if (!offline) return
    let alive = true
    const id = window.setInterval(() => { void makeOfflineCode().then((c) => { if (alive && c) setOffline(c) }) }, 1000)
    return () => { alive = false; window.clearInterval(id) }
  }, [offline !== null]) // eslint-disable-line react-hooks/exhaustive-deps

  const current = qr?.meals.current
  const next = qr?.meals.next

  return (
    <div className="flex flex-col items-center py-4">
      {qr ? (
        <>
          <div className={`rounded-2xl bg-white p-3 border border-line transition-opacity ${secondsLeft === 0 ? 'opacity-40' : ''}`} data-testid="meal-qr">
            <QrCodeSvg value={qr.token} size={220} />
          </div>
          <p className="mt-3 text-xs text-slate-400 font-mono">{qr.studentId}</p>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5" data-testid="qr-expiry">
            <ShieldCheck size={13} className="text-eco-600" /> Secure code — refreshes automatically ({secondsLeft}s)
          </p>
          <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-200 text-center" data-testid="meal-status">
            {current
              ? `${label(current)} is being served now (${qr.meals.windows.find((w) => w.meal === current)?.start}–${qr.meals.windows.find((w) => w.meal === current)?.end}).`
              : `No meal is being served right now.${next ? ` Next: ${label(next.meal)} at ${next.start}.` : ''}`}
          </p>
          <p className="mt-1 text-[11px] text-slate-400 text-center max-w-xs">{t('qr.show')}</p>
          {offlineReady && <p className="mt-1 text-[11px] text-eco-600 flex items-center gap-1" data-testid="offline-ready"><WifiOff size={11} /> {t('qr.offlineReady')}</p>}
        </>
      ) : offline ? (
        <>
          <div className="rounded-2xl bg-white p-3 border-2 border-amber-400" data-testid="offline-qr"><QrCodeSvg value={offline.token} size={220} /></div>
          <p className="mt-3 text-xs text-slate-400 font-mono">{offline.token.split('.')[1]}</p>
          <p className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5" data-testid="offline-badge">
            <WifiOff size={13} /> {t('qr.offlineBadge', { s: offline.expiresInSeconds })}
          </p>
          <p className="mt-1 text-[11px] text-slate-400 text-center max-w-xs">{t('qr.offlineNote')}</p>
        </>
      ) : error ? (
        <div className="text-center space-y-2">
          <p role="alert" className="text-sm text-rose-500">{error}</p>
          <button onClick={() => void load()} className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg border border-line dark:border-ink-700 px-3 py-1.5"><RefreshCw size={12} /> Try again</button>
        </div>
      ) : (
        <div className="animate-pulse bg-surface-dim dark:bg-ink-800 rounded-2xl" style={{ width: 220, height: 220 }} aria-label="Loading your QR code" />
      )}
    </div>
  )
}
