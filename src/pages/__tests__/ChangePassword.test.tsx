import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { renderWithRouter, signInAs, signOut, makeUser } from '@/test/utils'
import { useAuthStore } from '@/store/useAuthStore'

vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>()
  return { ...actual, api: { post: vi.fn(), get: vi.fn(), interceptors: actual.api.interceptors } }
})
import { api } from '@/services/api'
import ChangePasswordRequired from '../auth/ChangePasswordRequired'
import Profile from '../Profile'
import Login from '../auth/Login'

const post = api.post as unknown as ReturnType<typeof vi.fn>
const flagged = () => makeUser({ id: '10101', name: 'Asha Rao', role: 'KITCHEN_STAFF', mustChangePassword: true })

function App() {
  return (
    <Routes>
      <Route path="/change-password" element={<ChangePasswordRequired />} />
      <Route path="/login" element={<p>login page</p>} />
      <Route path="/kitchen" element={<p>kitchen home</p>} />
      <Route path="/dashboard" element={<p>dashboard home</p>} />
    </Routes>
  )
}

async function fill(user: ReturnType<typeof userEvent.setup>, current: string, next: string, confirm = next) {
  await user.type(screen.getByLabelText('Current password'), current)
  await user.type(screen.getByLabelText('New password'), next)
  await user.type(screen.getByLabelText('Confirm new password'), confirm)
}

const get = api.get as unknown as ReturnType<typeof vi.fn>
// Profile also shows the devices list and (for students) the photo-privacy card, which read from the API on load.
beforeEach(() => { post.mockReset(); get.mockReset(); get.mockImplementation(async (url: string) => ({ data: url === '/auth/sessions' ? [] : { photoOnFile: false, consentGiven: false, consentAt: null, consentMethod: null, consentNoticeVersion: null, currentNoticeVersion: 'v' } })); signOut() })

describe('forced "choose a new password" page', () => {
  it('explains why, and a successful change sends the person to their own home page with the flag cleared', async () => {
    signInAs(flagged())
    post.mockResolvedValueOnce({ data: { user: { ...flagged(), mustChangePassword: false } } })
    renderWithRouter(<App />, '/change-password')
    expect(screen.getByText(/signed in with a temporary password/i)).toBeInTheDocument()
    expect(screen.getByText(/Hi Asha/)).toBeInTheDocument()
    const user = userEvent.setup()
    await fill(user, 'Tmp-A1b2C3d4', 'Granite-Harbour-42')
    await user.click(screen.getByRole('button', { name: /save and continue/i }))
    expect(await screen.findByText('kitchen home')).toBeInTheDocument()
    expect(post).toHaveBeenCalledWith('/auth/change-password', { currentPassword: 'Tmp-A1b2C3d4', newPassword: 'Granite-Harbour-42' })
    expect(useAuthStore.getState().user?.mustChangePassword).toBe(false)
    expect(JSON.parse(localStorage.getItem('smartmess.user')!).mustChangePassword).toBe(false)
  })

  it('is not reachable by someone who has nothing to change (bounced home), nor by a signed-out visitor (bounced to login)', () => {
    signInAs(makeUser({ role: 'ADMIN', mustChangePassword: false }))
    const { unmount } = renderWithRouter(<App />, '/change-password')
    expect(screen.getByText('dashboard home')).toBeInTheDocument()
    unmount()
    signOut()
    renderWithRouter(<App />, '/change-password')
    expect(screen.getByText('login page')).toBeInTheDocument()
  })

  it('offers a way out: signing out', async () => {
    signInAs(flagged())
    post.mockResolvedValue({ data: {} })
    renderWithRouter(<App />, '/change-password')
    await userEvent.setup().click(screen.getByRole('button', { name: /not now — sign out/i }))
    expect(await screen.findByText('login page')).toBeInTheDocument()
    expect(useAuthStore.getState().user).toBeNull()
  })
})

