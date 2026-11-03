import { describe, it, expect, afterEach } from 'vitest'
import { screen } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { renderWithRouter, signInAs, signOut, makeUser } from '@/test/utils'
import { ProtectedRoute } from '../ProtectedRoute'

function App() {
  return (
    <Routes>
      <Route path="/login" element={<p>login page</p>} />
      <Route path="/dashboard" element={<p>dashboard page</p>} />
      <Route path="/staff" element={<ProtectedRoute roles={['SUPER_ADMIN', 'ADMIN']}><p>staff admin page</p></ProtectedRoute>} />
    </Routes>
  )
}
afterEach(signOut)

describe('ProtectedRoute', () => {
  it('sends a signed-out visitor to /login', () => {
    signOut()
    renderWithRouter(<App />, '/staff')
    expect(screen.getByText('login page')).toBeInTheDocument()
  })
  it('lets an allowed role in', () => {
    signInAs(makeUser({ role: 'ADMIN' }))
    renderWithRouter(<App />, '/staff')
    expect(screen.getByText('staff admin page')).toBeInTheDocument()
  })
  it('bounces a disallowed role (Kitchen Staff) to the dashboard instead of rendering the page', () => {
    signInAs(makeUser({ role: 'KITCHEN_STAFF' }))
    renderWithRouter(<App />, '/staff')
    expect(screen.queryByText('staff admin page')).not.toBeInTheDocument()
    expect(screen.getByText('dashboard page')).toBeInTheDocument()
  })
})

describe('ProtectedRoute — temporary-password accounts', () => {
  function Shell() {
    return (
      <Routes>
        <Route path="/change-password" element={<p>choose a new password page</p>} />
        <Route path="/login" element={<p>login page</p>} />
        <Route path="/dashboard" element={<ProtectedRoute><p>dashboard page</p></ProtectedRoute>} />
        <Route path="/staff" element={<ProtectedRoute roles={['SUPER_ADMIN', 'ADMIN']}><p>staff admin page</p></ProtectedRoute>} />
      </Routes>
    )
  }
  it('sends a flagged account to the change-password page from ANY protected route, role-allowed or not', () => {
    signInAs(makeUser({ role: 'ADMIN', mustChangePassword: true }))
    const { unmount } = renderWithRouter(<Shell />, '/dashboard')
    expect(screen.getByText('choose a new password page')).toBeInTheDocument()
    unmount()
    renderWithRouter(<Shell />, '/staff')
    expect(screen.getByText('choose a new password page')).toBeInTheDocument()
    expect(screen.queryByText('staff admin page')).not.toBeInTheDocument()
  })
  it('lets the same account straight in once the flag is cleared', () => {
    signInAs(makeUser({ role: 'ADMIN', mustChangePassword: false }))
    renderWithRouter(<Shell />, '/dashboard')
    expect(screen.getByText('dashboard page')).toBeInTheDocument()
  })
})
