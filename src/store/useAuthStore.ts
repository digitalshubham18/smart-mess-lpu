import { create } from 'zustand'
import type { User } from '@/types'
import * as authService from '@/services/authService'
import * as pushService from '@/services/pushService'
// import { AUTH_EXPIRED_EVENT, PASSWORD_CHANGE_REQUIRED_EVENT, TWO_FACTOR_SETUP_REQUIRED_EVENT } from '@/services/api'
import { AUTH_EXPIRED_EVENT, PASSWORD_CHANGE_REQUIRED_EVENT } from '@/services/api'
import { useMessStore } from './useMessStore'

interface AuthState {
  user: User | null
  isLoading: boolean
  error: string | null
  /** Set when the backend rejects the stored token — shown once on the Login page, then cleared. */
  sessionExpiredMessage: string | null
  login: (email: string, password: string) => Promise<User>
  register: (uid: string, name: string, email: string, password: string) => Promise<User>
  /** UID-only sign-up: name and email come from the roster record (the emailed code must already be verified). */
  registerWithUid: (uid: string, password: string) => Promise<User>
  /** Finishes a two-factor sign-in with an authenticator (or recovery) code. */
  // loginWithTwoFactor: (challenge: string, code: string) => Promise<User>
  /** Reflects turning two-factor on/off in the signed-in profile. */
  // setTwoFactorEnabled: (enabled: boolean) => void
  logout: () => Promise<void>
  /** Real password change; on success the cached profile (mustChangePassword now false) replaces the old one. */
  changePassword: (currentPassword: string, newPassword: string) => Promise<User>
  clearError: () => void
  clearSessionExpiredMessage: () => void
}

const stored = authService.getStoredSession()
// Lock the mess-scoping store to whichever session was already on disk, so a page
// refresh doesn't briefly show the wrong mess before the first render.
useMessStore.getState().syncToUser(stored?.user ?? null)

export const useAuthStore = create<AuthState>((set) => ({
  user: stored?.user ?? null,
  isLoading: false,
  error: null,
  sessionExpiredMessage: null,
  async login(email, password) {
  set({ isLoading: true, error: null })
  try {
    const { user } = await authService.login(email, password)
    set({ user, isLoading: false })
    useMessStore.getState().syncToUser(user)
    return user
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Login failed'
    set({ isLoading: false, error: message })
    throw e
  }
},
  // async loginWithTwoFactor(challenge, code) {
  //   set({ isLoading: true, error: null })
  //   try {
  //     const { user } = await authService.loginWithTwoFactor(challenge, code)
  //     set({ user, isLoading: false })
  //     useMessStore.getState().syncToUser(user)
  //     return user
  //   } catch (e) {
  //     set({ isLoading: false, error: e instanceof Error ? e.message : 'Could not verify the code.' })
  //     throw e
  //   }
  // },
  // setTwoFactorEnabled(enabled) {
  //   const u = useAuthStore.getState().user
  //   if (!u) return
  //   // Turning it on satisfies a "you must set this up" requirement; turning it off (only possible where it's optional) can't create one.
  //   const next = { ...u, twoFactorEnabled: enabled, twoFactorSetupRequired: !!u.twoFactorRequired && !enabled }
  //   authService.cacheUser(next)
  //   set({ user: next })
  // },
  async register(uid, name, email, password) {
    set({ isLoading: true, error: null })
    try {
      const { user } = await authService.register(uid, name, email, password)
      set({ user, isLoading: false })
      useMessStore.getState().syncToUser(user)
      return user
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Registration failed'
      set({ isLoading: false, error: message })
      throw e
    }
  },
  async registerWithUid(uid, password) {
    set({ isLoading: true, error: null })
    try {
      const { user } = await authService.registerWithUid(uid, password)
      set({ user, isLoading: false })
      useMessStore.getState().syncToUser(user)
      return user
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Registration failed'
      set({ isLoading: false, error: message })
      throw e
    }
  },
  async logout() {
    // Clear local state immediately for a snappy UI, then revoke server-side —
    // revocation doesn't need to block the person from seeing themselves logged out.
    set({ user: null })
    useMessStore.getState().syncToUser(null)
    // A shared phone must stop buzzing for the person who just signed out — done while the session is still valid.
    await pushService.detachOnLogout()
    await authService.logout()
  },
  async changePassword(currentPassword, newPassword) {
    const user = await authService.changePassword(currentPassword, newPassword)
    set({ user })
    return user
  },
  clearError() {
    set({ error: null })
  },
  clearSessionExpiredMessage() {
    set({ sessionExpiredMessage: null })
  },
}))

// A request anywhere in the app got a 401 with a previously-valid token — the JWT
// expired (7 days) or was otherwise rejected server-side. Log out cleanly and surface
// a real reason on the Login page, instead of leaving the person stuck on a page that
// will keep silently failing every request.
if (typeof window !== 'undefined') {
  window.addEventListener(AUTH_EXPIRED_EVENT, ((e: CustomEvent<string | undefined>) => {
    authService.logout()
    useAuthStore.setState({ user: null, sessionExpiredMessage: e.detail || 'Your session has expired — please sign in again.' })
    useMessStore.getState().syncToUser(null)
  }) as EventListener)
}

// The API said "choose a new password first" (this account was reset or created with a temporary password while we
// held a stale profile). Flip the flag; ProtectedRoute then routes to /change-password.
if (typeof window !== 'undefined') {
  window.addEventListener(PASSWORD_CHANGE_REQUIRED_EVENT, () => {
    const u = useAuthStore.getState().user
    if (u && !u.mustChangePassword) useAuthStore.setState({ user: { ...u, mustChangePassword: true } })
  })
}

// The API said "this role must set up two-factor first" (policy changed, or an Admin reset ours, while we held a stale
// profile). Flip the flag; ProtectedRoute then routes to /setup-two-factor.
// if (typeof window !== 'undefined') {
//   window.addEventListener(TWO_FACTOR_SETUP_REQUIRED_EVENT, () => {
//     const u = useAuthStore.getState().user
//     if (u && !u.twoFactorSetupRequired) useAuthStore.setState({ user: { ...u, twoFactorRequired: true, twoFactorSetupRequired: true, twoFactorEnabled: false } })
//   })
// }
