import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/services/wasteLogService', async (o) => ({ ...(await o<typeof import('@/services/wasteLogService')>()), getWasteSummary: vi.fn(), getWasteSuggestions: vi.fn() }))
vi.mock('@/services/attendanceService', () => ({ getDailySummary: vi.fn() }))
import * as w from '@/services/wasteLogService'
import * as att from '@/services/attendanceService'
import { RealWasteSummary } from '../RealWasteSummary'
import { WasteSuggestions } from '../WasteSuggestions'
import { DailySummaryCard } from '@/components/attendance/DailySummaryCard'
import { formatKg } from '@/utils/formatters'

beforeEach(() => vi.clearAllMocks())

describe('formatKg', () => {
  it('keeps one decimal where it matters (9.5 kg is not "10 kg") and groups big numbers', () => {
    expect(formatKg(9.5)).toBe('9.5 kg'); expect(formatKg(12)).toBe('12 kg'); expect(formatKg(0.25)).toBe('0.3 kg'); expect(formatKg(12500)).toBe('12,500 kg')
  })
})

describe('RealWasteSummary', () => {
  it('charts the real entries by day, meal and reason', async () => {
    vi.mocked(w.getWasteSummary).mockResolvedValue({
      byDay: [{ date: '2026-10-19', preparedKg: 100, wasteKg: 20, wastePct: 20 }, { date: '2026-10-20', preparedKg: 100, wasteKg: 10, wastePct: 10 }],
      byMeal: [{ meal: 'lunch', entries: 2, preparedKg: 200, wasteKg: 30, wastePct: 15 }], byReason: [{ reason: 'Overproduction', entries: 2, wasteKg: 30 }],
    })
    render(<RealWasteSummary messId="MESS-BH2" />)
    expect(await screen.findByTestId('real-waste')).toHaveTextContent('20 kg · 20%')
    expect(screen.getByTestId('waste-by-meal')).toHaveTextContent('Lunch: 30 kg (15%)')
    expect(screen.getByTestId('waste-by-reason')).toHaveTextContent('Overproduction: 30 kg')
  })
  it('with no entries it says where they come from instead of showing an empty chart', async () => {
    vi.mocked(w.getWasteSummary).mockResolvedValue({ byDay: [], byMeal: [], byReason: [] })
    render(<RealWasteSummary messId="MESS-BH2" />)
    expect(await screen.findByTestId('no-real-waste')).toHaveTextContent(/food waste page/i)
  })
})

describe('WasteSuggestions', () => {
  it('shows the advice drawn from the kitchen\'s own numbers, with how it was worked out', async () => {
    vi.mocked(w.getWasteSuggestions).mockResolvedValue([{ meal: 'lunch', entries: 6, avgWastePct: 14, avgWasteKg: 12, topReason: 'Overproduction', reducePct: 11, advice: 'Lunch averaged 14% waste over 6 recorded meals. Try cooking about 11% less.' }])
    render(<WasteSuggestions messId="MESS-BH2" />)
    const box = await screen.findByTestId('waste-suggestions')
    expect(box).toHaveTextContent('Try cooking about 11% less')
    expect(box).toHaveTextContent(/last 14 days.*3 or more per meal/i)
  })
  it('says nothing at all when there is nothing to say (or it cannot load)', async () => {
    vi.mocked(w.getWasteSuggestions).mockResolvedValue([])
    const { container } = render(<WasteSuggestions messId="MESS-BH2" />)
    await Promise.resolve(); await Promise.resolve()
    expect(container).toBeEmptyDOMElement()
  })
})

describe('DailySummaryCard', () => {
  it('shows today in numbers and says managers also get it as a notification', async () => {
    vi.mocked(att.getDailySummary).mockResolvedValue({ message: { title: 't', body: 'b', lines: ['Checked in: 210', '84% of students marked their meals', 'Waste 12 kg (6%)'] } } as never)
    render(<DailySummaryCard messId="MESS-BH2" />)
    const list = await screen.findByTestId('daily-summary')
    expect(list).toHaveTextContent('Checked in: 210'); expect(list).toHaveTextContent('Waste 12 kg (6%)')
    expect(screen.getByText(/also get this as a notification/i)).toBeInTheDocument()
  })
  it('shows the reason if it cannot load', async () => {
    vi.mocked(att.getDailySummary).mockRejectedValue(new Error('Not your mess.'))
    render(<DailySummaryCard messId="MESS-BH2" />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/not your mess/i)
  })
})
