import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CredentialsModal } from '../CredentialsModal'

const creds = [
  { name: 'Asha Rao', uid: '10101', password: 'Zk7-mQ2x', role: 'Kitchen Staff' },
  { name: 'Dev "DJ" Kumar', uid: '10102', password: 'Pw9-aa11', role: 'Mess Manager' },
]

describe('CredentialsModal', () => {
  it('shows each UID and temporary password, and says they are shown only once', () => {
    render(<CredentialsModal open onClose={() => {}} title="New team sign-in details" intro="Share these:" credentials={creds} />)
    expect(screen.getByText('Zk7-mQ2x')).toBeInTheDocument()
    expect(screen.getByText('10102')).toBeInTheDocument()
    expect(screen.getByText(/only time these passwords are shown/i)).toBeInTheDocument()
  })
  it('offers a CSV download only when there are several accounts, with quotes escaped', async () => {
    const { rerender } = render(<CredentialsModal open onClose={() => {}} title="t" intro="i" credentials={[creds[0]]} />)
    expect(screen.queryByRole('button', { name: /download csv/i })).not.toBeInTheDocument()
    rerender(<CredentialsModal open onClose={() => {}} title="t" intro="i" credentials={creds} />)
    let blob: Blob | undefined
    URL.createObjectURL = vi.fn((b: Blob) => { blob = b; return 'blob:x' })
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await userEvent.setup().click(screen.getByRole('button', { name: /download csv/i }))
    const text = await blob!.text()
    expect(text.split('\n')[0]).toBe('name,uid,role,temporary_password')
    expect(text).toContain('"Dev ""DJ"" Kumar","10102","Mess Manager","Pw9-aa11"')
  })
  it('calls onClose from Done', async () => {
    const onClose = vi.fn()
    render(<CredentialsModal open onClose={onClose} title="t" intro="i" credentials={[creds[0]]} />)
    await userEvent.setup().click(screen.getByRole('button', { name: /^done$/i }))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('CredentialsModal — email delivery warning', () => {
  it('tells the Admin to pass the details on themselves when the courtesy email could not be sent', () => {
    render(<CredentialsModal open onClose={() => {}} title="t" intro="i" credentials={[creds[0]]} emailFailed />)
    expect(screen.getByRole('alert')).toHaveTextContent(/could not be sent.*pass them on yourself/i)
  })
  it('shows no warning when the email went out', () => {
    render(<CredentialsModal open onClose={() => {}} title="t" intro="i" credentials={[creds[0]]} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
