import type { Role, User } from '@/types'
import { clearOfflineKey } from './offlineQr'
import { api, withDelay } from './api'

const USER_KEY = 'smartmess.user'

/** The session itself is an httpOnly cookie the browser holds; only the (non-secret) profile is kept for the UI. */
export interface AuthResult {
  user: User
}

/**
 * Everyone — staff (Super Admin, Mess Admin, Mess Manager, Kitchen Staff, Finance
 * Manager, Hostel Warden, Parent) and students alike — now logs in through the real
 * backend in /server: an actual Express + SQLite API with bcrypt password hashing and
 * JWT tokens (see server/src/routes/auth.js). `api` (src/services/api.ts) is an axios
 * client pointed at VITE_API_URL; run the server (`cd server && npm start`) for any of
 * this to work — there is no local fallback for login/register anymore.
 */

function extractApiError(e: unknown, fallback: string): string {
  const err = e as { response?: { data?: { error?: string } } }
  return err?.response?.data?.error ?? fallback
}

/** Thrown by login() when the password was right but the account has two-factor on: carries the short-lived challenge to finish with a code. */
// export class TwoFactorRequiredError extends Error {
//   challenge: string
//   constructor(challenge: string) {
//     super('Enter the code from your authenticator app.')
//     this.name = 'TwoFactorRequiredError'
//     this.challenge = challenge
//   }
// }

export async function login(
  identifier: string,
  password: string
): Promise<AuthResult> {
  const value = identifier.trim()

  if (!value || !password) {
    await withDelay(null, 400)
    throw new Error('Enter your registration number (or email) and password.')
  }

  try {
    const { data } = await api.post<AuthResult>('/auth/login', {
      identifier: value,
      password,
    })

    return finishLogin(data.user)
  } catch (e) {
    throw new Error(
      extractApiError(
        e,
        'Could not reach the real API server — is it running (cd server && npm start)?'
      )
    )
  }
}

function finishLogin(user: User): AuthResult {
  localStorage.setItem(USER_KEY, JSON.stringify(user))
  return { user }
}

/**
 * Creates a login for a student who is ALREADY on the real, enrolled roster — this
 * calls the real backend (POST /auth/register), which checks the UID exists, the name
 * fuzzy-matches the enrollment record, hashes the password with bcrypt, and issues a
 * real JWT. Nothing here is simulated: it's an actual network request to server/.
 */
export async function register(uid: string, name: string, email: string, password: string): Promise<AuthResult> {
  try {
    const { data } = await api.post<AuthResult>('/auth/register', { uid: uid.trim(), name: name.trim(), email, password })
    return finishLogin(data.user)
  } catch (e) {
    throw new Error(extractApiError(e, 'Could not reach the real API server — is it running (cd server && npm start)?'))
  }
}

/**
 * Sign-up by UID alone. The student is already on the mess roster, so their name and email come from that record:
 * the server emails a code to the address ON FILE (never one typed here), then, once it's verified, creates the login
 * from just the UID and a password. A UID that isn't on the roster gets the server's "you haven't taken mess" message.
 */
export async function sendSignupCode(uid: string): Promise<{ sent: boolean; maskedEmail?: string }> {
  try {
    const { data } = await api.post<{ sent: boolean; maskedEmail?: string }>('/auth/send-otp', { uid: uid.trim() })
    return data
  } catch (e) {
    throw new Error(extractApiError(e, 'Could not send the code — is the API server running?'))
  }
}

/** Returns verified:false for a wrong/expired code; on success also the student's name (shown only after the inbox is proven). */
export async function verifySignupCode(uid: string, code: string): Promise<{ verified: boolean; name?: string; error?: string }> {
  try {
    const { data } = await api.post<{ verified: boolean; name?: string }>('/auth/verify-otp', { uid: uid.trim(), code })
    return data
  } catch (e) {
    const err = e as { response?: { status?: number; data?: { error?: string } } }
    if (err.response?.status === 400) return { verified: false, error: err.response.data?.error }
    throw new Error(extractApiError(e, 'Could not verify the code — is the API server running?'))
  }
}

