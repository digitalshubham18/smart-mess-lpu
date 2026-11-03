import { useCallback, useEffect, useState } from 'react'
import type { InventoryItem } from '@/types'
import * as inventoryService from '@/services/inventoryService'
import { useMessStore } from '@/store/useMessStore'

export function useInventory() {
  const messId = useMessStore((s) => s.currentMessId)
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(() => {
    setLoading(true)
    inventoryService.listInventory(messId).then((data) => {
      setItems(data)
      setLoading(false)
    })
  }, [messId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const alerts = inventoryService.alertsFor(items)

  async function add(input: Omit<InventoryItem, 'id' | 'updatedAt'>) {
    await inventoryService.addInventoryItem(input)
    refresh()
  }
  async function update(id: string, patch: Partial<InventoryItem>) {
    await inventoryService.updateInventoryItem(id, patch)
    refresh()
  }
  async function remove(id: string) {
    await inventoryService.deleteInventoryItem(id)
    refresh()
  }

  return { items, loading, alerts, add, update, remove, refresh, messId }
}