describe('change-password form — validation and server reasons', () => {
  beforeEach(() => signInAs(flagged()))

  it('refuses obviously bad input BEFORE calling the server: too short, mismatch, same as current', async () => {
    renderWithRouter(<App />, '/change-password')
    const user = userEvent.setup()
    await fill(user, 'old-password', 'short', 'short')
    await user.click(screen.getByRole('button', { name: /save and continue/i }))
    expect(await screen.findByText('Use at least 8 characters')).toBeInTheDocument() // the error, not the hint underneath

    await user.clear(screen.getByLabelText('New password')); await user.clear(screen.getByLabelText('Confirm new password'))
    await user.type(screen.getByLabelText('New password'), 'Longer-Password-1'); await user.type(screen.getByLabelText('Confirm new password'), 'Different-Password-2')
    await user.click(screen.getByRole('button', { name: /save and continue/i }))
    expect(await screen.findByText(/don't match/i)).toBeInTheDocument()

    await user.clear(screen.getByLabelText('New password')); await user.clear(screen.getByLabelText('Confirm new password'))
    await user.type(screen.getByLabelText('New password'), 'old-password'); await user.type(screen.getByLabelText('Confirm new password'), 'old-password')
    await user.click(screen.getByRole('button', { name: /save and continue/i }))
    expect(await screen.findByText(/different from the current one/i)).toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()
  })

  it.each([
    ['wrong current password', 'Your current password is incorrect.'],
    ['a too-common password', 'That password is too common — choose something less guessable'],
    ['the account lockout', 'Too many failed attempts — this account is now locked for 15 minutes.'],
  ])('shows the server\'s reason verbatim for %s, stays on the page, and the flag is untouched', async (_label, message) => {
    post.mockRejectedValueOnce({ response: { status: 400, data: { error: message } } })
    renderWithRouter(<App />, '/change-password')
    const user = userEvent.setup()
    await fill(user, 'whatever-current', 'Valid-New-Password-9')
    await user.click(screen.getByRole('button', { name: /save and continue/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByText(/choose your own password/i)).toBeInTheDocument()
    expect(useAuthStore.getState().user?.mustChangePassword).toBe(true)
  })

  it('tells you plainly when the server can\'t be reached', async () => {
    post.mockRejectedValueOnce(new Error('Network Error'))
    renderWithRouter(<App />, '/change-password')
    const user = userEvent.setup()
    await fill(user, 'whatever-current', 'Valid-New-Password-9')
    await user.click(screen.getByRole('button', { name: /save and continue/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not change the password/i)
  })

  it('the show/hide control reveals and re-hides all three fields', async () => {
    renderWithRouter(<App />, '/change-password')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Show passwords' }))
    for (const l of ['Current password', 'New password', 'Confirm new password']) expect(screen.getByLabelText(l)).toHaveAttribute('type', 'text')
    await user.click(screen.getByRole('button', { name: 'Hide passwords' }))
    expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'password')
  })

  it('password managers are told which field is which', () => {
    renderWithRouter(<App />, '/change-password')
    expect(screen.getByLabelText('Current password')).toHaveAttribute('autocomplete', 'current-password')
    expect(screen.getByLabelText('New password')).toHaveAttribute('autocomplete', 'new-password')
  })
})

describe('Profile — the change-password button is real now (it used to be an alert("simulated"))', () => {
  it('calls the server, never alert(), and confirms that other devices were signed out', async () => {
    signInAs(makeUser({ role: 'STUDENT', studentId: '21000012', hostelId: 'BH1' }))
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    post.mockResolvedValueOnce({ data: { user: makeUser({ role: 'STUDENT', studentId: '21000012', hostelId: 'BH1' }) } })
    renderWithRouter(<Profile />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /^change password$/i }))
    await fill(user, 'old-password-1', 'Brand-New-Password-7')
    await user.click(screen.getByRole('button', { name: /update password/i }))
    expect(await screen.findByRole('status')).toHaveTextContent(/password updated.*other devices were signed out/i)
    expect(post).toHaveBeenCalledWith('/auth/change-password', { currentPassword: 'old-password-1', newPassword: 'Brand-New-Password-7' })
    expect(alertSpy).not.toHaveBeenCalled()
  })

  it('shows the server\'s refusal instead of pretending it worked', async () => {
    signInAs(makeUser({ role: 'STUDENT', studentId: '21000012', hostelId: 'BH1' }))
    post.mockRejectedValueOnce({ response: { status: 400, data: { error: 'Your current password is incorrect.' } } })
    renderWithRouter(<Profile />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /^change password$/i }))
    await fill(user, 'wrong-current-1', 'Brand-New-Password-7')
    await user.click(screen.getByRole('button', { name: /update password/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Your current password is incorrect.')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('sign-in and stale-profile handling', () => {
  it('signing in with a temporary password lands on the change-password page, not the dashboard', async () => {
    post.mockResolvedValueOnce({ data: { user: { ...flagged() } } })
    renderWithRouter(<Routes><Route path="/login" element={<Login />} /><Route path="/change-password" element={<p>forced page</p>} /><Route path="/kitchen" element={<p>kitchen home</p>} /></Routes>, '/login')
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText(/e\.g\. 21000001/i), '10101')
    await user.type(screen.getByPlaceholderText('••••••••'), 'Tmp-A1b2C3d4')
    await user.click(screen.getByRole('button', { name: /^sign in$/i }))
    expect(await screen.findByText('forced page')).toBeInTheDocument()
  })

  it('a PASSWORD_CHANGE_REQUIRED 403 from ANY request flips a stale profile into forced-change mode', async () => {
    const cached = makeUser({ role: 'ADMIN', mustChangePassword: false })
    signInAs(cached)
    localStorage.setItem('smartmess.user', JSON.stringify(cached)) // what a real sign-in leaves behind
    const { api: realApi } = await vi.importActual<typeof import('@/services/api')>('@/services/api')
    const handlers = (realApi.interceptors.response as unknown as { handlers: { rejected: (e: unknown) => Promise<unknown> }[] }).handlers
    await expect(handlers[0].rejected({ response: { status: 403, data: { code: 'PASSWORD_CHANGE_REQUIRED', error: 'x' } } })).rejects.toBeTruthy()
    await waitFor(() => expect(useAuthStore.getState().user?.mustChangePassword).toBe(true))
    expect(JSON.parse(localStorage.getItem('smartmess.user') ?? '{}').mustChangePassword).toBe(true)
  })
})
