import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithRouter, signOut, signInAs, makeUser } from '@/test/utils'
import { useAuthStore } from '@/store/useAuthStore'

vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>()
  return { ...actual, api: { post: vi.fn(), get: vi.fn(), interceptors: actual.api.interceptors } }
})
vi.mock('@/components/ui/QrCodeSvg', () => ({ QrCodeSvg: ({ value }: { value: string }) => <div data-testid="qr">{value}</div> }))
import { api } from '@/services/api'
import Login from '../auth/Login'
import { TwoFactorSettings } from '@/components/auth/TwoFactorSettings'

const post = api.post as unknown as ReturnType<typeof vi.fn>
const staffUser = { id: '10102', name: 'Mess Manager', email: 'm@x.edu', role: 'MESS_MANAGER', avatarColor: '#000', hostelId: 'BH2', createdAt: '', twoFactorEnabled: true }

beforeEach(() => { post.mockReset(); signOut() })

describe('Login — second step when two-factor is on', () => {
  async function passwordStep() {
    const user = userEvent.setup()
    renderWithRouter(<Login />)
    await user.type(screen.getByPlaceholderText(/e\.g\. 21000001/i), '10102')
    await user.type(screen.getByPlaceholderText('••••••••'), 'demo1234')
    await user.click(screen.getByRole('button', { name: /^sign in$/i }))
    return user
  }

  it('a right password with 2FA on asks for the code instead of signing in, then finishes with it', async () => {
    post.mockResolvedValueOnce({ data: { twoFactorRequired: true, challenge: 'chal-1' } })
      .mockResolvedValueOnce({ data: { user: staffUser } })
    const user = await passwordStep()
    expect(await screen.findByRole('heading', { name: /two-factor check/i })).toBeInTheDocument()
    expect(useAuthStore.getState().user).toBeNull()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument() // asking for a code is a step, not an error
    await user.type(screen.getByLabelText(/authentication code/i), '123456')
    await user.click(screen.getByRole('button', { name: /verify and sign in/i }))
    await waitFor(() => expect(useAuthStore.getState().user?.id).toBe('10102'))
    expect(post.mock.calls[1]).toEqual(['/auth/login/2fa', { challenge: 'chal-1', code: '123456' }])
  })

  it('a wrong code shows the server\'s reason and stays on the code step', async () => {
    post.mockResolvedValueOnce({ data: { twoFactorRequired: true, challenge: 'chal-1' } })
      .mockRejectedValueOnce({ response: { status: 401, data: { error: 'That code is incorrect or has already been used.', code: 'TOTP_INVALID' } } })
    const user = await passwordStep()
    await user.type(await screen.findByLabelText(/authentication code/i), '000000')
    await user.click(screen.getByRole('button', { name: /verify and sign in/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect or has already been used/i)
    expect(screen.getByLabelText(/authentication code/i)).toBeInTheDocument()
    expect(useAuthStore.getState().user).toBeNull()
  })

  it('an expired challenge sends the person back to the password step', async () => {
    post.mockResolvedValueOnce({ data: { twoFactorRequired: true, challenge: 'chal-1' } })
      .mockRejectedValueOnce({ response: { status: 401, data: { error: 'That sign-in attempt has expired — enter your password again.', code: 'CHALLENGE_EXPIRED' } } })
    const user = await passwordStep()
    await user.type(await screen.findByLabelText(/authentication code/i), '123456')
    await user.click(screen.getByRole('button', { name: /verify and sign in/i }))
    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/expired/i)
  })
})

describe('Profile — turning two-factor on and off', () => {
  it('shows the QR/key, only turns on after a code is confirmed, then shows recovery codes once', async () => {
    signInAs(makeUser({ id: '10102', role: 'MESS_MANAGER', twoFactorEnabled: false }))
    post.mockResolvedValueOnce({ data: { secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP' } })
      .mockResolvedValueOnce({ data: { enabled: true, recoveryCodes: ['aaaaa-bbbbb', 'ccccc-ddddd'] } })
    const user = userEvent.setup()
    renderWithRouter(<TwoFactorSettings />)
    await user.click(screen.getByRole('button', { name: /turn on two-factor/i }))
    expect(await screen.findByTestId('totp-secret')).toHaveTextContent('JBSWY3DPEHPK3PXP')
    expect(screen.getByTestId('qr')).toHaveTextContent('otpauth://')
    expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled()
    expect(useAuthStore.getState().user?.twoFactorEnabled).toBe(false)
    await user.type(screen.getByLabelText(/authenticator code/i), '123456')
    await user.click(screen.getByRole('button', { name: /confirm/i }))
    expect(await screen.findByTestId('recovery-codes')).toHaveTextContent('aaaaa-bbbbb')
    expect(post.mock.calls[1]).toEqual(['/auth/2fa/enable', { code: '123456' }])
    expect(useAuthStore.getState().user?.twoFactorEnabled).toBe(true)
  })

  it('a wrong confirmation code shows the reason and does not turn it on', async () => {
    signInAs(makeUser({ id: '10102', role: 'MESS_MANAGER', twoFactorEnabled: false }))
    post.mockResolvedValueOnce({ data: { secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/x' } })
      .mockRejectedValueOnce({ response: { status: 400, data: { error: 'That code is incorrect — check your authenticator app and try the newest code.' } } })
    const user = userEvent.setup()
    renderWithRouter(<TwoFactorSettings />)
    await user.click(screen.getByRole('button', { name: /turn on two-factor/i }))
    await user.type(await screen.findByLabelText(/authenticator code/i), '000000')
    await user.click(screen.getByRole('button', { name: /confirm/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/code is incorrect/i)
    expect(useAuthStore.getState().user?.twoFactorEnabled).toBe(false)
  })

  it('turning it off sends the password and a code', async () => {
    signInAs(makeUser({ id: '10102', role: 'MESS_MANAGER', twoFactorEnabled: true }))
    post.mockResolvedValueOnce({ data: { enabled: false } })
    const user = userEvent.setup()
    renderWithRouter(<TwoFactorSettings />)
    await user.click(screen.getByRole('button', { name: /turn off two-factor/i }))
    await user.type(screen.getByLabelText('Password'), 'demo1234')
    await user.type(screen.getByLabelText('Code'), '654321')
    await user.click(screen.getByRole('button', { name: /^turn off$/i }))
    await waitFor(() => expect(useAuthStore.getState().user?.twoFactorEnabled).toBe(false))
    expect(post.mock.calls[0]).toEqual(['/auth/2fa/disable', { password: 'demo1234', code: '654321' }])
  })
})
