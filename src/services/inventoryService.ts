import type { InventoryItem } from '@/types'
import { INVENTORY, inventoryStatus, generateInventoryForMess } from '@/data/mockInventory'
import { withDelay } from './api'

let inventory: InventoryItem[] = [...INVENTORY]

export async function listInventory(messId: string): Promise<InventoryItem[]> {
  return withDelay(inventory.filter((i) => i.messId === messId), 250)
}

export async function addInventoryItem(item: Omit<InventoryItem, 'id' | 'updatedAt'>): Promise<InventoryItem> {
  const record: InventoryItem = { ...item, id: `INV-${Date.now()}`, updatedAt: new Date().toISOString().slice(0, 10) }
  inventory = [record, ...inventory]
  return withDelay(record, 300)
}

export async function updateInventoryItem(id: string, patch: Partial<InventoryItem>): Promise<InventoryItem | null> {
  let updated: InventoryItem | null = null
  inventory = inventory.map((i) => {
    if (i.id !== id) return i
    updated = { ...i, ...patch, updatedAt: new Date().toISOString().slice(0, 10) }
    return updated
  })
  return withDelay(updated, 300)
}

export async function deleteInventoryItem(id: string): Promise<boolean> {
  const before = inventory.length
  inventory = inventory.filter((i) => i.id !== id)
  return withDelay(inventory.length < before, 250)
}

export function alertsFor(items: InventoryItem[]) {
  return items
    .map((i) => ({ item: i, status: inventoryStatus(i) }))
    .filter((x) => x.status !== 'ok')
    .sort((a, b) => {
      const order = { expired: 0, expiring: 1, low: 2, overstocked: 3 }
      return order[a.status as keyof typeof order] - order[b.status as keyof typeof order]
    })
}

export function forecastConsumption(item: InventoryItem, weeklyConsumption: number) {
  const recommendedPurchase = Math.max(0, weeklyConsumption * 1.1 - (item.quantity - item.minStock))
  const stockoutDays = weeklyConsumption > 0 ? Math.round((item.quantity / weeklyConsumption) * 7) : 999
  return {
    weeklyConsumption,
    recommendedPurchase: Math.round(recommendedPurchase),
    stockoutDays,
  }
}

/** Seeds a brand-new mess with a full, independent stock room. No-op if it already has one. */
export function ensureInventoryForMess(messId: string) {
  if (inventory.some((i) => i.messId === messId)) return
  inventory = [...inventory, ...generateInventoryForMess(messId)]
}

export { inventoryStatus }
