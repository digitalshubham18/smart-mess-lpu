import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithRouter, signInAs, signOut, makeUser } from '@/test/utils'

vi.mock('@/services/feedbackService', async (o) => ({ ...(await o<typeof import('@/services/feedbackService')>()), submitFeedback: vi.fn(), listMine: vi.fn(), listForMess: vi.fn(), respond: vi.fn() }))
vi.mock('@/services/inventoryStockService', async (o) => ({ ...(await o<typeof import('@/services/inventoryStockService')>()), listStock: vi.fn(), addItem: vi.fn(), moveStock: vi.fn(), listMoves: vi.fn(), setReorderLevel: vi.fn(), archiveItem: vi.fn() }))
vi.mock('@/services/errorsService', () => ({ listErrors: vi.fn(), dismissError: vi.fn() }))
import * as fb from '@/services/feedbackService'
import * as inv from '@/services/inventoryStockService'
import * as errs from '@/services/errorsService'
import Feedback from '../Feedback'
import Inventory from '../Inventory'
import SystemErrors from '../SystemErrors'

afterEach(signOut)
beforeEach(() => { vi.clearAllMocks() })

describe('Feedback — student', () => {
  beforeEach(() => { signInAs(makeUser({ role: 'STUDENT', studentId: '21000012', hostelId: 'BH2' })); vi.mocked(fb.listMine).mockResolvedValue([]) })

  it('says ratings are anonymous and complaints are named', async () => {
    renderWithRouter(<Feedback />)
    expect(await screen.findByText((_, n) => n?.tagName === 'P' && /anonymous.*to the mess staff/i.test(n.textContent ?? ''))).toBeInTheDocument()
    expect(screen.getByText(/complaints are not anonymous/i)).toBeInTheDocument()
  })
  it('a rating needs stars; sending it posts exactly what was chosen', async () => {
    vi.mocked(fb.submitFeedback).mockResolvedValue()
    renderWithRouter(<Feedback />)
    const user = userEvent.setup()
    const send = await screen.findByRole('button', { name: /send rating/i })
    expect(send).toBeDisabled()
    await user.click(screen.getByRole('radio', { name: '4 stars' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Meal' }), 'dinner')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'Quantity')
    await user.click(send)
    await waitFor(() => expect(fb.submitFeedback).toHaveBeenCalledWith(expect.objectContaining({ kind: 'feedback', meal: 'dinner', rating: 4, category: 'Quantity' })))
    expect(await screen.findByRole('status')).toHaveTextContent(/rating was saved/i)
  })
  it('a complaint needs words; the server\'s refusal (5 open) is shown', async () => {
    vi.mocked(fb.submitFeedback).mockRejectedValue(new Error('You already have 5 open complaints.'))
    renderWithRouter(<Feedback />)
    const user = userEvent.setup()
    const send = await screen.findByRole('button', { name: /send complaint/i })
    expect(send).toBeDisabled()
    await user.type(screen.getByLabelText('What went wrong'), 'Rice was undercooked')
    await user.click(send)
    expect(await screen.findByText(/already have 5 open complaints/i)).toBeInTheDocument()
  })
  it('shows what they sent, including the mess\'s reply', async () => {
    vi.mocked(fb.listMine).mockResolvedValue([{ id: 'c1', kind: 'complaint', date: '2026-10-20', meal: 'lunch', rating: null, category: 'Hygiene', comment: 'hair in dal', status: 'resolved', response: 'Sorry — fixed.', respondedAt: '', createdAt: '' }])
    renderWithRouter(<Feedback />)
    const list = await screen.findByTestId('my-feedback')
    expect(list).toHaveTextContent('Resolved')
    expect(list).toHaveTextContent('Reply from the mess: Sorry — fixed.')
  })
})

describe('Feedback — staff', () => {
  const data = { items: [
    { id: 'f1', kind: 'feedback', date: '2026-10-20', meal: 'lunch', rating: 5, category: 'Taste', comment: 'lovely', status: 'open', response: null, respondedAt: null, createdAt: '' },
    { id: 'c1', kind: 'complaint', date: '2026-10-20', meal: 'dinner', rating: null, category: 'Hygiene', comment: 'hair in the dal', status: 'open', response: null, respondedAt: null, createdAt: '', studentName: 'Aarav Sharma', studentRoom: 'B-204' },
  ], summary: { count: 1, avgRating: 5, openComplaints: 1, byMeal: [{ meal: 'lunch', count: 1, avgRating: 5 }, { meal: 'dinner', count: 0, avgRating: null }], byCategory: [{ category: 'Taste', count: 1 }] } } as unknown as Awaited<ReturnType<typeof fb.listForMess>>
  it('a manager sees averages, anonymous comments, and named complaints they can answer', async () => {
    signInAs(makeUser({ role: 'MESS_MANAGER', hostelId: 'BH2' }))
    vi.mocked(fb.listForMess).mockResolvedValue(data); vi.mocked(fb.respond).mockResolvedValue()
    renderWithRouter(<Feedback />)
    expect(await screen.findByTestId('feedback-summary')).toHaveTextContent('5 / 5')
    expect(screen.getByTestId('feedback-by-meal')).toHaveTextContent(/no ratings/i)
    expect(screen.getByText(/lovely/)).toBeInTheDocument()
    const row = screen.getByTestId('complaint-row')
    expect(row).toHaveTextContent('Aarav Sharma · room B-204')
    const user = userEvent.setup()
    await user.type(within(row).getByLabelText(/reply to aarav sharma/i), 'We will look into it')
    await user.click(within(row).getByRole('button', { name: /mark resolved/i }))
    await waitFor(() => expect(fb.respond).toHaveBeenCalledWith('c1', { status: 'resolved', response: 'We will look into it' }))
  })
  it('kitchen staff can read but get no reply controls', async () => {
    signInAs(makeUser({ role: 'KITCHEN_STAFF', hostelId: 'BH2' }))
    vi.mocked(fb.listForMess).mockResolvedValue(data)
    renderWithRouter(<Feedback />)
    await screen.findByTestId('complaint-row')
    expect(screen.queryByRole('button', { name: /mark resolved/i })).not.toBeInTheDocument()
  })
})

describe('Inventory — real stock', () => {
  const item = (o = {}) => ({ id: 'i1', messId: 'MESS-BH2', name: 'Basmati rice', unit: 'kg', category: 'Grains', quantity: 25, reorderLevel: 30, low: true, archived: false, ...o })
  beforeEach(() => { signInAs(makeUser({ role: 'KITCHEN_STAFF', hostelId: 'BH2' })); vi.mocked(inv.listStock).mockResolvedValue({ items: [item(), item({ id: 'i2', name: 'Salt', quantity: 40, reorderLevel: 5, low: false })], lowStock: 1 }); vi.mocked(inv.listMoves).mockResolvedValue([]) })

  it('says it is recorded by the server (not a demo), lists stock, and calls out what is low', async () => {
    renderWithRouter(<Inventory />)
    expect(await screen.findByText(/recorded by the server/i)).toBeInTheDocument()
    expect(screen.queryByTestId('demo-banner')).not.toBeInTheDocument()
    expect(await screen.findByTestId('low-stock')).toHaveTextContent(/1 item at or below.*basmati rice \(25 kg\)/i)
    expect(screen.getByTestId('qty-Basmati rice')).toHaveTextContent('25 kg')
  })
  it('records a movement with the amount and note, and shows the new balance', async () => {
    vi.mocked(inv.moveStock).mockResolvedValue(item({ quantity: 20.5 }))
    renderWithRouter(<Inventory />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /basmati rice details/i }))
    await user.type(await screen.findByLabelText('Amount'), '4.5')
    await user.type(screen.getByLabelText('Note'), 'lunch')
    await user.click(screen.getByRole('button', { name: /^record$/i }))
    await waitFor(() => expect(inv.moveStock).toHaveBeenCalledWith('i1', 'use', 4.5, 'lunch'))
    expect(await screen.findByText('Now 20.5 kg.')).toBeInTheDocument()
  })
  it('shows the server\'s refusal when taking out more than is on the shelf', async () => {
    vi.mocked(inv.moveStock).mockRejectedValue(new Error("Only 25 kg of Basmati rice on the shelf — you can't take out 500."))
    renderWithRouter(<Inventory />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /basmati rice details/i }))
    await user.type(await screen.findByLabelText('Amount'), '500')
    await user.click(screen.getByRole('button', { name: /^record$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/only 25 kg/i)
  })
  it('adds an item; finance can read but has no add form or movement controls', async () => {
    vi.mocked(inv.addItem).mockResolvedValue(item())
    const { unmount } = renderWithRouter(<Inventory />)
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('Item name'), 'Toor dal')
    await user.type(screen.getByLabelText('Opening stock'), '50')
    await user.click(screen.getByRole('button', { name: /add item/i }))
    await waitFor(() => expect(inv.addItem).toHaveBeenCalledWith(expect.objectContaining({ name: 'Toor dal', quantity: 50, unit: 'kg' })))
    unmount()
    signInAs(makeUser({ role: 'FINANCE_MANAGER', hostelId: 'BH2' }))
    renderWithRouter(<Inventory />)
    await user.click(await screen.findByRole('button', { name: /basmati rice details/i }))
    expect(screen.queryByLabelText('Item name')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^record$/i })).not.toBeInTheDocument()
  })
})

describe('System errors (Super Admin)', () => {
  it('lists what broke with counts, shows details on request, and dismisses', async () => {
    signInAs(makeUser({ role: 'SUPER_ADMIN' }))
    vi.mocked(errs.listErrors).mockResolvedValueOnce([{ id: 7, kind: 'client', message: 'x is undefined', stack: 'TypeError: x\n at y', url: '/attendance', count: 12, firstSeen: '', lastSeen: new Date().toISOString() }]).mockResolvedValue([])
    vi.mocked(errs.dismissError).mockResolvedValue()
    renderWithRouter(<SystemErrors />)
    const row = await screen.findByTestId('error-row')
    expect(row).toHaveTextContent('x is undefined')
    expect(row).toHaveTextContent('×12')
    const user = userEvent.setup()
    await user.click(within(row).getByRole('button', { name: /show details/i }))
    expect(row).toHaveTextContent('TypeError: x')
    await user.click(within(row).getByRole('button', { name: /dismiss error 7/i }))
    await waitFor(() => expect(errs.dismissError).toHaveBeenCalledWith(7))
    expect(await screen.findByTestId('no-errors')).toBeInTheDocument()
  })
})
