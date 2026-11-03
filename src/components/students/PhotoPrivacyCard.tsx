import { useEffect, useState } from 'react'
import { Loader2, ShieldCheck } from 'lucide-react'
import * as studentService from '@/services/studentService'
import type { MyPrivacy } from '@/services/studentService'
import { PhotoNoticeBody } from './PhotoNoticeBody'

/** A student's own control over the photo held about them: see the notice, agree, or withdraw (which deletes the photo at once). */
export function PhotoPrivacyCard() {
  const [p, setP] = useState<MyPrivacy | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [showNotice, setShowNotice] = useState(false)

  useEffect(() => {
    let current = true
    studentService.getMyPrivacy().then((v) => { if (current) setP(v) }).catch((e) => { if (current) setError(e instanceof Error ? e.message : 'Could not load your privacy settings.') })
    return () => { current = false }
  }, [])

  async function run(fn: () => Promise<MyPrivacy>) {
    setBusy(true); setError('')
    try { setP(await fn()); setConfirm(false) } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') } finally { setBusy(false) }
  }

  return (
    <section aria-labelledby="privacy-h" className="mt-6 pt-5 border-t border-line dark:border-ink-700">
      <h2 id="privacy-h" className="font-display font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2"><ShieldCheck size={16} className="text-slate-400" />Privacy — your photo</h2>
      {error && <p role="alert" className="mt-3 text-xs text-rose-600 bg-rose-50 dark:bg-rose-500/10 rounded-lg px-3 py-2">{error}</p>}
      {!p && !error && <p className="mt-2 text-xs text-slate-400">Loading…</p>}
      {p && (
        <div className="mt-2 space-y-3 max-w-md">
          <p className="text-xs text-slate-600 dark:text-slate-300" data-testid="privacy-status">
            {p.photoOnFile
              ? <>The mess holds <strong>a photo of you</strong> so counter staff can match you to your QR code.{p.consentAt ? ` Consent recorded ${new Date(p.consentAt).toLocaleDateString()}${p.consentMethod === 'staff_attested' ? ' (confirmed by staff when it was taken)' : ''}.` : ''}</>
              : p.consentGiven
                ? <>You've agreed to the photo notice. No photo is on file yet.</>
                : <>No photo of you is held. You'll be checked against your ID card instead — your meals aren't affected.</>}
          </p>
          <button type="button" onClick={() => setShowNotice((v) => !v)} className="text-xs font-semibold text-tech-600 dark:text-tech-500 hover:underline">{showNotice ? 'Hide' : 'Read'} the privacy notice</button>
          {showNotice && <PhotoNoticeBody />}
          <div className="flex flex-wrap gap-2">
            {!p.consentGiven && <button onClick={() => void run(studentService.givePhotoConsent)} disabled={busy} className="rounded-xl bg-tech-500 hover:bg-tech-600 text-white text-sm font-semibold py-2 px-3.5 disabled:opacity-60 flex items-center gap-1.5">{busy && <Loader2 size={14} className="animate-spin" />}I agree to the photo notice</button>}
            {(p.consentGiven || p.photoOnFile) && !confirm && <button onClick={() => setConfirm(true)} disabled={busy} className="rounded-xl border border-line dark:border-ink-700 text-sm font-semibold py-2 px-3.5 text-rose-600">Withdraw consent &amp; delete my photo…</button>}
          </div>
          {confirm && (
            <div role="alertdialog" aria-label="Confirm withdrawing photo consent" className="rounded-xl border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 p-3.5">
              <p className="text-xs text-rose-800 dark:text-rose-200"><strong>Delete your photo now?</strong> It is erased immediately and can only be added again with your consent. Your meals and QR code are not affected.</p>
              <div className="mt-2.5 flex gap-2">
                <button onClick={() => void run(studentService.withdrawPhotoConsent)} disabled={busy} className="rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold py-2 px-3.5 disabled:opacity-60 flex items-center gap-1.5">{busy && <Loader2 size={14} className="animate-spin" />}Yes, delete it</button>
                <button onClick={() => setConfirm(false)} className="text-sm text-slate-500 hover:underline">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
