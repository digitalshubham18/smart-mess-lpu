// import { useState } from 'react'
// import { TwoFactorRequiredError } from '@/services/authService'
// import { useForm } from 'react-hook-form'
// import { zodResolver } from '@hookform/resolvers/zod'
// import { Link, useNavigate } from 'react-router-dom'
// import { ChefHat, Loader2, Eye, EyeOff, IdCard, Lock, ArrowRight, TrendingUp, Leaf, QrCode, ShieldCheck } from 'lucide-react'
// import { loginSchema, type LoginForm } from '@/utils/validators'
// import { useAuth } from '@/hooks/useAuth'
// import { useDocumentTitle } from '@/hooks/useDocumentTitle'
// import { ROLE_HOME } from '@/data/mockUsers'
// import { useT } from '@/i18n/useLanguage'
// import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher'

// const FEATURES = [
//   { icon: TrendingUp, title: 'Demand forecasting', text: 'Know how many plates to cook before the day starts.' },
//   { icon: Leaf, title: 'Less food waste', text: 'Track what is cooked, eaten and thrown away — per mess.' },
//   { icon: QrCode, title: 'QR check-ins', text: 'Fast at the counter, fair to every student.' },
//   { icon: ShieldCheck, title: 'Role-based access', text: 'Everyone sees only their own hostel and responsibilities.' },
// ]

// const INPUT =
//   'w-full rounded-xl border border-line dark:border-ink-700 bg-white dark:bg-ink-800 text-sm text-slate-800 dark:text-slate-100 ' +
//   'placeholder:text-slate-400 py-3 transition focus:outline-none focus:border-tech-500 focus:ring-4 focus:ring-tech-500/15'

// export default function Login() {
//   const t = useT()
//   useDocumentTitle('Sign In')
//   // const { login, loginWithTwoFactor, isLoading, error, clearError, sessionExpiredMessage, clearSessionExpiredMessage } = useAuth()
//   const { login, isLoading, error, clearError, sessionExpiredMessage, clearSessionExpiredMessage } = useAuth()
//   const navigate = useNavigate()
//   const [showPw, setShowPw] = useState(false)
//   // Set once the password was right but the account needs an authenticator code too.
//   const [challenge, setChallenge] = useState<string | null>(null)
//   const [code, setCode] = useState('')
//   const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>({
//     resolver: zodResolver(loginSchema),
//     defaultValues: { identifier: '', password: '', remember: true },
//   })

//   async function onSubmit(data: LoginForm) {
//     clearError()
//     try {
//       const user = await login(data.identifier, data.password)
//       navigate(user.mustChangePassword ? '/change-password' : (ROLE_HOME[user.role] ?? '/dashboard'))
//     } catch (e) {
//       if (e instanceof TwoFactorRequiredError) { setChallenge(e.challenge); setCode('') }
//       // otherwise the error is already set in the store
//     }
//   }

//   async function onSubmitCode(ev: React.FormEvent) {
//     ev.preventDefault()
//     if (!challenge) return
//     clearError()
//     try {
//       const user = await loginWithTwoFactor(challenge, code)
//       navigate(user.mustChangePassword ? '/change-password' : (ROLE_HOME[user.role] ?? '/dashboard'))
//     } catch (e) {

//       // An expired challenge means the password step has to be repeated.
//       if ((e as { expired?: boolean }).expired) setChallenge(null)
//     }
//   }

//   return (
//     <div className="min-h-screen relative overflow-hidden flex items-center justify-center bg-surface dark:bg-ink-950 px-4 py-8 sm:py-12">
//       {/* soft background glow */}
//       <div aria-hidden className="pointer-events-none absolute -top-40 -left-40 h-[28rem] w-[28rem] rounded-full bg-tech-500/15 blur-3xl" />
//       <div aria-hidden className="pointer-events-none absolute -bottom-48 -right-40 h-[30rem] w-[30rem] rounded-full bg-eco-500/10 blur-3xl" />

