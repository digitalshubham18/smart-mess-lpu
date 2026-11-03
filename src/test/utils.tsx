import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { User } from '@/types'
import { useAuthStore } from '@/store/useAuthStore'
import { useMessStore } from '@/store/useMessStore'

export function renderWithRouter(ui: ReactElement, route = '/') {
  return render(<MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>)
}

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: '10005', name: 'Test Staff', email: 'staff@example.com', role: 'KITCHEN_STAFF',
    avatarColor: '#3554D1', hostelId: 'BH2', createdAt: '2026-01-01T00:00:00Z', ...overrides,
  } as User
}

/** Puts the real auth + mess stores into a signed-in state, exactly as a successful login would. */
export function signInAs(user: User) {
  useAuthStore.setState({ user, isLoading: false, error: null })
  useMessStore.getState().syncToUser(user)
}

export function signOut() {
  useAuthStore.setState({ user: null, isLoading: false, error: null, sessionExpiredMessage: null })
}
