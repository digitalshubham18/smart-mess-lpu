import { describe, it, expect, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithRouter, signInAs, makeUser } from '@/test/utils'
import { TODAY_ISO } from '@/utils/dateUtils'

import { INVENTORY } from '@/data/mockInventory'
import { PURCHASE_ORDERS } from '@/data/mockPurchaseOrders'
import { CALENDAR_EVENTS } from '@/data/mockEvents'
import CalendarPage from '../Calendar'

// Pin one stock expiry, one supplier delivery and one campus event onto TODAY so the month on screen always contains them.
beforeEach(() => {
  INVENTORY.length = 0
  PURCHASE_ORDERS.length = 0
  CALENDAR_EVENTS.length = 0
  INVENTORY.push({ id: 'I-1', name: 'Fresh Milk', expiryDate: TODAY_ISO } as never)
  PURCHASE_ORDERS.push({ id: 'PO-X', poNumber: 'PO-9001', deliveryDate: TODAY_ISO } as never)
  CALENDAR_EVENTS.push({ id: 'EV-1', title: 'Diwali Break', date: TODAY_ISO, type: 'holiday', demandImpactPct: -40 } as never)
})

describe('Calendar — kitchen operations are staff-only', () => {
  it.each(['STUDENT', 'PARENT'] as const)('a %s sees campus events but NO stock expiries or supplier deliveries', async (role) => {
    signInAs(makeUser({ role, hostelId: 'BH2' }))
    renderWithRouter(<CalendarPage />)
    expect(await screen.findByText('Diwali Break')).toBeInTheDocument()
    expect(screen.queryByText(/expires/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/delivery/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/PO-9001/)).not.toBeInTheDocument()
    expect(screen.getByText(/holidays, exams, festivals and campus events/i)).toBeInTheDocument()
  })

  it('mess staff still see expiries and deliveries alongside events', async () => {
    signInAs(makeUser({ role: 'MESS_MANAGER', hostelId: 'BH2' }))
    renderWithRouter(<CalendarPage />)
    expect(await screen.findByText('Diwali Break')).toBeInTheDocument()
    expect(screen.getByText('Fresh Milk expires')).toBeInTheDocument()
    expect(screen.getByText('PO-9001 delivery')).toBeInTheDocument()
  })
})
