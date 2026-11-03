import { AlertTriangle, BadgeCheck, CircleAlert, Clock } from 'lucide-react'
import type { CheckInResult } from '@/services/attendanceService'
import { MEAL_TYPES } from '@/data/mockOperations'
import { StudentAvatar } from '@/components/ui/StudentAvatar'

export type ScanOutcome =
  | { kind: 'success'; data: CheckInResult; timezone?: string }
  | { kind: 'error'; message: string; code?: string }
  | { kind: 'queued'; message: string; detail?: string }

/** What the counter sees after every scan: on success, the official photo and record to compare against the person standing there. */
export function ScanResultCard({ outcome }: { outcome: ScanOutcome }) {
  if (outcome.kind === 'success') {
    const d = outcome.data
    const when = new Date(d.scannedAt)
    const tz = outcome.timezone
    const date = when.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: tz })
    const time = when.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: tz })
    return (
      <div role="status" data-testid="scan-success" className="mt-4 rounded-2xl border border-eco-200 dark:border-eco-500/30 bg-eco-50 dark:bg-eco-500/10 p-4">
        <div className="flex items-center gap-1.5 text-eco-700 dark:text-eco-400 text-sm font-semibold">
          <BadgeCheck size={18} /> Checked in — {d.studentName}
        </div>
        <div className="mt-3 flex gap-4">
          <StudentAvatar studentId={d.studentId} name={d.studentName} size={96} />
          <dl className="text-sm text-slate-700 dark:text-slate-200 space-y-0.5 min-w-0">
            <div className="font-display font-bold text-base truncate">{d.studentName}</div>
            <div className="font-mono text-xs text-slate-500">{d.studentId}</div>
            {(d.hostelName || d.room) && <div className="text-xs">{[d.hostelName, d.room && `Room ${d.room}`].filter(Boolean).join(' · ')}</div>}
            {(d.branch || d.year) && <div className="text-xs">{[d.branch, d.year && `Year ${d.year}`].filter(Boolean).join(' · ')}</div>}
            <div className="text-xs font-semibold pt-1">{MEAL_TYPES.find((m) => m.key === d.meal)?.label} · {date}</div>
            <div className="text-xs flex items-center gap-1"><Clock size={12} /> {time}</div>
          </dl>
        </div>
        <p className="mt-3 text-[11px] text-eco-700/80 dark:text-eco-400/80">
          {d.method === 'qr' ? 'Verified from the database — signed QR scanned from the student\'s own phone.'
            : d.method === 'card' ? 'Verified from the database — printed ID card scanned. Compare the photo with the person in front of you.'
            : 'Verified from the database — UID typed by counter staff (no QR was scanned).'}
        </p>
        {d.onLeave && (
          <p role="alert" data-testid="leave-warning" className="mt-2 text-xs rounded-lg bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 px-3 py-2 flex items-start gap-1.5">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" /> This student is on approved leave until {d.leaveUntil}. They were checked in, but make sure it's really them standing there.
          </p>
        )}
        {d.hasPhoto === false && (
          <p role="alert" className="mt-2 text-xs rounded-lg bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 px-3 py-2 flex items-start gap-1.5">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" /> No official photo is on file for this student — check their ID card, and ask the warden office to add a photo.
          </p>
        )}
      </div>
    )
  }
  const tone = outcome.kind === 'queued'
    ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 border-amber-200'
    : 'bg-rose-50 dark:bg-rose-500/10 text-rose-600 border-rose-200 dark:border-rose-500/30'
  return (
    <div role={outcome.kind === 'error' ? 'alert' : 'status'} data-testid={`scan-${outcome.kind}`} className={`mt-4 rounded-2xl border p-4 text-sm flex items-start gap-2 ${tone}`}>
      <CircleAlert size={18} className="shrink-0 mt-0.5" />
      <div>
        <p className="font-medium">{outcome.message}</p>
        {outcome.kind === 'queued' && outcome.detail && <p className="text-xs opacity-80 mt-0.5">{outcome.detail}</p>}
      </div>
    </div>
  )
}
