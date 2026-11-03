import { STUDENTS } from '@/data/mockStudents'
import { MENU_ITEMS } from '@/data/mockMenus'
import { INVENTORY } from '@/data/mockInventory'
import { SUPPLIERS } from '@/data/mockSuppliers'

export interface SearchResult {
  id: string
  label: string
  category: 'Student' | 'Menu Item' | 'Inventory' | 'Supplier' | 'Report'
  path: string
}

const REPORT_SHORTCUTS: SearchResult[] = [
  { id: 'rep-daily', label: 'Daily Report', category: 'Report', path: '/reports' },
  { id: 'rep-weekly', label: 'Weekly Report', category: 'Report', path: '/reports' },
  { id: 'rep-monthly', label: 'Monthly Report', category: 'Report', path: '/reports' },
]

export function globalSearch(query: string, limit = 8): SearchResult[] {
  const q = query.toLowerCase()
  const results: SearchResult[] = []

  STUDENTS.forEach((s) => {
    if (results.length >= limit) return
    if (s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)) {
      results.push({ id: s.id, label: `${s.name} — ${s.id}`, category: 'Student', path: '/students' })
    }
  })

  MENU_ITEMS.forEach((m) => {
    if (results.length >= limit) return
    if (m.name.toLowerCase().includes(q)) {
      results.push({ id: m.id, label: m.name, category: 'Menu Item', path: '/menu-planner' })
    }
  })

  INVENTORY.forEach((i) => {
    if (results.length >= limit) return
    if (i.name.toLowerCase().includes(q)) {
      results.push({ id: i.id, label: i.name, category: 'Inventory', path: '/inventory' })
    }
  })

  SUPPLIERS.forEach((s) => {
    if (results.length >= limit) return
    if (s.name.toLowerCase().includes(q)) {
      results.push({ id: s.id, label: s.name, category: 'Supplier', path: '/suppliers' })
    }
  })

  REPORT_SHORTCUTS.forEach((r) => {
    if (results.length >= limit) return
    if (r.label.toLowerCase().includes(q)) results.push(r)
  })

  return results.slice(0, limit)
}
