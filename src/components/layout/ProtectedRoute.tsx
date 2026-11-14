import { Navigate, useLocation } from 'react-router-dom'
import type { Role } from '@/types'
import { useAuth } from '@/hooks/useAuth'

export function ProtectedRoute({ children, roles }: { children: React.ReactNode; roles?: Role[] }) {
  const { user, isAuthenticated } = useAuth()
  const location = useLocation()

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  // A temporary password means nothing else is available (the API refuses it anyway) — go straight to choosing one.
  if (user?.mustChangePassword) {
    return <Navigate to="/change-password" replace />
  }
  // Admin / Super Admin must have two-factor; until it's on, the API allows only setting it up, so go straight there.
  // if (user?.twoFactorSetupRequired) {
  //   return <Navigate to="/setup-two-factor" replace />
  // }
  if (roles && user && !roles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />
  }
  return <>{children}</>
}