//       <div className="relative w-full max-w-5xl grid md:grid-cols-[1.05fr_1fr] rounded-3xl overflow-hidden border border-line dark:border-ink-700 bg-white dark:bg-ink-900 shadow-xl shadow-slate-900/5">
//         {/* ---------- brand panel ---------- */}
//         <aside className="hidden md:flex flex-col justify-between p-10 text-white relative overflow-hidden bg-linear-to-br from-ink-950 via-ink-900 to-tech-700">
//           <div aria-hidden className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/5" />
//           <div aria-hidden className="absolute -left-16 bottom-10 h-56 w-56 rounded-full bg-eco-500/10 blur-2xl" />

//           <div className="relative flex items-center gap-2.5">
//             <span className="grid place-items-center h-9 w-9 rounded-xl bg-white/10 ring-1 ring-white/15">
//               <ChefHat size={18} />
//             </span>
//             <span className="font-display font-bold tracking-tight">LPU Smart Mess</span>
//           </div>

//           <div className="relative">
//             <h2 className="font-display text-[1.7rem] font-bold leading-tight">
//               Smarter meals.<br />Less waste. Every hostel.
//             </h2>
//             <p className="text-sm text-slate-300/90 mt-3 max-w-sm">
//               Demand forecasting and food-waste management for every hostel mess at Lovely Professional University.
//             </p>

//             <ul className="mt-8 space-y-4">
//               {FEATURES.map(({ icon: Icon, title, text }) => (
//                 <li key={title} className="flex items-start gap-3">
//                   <span className="mt-0.5 grid place-items-center h-8 w-8 shrink-0 rounded-lg bg-white/10 ring-1 ring-white/10">
//                     <Icon size={15} />
//                   </span>
//                   <span>
//                     <span className="block text-sm font-semibold">{title}</span>
//                     <span className="block text-xs text-slate-300/80">{text}</span>
//                   </span>
//                 </li>
//               ))}
//             </ul>
//           </div>

//           <p className="relative text-[11px] text-slate-400">₹ INR · kg · litres · pieces — built for Indian campus operations.</p>
//         </aside>

//         {/* ---------- form panel ---------- */}
//         <main className="p-7 sm:p-10 flex flex-col justify-center">
//           <div className="md:hidden flex items-center gap-2 mb-6">
//             <span className="grid place-items-center h-8 w-8 rounded-lg bg-tech-500 text-white"><ChefHat size={16} /></span>
//             <span className="font-display font-bold text-slate-800 dark:text-slate-100">LPU Smart Mess</span>
//           </div>

//           {challenge ? (
//             <form onSubmit={onSubmitCode} className="space-y-5" noValidate>
//               <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-50">Two-factor check</h1>
//               <p className="text-sm text-slate-500 dark:text-slate-400">Enter the 6-digit code from your authenticator app. Lost your phone? Use one of your recovery codes instead.</p>
//               {error && <div role="alert" className="text-sm rounded-xl bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 px-3.5 py-2.5">{error}</div>}
//               <input
//                 aria-label="Authentication code"
//                 value={code}
//                 onChange={(e) => setCode(e.target.value)}
//                 autoFocus
//                 autoComplete="one-time-code"
//                 inputMode="text"
//                 placeholder="000000"
//                 className={`${INPUT} px-3.5 text-center font-mono tracking-[0.3em] text-lg`}
//               />
//               <button type="submit" disabled={isLoading || code.trim().length < 6} className="w-full flex items-center justify-center gap-2 rounded-xl bg-tech-500 hover:bg-tech-600 text-white text-sm font-semibold py-3 disabled:opacity-60">
//                 {isLoading && <Loader2 size={16} className="animate-spin" aria-hidden />}
//                 Verify and sign in
//               </button>
//               <button type="button" onClick={() => { setChallenge(null); setCode(''); clearError() }} className="w-full text-xs text-slate-400 hover:underline">Back to password</button>
//             </form>
//           ) : (<>
//           <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-50">{t('login.welcome')}</h1>
//           <div className="mt-1"><LanguageSwitcher /></div>
//           <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5">
//             Sign in with your UID — your registration number if you're a student, your staff UID otherwise.
//           </p>