/** Creates the login for a UID whose emailed code has been verified. */
export async function registerWithUid(uid: string, password: string): Promise<AuthResult> {
  try {
    const { data } = await api.post<AuthResult>('/auth/register', { uid: uid.trim(), password })
    return finishLogin(data.user)
  } catch (e) {
    throw new Error(extractApiError(e, 'Could not reach the real API server — is it running (cd server && npm start)?'))
  }
}

/**
 * Real password reset: generates a real, hashed, 15-minute-expiring code server-side
 * and emails it (see server/src/email.js — writes to server/data/outbox/ by default,
 * or sends for real if SMTP_* env vars are set). The same response is returned whether
 * or not the account exists, so this can't be used to probe which UIDs are registered.
 */
export async function requestPasswordReset(identifier: string): Promise<{ sent: boolean }> {
  try {
    const { data } = await api.post<{ sent: boolean }>('/auth/request-password-reset', { identifier: identifier.trim() })
    return data
  } catch (e) {
    throw new Error(extractApiError(e, 'Could not reach the real API server — is it running (cd server && npm start)?'))
  }
}

/**
 * Emails a one-time 6-digit code to confirm the address before the account is created. Real:
 * the server stores only a hash, expires it after 10 minutes, and POST /auth/register refuses
 * to create the account unless this email has been verified. (No simulated fallback — if the
 * server is down you're told so, rather than being waved through.)
 */
export async function sendVerificationOtp(email: string): Promise<{ sent: boolean }> {
  try {
    const { data } = await api.post<{ sent: boolean }>('/auth/send-otp', { email })
    return data
  } catch (e) {
    throw new Error(extractApiError(e, 'Could not send the code — is the API server running?'))
  }
}

/** Returns verified:false for a wrong/expired code; throws only if the server can't be reached. */
export async function verifyOtp(email: string, code: string): Promise<{ verified: boolean; error?: string }> {
  try {
    const { data } = await api.post<{ verified: boolean }>('/auth/verify-otp', { email, code })
    return data
  } catch (e) {
    const err = e as { response?: { status?: number; data?: { error?: string } } }
    if (err.response?.status === 400) return { verified: false, error: err.response.data?.error }
    throw new Error(extractApiError(e, 'Could not verify the code — is the API server running?'))
  }
}

/** Actually changes the password server-side and revokes every existing session for the account. */
export async function resetPassword(identifier: string, code: string, newPassword: string): Promise<{ success: boolean }> {
  try {
    const { data } = await api.post<{ success: boolean }>('/auth/reset-password', { identifier: identifier.trim(), code, newPassword })
    return data
  } catch (e) {
    throw new Error(extractApiError(e, 'Could not reset the password.'))
  }
}

/**
 * Changes the signed-in person's own password (real: the server checks the current one, signs every other device out,
 * and re-issues this session). Throws the server's reason — "current password incorrect", "too common", "locked…".
 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<User> {
  try {
    const { data } = await api.post<AuthResult>('/auth/change-password', { currentPassword, newPassword })
    return finishLogin(data.user).user
  } catch (e) {
    throw new Error(extractApiError(e, 'Could not change the password — is the API server running?'))
  }
}

/** Revokes the session server-side and clears the cookie (not just local state). */
export async function logout() {
  try {
    await api.post('/auth/logout')
  } catch {
    // Best-effort — still clear local state even if the server is unreachable.
  }
  localStorage.removeItem(USER_KEY)
  await clearOfflineKey() // this device's offline meal key goes with the session
}

/** One signed-in device, as the server lists it. */
export interface DeviceSession { id: string; current: boolean; device: string; ip: string | null; signedInAt: string; lastActiveAt: string }

