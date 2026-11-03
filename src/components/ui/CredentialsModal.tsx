import { Download } from 'lucide-react'
import { Modal } from './Modal'

export interface Credential {
  name: string
  uid: string
  password: string
  role?: string
}

function toCsv(rows: Credential[]) {
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`
  return ['name,uid,role,temporary_password', ...rows.map((r) => [r.name, r.uid, r.role ?? '', r.password].map(q).join(','))].join('\n')
}

/**
 * Shows newly issued sign-in details ONCE. The server keeps only a hash of these passwords, so
 * this screen is the only place they exist in readable form — which is why it offers a CSV
 * download for bulk imports (and why closing it is a deliberate act, not an accident).
 */
export function CredentialsModal({ open, onClose, title, intro, credentials, emailFailed }: { open: boolean; onClose: () => void; title: string; intro: string; credentials: Credential[]; emailFailed?: boolean }) {
  function download() {
    const blob = new Blob([toCsv(credentials)], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'new-credentials.csv'
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">{intro}</p>
        <div className="rounded-lg bg-surface-dim dark:bg-ink-800 p-3 text-sm font-mono max-h-56 overflow-y-auto space-y-2" data-testid="credentials-list">
          {credentials.map((c) => (
            <div key={c.uid}>
              {credentials.length > 1 && <div className="text-[11px] font-sans text-slate-500">{c.name}{c.role ? ` · ${c.role}` : ''}</div>}
              UID: <strong>{c.uid}</strong><br />
              Password: <strong>{c.password}</strong>
            </div>
          ))}
        </div>
        {emailFailed && (
          <p role="alert" className="text-xs text-amber-700 bg-amber-50 dark:bg-amber-500/10 rounded-lg px-3 py-2">
            The email with these details could not be sent (the mail server isn't reachable), so nobody has them yet — pass them on yourself.
          </p>
        )}
        <p className="text-[11px] text-slate-400">This is the only time these passwords are shown — they're stored only as a hash. Each person should change theirs from their Profile page after first sign-in.</p>
        <div className="flex gap-2">
          {credentials.length > 1 && (
            <button onClick={download} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2.5 rounded-lg border border-line dark:border-ink-700"><Download size={13} /> Download CSV</button>
          )}
          <button onClick={onClose} className="flex-1 rounded-lg bg-tech-500 text-white text-sm font-semibold py-2.5">Done</button>
        </div>
      </div>
    </Modal>
  )
}
