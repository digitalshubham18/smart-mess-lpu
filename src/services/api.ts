import axios from 'axios'

export const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api'
export const ML_API_BASE_URL = import.meta.env.VITE_ML_API_URL ?? 'http://localhost:8000/api'

// Student and staff identity/roster/attendance now go through the real backend in
// /server via this client (see authService.ts, studentService.ts, userService.ts,
// attendanceService.ts). Everything else in src/data/* is still frontend mock data —
// see the README's "What's Real vs. What's Still Mock" section for the exact line.
export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  // The session is an httpOnly cookie the server sets at login — page JavaScript (and so any
  // XSS) can never read it. The browser attaches it because of withCredentials.
  withCredentials: true,
})

// Sent on every request. Two jobs: it tells the server this is the browser app (so login
// returns the session ONLY as the cookie, not in the response body), and it's the CSRF
// defense — a custom header can't be added by a cross-site form or image, and a cross-site
// fetch that adds it triggers a CORS preflight the server refuses for foreign origins.
api.interceptors.request.use((config) => {
  config.headers = config.headers ?? {}
  config.headers['X-SmartMess-Client'] = 'web'
  return config
})

/** Fired when the backend rejects the session (expired, revoked, signed out elsewhere) so a
 *  top-level listener can log the person out and explain why, instead of leaving them
 *  stuck making requests that will keep silently failing. See useAuthStore.ts. */
export const AUTH_EXPIRED_EVENT = 'smartmess:auth-expired'
/** The API refused a request because the account is still on a temporary password. */
export const PASSWORD_CHANGE_REQUIRED_EVENT = 'smartmess:password-change-required'
/** The API refused a request because this role must use two-factor login and it isn't set up yet. */
export const TWO_FACTOR_SETUP_REQUIRED_EVENT = 'smartmess:two-factor-setup-required'

api.interceptors.response.use(
  (res) => res,
  (error) => {
    // A 401 only means "your session ended" if we thought we had one — a wrong password on the
    // login form is also a 401 and must not be reported as an expired session.
    if (error?.response?.status === 401 && localStorage.getItem('smartmess.user')) {
      localStorage.removeItem('smartmess.user')
      window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT, { detail: error?.response?.data?.error }))
    }
    if (error?.response?.status === 403 && error?.response?.data?.code === 'PASSWORD_CHANGE_REQUIRED') {
      // Our cached profile was stale (e.g. an Admin reset this account while it was signed in): flip the flag so the
      // route guard sends the person to the "choose a new password" screen instead of showing a wall of errors.
      try {
        const cached = JSON.parse(localStorage.getItem('smartmess.user') ?? 'null')
        if (cached) localStorage.setItem('smartmess.user', JSON.stringify({ ...cached, mustChangePassword: true }))
      } catch { /* unreadable cache — the event below still updates the store */ }
      window.dispatchEvent(new CustomEvent(PASSWORD_CHANGE_REQUIRED_EVENT))
    }
    if (error?.response?.status === 403 && error?.response?.data?.code === 'TWO_FACTOR_SETUP_REQUIRED') {
      // Same idea: our cached profile didn't know a policy change (or a reset) now requires two-factor.
      try {
        const cached = JSON.parse(localStorage.getItem('smartmess.user') ?? 'null')
        if (cached) localStorage.setItem('smartmess.user', JSON.stringify({ ...cached, twoFactorRequired: true, twoFactorSetupRequired: true, twoFactorEnabled: false }))
      } catch { /* unreadable cache — the event below still updates the store */ }
      window.dispatchEvent(new CustomEvent(TWO_FACTOR_SETUP_REQUIRED_EVENT))
    }
    return Promise.reject(error)
  }
)

export const mlApi = axios.create({
  baseURL: ML_API_BASE_URL,
  timeout: 20000,
})

/** Simulates network latency for the mock services so loading states are visible. */
export function withDelay<T>(value: T, ms = 350): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}
