import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithRouter, signInAs, signOut, makeUser } from '@/test/utils'

vi.mock('@/services/authService', async (orig) => ({
  ...(await orig<typeof import('@/services/authService')>()),
  listSessions: vi.fn(), revokeSession: vi.fn(), revokeOtherSessions: vi.fn(), logoutEverywhere: vi.fn(), logout: vi.fn().mockResolvedValue(undefined),
}))
import * as auth from '@/services/authService'
import { DevicesCard } from '../DevicesCard'

const now = new Date().toISOString()
const dev = (id: string, device: string, current = false) => ({ id, current, device, ip: '10.0.0.5', signedInAt: now, lastActiveAt: now })
const list = vi.mocked(auth.listSessions)

beforeEach(() => { vi.clearAllMocks(); signInAs(makeUser({ role: 'STUDENT', studentId: '21000012' })) ; list.mockResolvedValue([dev('a', 'Chrome on Android', true), dev('b', 'Safari on iOS'), dev('c', 'Edge on Windows')]) })

describe('DevicesCard — where you are signed in', () => {
  it('lists the devices in words, marks this one, and offers sign-out only for the others', async () => {
    renderWithRouter(<DevicesCard />)
    const rows = within(await screen.findByTestId('device-list')).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Chrome on Android')
    expect(rows[0]).toHaveTextContent('This device')
    expect(within(rows[0]).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out Safari on iOS' })).toBeInTheDocument()
  })

  it('signing out one device calls the API for that device only and refreshes the list', async () => {
    vi.mocked(auth.revokeSession).mockResolvedValue({ current: false })
    renderWithRouter(<DevicesCard />)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Sign out Safari on iOS' }))
    await waitFor(() => expect(auth.revokeSession).toHaveBeenCalledWith('b'))
    expect(await screen.findByRole('status')).toHaveTextContent(/signed out safari on ios/i)
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('"sign out all other devices" is offered only when there are others', async () => {
    list.mockResolvedValueOnce([dev('a', 'Chrome on Android', true)])
    const { unmount } = renderWithRouter(<DevicesCard />)
    await screen.findByTestId('device-list')
    expect(screen.queryByRole('button', { name: /all other devices/i })).not.toBeInTheDocument()
    unmount()
    vi.mocked(auth.revokeOtherSessions).mockResolvedValue()
    renderWithRouter(<DevicesCard />)
    await userEvent.setup().click(await screen.findByRole('button', { name: /sign out all other devices/i }))
    await waitFor(() => expect(auth.revokeOtherSessions).toHaveBeenCalled())
  })

  it('"sign out everywhere" asks first, explains the push consequence, and only then does it', async () => {
    vi.mocked(auth.logoutEverywhere).mockResolvedValue()
    renderWithRouter(<DevicesCard />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /sign out everywhere/i }))
    const confirm = screen.getByRole('alertdialog', { name: /confirm sign out everywhere/i })
    expect(confirm).toHaveTextContent(/notifications to your phones stop/i)
    expect(auth.logoutEverywhere).not.toHaveBeenCalled()
    await user.click(within(confirm).getByRole('button', { name: /yes, sign out everywhere/i }))
    await waitFor(() => expect(auth.logoutEverywhere).toHaveBeenCalled())
  })

  it('shows the reason if the list cannot be loaded', async () => {
    list.mockRejectedValueOnce(new Error('Could not load your devices.'))
    renderWithRouter(<DevicesCard />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load your devices/i)
    signOut()
  })
})
