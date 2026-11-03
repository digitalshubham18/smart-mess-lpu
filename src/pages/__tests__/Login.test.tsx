import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithRouter, signOut } from '@/test/utils'
import { useAuthStore } from '@/store/useAuthStore'

// Only the network edge is faked: the real Login page, real zod form validation, real
// zustand store and real authService all run. `api.post` stands in for the server's reply.
vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>()
  return { ...actual, api: { post: vi.fn(), get: vi.fn(), interceptors: actual.api.interceptors } }
})
import { api } from '@/services/api'
import Login from '../auth/Login'

const post = api.post as unknown as ReturnType<typeof vi.fn>

function serverRejects(status: number, error: string) {
  post.mockRejectedValueOnce({ response: { status, data: { error } } })
}

async function signIn(uid: string, password: string) {
  const user = userEvent.setup()
  await user.type(screen.getByPlaceholderText(/e\.g\. 21000001/i), uid)
  await user.type(screen.getByPlaceholderText('••••••••'), password)
  await user.click(screen.getByRole('button', { name: /^sign in$/i }))
}

beforeEach(() => {
  post.mockReset()
  signOut()
})

describe('Login — lockout and error rendering', () => {
  it('renders the server\'s account-lockout message when the 5th wrong password locks the account', async () => {
    serverRejects(423, 'Too many failed attempts — this account is now locked for 15 minutes.')
    renderWithRouter(<Login />)
    await signIn('21000016', 'wrong-pw')
    expect(await screen.findByText(/this account is now locked for 15 minutes/i)).toBeInTheDocument()
  })

  it('keeps showing the lock (with minutes remaining) when someone retries with the right password', async () => {
    serverRejects(423, 'Too many failed attempts — this account is locked for 14 more minutes.')
    renderWithRouter(<Login />)
    await signIn('21000016', 'correct-password')
    expect(await screen.findByText(/locked for 14 more minutes/i)).toBeInTheDocument()
    expect(useAuthStore.getState().user).toBeNull()
    expect(localStorage.getItem('smartmess.user')).toBeNull()
  })

  it('shows the "attempts left" warning from a plain wrong-password response', async () => {
    serverRejects(401, 'Incorrect password. 2 attempts left before this account locks.')
    renderWithRouter(<Login />)
    await signIn('21000012', 'nope')
    expect(await screen.findByText(/2 attempts left before this account locks/i)).toBeInTheDocument()
  })

  it('shows a clear message (not a blank screen) when the API server is unreachable', async () => {
    post.mockRejectedValueOnce(new Error('Network Error'))
    renderWithRouter(<Login />)
    await signIn('21000012', 'password1')
    expect(await screen.findByText(/could not reach the real api server/i)).toBeInTheDocument()
  })

  it('clears a previous error as soon as the person tries again', async () => {
    serverRejects(401, 'Incorrect password.')
    renderWithRouter(<Login />)
    await signIn('21000012', 'badpass')
    expect(await screen.findByText('Incorrect password.')).toBeInTheDocument()

    post.mockReturnValueOnce(new Promise(() => {})) // second attempt hangs in flight
    await userEvent.setup().click(screen.getByRole('button', { name: /sign in/i }))
    await waitFor(() => expect(screen.queryByText('Incorrect password.')).not.toBeInTheDocument())
  })

  it('validates before touching the network: a too-short password never calls the API', async () => {
    renderWithRouter(<Login />)
    await signIn('21000012', 'abc')
    expect(await screen.findByText(/at least 4 characters/i)).toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()
  })

  it('shows the "session expired / signed out elsewhere" banner, and it can be dismissed', async () => {
    useAuthStore.setState({ sessionExpiredMessage: 'Your session is no longer valid — please sign in again.' })
    renderWithRouter(<Login />)
    expect(screen.getByText(/session is no longer valid/i)).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: /dismiss/i }))
    expect(screen.queryByText(/session is no longer valid/i)).not.toBeInTheDocument()
  })

  it('on success: stores the session and shows no error', async () => {
    post.mockResolvedValueOnce({ data: { user: { id: '10001', name: 'Dr. Ashok Mittal', email: 's@x.edu', role: 'SUPER_ADMIN', avatarColor: '#000', createdAt: '' } } })
    renderWithRouter(<Login />)
    await signIn('10001', 'demo1234')
    await waitFor(() => expect(useAuthStore.getState().user?.role).toBe('SUPER_ADMIN'))
    // The session is an httpOnly cookie the browser holds — no token ever touches page storage.
    expect(localStorage.getItem('smartmess.token')).toBeNull()
    expect(JSON.parse(localStorage.getItem('smartmess.user') ?? 'null').id).toBe('10001')
    expect(post).toHaveBeenCalledWith('/auth/login', { identifier: '10001', password: 'demo1234' })
  })
})

describe('Login — redesign: no credentials on screen, accessible form', () => {
  it('shows NO demo accounts, UIDs, passwords or quick-fill buttons anywhere on the page', () => {
    const { container } = renderWithRouter(<Login />)
    const text = (container.textContent ?? '') + ' ' + [...container.querySelectorAll('input')].map((i) => `${i.placeholder} ${i.value}`).join(' ')
    expect(text).not.toMatch(/demo1234/i)
    expect(text).not.toMatch(/any password works/i)
    expect(text).not.toMatch(/demo\b/i)
    expect(text).not.toMatch(/\b10001\b|\b21000020\b/) // neither the Super Admin UID nor the featured student's
    expect(text).not.toMatch(/UID\s+\d{5,8}/)
    // the only buttons are the ones a real sign-in needs
    const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim())
    expect(names.sort()).toEqual(['Show password', 'Sign in'].sort())
  })

  it('clicking around the page never pre-fills the form', async () => {
    renderWithRouter(<Login />)
    const user = userEvent.setup()
    for (const b of screen.getAllByRole('button')) if (b.getAttribute('aria-label') !== 'Show password' && b.textContent?.trim() !== 'Sign in') await user.click(b)
    expect(screen.getByLabelText('UID')).toHaveValue('')
    expect(screen.getByLabelText('Password')).toHaveValue('')
  })

  it('every field has a real label, and the browser can offer its password manager', () => {
    renderWithRouter(<Login />)
    const uid = screen.getByLabelText('UID')
    const pw = screen.getByLabelText('Password')
    expect(uid).toHaveAttribute('autocomplete', 'username')
    expect(pw).toHaveAttribute('autocomplete', 'current-password')
    expect(pw).toHaveAttribute('type', 'password')
  })

  it('the show/hide control announces its state and actually toggles the field', async () => {
    renderWithRouter(<Login />)
    const user = userEvent.setup()
    const pw = screen.getByLabelText('Password')
    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(pw).toHaveAttribute('type', 'text')
    const hide = screen.getByRole('button', { name: 'Hide password' })
    expect(hide).toHaveAttribute('aria-pressed', 'true')
    await user.click(hide)
    expect(pw).toHaveAttribute('type', 'password')
  })

  it('points people without an account to registration, and staff/parents to their Admin', () => {
    renderWithRouter(<Login />)
    expect(screen.getByRole('link', { name: /create a student account/i })).toHaveAttribute('href', '/register')
    expect(screen.getByRole('link', { name: /forgot password/i })).toHaveAttribute('href', '/forgot-password')
    expect(screen.getByText(/staff and parent accounts are created for you by your hostel's admin/i)).toBeInTheDocument()
  })

  it('a failed sign-in is announced to assistive tech (role=alert)', async () => {
    serverRejects(401, 'Incorrect password.')
    renderWithRouter(<Login />)
    await signIn('21000012', 'badpass')
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect password.')
  })
})
