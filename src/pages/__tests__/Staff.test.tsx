import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithRouter, signInAs, makeUser } from '@/test/utils'
import type { User } from '@/types'

vi.mock('@/services/userService', () => ({
  listStaffForHostel: vi.fn(),
  createStaffMember: vi.fn(),
  deleteStaffMember: vi.fn(),
  resetStaffPassword: vi.fn(),
  resetStaffTwoFactor: vi.fn(),
}))
vi.mock('@/components/ui/StaffAvatar', () => ({ StaffAvatar: () => null }))

import * as userService from '@/services/userService'
import Staff from '../Staff'

const svc = vi.mocked(userService)
const member = (over: Partial<User> = {}): User => ({ id: '10009', name: 'Kiran Joshi', email: 'k@x.edu', role: 'KITCHEN_STAFF', hostelId: 'BH2', avatarColor: '#000', createdAt: '', ...over }) as User
const made = (id: string, name: string, role = 'KITCHEN_STAFF', tempPassword = 'Tmp-' + id) => ({ ...member({ id, name, role: role as User['role'] }), tempPassword })
const csv = (t: string) => new File([t], 'staff.csv', { type: 'text/csv' })
const input = (c: HTMLElement) => c.querySelector('input[type="file"]') as HTMLInputElement

beforeEach(() => {
  vi.clearAllMocks()
  svc.listStaffForHostel.mockResolvedValue([member({ id: '10007', name: 'Deepak Yadav', role: 'ADMIN' }), member()])
  signInAs(makeUser({ id: '10007', role: 'ADMIN', hostelId: 'BH2' }))
})

describe('Staff — credentials are actually shown', () => {
  it('after adding a team member, shows their UID and the generated temporary password (not a fake "demo" one)', async () => {
    svc.createStaffMember.mockResolvedValueOnce(made('10110', 'Asha Rao', 'MESS_MANAGER', 'Zk7-mQ2x'))
    renderWithRouter(<Staff />)
    await screen.findByText('Kiran Joshi')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /add staff member/i }))
    const dialog = await screen.findByRole('dialog', { name: /add staff member/i })
    await user.type(within(dialog).getByPlaceholderText('Full name'), 'Asha Rao')
    await user.click(within(dialog).getByRole('button', { name: /add to team/i }))
    const creds = await screen.findByTestId('credentials-list')
    expect(creds).toHaveTextContent('10110')
    expect(creds).toHaveTextContent('Zk7-mQ2x')
    expect(screen.queryByText(/demo1234/)).not.toBeInTheDocument()
  })

  it('an Admin can issue a new temporary password for a team member and sees it once', async () => {
    svc.resetStaffPassword.mockResolvedValueOnce({ id: '10009', tempPassword: 'New-Pw-42' })
    renderWithRouter(<Staff />)
    await screen.findByText('Kiran Joshi')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /reset password for kiran joshi/i }))
    await user.click(await screen.findByRole('button', { name: /^reset password$/i }))
    expect(await screen.findByTestId('credentials-list')).toHaveTextContent('New-Pw-42')
    expect(svc.resetStaffPassword).toHaveBeenCalledWith('10009')
  })

  it('shows the server\'s reason if a reset is refused', async () => {
    svc.resetStaffPassword.mockRejectedValueOnce(new Error("You can't reset that account's password here."))
    renderWithRouter(<Staff />)
    await screen.findByText('Kiran Joshi')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /reset password for kiran joshi/i }))
    await user.click(await screen.findByRole('button', { name: /^reset password$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/can't reset that account/i)
  })
})

