import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/services/studentService', () => ({
  getMyPrivacy: vi.fn(), givePhotoConsent: vi.fn(), withdrawPhotoConsent: vi.fn(),
  getPhotoNotice: vi.fn().mockResolvedValue({ version: 'v1', title: 'Your photo at the mess counter', points: [{ heading: 'How long', text: 'Until you leave the mess or withdraw your consent.' }] }),
}))
import * as svc from '@/services/studentService'
import { PhotoPrivacyCard } from '../PhotoPrivacyCard'

const base = { photoOnFile: false, consentGiven: false, consentAt: null, consentMethod: null, consentNoticeVersion: null, currentNoticeVersion: 'v1' } as const
beforeEach(() => vi.clearAllMocks())

describe('PhotoPrivacyCard — the student controls their own photo', () => {
  it('no photo and no consent: says nothing is held and meals are unaffected; offers to agree', async () => {
    vi.mocked(svc.getMyPrivacy).mockResolvedValue({ ...base })
    render(<PhotoPrivacyCard />)
    expect(await screen.findByTestId('privacy-status')).toHaveTextContent(/no photo of you is held.*meals aren't affected/i)
    expect(screen.queryByRole('button', { name: /withdraw/i })).not.toBeInTheDocument()
    vi.mocked(svc.givePhotoConsent).mockResolvedValue({ ...base, consentGiven: true, consentMethod: 'student_app', consentAt: new Date().toISOString() })
    await userEvent.setup().click(screen.getByRole('button', { name: /i agree to the photo notice/i }))
    await waitFor(() => expect(svc.givePhotoConsent).toHaveBeenCalled())
    expect(await screen.findByTestId('privacy-status')).toHaveTextContent(/agreed to the photo notice/i)
  })

  it('the notice can be read before agreeing', async () => {
    vi.mocked(svc.getMyPrivacy).mockResolvedValue({ ...base })
    render(<PhotoPrivacyCard />)
    await userEvent.setup().click(await screen.findByRole('button', { name: /read the privacy notice/i }))
    expect(await screen.findByTestId('photo-notice')).toHaveTextContent(/until you leave the mess/i)
  })

  it('withdrawing asks for confirmation, says the photo is erased immediately, then calls the API and reflects it', async () => {
    vi.mocked(svc.getMyPrivacy).mockResolvedValue({ ...base, photoOnFile: true, consentGiven: true, consentMethod: 'staff_attested', consentAt: '2026-10-01T10:00:00Z' })
    render(<PhotoPrivacyCard />)
    const user = userEvent.setup()
    expect(await screen.findByTestId('privacy-status')).toHaveTextContent(/holds a photo of you.*confirmed by staff/i)
    await user.click(screen.getByRole('button', { name: /withdraw consent/i }))
    const dlg = screen.getByRole('alertdialog', { name: /confirm withdrawing photo consent/i })
    expect(dlg).toHaveTextContent(/erased immediately/i)
    expect(svc.withdrawPhotoConsent).not.toHaveBeenCalled()
    vi.mocked(svc.withdrawPhotoConsent).mockResolvedValue({ ...base })
    await user.click(within(dlg).getByRole('button', { name: /yes, delete it/i }))
    await waitFor(() => expect(svc.withdrawPhotoConsent).toHaveBeenCalled())
    expect(await screen.findByTestId('privacy-status')).toHaveTextContent(/no photo of you is held/i)
  })

  it('shows the reason if something fails', async () => {
    vi.mocked(svc.getMyPrivacy).mockRejectedValue(new Error('Could not load your privacy settings.'))
    render(<PhotoPrivacyCard />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load/i)
  })
})
