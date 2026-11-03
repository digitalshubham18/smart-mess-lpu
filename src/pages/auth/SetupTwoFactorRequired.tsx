import { Navigate, useNavigate } from 'react-router-dom'
import { ChefHat, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { ROLE_HOME } from '@/data/mockUsers'
import { TwoFactorSettings } from '@/components/auth/TwoFactorSettings'

/**
 * Admin and Super Admin accounts must use two-factor sign-in (they can do the most damage if one is stolen). Until it is on,
 * the API refuses every other request, so — like "choose a new password" — this page is the only door, not a nag.
 */
export default function SetupTwoFactorRequired() {
  useDocumentTitle('Set up two-factor sign-in')
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  if (!user) return <Navigate to="/login" replace />
  // Nothing to do (not required, or already on and the recovery codes have been dealt with): go on to the app.
  const done = !user.twoFactorSetupRequired && !user.twoFactorRequired
  if (done) return <Navigate to={ROLE_HOME[user.role] ?? '/dashboard'} replace />

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface dark:bg-ink-950 px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-line dark:border-ink-700 bg-white dark:bg-ink-900 p-7 sm:p-9 shadow-xl shadow-slate-900/5">
        <div className="flex items-center gap-2 mb-6">
          <span className="grid place-items-center h-8 w-8 rounded-lg bg-tech-500 text-white"><ChefHat size={16} /></span>
          <span className="font-display font-bold text-slate-800 dark:text-slate-100">LPU Smart Mess</span>
        </div>
        <div className="flex items-start gap-3">
          <span className="grid place-items-center h-10 w-10 shrink-0 rounded-xl bg-amber-50 dark:bg-amber-500/10 text-amber-600"><ShieldCheck size={18} /></span>
          <div>
            <h1 className="font-display text-xl font-bold text-slate-900 dark:text-slate-50">Set up two-factor sign-in</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Hi {user.name.split(' ')[0]} — accounts like yours can change anyone's access, so a password alone isn't enough.
              It takes about a minute with an authenticator app on your phone.
            </p>
          </div>
        </div>

        {/* TwoFactorSettings is the same flow as on the Profile page: scan, confirm a code, save the recovery codes. */}
        <TwoFactorSettings />

        {user.twoFactorEnabled && !user.twoFactorSetupRequired && (
          <button onClick={() => navigate(ROLE_HOME[user.role] ?? '/dashboard', { replace: true })} className="mt-5 w-full rounded-xl bg-tech-500 hover:bg-tech-600 text-white text-sm font-semibold py-2.5">
            Continue to the app
          </button>
        )}
        <button onClick={() => void logout().then(() => navigate('/login'))} className="mt-4 w-full text-center text-xs text-slate-500 hover:underline">
          Not now — sign out
        </button>
      </div>
    </div>
  )
}