export async function listSessions(): Promise<DeviceSession[]> {
  try { return (await api.get<DeviceSession[]>('/auth/sessions')).data }
  catch (e) { throw new Error(extractApiError(e, 'Could not load your devices.')) }
}
/** Signs ONE device out. If it was this device the caller must treat it as a logout. */
export async function revokeSession(id: string): Promise<{ current: boolean }> {
  try { return (await api.delete<{ success: boolean; current: boolean }>(`/auth/sessions/${encodeURIComponent(id)}`)).data }
  catch (e) { throw new Error(extractApiError(e, 'Could not sign that device out.')) }
}
/** Signs out every device except this one. */
export async function revokeOtherSessions(): Promise<void> {
  try { finishLogin((await api.post<AuthResult>('/auth/sessions/revoke-others', {})).data.user) }
  catch (e) { throw new Error(extractApiError(e, 'Could not sign the other devices out.')) }
}
/** Signs out EVERYWHERE, this device too, and stops notifications reaching any phone. For a lost phone. */
export async function logoutEverywhere(): Promise<void> {
  try { await api.post('/auth/logout-all', {}) }
  catch (e) { throw new Error(extractApiError(e, 'Could not sign out everywhere.')) }
  localStorage.removeItem(USER_KEY)
  await clearOfflineKey()
}

/** The cached profile from the last login. Whether the session is still valid is the server's call — the first request that gets a 401 signs the person out. */
export function getStoredSession(): AuthResult | null {
  const rawUser = localStorage.getItem(USER_KEY)
  if (!rawUser) return null
  try {
    return { user: JSON.parse(rawUser) as User }
  } catch {
    return null
  }
}

export function hasRole(user: User | null, ...roles: Role[]): boolean {
  if (!user) return false
  return roles.includes(user.role)
}

/** Second step of sign-in: exchanges the challenge + an authenticator code (or a one-time recovery code) for the session. */
// export async function loginWithTwoFactor(challenge: string, code: string): Promise<AuthResult> {
//   try {
//     const { data } = await api.post<AuthResult>('/auth/login/2fa', { challenge, code: code.trim() })
//     return finishLogin(data.user)
//   } catch (e) {
//     const err = e as { response?: { data?: { code?: string } } }
//     const wrapped = new Error(extractApiError(e, 'Could not verify the code — is the API server running?')) as Error & { expired?: boolean }
//     wrapped.expired = err.response?.data?.code === 'CHALLENGE_EXPIRED'
//     throw wrapped
//   }
// }

/** Starts setup: the server makes a secret; show it as a QR code / text for the authenticator app. Nothing is on until enableTwoFactor succeeds. */
// export async function startTwoFactorSetup(): Promise<{ secret: string; otpauthUri: string }> {
//   try {
//     const { data } = await api.post<{ secret: string; otpauthUri: string }>('/auth/2fa/setup', {})
//     return data
//   } catch (e) {
//     throw new Error(extractApiError(e, 'Could not start two-factor setup.'))
//   }
// }

/** Confirms the app works by checking a live code; returns the one-time recovery codes (shown once, only hashes are stored). */
// export async function enableTwoFactor(code: string): Promise<{ recoveryCodes: string[] }> {
//   try {
//     const { data } = await api.post<{ enabled: boolean; recoveryCodes: string[] }>('/auth/2fa/enable', { code: code.trim() })
//     return { recoveryCodes: data.recoveryCodes }
//   } catch (e) {
//     throw new Error(extractApiError(e, 'Could not turn on two-factor login.'))
//   }
// }

// export async function disableTwoFactor(password: string, code: string): Promise<void> {
//   try {
//     await api.post('/auth/2fa/disable', { password, code: code.trim() })
//   } catch (e) {
//     throw new Error(extractApiError(e, 'Could not turn off two-factor login.'))
//   }
// }

// /** Keeps the cached profile in step after two-factor is turned on or off. */
// export function cacheUser(user: User) {
//   localStorage.setItem(USER_KEY, JSON.stringify(user))
// }
