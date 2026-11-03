import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend } from 'recharts'
import { ScanLine, AlertTriangle, IndianRupee } from 'lucide-react'
import type { MealType } from '@/types'
import { useAuth } from '@/hooks/useAuth'
import { MEAL_TYPES } from '@/data/mockOperations'
import * as attendanceService from '@/services/attendanceService'
import * as offlineQueue from '@/services/offlineQueue'
import { parseOfflineCode } from '@/services/offlineQr'
import { attendanceByMealSeries, hostelWiseDemand } from '@/services/analyticsService'
import { useMessStore } from '@/store/useMessStore'
import { ChartCard, DashboardCard } from '@/components/ui/DashboardCard'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { QrScanner } from '@/components/attendance/QrScanner'
import { StudentQrCard } from '@/components/attendance/StudentQrCard'
import { ScanResultCard, type ScanOutcome } from '@/components/attendance/ScanResultCard'
import { MealTimingsEditor } from '@/components/attendance/MealTimingsEditor'
import { DailySummaryCard } from '@/components/attendance/DailySummaryCard'
import { AutoNoShowCard } from '@/components/attendance/AutoNoShowCard'
import { AttendanceExportCard } from '@/components/attendance/AttendanceExportCard'
import { DemoBanner } from '@/components/ui/DemoBanner'
import { CheckinEmailToggle } from '@/components/attendance/CheckinEmailToggle'
import { LiveCount } from '@/components/attendance/LiveCount'
import { ScanAlertsCard } from '@/components/attendance/ScanAlertsCard'
import { ScannerSelfTest } from '@/components/attendance/ScannerSelfTest'
import { playScanFeedback, isSoundOn, setSoundOn } from '@/utils/scanFeedback'
import { StudentAvatar } from '@/components/ui/StudentAvatar'
import { TODAY_ISO } from '@/utils/dateUtils'
import { formatNumber, formatINR } from '@/utils/formatters'

export default function Attendance() {
  const { user } = useAuth()
  if (user?.role === 'STUDENT') return <StudentQRCard studentId={user.studentId ?? ''} />
  if (user?.role === 'PARENT') return <StudentQRCard studentId={user.studentId ?? ''} readOnly />
  if (['SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER', 'KITCHEN_STAFF'].includes(user?.role ?? '')) return <CheckInConsole />
  return <AttendanceAnalytics />
}

