import { useState } from 'react'
import { Loader2, ShieldCheck, ShieldOff, Copy, Check } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import * as authService from '@/services/authService'
import { QrCodeSvg } from '@/components/ui/QrCodeSvg'

const INPUT = 'w-full rounded-xl border border-line dark:border-ink-700 bg-white dark:bg-ink-800 text-sm text-slate-800 dark:text-slate-100 py-2.5 px-3.5 focus:outline-none focus:border-tech-500 focus:ring-4 focus:ring-tech-500/15'
const BTN = 'rounded-xl bg-tech-500 hover:bg-tech-600 text-white text-sm font-semibold py-2.5 px-4 disabled:opacity-60 flex items-center justify-center gap-2'

type Phase = 'idle' | 'setup' | 'codes' | 'disable'

/** Turn authenticator-app (TOTP) two-factor sign-in on or off — for your own account. */
export function TwoFactorSettings() {
  const { user, setTwoFactorEnabled } = useAuth()
  const enabled = !!user?.twoFactorEnabled
  const [phase, setPhase] = useState<Phase>('idle')
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [recovery, setRecovery] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  async function begin() {
    setError(''); setBusy(true)
    try { setSetup(await authService.startTwoFactorSetup()); setCode(''); setPhase('setup') }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not start setup.') }
    finally { setBusy(false) }
  }
  async function confirm() {
    setError(''); setBusy(true)
    try {
      const r = await authService.enableTwoFactor(code)
      setRecovery(r.recoveryCodes); setTwoFactorEnabled(true); setPhase('codes')
    } catch (e) { setError(e instanceof Error ? e.message : 'That code did not work.') }
    finally { setBusy(false) }
  }
  async function turnOff() {
    setError(''); setBusy(true)
    try { await authService.disableTwoFactor(password, code); setTwoFactorEnabled(false); setPhase('idle'); setPassword(''); setCode('') }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not turn it off.') }
    finally { setBusy(false) }
  }

  return (
    <section aria-labelledby="twofa-h" className="mt-6 pt-5 border-t border-line dark:border-ink-700">
      <h2 id="twofa-h" className="font-display font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
        {enabled ? <ShieldCheck size={16} className="text-eco-600" /> : <ShieldOff size={16} className="text-slate-400" />} Two-factor sign-in
        <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${enabled ? 'bg-eco-50 text-eco-700 dark:bg-eco-500/10 dark:text-eco-400' : 'bg-surface-dim dark:bg-ink-800 text-slate-500'}`}>{enabled ? 'On' : 'Off'}</span>
      </h2>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Adds a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy…) to your password when you sign in.</p>
      {error && <p role="alert" className="mt-3 text-xs text-rose-600 bg-rose-50 dark:bg-rose-500/10 rounded-lg px-3 py-2">{error}</p>}

      {phase === 'idle' && !enabled && <button onClick={begin} disabled={busy} className={`${BTN} mt-3`}>{busy && <Loader2 size={14} className="animate-spin" />}Turn on two-factor</button>}
      {phase === 'idle' && enabled && !user?.twoFactorRequired && <button onClick={() => { setPhase('disable'); setError('') }} className="mt-3 text-sm font-semibold text-rose-600 hover:underline">Turn off two-factor…</button>}
      {phase === 'idle' && enabled && user?.twoFactorRequired && <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Required for your role, so it can't be turned off. If you lose your authenticator and your recovery codes, the Super Admin can reset it for you.</p>}

      {phase === 'setup' && setup && (
        <div className="mt-4 space-y-3 max-w-sm">
          <p className="text-xs text-slate-600 dark:text-slate-300">1. Scan this with your authenticator app (or type the key in by hand).</p>
          <div className="inline-block rounded-xl bg-white p-2 border border-line"><QrCodeSvg value={setup.otpauthUri} size={168} /></div>
          <p className="text-[11px] text-slate-500">Key: <code data-testid="totp-secret" className="font-mono select-all break-all">{setup.secret}</code></p>
          <p className="text-xs text-slate-600 dark:text-slate-300">2. Enter the 6-digit code the app shows to confirm it works.</p>
          <input aria-label="Authenticator code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" className={`${INPUT} font-mono tracking-[0.4em] text-center`} />
          <div className="flex gap-2">
            <button onClick={confirm} disabled={busy || code.length !== 6} className={BTN}>{busy && <Loader2 size={14} className="animate-spin" />}Confirm &amp; turn on</button>
            <button onClick={() => { setPhase('idle'); setSetup(null) }} className="text-sm text-slate-500 hover:underline">Cancel</button>
          </div>
        </div>
      )}

      {phase === 'codes' && (
        <div className="mt-4 max-w-sm space-y-3" data-testid="recovery-codes">
          <p role="status" className="text-sm rounded-xl bg-eco-50 dark:bg-eco-500/10 text-eco-700 dark:text-eco-400 px-3.5 py-2.5">Two-factor sign-in is on.</p>
          <p className="text-xs text-slate-600 dark:text-slate-300"><strong>Save these recovery codes now.</strong> Each works once if you lose your phone. They are shown only this one time.</p>
          <ul className="grid grid-cols-2 gap-1.5 font-mono text-sm rounded-xl bg-surface-dim dark:bg-ink-800 p-3">{recovery.map((c) => <li key={c}>{c}</li>)}</ul>
          <div className="flex gap-2">
            <button onClick={() => { navigator.clipboard?.writeText(recovery.join('\n')); setCopied(true) }} className="rounded-xl border border-line dark:border-ink-700 text-sm font-semibold py-2 px-3 flex items-center gap-1.5">{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy'}</button>
            <button onClick={() => { setPhase('idle'); setRecovery([]) }} className={BTN}>I've saved them</button>
          </div>
        </div>
      )}

      {phase === 'disable' && (
        <div className="mt-4 max-w-sm space-y-3">
          <p className="text-xs text-slate-600 dark:text-slate-300">Enter your password and a current code (or a recovery code) to turn it off.</p>
          <input aria-label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder="Password" className={INPUT} />
          <input aria-label="Code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" placeholder="Authenticator or recovery code" className={`${INPUT} font-mono`} />
          <div className="flex gap-2">
            <button onClick={turnOff} disabled={busy || !password || code.trim().length < 6} className="rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold py-2.5 px-4 disabled:opacity-60 flex items-center gap-2">{busy && <Loader2 size={14} className="animate-spin" />}Turn off</button>
            <button onClick={() => { setPhase('idle'); setError('') }} className="text-sm text-slate-500 hover:underline">Cancel</button>
          </div>
        </div>
      )}
    </section>
  )
}