describe('Staff — CSV import reports each row instead of stopping at the first failure', () => {
  it('imports the good rows, lists each rejected line with its reason, and hands over every temp password', async () => {
    svc.createStaffMember
      .mockResolvedValueOnce(made('10201', 'Asha Rao', 'MESS_MANAGER', 'Pw-1'))
      .mockRejectedValueOnce(new Error('A staff member with that email already exists.'))
      .mockResolvedValueOnce(made('10203', 'Dev Kumar', 'KITCHEN_STAFF', 'Pw-3'))
    const { container } = renderWithRouter(<Staff />)
    await screen.findByText('Kiran Joshi')
    await userEvent.setup().upload(input(container), csv([
      'role,name,email,phone',
      'Mess Manager,Asha Rao,asha@x.edu,',            // ok
      'Kitchen Staff,Dup Person,dup@x.edu,',           // server refuses (duplicate email) — must NOT stop the import
      'Cook,Wrong Role,w@x.edu,',                      // invalid role
      'Kitchen Staff,,noname@x.edu,',                  // missing name
      'Kitchen Staff,"Kumar, Dev",dev@x.edu,',         // quoted comma survives; ok
    ].join('\n')))

    const banner = await screen.findByTestId('staff-import-result')
    expect(banner).toHaveTextContent('Imported 2 staff members, 3 rows rejected.')
    expect(within(banner).getByText(/Line 3: A staff member with that email already exists/)).toBeInTheDocument()
    expect(within(banner).getByText(/Line 4: role must be one of/)).toBeInTheDocument()
    expect(within(banner).getByText(/Line 5: name is required/)).toBeInTheDocument()
    expect(svc.createStaffMember).toHaveBeenCalledTimes(3)
    expect(svc.createStaffMember).toHaveBeenLastCalledWith({ hostelId: 'BH2', role: 'KITCHEN_STAFF', name: 'Kumar, Dev', email: 'dev@x.edu', phone: undefined })

    const creds = await screen.findByTestId('credentials-list')
    expect(creds).toHaveTextContent('Pw-1')
    expect(creds).toHaveTextContent('Pw-3')
    expect(screen.getByRole('button', { name: /download csv/i })).toBeInTheDocument()
  })

  it('refuses a file with no header row', async () => {
    const { container } = renderWithRouter(<Staff />)
    await screen.findByText('Kiran Joshi')
    await userEvent.setup().upload(input(container), csv('Kitchen Staff,Asha,a@x.edu'))
    expect(await screen.findByTestId('staff-import-result')).toHaveTextContent(/no header row found/i)
    expect(svc.createStaffMember).not.toHaveBeenCalled()
  })
})

describe('Staff — resetting a lost authenticator', () => {
  it('offers the reset only for people who actually have two-factor on, asks first, then resets and says what happens next', async () => {
    svc.listStaffForHostel.mockResolvedValue([member({ id: '10007', name: 'Deepak Yadav', role: 'ADMIN' }), member({ twoFactorEnabled: true }), member({ id: '10010', name: 'Meena Rao', twoFactorEnabled: false })])
    svc.resetStaffTwoFactor.mockResolvedValue()
    renderWithRouter(<Staff />)
    await screen.findByText('Kiran Joshi')
    expect(screen.queryByRole('button', { name: /reset two-factor for meena rao/i })).not.toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /reset two-factor for kiran joshi/i }))
    expect(svc.resetStaffTwoFactor).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: /^reset two-factor$/i }))
    await waitFor(() => expect(svc.resetStaffTwoFactor).toHaveBeenCalledWith('10009'))
    expect(await screen.findByTestId('staff-import-result')).toHaveTextContent(/must set it up again at their next sign-in/i)
  })

  it("shows the server's reason if it is refused", async () => {
    svc.listStaffForHostel.mockResolvedValue([member({ id: '10007', name: 'Deepak Yadav', role: 'ADMIN' }), member({ twoFactorEnabled: true })])
    svc.resetStaffTwoFactor.mockRejectedValue(new Error("You can't reset that account's two-factor login here."))
    renderWithRouter(<Staff />)
    await screen.findByText('Kiran Joshi')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /reset two-factor for kiran joshi/i }))
    await user.click(await screen.findByRole('button', { name: /^reset two-factor$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/can't reset that account/i)
  })

  it('the Super Admin also gets a reset button on the Mess Admin card (an Admin does not)', async () => {
    svc.listStaffForHostel.mockResolvedValue([member({ id: '10007', name: 'Deepak Yadav', role: 'ADMIN', twoFactorEnabled: true })])
    const { unmount } = renderWithRouter(<Staff />)
    await screen.findByText('Deepak Yadav')
    expect(screen.queryByRole('button', { name: /reset two-factor for deepak yadav/i })).not.toBeInTheDocument()
    unmount()
    signInAs(makeUser({ id: '10001', role: 'SUPER_ADMIN', hostelId: 'BH2' }))
    renderWithRouter(<Staff />)
    expect(await screen.findByRole('button', { name: /reset two-factor for deepak yadav/i })).toBeInTheDocument()
  })
})
