import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithRouter, signInAs, signOut, makeUser } from '@/test/utils'

// Screens whose numbers are not recorded by the server must SAY so, up front.
vi.mock('recharts', async (orig) => { const a = await orig<typeof import('recharts')>(); return { ...a, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div> } })
import Finance from '../Finance'
import Sustainability from '../Sustainability'
import WasteAnalytics from '../WasteAnalytics'
import Notifications from '../Notifications'
import { DemoBanner } from '@/components/ui/DemoBanner'
import { Sidebar } from '@/components/layout/Sidebar'

afterEach(signOut)

describe('demo screens are labelled', () => {
  it.each([
    ['Finance', Finance], ['Sustainability', Sustainability], ['Waste Analytics', WasteAnalytics],
  ])('%s opens with a "demo data" notice', (_n, Page) => {
    signInAs(makeUser({ role: 'SUPER_ADMIN' }))
    renderWithRouter(<Page />)
    expect(screen.getAllByTestId('demo-banner')[0]).toHaveTextContent(/demo data — not recorded by the server/i)
  })

  it('Notifications says it only lives in this browser tab', () => {
    signInAs(makeUser({ role: 'SUPER_ADMIN' }))
    renderWithRouter(<Notifications />)
    expect(screen.getAllByTestId('demo-banner').some((b) => /not delivered to anyone/i.test(b.textContent ?? ''))).toBe(true)
  })

  it('the banner has a role, so assistive tech announces it, and accepts custom wording', () => {
    renderWithRouter(<DemoBanner what="Custom words." detail="use the CSV." />)
    expect(screen.getByRole('note')).toHaveTextContent(/custom words\. don't use it for decisions — use the csv\./i)
  })

  it('the sidebar tags demo screens with "demo" and leaves real ones untagged', () => {
    signInAs(makeUser({ role: 'SUPER_ADMIN' }))
    renderWithRouter(<Sidebar role="SUPER_ADMIN" mobileOpen={false} onCloseMobile={() => {}} />)
    const link = (name: RegExp) => screen.getByRole('link', { name })
    expect(link(/^Finance/)).toHaveTextContent(/demo/i)
    expect(link(/^Inventory Forecast/)).toHaveTextContent(/demo/i)
    // built on the server now, so no tag
    expect(link(/^Inventory$/)).not.toHaveTextContent(/demo/i)
    expect(link(/^Feedback/)).not.toHaveTextContent(/demo/i)
    expect(link(/^Attendance/)).not.toHaveTextContent(/demo/i)
    expect(link(/^Students/)).not.toHaveTextContent(/demo/i)
  })
})
