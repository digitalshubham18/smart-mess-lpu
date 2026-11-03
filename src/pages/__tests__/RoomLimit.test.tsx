import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/services/hostelService', async (orig) => ({ ...(await orig<typeof import('@/services/hostelService')>()), setRoomCapacity: vi.fn() }))
import * as hostelService from '@/services/hostelService'
import { RoomLimitControl } from '../Hostels'

const setRoomCapacity = vi.mocked(hostelService.setRoomCapacity)
beforeEach(() => vi.clearAllMocks())

describe('RoomLimitControl (beds per room)', () => {
  it('saves a new limit and refreshes', async () => {
    setRoomCapacity.mockResolvedValueOnce()
    const onSaved = vi.fn()
    render(<RoomLimitControl hostelId="BH2" current={null} onSaved={onSaved} />)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/beds per room/i), '3')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(setRoomCapacity).toHaveBeenCalledWith('BH2', 3)
  })
  it('blank means "no limit" (null)', async () => {
    setRoomCapacity.mockResolvedValueOnce()
    render(<RoomLimitControl hostelId="BH2" current={4} onSaved={() => {}} />)
    const user = userEvent.setup()
    await user.clear(screen.getByLabelText(/beds per room/i))
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(setRoomCapacity).toHaveBeenCalledWith('BH2', null)
  })
  it('refuses nonsense client-side, and Save is disabled when nothing changed', async () => {
    render(<RoomLimitControl hostelId="BH2" current={4} onSaved={() => {}} />)
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled()
    const user = userEvent.setup()
    await user.clear(screen.getByLabelText(/beds per room/i))
    await user.type(screen.getByLabelText(/beds per room/i), '0')
    expect(screen.getByText(/whole number from 1 to 20/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled()
  })
  it('shows the server\'s reason when existing rooms already exceed the limit', async () => {
    setRoomCapacity.mockRejectedValueOnce(new Error('3 rooms have more than 2 students already — e.g. CRAM-1 (3). Move them first.'))
    render(<RoomLimitControl hostelId="BH4" current={null} onSaved={() => {}} />)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText(/beds per room/i), '2')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/CRAM-1 \(3\)/)
  })
})
