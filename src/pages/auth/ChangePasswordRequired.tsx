import { Navigate, useNavigate } from 'react-router-dom'
import { ChefHat, KeyRound } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { ROLE_HOME } from '@/data/mockUsers'
import { ChangePasswordForm } from '@/components/auth/ChangePasswordForm'

/**
 * Shown to anyone whose account is on a TEMPORARY password (new staff, parent access, or an Admin's reset). Until they
 * choose their own, the API refuses every other request — so this page is not a nag, it's the only door.
 */
export default function ChangePasswordRequired() {
  useDocumentTitle('Choose a new password')
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  if (!user) return <Navigate to="/login" replace />
  if (!user.mustChangePassword) return <Navigate to={ROLE_HOME[user.role] ?? '/dashboard'} replace />

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface dark:bg-ink-950 px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-line dark:border-ink-700 bg-white dark:bg-ink-900 p-7 sm:p-9 shadow-xl shadow-slate-900/5">
        <div className="flex items-center gap-2 mb-6">
          <span className="grid place-items-center h-8 w-8 rounded-lg bg-tech-500 text-white"><ChefHat size={16} /></span>
          <span className="font-display font-bold text-slate-800 dark:text-slate-100">LPU Smart Mess</span>
        </div>
        <div className="flex items-start gap-3 mb-5">
          <span className="grid place-items-center h-10 w-10 shrink-0 rounded-xl bg-amber-50 dark:bg-amber-500/10 text-amber-600"><KeyRound size={18} /></span>
          <div>
            <h1 className="font-display text-xl font-bold text-slate-900 dark:text-slate-50">Choose your own password</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Hi {user.name.split(' ')[0]} — you signed in with a temporary password. Pick a new one to continue; your
              temporary password stops working as soon as you do.
            </p>
          </div>
        </div>

        <ChangePasswordForm submitLabel="Save and continue" onDone={() => navigate(ROLE_HOME[user.role] ?? '/dashboard', { replace: true })} />

        <button onClick={() => void logout().then(() => navigate('/login'))} className="mt-5 w-full text-center text-xs text-slate-500 hover:underline">
          Not now — sign out
        </button>
      </div>
    </div>
  )
}
