import type { MenuItem } from '@/types'
import { MENU_ITEMS } from '@/data/mockMenus'
import { withDelay } from './api'

let items: MenuItem[] = [...MENU_ITEMS]

export async function listMenuItems(): Promise<MenuItem[]> {
  return withDelay([...items], 200)
}

export async function addMenuItem(input: Omit<MenuItem, 'id' | 'popularity'>): Promise<MenuItem> {
  const record: MenuItem = { ...input, id: `MI-${Date.now()}`, popularity: 1 }
  items = [record, ...items]
  return withDelay(record, 300)
}

export async function updateMenuItem(id: string, patch: Partial<MenuItem>): Promise<MenuItem | null> {
  let updated: MenuItem | null = null
  items = items.map((i) => {
    if (i.id !== id) return i
    updated = { ...i, ...patch }
    return updated
  })
  return withDelay(updated, 250)
}

export async function deleteMenuItem(id: string): Promise<boolean> {
  const before = items.length
  items = items.filter((i) => i.id !== id)
  return withDelay(items.length < before, 200)
}
