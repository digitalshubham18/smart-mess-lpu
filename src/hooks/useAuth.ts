import { useAuthStore } from '@/store/useAuthStore'

export function useAuth() {
  const user = useAuthStore((s) => s.user)
  const isLoading = useAuthStore((s) => s.isLoading)
  const error = useAuthStore((s) => s.error)
  const sessionExpiredMessage = useAuthStore((s) => s.sessionExpiredMessage)
  const login = useAuthStore((s) => s.login)
  const register = useAuthStore((s) => s.register)
  const registerWithUid = useAuthStore((s) => s.registerWithUid)
  const loginWithTwoFactor = useAuthStore((s) => s.loginWithTwoFactor)
  const setTwoFactorEnabled = useAuthStore((s) => s.setTwoFactorEnabled)
  const logout = useAuthStore((s) => s.logout)
  const changePassword = useAuthStore((s) => s.changePassword)
  const clearError = useAuthStore((s) => s.clearError)
  const clearSessionExpiredMessage = useAuthStore((s) => s.clearSessionExpiredMessage)

  return { user, isLoading, error, sessionExpiredMessage, login, register, registerWithUid, loginWithTwoFactor, setTwoFactorEnabled, logout, changePassword, clearError, clearSessionExpiredMessage, isAuthenticated: !!user }
}