function StudentQRCard({ studentId, readOnly }: { studentId: string; readOnly?: boolean }) {
  const { user } = useAuth()
  const [history, setHistory] = useState<Awaited<ReturnType<typeof attendanceService.listCheckInsForStudent>>>([])
  const [warnings, setWarnings] = useState<Awaited<ReturnType<typeof attendanceService.warningsForStudent>>>([])
  const [fines, setFines] = useState<Awaited<ReturnType<typeof attendanceService.finesForStudent>>>([])

  useEffect(() => {
    if (!studentId) return
    attendanceService.listCheckInsForStudent(studentId).then((rows) => setHistory(rows.slice(0, 10)))
    attendanceService.warningsForStudent(studentId).then(setWarnings)
    attendanceService.finesForStudent(studentId).then(setFines)
  }, [studentId])

  const thisMonth = TODAY_ISO.slice(0, 7)
  const monthWarnings = warnings.filter((w) => w.date.slice(0, 7) === thisMonth).length
  const unpaidFines = fines.filter((f) => !f.paid)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        {studentId && <StudentAvatar studentId={studentId} name={user?.name ?? 'Student'} size={44} />}
        <div>
          <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100">Meal Attendance</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Show your QR code to the counter staff — they scan it with their device to check you in for each meal.</p>
        </div>
      </div>

      {monthWarnings > 0 && (
        <div className={`rounded-xl border p-4 flex items-start gap-3 ${monthWarnings >= 3 ? 'border-rose-300 bg-rose-50 dark:bg-rose-500/10' : 'border-amber-300 bg-amber-50 dark:bg-amber-500/10'}`}>
          <AlertTriangle size={18} className={monthWarnings >= 3 ? 'text-rose-500 shrink-0' : 'text-amber-500 shrink-0'} />
          <div>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{monthWarnings} no-show warning{monthWarnings === 1 ? '' : 's'} this month</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              You marked "will eat" but weren't checked in at the counter. 3 warnings in a calendar month triggers a fine — make sure to show up (or mark "will not eat") if your plans change.
            </p>
          </div>
        </div>
      )}

      {unpaidFines.length > 0 && (
        <div className="rounded-xl border border-rose-300 bg-rose-50 dark:bg-rose-500/10 p-4">
          <p className="text-sm font-semibold text-rose-700 dark:text-rose-400 flex items-center gap-1.5"><IndianRupee size={14} /> {unpaidFines.length} unpaid fine{unpaidFines.length === 1 ? '' : 's'}</p>
          <div className="mt-2 space-y-1">
            {unpaidFines.map((f) => (
              <div key={f.id} className="text-xs text-slate-600 dark:text-slate-300 flex justify-between">
                <span>No-show fine — {f.month}</span>
                <span className="font-semibold">{formatINR(f.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-5">
        {readOnly ? (
          <DashboardCard title="Check-in QR code">
            <p className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center">Only the student shows the meal QR code — it's tied to their own phone and changes every minute. You can follow their check-ins and warnings here.</p>
          </DashboardCard>
        ) : (
          <DashboardCard title="Your check-in QR code">
            {studentId ? <><StudentQrCard /><CheckinEmailToggle /></> : <p className="text-sm text-slate-400 py-4 text-center">No student is linked to this account.</p>}
          </DashboardCard>
        )}

        <DashboardCard title="Recent Check-ins">
          {history.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">No check-ins recorded yet.</p>
          ) : (
            <div className="divide-y divide-line dark:divide-ink-700">
              {history.map((h) => (
                <div key={h.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-slate-600 dark:text-slate-300">{h.date} · {h.meal}</span>
                  <span className="text-xs text-slate-400">{new Date(h.scanned_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              ))}
            </div>
          )}
        </DashboardCard>
      </div>
      {readOnly && <p className="text-xs text-slate-400">Read-only — the student shows their own QR code and manages their own attendance.</p>}
    </div>
  )
}

function CheckInConsole() {
  const { user } = useAuth()
  const messId = useMessStore((s) => s.currentMessId)
  // Nothing is pre-selected: the person at the counter picks the meal being served, then the scanner opens (if it's that meal's time).
  const [meal, setMeal] = useState<MealType | null>(null)
  const [snap, setSnap] = useState<attendanceService.MealWindowsSnapshot | null>(null)
  const [snapError, setSnapError] = useState('')
  const [uid, setUid] = useState('')
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null)
  const [pending, setPending] = useState(() => offlineQueue.pendingCount())
  const [rejectedScans, setRejectedScans] = useState(() => offlineQueue.getRejected())
  const [syncing, setSyncing] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [recent, setRecent] = useState<Awaited<ReturnType<typeof attendanceService.listCheckIns>>>([])
  const [noShowSummary, setNoShowSummary] = useState<attendanceService.NoShowSummary | null>(null)
  const [fines, setFines] = useState<attendanceService.MessFineRow[]>([])
  const [payingId, setPayingId] = useState<string | null>(null)
  const [showTimings, setShowTimings] = useState(false)
  const [summary, setSummary] = useState<attendanceService.AttendanceSummary | null>(null)
  const [soundOn, setSound] = useState(() => isSoundOn())
  const [flash, setFlash] = useState<{ kind: 'success' | 'warn' | 'error'; id: number } | null>(null)
  const [alertsKey, setAlertsKey] = useState(0)
  const canEditTimings = ['SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER'].includes(user?.role ?? '')

  // The date and time that count are the MESS's (the server's clock, in the mess's timezone) — never this phone's.
  const win = meal && snap ? snap.windows.find((w) => w.meal === meal) : undefined
  // A meal that runs past midnight is still last evening's meal at 00:30, so the server says which date to record it under.
  const today = win?.date ?? snap?.now.date ?? TODAY_ISO
  const timingKnown = !!snap
  const isOpen = !snap || !snap.enforced || !!win?.open
  const blocked = !!meal && timingKnown && !isOpen
  const mealLabel = (m: MealType) => MEAL_TYPES.find((x) => x.key === m)?.label ?? m
  const openNow = snap?.windows.find((w) => w.open)

  function refreshFines() {
    attendanceService.finesForMess(messId, false).then(setFines)
  }
  useEffect(refreshFines, [messId])

  async function payFine(fineId: string) {
    setPayingId(fineId)
    try {
      await attendanceService.markFinePaid(fineId)
      refreshFines()
    } catch (e) {
      setOutcome({ kind: 'error', message: e instanceof Error ? e.message : 'Could not mark that fine as paid.' })
    } finally {
      setPayingId(null)
    }
  }

  // Meal timings from the server: on load, every 20 s (so the scanner opens/closes by itself as the clock moves), and on demand.
  const loadSnap = useCallback(() => {
    return attendanceService.getMealWindows(messId).then((s) => { setSnap(s); setSnapError('') }).catch((e) => setSnapError(e instanceof Error ? e.message : 'Could not load the meal timings.'))
  }, [messId])
  useEffect(() => {
    void loadSnap()
    const id = window.setInterval(() => void loadSnap(), 20_000)
    return () => window.clearInterval(id)
  }, [loadSnap])

  function refreshRecent() {
    if (!meal) { setRecent([]); return }
    attendanceService.listCheckIns(messId, today, meal).then(setRecent)
  }
  useEffect(refreshRecent, [messId, meal, today])

  const refreshSummary = useCallback(() => {
    if (!meal) { setSummary(null); return }
    attendanceService.getAttendanceSummary(messId, today, meal).then(setSummary).catch(() => { /* the count is a convenience; scanning works without it */ })
  }, [messId, today, meal])
  useEffect(() => {
    refreshSummary()
    const id = window.setInterval(refreshSummary, 20_000)
    return () => window.clearInterval(id)
  }, [refreshSummary])

  /** What the counter hears, feels and sees after every scan — the line moves faster when you don't have to read a card. */
  function signal(kind: 'success' | 'warn' | 'error') {
    playScanFeedback(kind)
    setFlash({ kind, id: Date.now() })
  }

  function describeClosed(m: MealType): string {
    const w = snap?.windows.find((x) => x.meal === m)
    if (!w || !snap) return ''
    const base = `This is not ${mealLabel(m)} time — ${mealLabel(m)} is served ${w.start}–${w.end} (it's ${snap.now.time} now).`
    const on = snap.windows.find((x) => x.open)
    if (on) return `${base} ${mealLabel(on.meal)} is being served now.`
    return snap.next ? `${base} Next up: ${mealLabel(snap.next.meal)} at ${snap.next.start}.` : base
  }

  // Everything that records a check-in goes through here, so QR scans and typed UIDs behave identically.
  async function record(run: () => Promise<attendanceService.CheckInResult>, queueUid?: string, queueQr?: string) {
    if (!meal || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      const result = await run()
      setOutcome({ kind: 'success', data: result, timezone: snap?.timezone })
      signal(result.onLeave || result.hasPhoto === false ? 'warn' : 'success') // "look at this person" tones when something needs a human eye
      setUid('')
      refreshRecent()
      refreshSummary()
      setAlertsKey((k) => k + 1)
    } catch (e) {
      const code = (e as { code?: string }).code
      const meals = (e as { meals?: attendanceService.MealWindowsSnapshot }).meals
      if (meals) setSnap(meals) // the server's own view of the timings, from the refusal
      if (offlineQueue.isNetworkError(e)) {
        if (queueUid) {
          // The request never reached the server — keep the line moving: save the scan with its real time and replay it later.
          const saved = offlineQueue.enqueue({ uid: queueUid, ...(queueQr ? { qr: queueQr } : {}), messId, meal, date: today, scannedAt: new Date().toISOString() })
          setPending(offlineQueue.pendingCount())
          setOutcome(saved
            ? { kind: 'queued', message: `Saved offline — ${queueUid}${queueQr ? "'s offline code" : ''} will be checked in automatically when the connection returns.`, detail: queueQr ? "Not confirmed yet: this phone's offline code is only verified by the server once it syncs — if it turns out invalid, it will be listed as rejected." : "Not confirmed yet: the student's check-in is only recorded once it syncs." }
            : { kind: 'error', message: 'Offline and the pending list is full (500) — reconnect and sync before scanning more.' })
          if (saved) setUid('')
        } else {
          // A live QR can only be verified by the server (it holds the signing key) and expires in a minute, so it can't be queued.
          setOutcome({ kind: 'error', code: 'OFFLINE_QR', message: 'No connection to the server — a live QR code can only be verified online. Ask the student to show their offline code (open the Attendance page on their phone), or enter their UID below to save it for syncing.' })
        }
      } else {
        setOutcome({ kind: 'error', code, message: e instanceof Error ? e.message : 'Check-in failed.' })
        signal('error')
        setAlertsKey((k) => k + 1)
      }
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const onQr = (value: string) => {
    if (!meal || !isOpen) return
    // A phone's OFFLINE code can wait in the queue (the server checks it against the scan time later); a live QR can't.
    const off = parseOfflineCode(value)
    void record(() => attendanceService.checkInByQr(value, messId, meal, today), off?.studentId, off ? value : undefined)
  }
  const submitUid = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed || !meal) return
    void record(() => attendanceService.checkIn(trimmed, messId, meal, today, user), trimmed)
  }

  async function syncPending() {
    setSyncing(true)
    try {
      const r = await offlineQueue.syncQueue((scan) => scan.qr
        ? attendanceService.checkInByQr(scan.qr, scan.messId, scan.meal, scan.date, scan.scannedAt)
        : attendanceService.checkIn(scan.uid, scan.messId, scan.meal, scan.date, user, scan.scannedAt))
      if (r.synced > 0) refreshRecent()
    } finally {
      setPending(offlineQueue.pendingCount())
      setRejectedScans(offlineQueue.getRejected())
      setSyncing(false)
    }
  }

  // Replay automatically when the browser regains connectivity, and retry every 30s while anything is waiting.
  useEffect(() => {
    const onOnline = () => { void syncPending(); void loadSnap() }
    window.addEventListener('online', onOnline)
    const timer = setInterval(() => { if (offlineQueue.pendingCount() > 0) void syncPending() }, 30_000)
    if (offlineQueue.pendingCount() > 0) void syncPending()
    return () => { window.removeEventListener('online', onOnline); clearInterval(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messId, meal])

  async function runNoShows() {
    if (!meal) return
    setBusy(true)
    try {
      const summary = await attendanceService.processNoShows(messId, today, meal, user)
      setNoShowSummary(summary)
      refreshFines()
    } catch (e) {
      setOutcome({ kind: 'error', message: e instanceof Error ? e.message : 'No-show processing failed.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100">Meal Check-in</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Choose the meal being served, then scan each student's QR code with this device's camera.</p>
        </div>
        <div className="flex items-center gap-3">
          {snap && <p data-testid="mess-clock" className="text-xs text-slate-500 dark:text-slate-400">Mess time <strong className="font-mono">{snap.now.time}</strong> · {snap.now.date}</p>}
          <button
            type="button"
            aria-pressed={soundOn}
            onClick={() => { const next = !soundOn; setSoundOn(next); setSound(next); if (next) playScanFeedback('success') }}
            className="text-xs font-semibold rounded-lg border border-line dark:border-ink-700 px-2.5 py-1.5"
          >
            {soundOn ? 'Sound on' : 'Sound off'}
          </button>
        </div>
      </div>
      {flash && <div key={flash.id} aria-hidden data-testid="scan-flash" data-kind={flash.kind} className={`scan-flash scan-flash-${flash.kind}`} />}
      {meal && <LiveCount summary={summary} label={mealLabel(meal)} />}

      <DashboardCard title="1. Which meal is being served?">
        <div role="group" aria-label="Meal" className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {MEAL_TYPES.map((m) => {
            const w = snap?.windows.find((x) => x.meal === m.key)
            const selected = meal === m.key
            return (
              <button
                key={m.key}
                type="button"
                aria-pressed={selected}
                onClick={() => { setMeal(m.key); setOutcome(null); void loadSnap() }}
                className={`rounded-xl border px-3 py-2.5 text-left transition ${selected ? 'border-tech-500 bg-tech-50 dark:bg-tech-500/10 ring-2 ring-tech-500/30' : 'border-line dark:border-ink-700 hover:bg-surface-dim dark:hover:bg-ink-800'}`}
              >
                <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{m.label}</span>
                {w && <span className="block text-[11px] text-slate-500 dark:text-slate-400">{w.start}–{w.end}</span>}
                {w && snap?.enforced && <span className={`mt-1 inline-block text-[10px] font-semibold rounded-full px-1.5 py-0.5 ${w.open ? 'bg-eco-50 text-eco-700 dark:bg-eco-500/10 dark:text-eco-400' : 'bg-surface-dim dark:bg-ink-800 text-slate-500'}`}>{w.open ? 'Serving now' : 'Not now'}</span>}
              </button>
            )
          })}
        </div>
        {snapError && !snap && <p role="alert" className="mt-3 text-xs text-amber-700 bg-amber-50 dark:bg-amber-500/10 rounded-lg px-3 py-2">{snapError} Meal timings can't be checked right now; typed-UID check-ins will be saved and synced when the connection returns.</p>}
        {canEditTimings && snap && (
          <div className="mt-3">
            <button onClick={() => setShowTimings((v) => !v)} className="text-xs font-semibold text-tech-600 hover:underline">{showTimings ? 'Hide meal timings' : 'Edit meal timings'}</button>
            {showTimings && <div className="mt-3"><MealTimingsEditor messId={messId} snapshot={snap} onSaved={setSnap} /></div>}
          </div>
        )}
      </DashboardCard>

      <div className="grid md:grid-cols-2 gap-5">
        <DashboardCard title="2. Scan">
          {!meal ? (
            <p data-testid="pick-meal" className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center">Select the meal above to start scanning.</p>
          ) : blocked ? (
            <div data-testid="not-meal-time" role="alert" className="rounded-xl bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 p-4 text-sm space-y-3">
              <p className="font-semibold">{describeClosed(meal)}</p>
              <p className="text-xs opacity-80">The camera stays off outside the meal's serving time, and the server would refuse the check-in anyway.</p>
              {openNow && <button onClick={() => { setMeal(openNow.meal); setOutcome(null) }} className="text-xs font-semibold rounded-lg bg-amber-600 text-white px-3 py-1.5">Switch to {mealLabel(openNow.meal)}</button>}
            </div>
          ) : (
            <>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">{mealLabel(meal)} is being served{win ? ` (${win.start}–${win.end})` : ''} — point the camera at the student's QR code.</p>
              <QrScanner active={!!meal && isOpen} onScan={onQr} />
            </>
          )}

          <form onSubmit={(e) => { e.preventDefault(); submitUid(uid) }} className="flex gap-2 mt-3">
            <input value={uid} onChange={(e) => setUid(e.target.value)} disabled={!meal || blocked} placeholder="Enter student UID" aria-label="Student UID" className="flex-1 rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm disabled:opacity-50" />
            <button type="submit" disabled={busy || !meal || blocked} className="flex items-center gap-1.5 rounded-lg border border-line dark:border-ink-700 px-3 py-2 text-xs font-semibold disabled:opacity-60">
              <ScanLine size={13} /> Mark
            </button>
          </form>
          <ScannerSelfTest />
          <p className="text-[11px] text-slate-400 mt-1.5">Phone dead or camera not working? Type the UID instead — it is recorded as a manual check-in.</p>

          {outcome && <ScanResultCard outcome={outcome} />}

          {(pending > 0 || rejectedScans.length > 0) && (
            <div data-testid="offline-queue" className="mt-3 rounded-lg border border-amber-200 dark:border-amber-500/30 p-3 text-xs space-y-2">
              {pending > 0 && (
                <div className="flex items-center justify-between gap-3">
                  <span><strong>{pending}</strong> scan{pending === 1 ? '' : 's'} waiting to sync — saved on this device.</span>
                  <button onClick={() => void syncPending()} disabled={syncing} className="font-semibold px-3 py-1.5 rounded-lg border border-line dark:border-ink-700 disabled:opacity-60">{syncing ? 'Syncing…' : 'Sync now'}</button>
                </div>
              )}
              {rejectedScans.map((r) => (
                <div key={r.clientId} className="flex items-start justify-between gap-3 text-rose-600">
                  <span><strong>{r.uid}</strong> ({r.meal}, {r.date}) was not recorded: {r.reason}</span>
                  <button onClick={() => { offlineQueue.dismissRejected(r.clientId); setRejectedScans(offlineQueue.getRejected()) }} className="shrink-0 underline">Dismiss</button>
                </div>
              ))}
            </div>
          )}
        </DashboardCard>

        <DashboardCard title={meal ? `Checked in today — ${mealLabel(meal)}` : 'Checked in today'}>
          {recent.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">{meal ? 'No one checked in yet for this meal.' : 'Select a meal to see who has been checked in.'}</p>
          ) : (
            <div className="divide-y divide-line dark:divide-ink-700 max-h-64 overflow-y-auto">
              {recent.map((r) => (
                <div key={r.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-slate-600 dark:text-slate-300">{r.student_id}</span>
                  <span className="text-xs text-slate-400">{new Date(r.scanned_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: snap?.timezone })}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 pt-3 border-t border-line dark:border-ink-700">
            <button onClick={runNoShows} disabled={busy || !meal} className="w-full text-xs font-semibold rounded-lg border border-line dark:border-ink-700 py-2 disabled:opacity-60">
              Process no-shows{meal ? ` for ${mealLabel(meal)} today` : ''}
            </button>
            <p className="text-[11px] text-slate-400 mt-1.5">This runs by itself shortly after the meal's window closes (see "Automatic no-shows" below) — use the button to run it early, or if automatic processing is off.</p>
            {noShowSummary && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                {noShowSummary.checked} expected · {noShowSummary.noShows} no-show{noShowSummary.noShows === 1 ? '' : 's'} ·{' '}
                <StatusBadge tone={noShowSummary.warningsIssued ? 'warning' : 'neutral'}>{noShowSummary.warningsIssued} warning{noShowSummary.warningsIssued === 1 ? '' : 's'}</StatusBadge>{' '}
                {noShowSummary.finesIssued > 0 && <StatusBadge tone="danger">{noShowSummary.finesIssued} fine{noShowSummary.finesIssued === 1 ? '' : 's'} issued</StatusBadge>}
              </p>
            )}
          </div>
        </DashboardCard>
      </div>

      {canEditTimings && <ScanAlertsCard messId={messId} refreshKey={alertsKey} />}
      {canEditTimings && <DailySummaryCard messId={messId} />}
      {canEditTimings && <AutoNoShowCard messId={messId} />}
      {canEditTimings && <AttendanceExportCard messId={messId} />}

      <DashboardCard title="Outstanding Fines">
        {fines.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">No unpaid no-show fines for this mess right now.</p>
        ) : (
          <div className="divide-y divide-line dark:divide-ink-700">
            {fines.map((f) => (
              <div key={f.id} className="flex items-center justify-between py-2.5 text-sm">
                <div>
                  <span className="font-medium text-slate-700 dark:text-slate-200">{f.studentName}</span>
                  <span className="text-slate-400 ml-2">{f.studentId} · {f.month} · {formatINR(f.amount)}</span>
                </div>
                <button
                  onClick={() => payFine(f.id)}
                  disabled={payingId === f.id}
                  className="text-xs font-semibold rounded-lg border border-line dark:border-ink-700 px-3 py-1.5 disabled:opacity-60"
                >
                  {payingId === f.id ? 'Marking…' : 'Mark paid'}
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="text-[11px] text-slate-400 mt-3">Only mess staff can mark a fine as paid — a student can see their own fines but not clear them (Attendance page, their view).</p>
      </DashboardCard>
    </div>
  )
}

function AttendanceAnalytics() {
  const { user } = useAuth()
  const canExport = user?.role === 'FINANCE_MANAGER' // managers get the export in their console; finance has no console
  const messId = useMessStore((s) => s.currentMessId)
  const series = useMemo(() => attendanceByMealSeries(messId, 14), [messId])
  const hostelDemand = useMemo(() => hostelWiseDemand(messId), [messId])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100">Attendance Analytics</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Daily, meal-wise and hostel-wise participation trends.</p>
      </div>
      {canExport && <AttendanceExportCard messId={messId} />}
      <DemoBanner what="The charts and hostel figures below are sample data." detail="Real attendance is the check-in log above and the CSV export — use those for decisions." />
      <ChartCard title="Meal-wise Attendance" subtitle="Last 14 days" height={280}>
        <BarChart data={series}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-line dark:stroke-ink-700" />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => String(d).slice(5)} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="Breakfast" stackId="a" fill="#D97D0A" />
          <Bar dataKey="Lunch" stackId="a" fill="#1F8A5F" />
          <Bar dataKey="Snacks" stackId="a" fill="#9AA6B8" />
          <Bar dataKey="Dinner" stackId="a" fill="#3554D1" />
        </BarChart>
      </ChartCard>
      <div>
        <h2 className="font-display font-semibold text-slate-800 dark:text-slate-100 mb-3">Hostel-wise Demand</h2>
        <div className="grid md:grid-cols-2 gap-3">
          {hostelDemand.map((h) => (
            <div key={h.hostel} className="rounded-xl border border-line dark:border-ink-700 bg-white dark:bg-ink-900 p-4 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{h.hostel}</span>
              <span className="font-display font-bold text-tech-600 dark:text-tech-500">{formatNumber(h.students)} students</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
