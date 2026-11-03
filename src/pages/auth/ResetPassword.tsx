import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { resetPasswordSchema } from '@/utils/validators'
import { resetPassword } from '@/services/authService'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'

interface ResetForm {
  code: string
  password: string
  confirmPassword: string
}

export default function ResetPassword() {
  useDocumentTitle('Reset Password')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const location = useLocation()
  const identifierFromNav = (location.state as { identifier?: string } | null)?.identifier ?? ''
  const [identifier, setIdentifier] = useState(identifierFromNav)
  const { register, handleSubmit, formState: { errors } } = useForm<ResetForm>({ resolver: zodResolver(resetPasswordSchema) })

  async function onSubmit(data: ResetForm) {
    setError('')
    if (!identifier.trim()) {
      setError('Enter your UID or email.')
      return
    }
    setLoading(true)
    try {
      await resetPassword(identifier, data.code, data.password)
      setDone(true)
      setTimeout(() => navigate('/login'), 1200)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reset the password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface dark:bg-ink-950 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line dark:border-ink-700 bg-white dark:bg-ink-900 p-8">
        <h1 className="font-display text-lg font-bold text-slate-800 dark:text-slate-100">Set a new password</h1>
        {done ? (
          <p className="text-sm text-eco-600 mt-4">Password updated — every existing session was signed out. Redirecting to sign in…</p>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="mt-5 space-y-3">
            {error && <p className="text-xs text-rose-500 rounded-lg bg-rose-50 dark:bg-rose-500/10 px-3 py-2">{error}</p>}
            <div>
              <label className="text-xs font-medium text-slate-500">UID or email</label>
              <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} className="mt-1 w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2.5 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">6-digit code</label>
              <input {...register('code')} inputMode="numeric" maxLength={6} className="mt-1 w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2.5 text-sm tracking-[0.3em] text-center font-mono" />
              {errors.code && <p className="text-xs text-rose-500 mt-1">{errors.code.message}</p>}
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">New password</label>
              <input {...register('password')} type="password" className="mt-1 w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2.5 text-sm" />
              {errors.password && <p className="text-xs text-rose-500 mt-1">{errors.password.message}</p>}
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">Confirm password</label>
              <input {...register('confirmPassword')} type="password" className="mt-1 w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2.5 text-sm" />
              {errors.confirmPassword && <p className="text-xs text-rose-500 mt-1">{errors.confirmPassword.message}</p>}
            </div>
            <button type="submit" disabled={loading} className="w-full flex items-center justify-center gap-2 rounded-lg bg-tech-500 text-white text-sm font-semibold py-2.5 disabled:opacity-60">
              {loading && <Loader2 size={15} className="animate-spin" />} Update password
            </button>
          </form>
        )}
        <p className="text-xs text-slate-400 mt-5 text-center">
          <Link to="/forgot-password" className="text-tech-600 dark:text-tech-500 hover:underline">Didn't get a code? Request a new one</Link>
        </p>
      </div>
    </div>
  )
}
