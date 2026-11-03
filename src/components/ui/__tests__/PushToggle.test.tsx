import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/services/pushService', () => ({
  pushSupport: vi.fn(),
  permission: vi.fn(),
  isSubscribedHere: vi.fn(),
  enablePush: vi.fn(),
  disablePush: vi.fn(),
  sendTest: vi.fn(),
}))
import * as push from '@/services/pushService'
import { PushToggle } from '../PushToggle'

const m = vi.mocked(push)
const ui = () => render(<PushToggle title="Notify this device" description="A push notification each time you're checked in." />)

beforeEach(() => {
  vi.clearAllMocks()
  m.pushSupport.mockReturnValue({ supported: true })
  m.permission.mockReturnValue('default')
  m.isSubscribedHere.mockResolvedValue(false)
})

describe('PushToggle — every state a person can be in', () => {
  it('off: offers to turn notifications on, and asks permission only when tapped', async () => {
    m.enablePush.mockResolvedValue(undefined)
    ui()
    const btn = await screen.findByRole('button', { name: /turn on notifications/i })
    expect(m.enablePush).not.toHaveBeenCalled() // no surprise permission prompt on page load
    m.isSubscribedHere.mockResolvedValue(true)
    await userEvent.setup().click(btn)
    expect(m.enablePush).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/^on for this device$/i)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/notifications are on for this device/i)
  })

  it('on: can send a test and can turn off', async () => {
    m.isSubscribedHere.mockResolvedValue(true)
    m.sendTest.mockResolvedValue(undefined)
    m.disablePush.mockResolvedValue(undefined)
    ui()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /send a test/i }))
    expect(m.sendTest).toHaveBeenCalled()
    expect(await screen.findByText(/test sent/i)).toBeInTheDocument()
    m.isSubscribedHere.mockResolvedValue(false)
    await user.click(screen.getByRole('button', { name: /^turn off$/i }))
    await waitFor(() => expect(m.disablePush).toHaveBeenCalled())
    expect(await screen.findByRole('button', { name: /turn on notifications/i })).toBeInTheDocument()
  })

  it('blocked in the browser: explains how to unblock and offers no button that cannot work', async () => {
    m.permission.mockReturnValue('denied')
    ui()
    expect(await screen.findByRole('note')).toHaveTextContent(/blocked for this site.*site settings/i)
    expect(screen.queryByRole('button', { name: /turn on notifications/i })).not.toBeInTheDocument()
    expect(m.isSubscribedHere).not.toHaveBeenCalled()
  })

  it('not supported (e.g. iPhone not added to the Home Screen): shows the reason instead of a dead button', async () => {
    m.pushSupport.mockReturnValue({ supported: false, reason: 'On iPhone and iPad, first add this site to your Home Screen (Share → Add to Home Screen).' })
    ui()
    expect(await screen.findByRole('note')).toHaveTextContent(/add this site to your home screen/i)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it("shows the reason when turning on fails (e.g. the server's device limit) and stays off", async () => {
    m.enablePush.mockRejectedValue(new Error('You already get notifications on 5 devices — turn them off on one of those first.'))
    ui()
    await userEvent.setup().click(await screen.findByRole('button', { name: /turn on notifications/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/already get notifications on 5 devices/i)
    expect(screen.getByRole('button', { name: /turn on notifications/i })).toBeInTheDocument()
  })

  it('a failed test notification says why', async () => {
    m.isSubscribedHere.mockResolvedValue(true)
    m.sendTest.mockRejectedValue(new Error('The notification could not be delivered to your device — turn notifications off and on again.'))
    ui()
    await userEvent.setup().click(await screen.findByRole('button', { name: /send a test/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be delivered/i)
  })
})
