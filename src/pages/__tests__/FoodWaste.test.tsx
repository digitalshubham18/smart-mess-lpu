import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithRouter, signInAs, signOut, makeUser } from '@/test/utils'
import { TODAY_ISO } from '@/utils/dateUtils'

vi.mock('@/services/wasteLogService', async (orig) => ({ ...(await orig<typeof import('@/services/wasteLogService')>()), listWasteLog: vi.fn(), saveWasteEntry: vi.fn() }))
import * as svc from '@/services/wasteLogService'
import FoodWaste from '../FoodWaste'

const entry = (over = {}) => ({ id: 'w1', messId: 'MESS-BH2', date: TODAY_ISO, meal: 'lunch', preparedKg: 120, consumedKg: 105, wasteKg: 15, wastePct: 12.5, reason: 'Plate waste', note: '', recordedBy: 'Asha Rao', recordedAt: '', ...over }) as svc.WasteLogEntry
const log = (entries: svc.WasteLogEntry[]): svc.WasteLog => ({ entries, totals: { entries: entries.length, preparedKg: entries.reduce((t, e) => t + e.preparedKg, 0), wasteKg: entries.reduce((t, e) => t + e.wasteKg, 0), wastePct: 12.5 } })

beforeEach(() => { vi.clearAllMocks(); signInAs(makeUser({ role: 'KITCHEN_STAFF', hostelId: 'BH2' })) })
afterEach(signOut)

describe('Food Waste — the real, server-recorded log', () => {
  it('says its numbers come from the server (no demo banner) and shows the 14-day totals', async () => {
    vi.mocked(svc.listWasteLog).mockResolvedValue(log([entry()]))
    renderWithRouter(<FoodWaste />)
    expect(await screen.findByText(/recorded by the server/i)).toBeInTheDocument()
    expect(screen.queryByTestId('demo-banner')).not.toBeInTheDocument()
    const totals = await screen.findByTestId('waste-totals')
    expect(totals).toHaveTextContent('120')
    expect(totals).toHaveTextContent('12.5%')
  })

  it("shows today's entry for the meal, and a prompt for meals with none", async () => {
    vi.mocked(svc.listWasteLog).mockResolvedValue(log([entry()]))
    renderWithRouter(<FoodWaste />)
    expect(await screen.findByTestId('waste-lunch')).toHaveTextContent(/plate waste/i)
    expect(screen.getAllByText(/no entry recorded/i).length).toBe(3)
  })

  it('recording a new entry sends what was typed, shows the computed waste, then refreshes', async () => {
    vi.mocked(svc.listWasteLog).mockResolvedValue(log([]))
    vi.mocked(svc.saveWasteEntry).mockResolvedValue(entry())
    renderWithRouter(<FoodWaste />)
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Prepared (kg)'), '80')
    await user.type(screen.getByLabelText('Eaten (kg)'), '70.5')
    expect(screen.getByTestId('waste-preview')).toHaveTextContent(/9\.5 kg.*11\.9%/)
    await user.selectOptions(screen.getByLabelText('Reason'), 'Spoilage')
    await user.click(screen.getByRole('button', { name: /save entry/i }))
    await waitFor(() => expect(svc.saveWasteEntry).toHaveBeenCalledWith({ messId: 'MESS-BH2', date: TODAY_ISO, meal: 'lunch', preparedKg: 80, consumedKg: 70.5, reason: 'Spoilage' }))
    expect(await screen.findByRole('status')).toHaveTextContent(/recorded lunch waste/i)
    expect(svc.listWasteLog).toHaveBeenCalledTimes(2)
  })

  it('refuses eaten > prepared in the form, so nothing is sent', async () => {
    vi.mocked(svc.listWasteLog).mockResolvedValue(log([]))
    renderWithRouter(<FoodWaste />)
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Prepared (kg)'), '10')
    await user.type(screen.getByLabelText('Eaten (kg)'), '12')
    expect(screen.getByRole('alert')).toHaveTextContent(/can't be more than prepared/i)
    expect(screen.getByRole('button', { name: /save entry/i })).toBeDisabled()
  })

  it('choosing a meal that already has an entry loads it for correction', async () => {
    vi.mocked(svc.listWasteLog).mockResolvedValue(log([entry()]))
    vi.mocked(svc.saveWasteEntry).mockResolvedValue(entry({ consumedKg: 110, wasteKg: 10 }))
    renderWithRouter(<FoodWaste />)
    const user = userEvent.setup()
    expect(await screen.findByRole('button', { name: /save correction/i })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Prepared (kg)')).toHaveValue(120))
    const eaten = screen.getByLabelText('Eaten (kg)')
    await user.clear(eaten); await user.type(eaten, '110')
    await user.click(screen.getByRole('button', { name: /save correction/i }))
    await waitFor(() => expect(svc.saveWasteEntry).toHaveBeenCalledWith(expect.objectContaining({ consumedKg: 110, preparedKg: 120 })))
    expect(await screen.findByRole('status')).toHaveTextContent(/corrected lunch waste/i)
  })

  it("shows the server's reason when saving or loading fails", async () => {
    vi.mocked(svc.listWasteLog).mockRejectedValue(new Error('You can only record waste for your own mess.'))
    renderWithRouter(<FoodWaste />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/own mess/i)
  })
})
