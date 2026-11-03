import { useState } from 'react'
import { CheckCircle2, XCircle, MinusCircle } from 'lucide-react'
import { QrScanner } from './QrScanner'

type Status = 'pass' | 'fail' | 'info'
interface Check { label: string; status: Status; detail: string }

/**
 * "Check this device": before the line forms, find out whether THIS phone/tablet can scan — secure page, camera API, camera
 * permission, which decoder it will use — then try a real read. Nothing is sent to the server and nobody is checked in.
 */
export function ScannerSelfTest() {
  const [open, setOpen] = useState(false)
  const [checks, setChecks] = useState<Check[]>([])
  const [reading, setReading] = useState(false)
  const [read, setRead] = useState('')

  async function run() {
    setRead(''); setReading(false)
    const out: Check[] = []
    const secure = window.isSecureContext !== false
    out.push({ label: 'Secure page (https)', status: secure ? 'pass' : 'fail', detail: secure ? 'The browser will allow the camera.' : 'Browsers block the camera on plain http. Open this site over https (or localhost).' })
    const hasApi = !!navigator.mediaDevices?.getUserMedia
    out.push({ label: 'Camera available to the browser', status: hasApi ? 'pass' : 'fail', detail: hasApi ? 'Camera API found.' : 'This browser or page has no camera access.' })
    const native = !!(window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector
    out.push({ label: 'QR decoder', status: 'info', detail: native ? "Using the browser's built-in decoder (fast)." : 'Using the bundled JavaScript decoder (works on iPhone Safari and Firefox; slightly slower).' })
    if (hasApi) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
        const label = stream.getVideoTracks()[0]?.label || 'camera'
        stream.getTracks().forEach((t) => t.stop())
        out.push({ label: 'Camera permission', status: 'pass', detail: `Allowed (${label}).` })
      } catch (e) {
        const name = (e as { name?: string })?.name
        out.push({ label: 'Camera permission', status: 'fail', detail: name === 'NotAllowedError' ? 'Blocked. Allow the camera for this site in the browser settings, then run the check again.' : name === 'NotFoundError' ? 'No camera was found on this device.' : 'The camera could not be opened (is another app using it?).' })
      }
    }
    setChecks(out)
  }

  const allGood = checks.length > 0 && checks.every((c) => c.status !== 'fail')

  return (
    <div className="mt-3">
      <button onClick={() => { setOpen((v) => !v); if (!open) void run() }} className="text-xs font-semibold text-tech-600 hover:underline">{open ? 'Hide device check' : 'Check this device'}</button>
      {open && (
        <div data-testid="self-test" className="mt-3 rounded-xl border border-line dark:border-ink-700 p-3 space-y-3">
          <ul className="space-y-2">
            {checks.map((c) => (
              <li key={c.label} className="flex items-start gap-2 text-xs">
                {c.status === 'pass' ? <CheckCircle2 size={15} className="text-eco-600 shrink-0" /> : c.status === 'fail' ? <XCircle size={15} className="text-rose-500 shrink-0" /> : <MinusCircle size={15} className="text-slate-400 shrink-0" />}
                <span><strong className="text-slate-700 dark:text-slate-200">{c.label}.</strong> <span className="text-slate-500 dark:text-slate-400">{c.detail}</span></span>
              </li>
            ))}
          </ul>
          {allGood && !reading && <button onClick={() => { setRead(''); setReading(true) }} className="text-xs font-semibold rounded-lg border border-line dark:border-ink-700 px-3 py-1.5">Try a real read</button>}
          {reading && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">Point the camera at any QR code (for example the one on a student's phone). Nothing is recorded.</p>
              <QrScanner active={reading && !read} onScan={(v) => { setRead(v); setReading(false) }} />
            </div>
          )}
          {read && <p role="status" className="text-xs rounded-lg bg-eco-50 dark:bg-eco-500/10 text-eco-700 dark:text-eco-400 px-3 py-2 break-all">✔ This device can scan. It read {read.length} characters ({read.slice(0, 24)}{read.length > 24 ? '…' : ''}). Nobody was checked in.</p>}
          <button onClick={() => void run()} className="text-[11px] text-slate-400 hover:underline">Run the check again</button>
        </div>
      )}
    </div>
  )
}