//           <form onSubmit={handleSubmit(onSubmit)} className="mt-7 space-y-5" noValidate>
//             {sessionExpiredMessage && (
//               <div className="text-sm rounded-xl bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 px-3.5 py-2.5 flex items-center justify-between gap-2">
//                 <span>{sessionExpiredMessage}</span>
//                 <button type="button" onClick={clearSessionExpiredMessage} className="shrink-0 text-xs font-medium underline">Dismiss</button>
//               </div>
//             )}
//             {error && (
//               <div role="alert" className="text-sm rounded-xl bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 px-3.5 py-2.5">{error}</div>
//             )}

//             <div>
//               <label htmlFor="login-uid" className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">{t('login.uid')}</label>
//               <div className="relative">
//                 <IdCard size={16} aria-hidden className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
//                 <input
//                   id="login-uid"
//                   {...register('identifier')}
//                   type="text"
//                   inputMode="text"
//                   autoComplete="username"
//                   autoCapitalize="none"
//                   spellCheck={false}
//                   placeholder="e.g. 21000001"
//                   aria-invalid={!!errors.identifier}
//                   className={`${INPUT} pl-10 pr-3.5`}
//                 />
//               </div>
//               {errors.identifier && <p className="text-xs text-rose-500 mt-1.5">{errors.identifier.message}</p>}
//               <p className="text-[11px] text-slate-400 mt-1.5">{t('login.noUid')}</p>
//             </div>

//             <div>
//               <div className="flex items-center justify-between mb-1.5">
//                 <label htmlFor="login-password" className="text-xs font-semibold text-slate-600 dark:text-slate-300">{t('login.password')}</label>
//                 <Link to="/forgot-password" className="text-xs font-medium text-tech-600 dark:text-indigo-300 hover:underline">{t('login.forgot')}</Link>
//               </div>
//               <div className="relative">
//                 <Lock size={16} aria-hidden className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
//                 <input
//                   id="login-password"
//                   {...register('password')}
//                   type={showPw ? 'text' : 'password'}
//                   autoComplete="current-password"
//                   placeholder="••••••••"
//                   aria-invalid={!!errors.password}
//                   className={`${INPUT} pl-10 pr-11`}
//                 />
//                 <button
//                   type="button"
//                   onClick={() => setShowPw((v) => !v)}
//                   aria-label={showPw ? 'Hide password' : 'Show password'}
//                   aria-pressed={showPw}
//                   className="absolute right-2 top-1/2 -translate-y-1/2 grid place-items-center h-8 w-8 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-surface-dim dark:hover:bg-ink-700 transition"
//                 >
//                   {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
//                 </button>
//               </div>
//               {errors.password && <p className="text-xs text-rose-500 mt-1.5">{errors.password.message}</p>}
//             </div>

//             <label className="flex items-center gap-2.5 text-xs text-slate-500 dark:text-slate-400 select-none cursor-pointer">
//               <input type="checkbox" {...register('remember')} defaultChecked className="h-4 w-4 rounded border-line accent-tech-500" />
//               Keep me signed in on this device
//             </label>

//             <button
//               type="submit"
//               disabled={isLoading}
//               className="group w-full flex items-center justify-center gap-2 rounded-xl bg-tech-500 hover:bg-tech-600 active:bg-tech-700 text-white text-sm font-semibold py-3 shadow-sm shadow-tech-500/30 transition disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-4 focus-visible:ring-tech-500/30"
//             >
//               {isLoading ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
//               <span>{t('login.signin')}</span>
//               {!isLoading && <ArrowRight size={16} aria-hidden className="transition-transform group-hover:translate-x-0.5" />}
//             </button>
//           </form>

//           <div className="mt-7 flex items-center gap-3 text-[11px] uppercase tracking-wider text-slate-400">
//             <span className="h-px flex-1 bg-line dark:bg-ink-700" /> New student? <span className="h-px flex-1 bg-line dark:bg-ink-700" />
//           </div>
//           <Link
//             to="/register"
//             className="mt-4 w-full text-center rounded-xl border border-line dark:border-ink-700 text-sm font-semibold text-slate-700 dark:text-slate-200 py-3 hover:bg-surface-dim dark:hover:bg-ink-800 transition"
//           >
//             Create a student account
//           </Link>
//           <p className="text-[11px] text-slate-400 mt-5 text-center">
//             Staff and parent accounts are created for you by your hostel's Admin — ask them if you can't sign in.
//           </p>
//           </>)}
//         </main>
//       </div>
//     </div>
//   )
// }


