import { useState } from 'react'
import { Modal } from './Modal'

export function RequestChangeModal({
  open,
  onClose,
  mealLabel,
  menuLabel,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  mealLabel: string
  menuLabel: string
  onSubmit: (status: 'will_eat' | 'will_not', reason: string) => Promise<void> | void
}) {
  const [status, setStatus] = useState<'will_eat' | 'will_not'>('will_eat')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  async function submit() {
    setSubmitting(true)
    await onSubmit(status, reason || 'Forgot to mark before the cutoff.')
    setSubmitting(false)
    setDone(true)
  }

  function handleClose() {
    setDone(false)
    setReason('')
    setStatus('will_eat')
    onClose()
  }

  return (
    <Modal open={open} onClose={handleClose} title="Request a Meal Change" widthClass="max-w-sm">
      {done ? (
        <div className="text-center py-4">
          <p className="text-sm text-slate-700 dark:text-slate-200 font-medium">Request submitted.</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">A mess admin or manager will review it and apply the change if approved.</p>
          <button onClick={handleClose} className="mt-4 w-full rounded-lg bg-tech-500 hover:bg-tech-600 text-white text-sm font-semibold py-2.5">
            Close
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-slate-500 dark:text-slate-400">{mealLabel} · {menuLabel}</p>
          <div>
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">What should your status be?</label>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {(['will_eat', 'will_not'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={`rounded-lg py-2 text-xs font-semibold transition-colors ${
                    status === s ? 'bg-tech-500 text-white' : 'bg-surface dark:bg-ink-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {s === 'will_eat' ? 'Going' : "Won't eat"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Reason (optional)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="e.g. I forgot to mark before the cutoff — please add me for this meal."
              className="mt-1 w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm"
            />
          </div>
          <button onClick={submit} disabled={submitting} className="w-full rounded-lg bg-tech-500 hover:bg-tech-600 text-white text-sm font-semibold py-2.5 disabled:opacity-60">
            {submitting ? 'Submitting…' : 'Submit Request'}
          </button>
        </div>
      )}
    </Modal>
  )
}
