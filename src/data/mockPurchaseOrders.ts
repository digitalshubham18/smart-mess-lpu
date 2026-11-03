import type { PurchaseOrder, POStatus } from '@/types'
import { pick, randInt, randFloat } from '@/lib/rng'
import { addDaysISO, TODAY_ISO } from '@/utils/dateUtils'
import { SUPPLIERS } from './mockSuppliers'
import { INVENTORY } from './mockInventory'
import { MESSES } from './mockMesses'

const STATUSES: POStatus[] = ['Pending', 'Approved', 'Ordered', 'Delivered', 'Delivered', 'Delivered', 'Cancelled']

export const PURCHASE_ORDERS: PurchaseOrder[] = Array.from({ length: 24 }, (_, i) => {
  const supplier = pick(SUPPLIERS)
  const mess = pick(MESSES)
  const messInventory = INVENTORY.filter((inv) => inv.messId === mess.id)
  const itemCount = randInt(1, 4)
  const items = Array.from({ length: itemCount }, () => {
    const inv = pick(messInventory)
    const quantity = randInt(20, 300)
    return { itemId: inv.id, quantity, unit: inv.unit, price: inv.purchasePrice }
  })
  const total = items.reduce((s, it) => s + it.quantity * it.price, 0)
  return {
    id: `PO-${i + 1}`,
    messId: mess.id,
    poNumber: `PO-2026-${String(1000 + i)}`,
    supplierId: supplier.id,
    items,
    total: Math.round(total),
    status: pick(STATUSES),
    deliveryDate: addDaysISO(TODAY_ISO, randInt(-20, 12)),
    createdAt: addDaysISO(TODAY_ISO, randInt(-30, -1)),
  }
})
