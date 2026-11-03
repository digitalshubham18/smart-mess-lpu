import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../api', async (orig) => {
  const actual = await orig<typeof import('../api')>()
  return { ...actual, api: { put: vi.fn(), get: vi.fn(), post: vi.fn() } }
})
import { api } from '../api'
import { setIntention, getIntention } from '../mealService'

const put = api.put as unknown as ReturnType<typeof vi.fn>
beforeEach(() => put.mockReset())

describe('setIntention — the server is the record', () => {
  it('writes to the server first, then local state', async () => {
    put.mockResolvedValueOnce({ data: {} })
    await setIntention('21000999', '2099-01-01', 'lunch', 'will_eat')
    expect(put).toHaveBeenCalledWith('/intentions/21000999', { date: '2099-01-01', meal: 'lunch', status: 'will_eat' })
    expect((await getIntention('21000999', '2099-01-01', 'lunch'))?.status).toBe('will_eat')
  })

  it('when the server refuses (past the 2:00 AM cutoff) it throws the reason and does NOT change local state', async () => {
    put.mockRejectedValueOnce({ response: { status: 403, data: { error: 'Marking for that day closed at 2:00 AM — submit a change request instead.' } } })
    await expect(setIntention('21000998', '2099-01-02', 'dinner', 'will_not')).rejects.toThrow(/closed at 2:00 AM/)
    expect(await getIntention('21000998', '2099-01-02', 'dinner')).toBeFalsy()
  })

  it('an unreachable server is reported, not swallowed', async () => {
    put.mockRejectedValueOnce(new Error('Network Error'))
    await expect(setIntention('21000997', '2099-01-03', 'dinner', 'will_eat')).rejects.toThrow(/could not save your choice/i)
  })

  it('a demo-only student the server has never heard of (404) still works locally', async () => {
    put.mockRejectedValueOnce({ response: { status: 404, data: { error: 'Student not found.' } } })
    await expect(setIntention('S-demo', '2099-01-04', 'lunch', 'will_eat')).resolves.toMatchObject({ status: 'will_eat' })
  })
})
