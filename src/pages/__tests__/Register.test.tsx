import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithRouter, signOut } from '@/test/utils'

vi.mock('@/services/studentService', async (orig) => ({ ...(await orig<typeof import('@/services/studentService')>()), findByUid: vi.fn() }))
vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>()
  return { ...actual, api: { post: vi.fn(), get: vi.fn(), interceptors: actual.api.interceptors } }
})
import { api } from '@/services/api'
import * as studentService from '@/services/studentService'
import Register from '../auth/Register'

const post = api.post as unknown as ReturnType<typeof vi.fn>
const findByUid = vi.mocked(studentService.findByUid)
const UID = /e\.g\. 21000001/i

beforeEach(() => {
  post.mockReset()
  findByUid.mockReset()
  signOut()
  findByUid.mockResolvedValue({ maskedName: 'A••••• S•••••', maskedEmail: 'a•••••@lpu.smartmess.edu', hostelName: 'Boys Hostel 2', messId: 'MESS-BH2', messName: 'Mess 2', alreadyRegistered: false })
})

describe('Register — sign up with just a UID', () => {
  it('a student who has taken mess sees their hostel/mess and where the code will go — nothing else to type', async () => {
    const user = userEvent.setup()
    renderWithRouter(<Register />)
    await user.type(screen.getByPlaceholderText(UID), '21000101')
    expect(await screen.findByText(/you're on the mess/i)).toBeInTheDocument()
    expect(screen.getByText('A••••• S•••••')).toBeInTheDocument()
    expect(screen.getByText('a•••••@lpu.smartmess.edu')).toBeInTheDocument()
    expect(document.querySelector('input[name="name"]')).toBeNull()
    expect(document.querySelector('input[name="email"]')).toBeNull()
  })

  it('a UID that has NOT taken mess is told to visit the warden office and cannot continue', async () => {
    findByUid.mockResolvedValue(null)
    const user = userEvent.setup()
    renderWithRouter(<Register />)
    await user.type(screen.getByPlaceholderText(UID), '99999999')
    expect(await screen.findByRole('alert')).toHaveTextContent("You haven't taken mess. For any query, visit the warden office.")
    expect(screen.getByRole('button', { name: /send verification code/i })).toBeDisabled()
  })

  it('a server that cannot be reached is NOT reported as "you haven\'t taken mess"', async () => {
    findByUid.mockRejectedValue(new Error('Could not check your UID — is the API server running?'))
    const user = userEvent.setup()
    renderWithRouter(<Register />)
    await user.type(screen.getByPlaceholderText(UID), '21000101')
    expect(await screen.findByText(/could not check your uid/i)).toBeInTheDocument()
    expect(screen.queryByText(/haven't taken mess/i)).not.toBeInTheDocument()
  })

  it('code goes to the email on file (UID only), then the name appears, then a password finishes it', async () => {
    post.mockResolvedValueOnce({ data: { sent: true, maskedEmail: 'a•••••@lpu.smartmess.edu' } }) // send-otp
      .mockResolvedValueOnce({ data: { verified: true, name: 'Aarav Sharma' } }) // verify-otp
      .mockResolvedValueOnce({ data: { user: { id: '21000101', name: 'Aarav Sharma', email: 'a@x.edu', role: 'STUDENT', avatarColor: '#000', createdAt: '' } } }) // register
    const user = userEvent.setup()
    renderWithRouter(<Register />)
    await user.type(screen.getByPlaceholderText(UID), '21000101')
    await screen.findByText(/you're on the mess/i)
    await user.click(screen.getByRole('button', { name: /send verification code/i }))
    await user.type(await screen.findByPlaceholderText('000000'), '482913')
    await user.click(screen.getByRole('button', { name: /^verify$/i }))
    expect(await screen.findByText(/welcome, aarav sharma/i)).toBeInTheDocument()
    await user.type(document.querySelector('input[name="password"]') as HTMLInputElement, 'password1')
    await user.type(document.querySelector('input[name="confirmPassword"]') as HTMLInputElement, 'password1')
    await user.click(screen.getByRole('button', { name: /create account/i }))
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3))
    expect(post.mock.calls[0]).toEqual(['/auth/send-otp', { uid: '21000101' }])
    expect(post.mock.calls[1]).toEqual(['/auth/verify-otp', { uid: '21000101', code: '482913' }])
    expect(post.mock.calls[2]).toEqual(['/auth/register', { uid: '21000101', password: 'password1' }])
  })

  it('a wrong code shows the server\'s reason and never reaches the password step', async () => {
    post.mockResolvedValueOnce({ data: { sent: true } })
      .mockRejectedValueOnce({ response: { status: 400, data: { error: 'That code is incorrect or has expired — request a new one.' } } })
    const user = userEvent.setup()
    renderWithRouter(<Register />)
    await user.type(screen.getByPlaceholderText(UID), '21000101')
    await screen.findByText(/you're on the mess/i)
    await user.click(screen.getByRole('button', { name: /send verification code/i }))
    await user.type(await screen.findByPlaceholderText('000000'), '000000')
    await user.click(screen.getByRole('button', { name: /^verify$/i }))
    expect(await screen.findByText(/incorrect or has expired/i)).toBeInTheDocument()
    expect(screen.queryByText(/welcome/i)).not.toBeInTheDocument()
    expect(post.mock.calls.some((c) => c[0] === '/auth/register')).toBe(false)
  })

  it('if the code can\'t be sent you are told — not waved through', async () => {
    post.mockRejectedValueOnce(new Error('Network Error'))
    const user = userEvent.setup()
    renderWithRouter(<Register />)
    await user.type(screen.getByPlaceholderText(UID), '21000101')
    await screen.findByText(/you're on the mess/i)
    await user.click(screen.getByRole('button', { name: /send verification code/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not send the code/i)
    expect(screen.queryByPlaceholderText('000000')).not.toBeInTheDocument()
  })
})
