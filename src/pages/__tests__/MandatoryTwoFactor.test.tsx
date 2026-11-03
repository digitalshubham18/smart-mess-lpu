import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { renderWithRouter, signInAs, signOut, makeUser } from '@/test/utils'
import { useAuthStore } from '@/store/useAuthStore'
import { TWO_FACTOR_SETUP_REQUIRED_EVENT } from '@/services/api'
import { ProtectedRoute } from '@/components/layout/ProtectedRoute'

import SetupTwoFactorRequired from '../auth/SetupTwoFactorRequired'
import { TwoFactorSettings } from '@/components/auth/TwoFactorSettings'

function App() {
  return (
    <Routes>
      <Route path="/login" element={<p>login page</p>} />
      <Route path="/dashboard" element={<ProtectedRoute><p>dashboard page</p></ProtectedRoute>} />
      <Route path="/setup-two-factor" element={<SetupTwoFactorRequired />} />
    </Routes>
  )
}
const admin = (over = {}) => makeUser({ role: 'ADMIN', twoFactorRequired: true, twoFactorSetupRequired: true, twoFactorEnabled: false, ...over })
beforeEach(() => { vi.clearAllMocks() })
afterEach(signOut)

describe('mandatory two-factor for Admin / Super Admin', () => {
  it('an Admin who has not set it up is sent to the setup page from anywhere in the app', () => {
    signInAs(admin())
    renderWithRouter(<App />, '/dashboard')
    expect(screen.getByRole('heading', { name: /set up two-factor sign-in/i })).toBeInTheDocument()
    expect(screen.queryByText('dashboard page')).not.toBeInTheDocument()
  })

  it('an Admin who already has it goes straight through', () => {
    signInAs(admin({ twoFactorSetupRequired: false, twoFactorEnabled: true }))
    renderWithRouter(<App />, '/dashboard')
    expect(screen.getByText('dashboard page')).toBeInTheDocument()
  })

  it('a role that is not required never sees the page (it redirects away)', () => {
    signInAs(makeUser({ role: 'KITCHEN_STAFF' }))
    renderWithRouter(<App />, '/setup-two-factor')
    expect(screen.queryByRole('heading', { name: /set up two-factor/i })).not.toBeInTheDocument()
  })

  it('the setup page can be left only by signing out, not skipped', async () => {
    signInAs(admin())
    renderWithRouter(<App />, '/setup-two-factor')
    expect(screen.queryByRole('button', { name: /continue to the app/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /not now — sign out/i })).toBeInTheDocument()
  })

  it('finishing setup clears the requirement in the store, so the guard lets them in', () => {
    signInAs(admin())
    useAuthStore.getState().setTwoFactorEnabled(true)
    const u = useAuthStore.getState().user!
    expect(u.twoFactorEnabled).toBe(true)
    expect(u.twoFactorSetupRequired).toBe(false)
    expect(u.twoFactorRequired).toBe(true)
  })

  it('the API saying "set up two-factor first" (policy changed, or an admin reset ours) flips a stale profile and routes there', async () => {
    signInAs(admin({ twoFactorSetupRequired: false, twoFactorEnabled: true }))
    renderWithRouter(<App />, '/dashboard')
    expect(screen.getByText('dashboard page')).toBeInTheDocument()
    window.dispatchEvent(new CustomEvent(TWO_FACTOR_SETUP_REQUIRED_EVENT))
    await waitFor(() => expect(screen.getByRole('heading', { name: /set up two-factor sign-in/i })).toBeInTheDocument())
  })

  it('the "turn off" option is not offered for a required role (and is for an optional one)', () => {
    signInAs(admin({ twoFactorSetupRequired: false, twoFactorEnabled: true }))
    const { unmount } = renderWithRouter(<TwoFactorSettings />)
    expect(screen.queryByRole('button', { name: /turn off two-factor/i })).not.toBeInTheDocument()
    expect(screen.getByText(/required for your role/i)).toBeInTheDocument()
    unmount()
    signInAs(makeUser({ role: 'KITCHEN_STAFF', twoFactorEnabled: true }))
    renderWithRouter(<TwoFactorSettings />)
    expect(screen.getByRole('button', { name: /turn off two-factor/i })).toBeInTheDocument()
  })

  it('shows the sign-out escape hatch and greets the person by first name', async () => {
    signInAs(admin({ name: 'Meera Kapoor' }))
    renderWithRouter(<App />, '/setup-two-factor')
    expect(screen.getByText(/hi meera/i)).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: /not now — sign out/i }))
  })
})
