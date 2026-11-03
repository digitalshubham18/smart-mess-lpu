import { useEffect, useState } from 'react'
import * as studentService from '@/services/studentService'
import type { PhotoNotice } from '@/services/studentService'

/** The photo privacy notice (DPDP): what is kept, why, who sees it, how long, and how to withdraw. Text comes from the server so there is one version. */
export function PhotoNoticeBody({ onLoaded }: { onLoaded?: (n: PhotoNotice) => void }) {
  const [notice, setNotice] = useState<PhotoNotice | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let current = true
    studentService.getPhotoNotice().then((n) => { if (current) { setNotice(n); onLoaded?.(n) } }).catch((e) => { if (current) setError(e instanceof Error ? e.message : 'Could not load the notice.') })
    return () => { current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (error) return <p role="alert" className="text-xs text-rose-600">{error}</p>
  if (!notice) return <p className="text-xs text-slate-400">Loading the privacy notice…</p>
  return (
    <div data-testid="photo-notice" className="rounded-xl bg-surface-dim dark:bg-ink-800 p-3.5 text-xs text-slate-600 dark:text-slate-300 space-y-1.5">
      <p className="font-semibold text-slate-800 dark:text-slate-100">{notice.title}</p>
      {notice.points.map((p) => <p key={p.heading}><strong>{p.heading}.</strong> {p.text}</p>)}
    </div>
  )
}
