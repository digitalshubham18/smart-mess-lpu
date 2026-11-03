import type { PurchaseOrder, Supplier } from '@/types'
import { SUPPLIERS } from '@/data/mockSuppliers'
import { PURCHASE_ORDERS } from '@/data/mockPurchaseOrders'
import { withDelay } from './api'

let suppliers: Supplier[] = [...SUPPLIERS]
let orders: PurchaseOrder[] = [...PURCHASE_ORDERS]

export async function listSuppliers(): Promise<Supplier[]> {
  return withDelay([...suppliers], 200)
}

export async function addSupplier(input: Omit<Supplier, 'id' | 'itemsSupplied'>): Promise<Supplier> {
  const record: Supplier = { ...input, id: `SUP-${Date.now()}`, itemsSupplied: [] }
  suppliers = [record, ...suppliers]
  return withDelay(record, 300)
}

export async function listPurchaseOrders(messId: string): Promise<PurchaseOrder[]> {
  return withDelay(orders.filter((o) => o.messId === messId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)), 250)
}

export async function updatePOStatus(id: string, status: PurchaseOrder['status']): Promise<PurchaseOrder | null> {
  let updated: PurchaseOrder | null = null
  orders = orders.map((o) => {
    if (o.id !== id) return o
    updated = { ...o, status }
    return updated
  })
  return withDelay(updated, 250)
}

export async function createPurchaseOrder(input: Omit<PurchaseOrder, 'id' | 'poNumber' | 'createdAt'>): Promise<PurchaseOrder> {
  const record: PurchaseOrder = { ...input, id: `PO-${Date.now()}`, poNumber: `PO-2026-${1000 + orders.length}`, createdAt: new Date().toISOString().slice(0, 10) }
  orders = [record, ...orders]
  return withDelay(record, 300)
}
