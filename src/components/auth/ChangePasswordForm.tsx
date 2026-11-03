import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2, Eye, EyeOff } from 'lucide-react'
import { changePasswordSchema, type ChangePasswordForm as FormValues } from '@/utils/validators'
import { useAuth } from '@/hooks/useAuth'

const INPUT =
  'w-full rounded-xl border border-line dark:border-ink-700 bg-white dark:bg-ink-800 text-sm text-slate-800 dark:text-slate-100 ' +
  'placeholder:text-slate-400 py-2.5 pl-3.5 pr-11 transition focus:outline-none focus:border-tech-500 focus:ring-4 focus:ring-tech-500/15'

/**
 * The real "choose a new password" form — used on the Profile page and on the forced first-sign-in screen.
 * The server checks the current password (wrong guesses count toward the account lockout), refuses weak or reused
 * passwords, and signs every other device out; whatever it says is shown here verbatim.
 */
export function ChangePasswordForm({ onDone, submitLabel = 'Update password' }: { onDone?: () => void; submitLabel?: string }) {
  const { changePassword } = useAuth()
  const [show, setShow] = useState(false)
  const [serverError, setServerError] = useState('')
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  })

  async function onSubmit(v: FormValues) {
    setServerError('')
    try {
      await changePassword(v.currentPassword, v.newPassword)
      onDone?.()
    } catch (e) {
      setServerError(e instanceof Error ? e.message : 'Could not change the password.')
    }
  }

  const field = (id: 'currentPassword' | 'newPassword' | 'confirmPassword', label: string, autoComplete: string, withToggle = false) => (
    <div>
      <label htmlFor={`cp-${id}`} className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">{label}</label>
      <div className="relative">
        <input id={`cp-${id}`} {...register(id)} type={show ? 'text' : 'password'} autoComplete={autoComplete} aria-invalid={!!errors[id]} className={INPUT} />
        {withToggle && (
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? 'Hide passwords' : 'Show passwords'}
            aria-pressed={show}
            className="absolute right-2 top-1/2 -translate-y-1/2 grid place-items-center h-8 w-8 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
      {errors[id] && <p className="text-xs text-rose-500 mt-1.5">{errors[id]?.message}</p>}
    </div>
  )

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {serverError && <div role="alert" className="text-sm rounded-xl bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 px-3.5 py-2.5">{serverError}</div>}
      {field('currentPassword', 'Current password', 'current-password', true)}
      {field('newPassword', 'New password', 'new-password')}
      <p className="text-[11px] text-slate-400 -mt-2">At least 8 characters, and nothing everyone guesses first (like "password1").</p>
      {field('confirmPassword', 'Confirm new password', 'new-password')}
      <button type="submit" disabled={isSubmitting} className="w-full flex items-center justify-center gap-2 rounded-xl bg-tech-500 hover:bg-tech-600 text-white text-sm font-semibold py-2.5 disabled:opacity-60">
        {isSubmitting && <Loader2 size={15} className="animate-spin" aria-hidden />}
        {submitLabel}
      </button>
    </form>
  )
}
