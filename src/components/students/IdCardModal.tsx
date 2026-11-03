import { useEffect, useState } from 'react'
import { Loader2, Printer } from 'lucide-react'
import type { Student } from '@/types'
import * as studentService from '@/services/studentService'
import { QrCodeSvg } from '@/components/ui/QrCodeSvg'
import { StudentAvatar } from '@/components/ui/StudentAvatar'

/**
 * A printable meal ID card for a student who has no phone login yet (a temporary TMP- ID) or has lost their phone. Its QR is
 * permanent but revocable: "Reissue" makes a new one and the old printed card stops working at once.
 */
export function IdCardModalBody({ student }: { student: Student }) {
  const [card, setCard] = useState<studentService.IdCard | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmReissue, setConfirmReissue] = useState(false)

  useEffect(() => {
    let current = true
    studentService.getIdCard(student.id).then((c) => { if (current) setCard(c) }).catch((e) => { if (current) setError(e instanceof Error ? e.message : 'Could not create the card.') })
    return () => { current = false }
  }, [student.id])

  async function reissue() {
    setBusy(true); setError('')
    try { setCard(await studentService.getIdCard(student.id, true)); setConfirmReissue(false) } catch (e) { setError(e instanceof Error ? e.message : 'Could not reissue the card.') } finally { setBusy(false) }
  }

  if (error && !card) return <p role="alert" className="text-sm text-rose-500">{error}</p>
  if (!card) return <p className="text-sm text-slate-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Creating the card…</p>

  return (
    <div className="space-y-4">
      {card.provisional && <p className="text-xs rounded-lg bg-amber-50 dark:bg-amber-500/10 text-amber-700 px-3 py-2">This student is on a temporary ID. The card keeps working after their real UID is assigned.</p>}
      {!card.hasPhoto && <p role="alert" className="text-xs rounded-lg bg-amber-50 dark:bg-amber-500/10 text-amber-700 px-3 py-2">No official photo yet — add one first so the counter can compare it with the person holding the card.</p>}
      {card.reissued && <p role="status" className="text-xs rounded-lg bg-eco-50 dark:bg-eco-500/10 text-eco-700 px-3 py-2">New card created. Any older printed card no longer works.</p>}
      {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}

      <div className="print-area">
        <div data-testid="id-card" className="w-[320px] rounded-2xl border-2 border-slate-300 bg-white text-slate-900 p-4 shadow-sm">
          <p className="text-[10px] font-semibold tracking-widest text-slate-500 uppercase">Smart Mess · Meal ID</p>
          <div className="mt-2 flex gap-3 items-center">
            <StudentAvatar studentId={card.studentId} name={card.name} size={72} />
            <div className="min-w-0">
              <p className="font-bold leading-tight">{card.name}</p>
              <p className="font-mono text-xs text-slate-600">{card.studentId}</p>
              <p className="text-xs text-slate-600">{card.hostelName} · Room {card.room}</p>
            </div>
          </div>
          <div className="mt-3 flex justify-center"><QrCodeSvg value={card.token} size={190} /></div>
          <p className="mt-2 text-[10px] text-center text-slate-500">Show this card at the mess counter. Do not share or photocopy it — if it is lost, tell the warden office.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 no-print">
        <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded-lg bg-tech-500 text-white text-sm font-semibold px-4 py-2"><Printer size={14} /> Print card</button>
        {!confirmReissue
          ? <button onClick={() => setConfirmReissue(true)} className="rounded-lg border border-line dark:border-ink-700 text-sm font-semibold px-4 py-2">Lost or copied? Reissue…</button>
          : (
            <span className="flex items-center gap-2 text-xs">
              <span className="text-rose-600">The old printed card will stop working immediately.</span>
              <button onClick={() => void reissue()} disabled={busy} className="rounded-lg bg-rose-600 text-white font-semibold px-3 py-1.5 disabled:opacity-60">{busy ? 'Reissuing…' : 'Yes, reissue'}</button>
              <button onClick={() => setConfirmReissue(false)} className="underline text-slate-500">Cancel</button>
            </span>
          )}
      </div>
    </div>
  )
}
