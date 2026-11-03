import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithRouter, signInAs, makeUser } from '@/test/utils'

vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>()
  return { ...actual, api: { post: vi.fn(), get: vi.fn(), interceptors: actual.api.interceptors } }
})
import { api } from '@/services/api'
import Forecast from '../Forecast'
import ForecastAccuracy from '../ForecastAccuracy'

const get = api.get as unknown as ReturnType<typeof vi.fn>
const evidence = { historyDays: 20, backtestDays: 15, eligibleStudents: 112, willEat: 80, willNot: 5, historicalAverage: 70 }

beforeEach(() => {
  get.mockReset()
  signInAs(makeUser({ role: 'MESS_MANAGER', hostelId: 'BH2' }))
})

describe('Forecast — real numbers from the API, never invented ones', () => {
  it('asks the server for each meal and shows the predicted students, measured confidence and evidence', async () => {
    get.mockResolvedValue({ data: { predictedStudents: 90, confidence: 88, basis: 'history+intentions', evidence, method: 'weekday_average' } })
    renderWithRouter(<Forecast />)
    expect((await screen.findAllByText('90')).length).toBe(4)
    expect(screen.getAllByText(/88% confidence \(backtested\)/i).length).toBe(4)
    expect(screen.getAllByText('80 / 112').length).toBe(4)
    expect(get).toHaveBeenCalledTimes(4)
    expect(get.mock.calls[0][0]).toBe('/forecast')
    expect(get.mock.calls[0][1].params).toMatchObject({ messId: 'MESS-BH2', method: 'weekday_average' })
    // kitchen quantities come from predicted × serving size × (1 + buffer)
    expect(screen.getAllByText(/recommended prep/i).length).toBe(4)
  })

  it('with no history it says so and shows NO number, kg or cost', async () => {
    get.mockResolvedValue({ data: { predictedStudents: null, confidence: null, basis: 'none', evidence: { ...evidence, historyDays: 0, willEat: 0 }, method: 'weekday_average', note: 'No check-in history or meal intentions recorded for this mess yet — nothing to forecast from.' } })
    renderWithRouter(<Forecast />)
    expect((await screen.findAllByTestId('no-forecast')).length).toBe(4)
    expect(screen.getAllByText(/nothing to forecast from/i).length).toBe(4)
    expect(screen.queryByText(/recommended prep/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/confidence/i)).not.toBeInTheDocument()
  })

  it('a server failure is shown as an error, not papered over with demo data', async () => {
    get.mockRejectedValue({ response: { data: { error: 'Only mess staff can view demand forecasts.' } } })
    renderWithRouter(<Forecast />)
    expect((await screen.findAllByRole('alert')).length).toBe(4)
    expect(screen.getAllByText(/only mess staff can view demand forecasts/i).length).toBe(4)
  })
})

describe('Forecast Accuracy — the real backtest', () => {
  it('computes accuracy from the rows the server returns', async () => {
    get.mockResolvedValue({ data: { rows: [
      { date: '2026-10-01', meal: 'lunch', predicted: 90, actual: 100 },
      { date: '2026-10-02', meal: 'lunch', predicted: 110, actual: 100 },
    ] } })
    renderWithRouter(<ForecastAccuracy />)
    await waitFor(() => expect(screen.getByText('MAE')).toBeInTheDocument())
    expect(await screen.findByText('90.0%')).toBeInTheDocument() // 100 − MAPE(10%)
    expect(get.mock.calls[0][0]).toBe('/forecast/accuracy')
  })

  it('with no recorded history it says so instead of charting demo data', async () => {
    get.mockResolvedValue({ data: { rows: [] } })
    renderWithRouter(<ForecastAccuracy />)
    expect(await screen.findByTestId('no-accuracy')).toBeInTheDocument()
  })
})