import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate } from 'react-router-dom'
import {
  ChefHat, Loader2, Eye, EyeOff, IdCard, Lock,
  ArrowRight, TrendingUp, Leaf, QrCode, ShieldCheck
} from 'lucide-react'
import { loginSchema, type LoginForm } from '@/utils/validators'
import { useAuth } from '@/hooks/useAuth'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { ROLE_HOME } from '@/data/mockUsers'
import { useT } from '@/i18n/useLanguage'
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher'

const FEATURES = [
  { icon: TrendingUp, title: 'Demand forecasting', text: 'Know how many plates to cook before the day starts.' },
  { icon: Leaf, title: 'Less food waste', text: 'Track what is cooked, eaten and thrown away — per mess.' },
  { icon: QrCode, title: 'QR check-ins', text: 'Fast at the counter, fair to every student.' },
  { icon: ShieldCheck, title: 'Role-based access', text: 'Everyone sees only their own hostel and responsibilities.' },
]

const INPUT =
  'w-full rounded-xl border border-line dark:border-ink-700 bg-white dark:bg-ink-800 text-sm text-slate-800 dark:text-slate-100 ' +
  'placeholder:text-slate-400 py-3 transition focus:outline-none focus:border-tech-500 focus:ring-4 focus:ring-tech-500/15'

