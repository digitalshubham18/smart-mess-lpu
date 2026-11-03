import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2, CheckCircle2, XCircle, Search, MailCheck, Utensils } from 'lucide-react'
import { signupPasswordSchema, type SignupPasswordForm } from '@/utils/validators'
import { useAuth } from '@/hooks/useAuth'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import * as studentService from '@/services/studentService'
import * as authService from '@/services/authService'
import type { StudentLookup } from '@/services/studentService'

type Phase = 'uid' | 'otp' | 'password'

const input = 'mt-1 w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2.5 text-sm'
const primary = 'w-full flex items-center justify-center gap-2 rounded-lg bg-tech-500 hover:bg-tech-600 text-white text-sm font-semibold py-2.5 disabled:opacity-50'

/**
 * Student sign-up, driven by the UID alone.
 *  1. UID — on the mess roster (the student has taken mess) → we already know who they are; otherwise
 *     "You haven't taken mess. For any query, visit the warden office."
 *  2. A 6-digit code goes to the email ON FILE (never one typed here), so knowing a UID isn't enough to claim it.
 *  3. Once verified the name appears, and the only thing left to choose is a password.
 */
export default function Register() {
  useDocumentTitle('Create Account')
  const { registerWithUid, isLoading, error, clearError } = useAuth()
  const navigate = useNavigate()

  const [phase, setPhase] = useState<Phase>('uid')
  const [uid, setUid] = useState('')
  const [lookup, setLookup] = useState<StudentLookup | null | undefined>(undefined) // undefined = not looked up yet, null = not on mess
  const [checking, setChecking] = useState(false)

  const [maskedEmail, setMaskedEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [otp, setOtp] = useState('')
  const [otpError, setOtpError] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [name, setName] = useState('')

  const { register, handleSubmit, formState: { errors } } = useForm<SignupPasswordForm>({ resolver: zodResolver(signupPasswordSchema) })

  useEffect(() => {
    const trimmed = uid.trim()
    setSendError('')
    if (!trimmed) {
      setLookup(undefined)
      setChecking(false)
      return
    }
    setChecking(true)
    let current = true
    const handle = setTimeout(() => {
      studentService.findByUid(trimmed).then((result) => {
        if (!current) return
        setLookup(result)
        setChecking(false)
      }).catch((e) => {
        if (!current) return
        setLookup(undefined)
        setChecking(false)
        setSendError(e instanceof Error ? e.message : 'Could not check your UID.')
      })
    }, 350) // debounce while typing
    return () => { current = false; clearTimeout(handle) }
  }, [uid])

  const onMess = !!lookup && !lookup.alreadyRegistered

  async function sendCode() {
    clearError()
    setSendError('')
    setSending(true)
    try {
      const r = await authService.sendSignupCode(uid)
      setMaskedEmail(r.maskedEmail ?? lookup?.maskedEmail ?? '')
      setOtp('')
      setOtpError('')
      setPhase('otp')
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Could not send the code.')
    } finally {
      setSending(false)
    }
  }

  async function verify() {
    setOtpError('')
    setVerifying(true)
    try {
      const r = await authService.verifySignupCode(uid, otp)
      if (!r.verified) {
        setOtpError(r.error ?? 'That code is incorrect or has expired — go back and request a new one.')
        return
      }
      setName(r.name ?? '')
      setPhase('password')
    } catch (e) {
      setOtpError(e instanceof Error ? e.message : 'Could not verify the code.')
    } finally {
      setVerifying(false)
    }
  }

  async function onSubmitPassword(data: SignupPasswordForm) {
    clearError()
    try {
      await registerWithUid(uid, data.password)
      navigate('/dashboard')
    } catch {
      // the reason is already in the store's `error` and shown above the form
    }
  }

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen flex items-center justify-center bg-surface dark:bg-ink-950 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-line dark:border-ink-700 bg-white dark:bg-ink-900 p-8">{children}</div>
    </div>
  )

  if (phase === 'otp') {
    return shell(
      <>
        <MailCheck size={28} className="text-tech-500" />
        <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100 mt-3">Check your email</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          We sent a 6-digit code to <strong className="text-slate-700 dark:text-slate-200">{maskedEmail || 'the email on your record'}</strong>. Enter it to confirm it's you.
        </p>
        <input
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="000000"
          inputMode="numeric"
          autoFocus
          className="mt-4 w-full text-center tracking-[0.5em] font-mono text-lg rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2.5"
        />
        {otpError && <p role="alert" className="text-xs text-rose-500 mt-1.5">{otpError}</p>}
        <button onClick={verify} disabled={verifying || otp.length !== 6} className={`${primary} mt-4`}>
          {verifying && <Loader2 size={15} className="animate-spin" />}
          Verify
        </button>
        <button onClick={() => { setPhase('uid'); setOtp('') }} className="w-full mt-2 text-xs text-slate-400 hover:underline">Back</button>
      </>,
    )
  }

  if (phase === 'password') {
    return shell(
      <>
        <CheckCircle2 size={28} className="text-eco-600" />
        <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100 mt-3">Welcome{name ? `, ${name}` : ''}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">You're confirmed. Choose a password to finish creating your account.</p>
        <form onSubmit={handleSubmit(onSubmitPassword)} className="mt-6 space-y-4">
          {error && <div role="alert" className="text-sm rounded-lg bg-rose-50 dark:bg-rose-500/10 text-rose-600 px-3 py-2">{error}</div>}
          <div>
            <label className="text-xs font-medium text-slate-500">Password</label>
            <input {...register('password')} type="password" autoComplete="new-password" className={input} />
            {errors.password && <p className="text-xs text-rose-500 mt-1">{errors.password.message}</p>}
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500">Confirm password</label>
            <input {...register('confirmPassword')} type="password" autoComplete="new-password" className={input} />
            {errors.confirmPassword && <p className="text-xs text-rose-500 mt-1">{errors.confirmPassword.message}</p>}
          </div>
          <button type="submit" disabled={isLoading} className={primary}>
            {isLoading && <Loader2 size={15} className="animate-spin" />}
            Create account
          </button>
        </form>
      </>,
    )
  }

  return shell(
    <>
      <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100">Create a student account</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
        Enter your UID. If you've taken mess, everything else is filled in from your record — there's nothing else to type but a password.
      </p>

      <div className="mt-6 space-y-4">
        <div>
          <label htmlFor="uid" className="text-xs font-medium text-slate-500">Student UID <span className="text-rose-500">*</span></label>
          <div className="relative mt-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              id="uid"
              value={uid}
              onChange={(e) => setUid(e.target.value)}
              placeholder="e.g. 21000001"
              inputMode="numeric"
              autoFocus
              className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 text-sm"
            />
          </div>

          {checking && <p className="text-xs text-slate-400 mt-1.5 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Checking your mess enrollment…</p>}

          {!checking && lookup === null && (
            <div role="alert" className="mt-2 rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-3 py-2.5">
              <p className="text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2 font-medium">
                <Utensils size={15} className="mt-0.5 shrink-0" /> {studentService.NOT_ON_MESS_MESSAGE}
              </p>
            </div>
          )}

          {!checking && lookup && lookup.alreadyRegistered && (
            <p className="text-xs text-rose-500 mt-1.5 flex items-center gap-1.5">
              <XCircle size={13} /> This UID already has an account. <Link to="/login" className="underline">Sign in instead</Link>.
            </p>
          )}

          {!checking && onMess && lookup && (
            <div className="mt-2 rounded-lg border border-eco-200 dark:border-eco-500/30 bg-eco-50 dark:bg-eco-500/10 px-3 py-2">
              <p className="text-xs text-eco-700 dark:text-eco-400 flex items-center gap-1.5 font-medium"><CheckCircle2 size={13} /> You're on the mess</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                <span className="font-mono">{lookup.maskedName}</span> · <strong className="text-slate-700 dark:text-slate-200">{lookup.hostelName}</strong> · <strong className="text-slate-700 dark:text-slate-200">{lookup.messName}</strong>
              </p>
              <p className="text-[11px] text-slate-400 mt-1">We'll email a 6-digit code to <strong>{lookup.maskedEmail}</strong> to confirm it's you.</p>
            </div>
          )}
        </div>

        {sendError && <p role="alert" className="text-xs text-rose-600 bg-rose-50 dark:bg-rose-500/10 rounded-lg px-3 py-2">{sendError}</p>}

        <button onClick={sendCode} disabled={sending || checking || !onMess} className={primary}>
          {sending && <Loader2 size={15} className="animate-spin" />}
          Send verification code
        </button>
      </div>

      <p className="text-xs text-slate-400 mt-6 text-center">
        Already have an account? <Link to="/login" className="text-tech-600 dark:text-tech-500 font-medium hover:underline">Sign in</Link>
      </p>
    </>,
  )
}
