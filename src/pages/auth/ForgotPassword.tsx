import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2, MailCheck } from 'lucide-react'
import { forgotPasswordSchema } from '@/utils/validators'
import { requestPasswordReset } from '@/services/authService'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'

export default function ForgotPassword() {
  useDocumentTitle('Forgot Password')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [identifier, setIdentifier] = useState('')
  const navigate = useNavigate()
  const { register, handleSubmit, formState: { errors } } = useForm<{ identifier: string }>({ resolver: zodResolver(forgotPasswordSchema) })

  async function onSubmit(data: { identifier: string }) {
    setLoading(true)
    await requestPasswordReset(data.identifier)
    setIdentifier(data.identifier)
    setLoading(false)
    setSent(true)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface dark:bg-ink-950 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line dark:border-ink-700 bg-white dark:bg-ink-900 p-8 text-center">
        {sent ? (
          <>
            <MailCheck size={28} className="text-eco-500 mx-auto" />
            <h1 className="font-display text-lg font-bold mt-3 text-slate-800 dark:text-slate-100">Check your inbox</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              If an account exists for that UID or email, a real 6-digit code was just sent to it — it expires in 15 minutes.
            </p>
            <button onClick={() => navigate('/reset-password', { state: { identifier } })} className="mt-5 w-full rounded-lg bg-tech-500 text-white text-sm font-semibold py-2.5">
              I have my code
            </button>
          </>
        ) : (
          <>
            <h1 className="font-display text-lg font-bold text-slate-800 dark:text-slate-100 text-left">Forgot password</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 text-left">Enter your UID or email and we'll send a real reset code.</p>
            <form onSubmit={handleSubmit(onSubmit)} className="mt-5 space-y-3 text-left">
              <input {...register('identifier')} placeholder="UID or email" className="w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2.5 text-sm" />
              {errors.identifier && <p className="text-xs text-rose-500">{errors.identifier.message}</p>}
              <button type="submit" disabled={loading} className="w-full flex items-center justify-center gap-2 rounded-lg bg-tech-500 text-white text-sm font-semibold py-2.5 disabled:opacity-60">
                {loading && <Loader2 size={15} className="animate-spin" />} Send reset code
              </button>
            </form>
          </>
        )}
        <p className="text-xs text-slate-400 mt-5">
          <Link to="/login" className="text-tech-600 dark:text-tech-500 hover:underline">Back to sign in</Link>
        </p>
      </div>
    </div>
  )
}