export default function Login() {
  const t = useT()
  useDocumentTitle('Sign In')

  const { login, isLoading, error, clearError, sessionExpiredMessage, clearSessionExpiredMessage } = useAuth()
  const navigate = useNavigate()
  const [showPw, setShowPw] = useState(false)

  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: '', password: '', remember: true },
  })

  async function onSubmit(data: LoginForm) {
    clearError()
    try {
      const user = await login(data.identifier, data.password)
      navigate(user.mustChangePassword ? '/change-password' : (ROLE_HOME[user.role] ?? '/dashboard'))
    } catch {
      // Login errors are already stored in the authentication store.
    }
  }

  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center bg-surface dark:bg-ink-950 px-4 py-8 sm:py-12">
      <div aria-hidden className="pointer-events-none absolute -top-40 -left-40 h-[28rem] w-[28rem] rounded-full bg-tech-500/15 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-48 -right-40 h-[30rem] w-[30rem] rounded-full bg-eco-500/10 blur-3xl" />

      <div className="relative w-full max-w-5xl grid md:grid-cols-[1.05fr_1fr] rounded-3xl overflow-hidden border border-line dark:border-ink-700 bg-white dark:bg-ink-900 shadow-xl shadow-slate-900/5">
        <aside className="hidden md:flex flex-col justify-between p-10 text-white relative overflow-hidden bg-linear-to-br from-ink-950 via-ink-900 to-tech-700">
          <div aria-hidden className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/5" />
          <div aria-hidden className="absolute -left-16 bottom-10 h-56 w-56 rounded-full bg-eco-500/10 blur-2xl" />

          <div className="relative flex items-center gap-2.5">
            <span className="grid place-items-center h-9 w-9 rounded-xl bg-white/10 ring-1 ring-white/15">
              <ChefHat size={18} />
            </span>
            <span className="font-display font-bold tracking-tight">LPU Smart Mess</span>
          </div>

          <div className="relative">
            <h2 className="font-display text-[1.7rem] font-bold leading-tight">
              Smarter meals.<br />Less waste. Every hostel.
            </h2>
            <p className="text-sm text-slate-300/90 mt-3 max-w-sm">
              Demand forecasting and food-waste management for every hostel mess at Lovely Professional University.
            </p>

            <ul className="mt-8 space-y-4">
              {FEATURES.map(({ icon: Icon, title, text }) => (
                <li key={title} className="flex items-start gap-3">
                  <span className="mt-0.5 grid place-items-center h-8 w-8 shrink-0 rounded-lg bg-white/10 ring-1 ring-white/10">
                    <Icon size={15} />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold">{title}</span>
                    <span className="block text-xs text-slate-300/80">{text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <p className="relative text-[11px] text-slate-400">₹ INR · kg · litres · pieces — built for Indian campus operations.</p>
        </aside>

        <main className="p-7 sm:p-10 flex flex-col justify-center">
          <div className="md:hidden flex items-center gap-2 mb-6">
            <span className="grid place-items-center h-8 w-8 rounded-lg bg-tech-500 text-white">
              <ChefHat size={16} />
            </span>
            <span className="font-display font-bold text-slate-800 dark:text-slate-100">LPU Smart Mess</span>
          </div>

          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-50">
            {t('login.welcome')}
          </h1>

          <div className="mt-1"><LanguageSwitcher /></div>

          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5">
            Sign in with your UID — your registration number if you're a student, your staff UID otherwise.
          </p>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-7 space-y-5" noValidate>
            {sessionExpiredMessage && (
              <div className="text-sm rounded-xl bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 px-3.5 py-2.5 flex items-center justify-between gap-2">
                <span>{sessionExpiredMessage}</span>
                <button type="button" onClick={clearSessionExpiredMessage} className="shrink-0 text-xs font-medium underline">
                  Dismiss
                </button>
              </div>
            )}

            {error && (
              <div role="alert" className="text-sm rounded-xl bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 px-3.5 py-2.5">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="login-uid" className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                {t('login.uid')}
              </label>
              <div className="relative">
                <IdCard size={16} aria-hidden className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  id="login-uid"
                  {...register('identifier')}
                  type="text"
                  inputMode="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="e.g. 21000001"
                  aria-invalid={!!errors.identifier}
                  className={`${INPUT} pl-10 pr-3.5`}
                />
              </div>
              {errors.identifier && <p className="text-xs text-rose-500 mt-1.5">{errors.identifier.message}</p>}
              <p className="text-[11px] text-slate-400 mt-1.5">{t('login.noUid')}</p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="login-password" className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {t('login.password')}
                </label>
                <Link to="/forgot-password" className="text-xs font-medium text-tech-600 dark:text-indigo-300 hover:underline">
                  {t('login.forgot')}
                </Link>
              </div>

              <div className="relative">
                <Lock size={16} aria-hidden className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  id="login-password"
                  {...register('password')}
                  type={showPw ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  aria-invalid={!!errors.password}
                  className={`${INPUT} pl-10 pr-11`}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                  aria-pressed={showPw}
                  className="absolute right-2 top-1/2 -translate-y-1/2 grid place-items-center h-8 w-8 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-surface-dim dark:hover:bg-ink-700 transition"
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {errors.password && <p className="text-xs text-rose-500 mt-1.5">{errors.password.message}</p>}
            </div>

            <label className="flex items-center gap-2.5 text-xs text-slate-500 dark:text-slate-400 select-none cursor-pointer">
              <input type="checkbox" {...register('remember')} defaultChecked className="h-4 w-4 rounded border-line accent-tech-500" />
              Keep me signed in on this device
            </label>

            <button
              type="submit"
              disabled={isLoading}
              className="group w-full flex items-center justify-center gap-2 rounded-xl bg-tech-500 hover:bg-tech-600 active:bg-tech-700 text-white text-sm font-semibold py-3 shadow-sm shadow-tech-500/30 transition disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-4 focus-visible:ring-tech-500/30"
            >
              {isLoading ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
              <span>{t('login.signin')}</span>
              {!isLoading && <ArrowRight size={16} aria-hidden className="transition-transform group-hover:translate-x-0.5" />}
            </button>
          </form>

          <div className="mt-7 flex items-center gap-3 text-[11px] uppercase tracking-wider text-slate-400">
            <span className="h-px flex-1 bg-line dark:bg-ink-700" /> New student? <span className="h-px flex-1 bg-line dark:bg-ink-700" />
          </div>

          <Link
            to="/register"
            className="mt-4 w-full text-center rounded-xl border border-line dark:border-ink-700 text-sm font-semibold text-slate-700 dark:text-slate-200 py-3 hover:bg-surface-dim dark:hover:bg-ink-800 transition"
          >
            Create a student account
          </Link>

          <p className="text-[11px] text-slate-400 mt-5 text-center">
            Staff and parent accounts are created for you by your hostel's Admin — ask them if you can't sign in.
          </p>
        </main>
      </div>
    </div>
  )
}
