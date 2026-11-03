import { api } from './api'

/** REAL stock (server/src/routes/inventory.js): a balance that is always the sum of recorded movements. */
export const UNITS = ['kg', 'g', 'l', 'ml', 'pcs', 'packs'] as const
export const CATEGORIES = ['Grains', 'Pulses', 'Vegetables', 'Dairy', 'Spices', 'Oil & fats', 'Fuel', 'Other'] as const
export type MoveKind = 'receive' | 'use' | 'waste' | 'adjust'
export interface StockItem { id: string; messId: string; name: string; unit: string; category: string; quantity: number; reorderLevel: number; low: boolean; archived: boolean }
export interface StockMove { id: string; kind: MoveKind; delta: number; balance: number; note: string | null; byName: string; at: string }

function reason(e: unknown, fallback: string): string {
  const d = (e as { response?: { data?: { error?: string; details?: { message?: string }[] } } })?.response?.data
  return d?.details?.[0]?.message ?? d?.error ?? fallback
}
export async function listStock(messId: string): Promise<{ items: StockItem[]; lowStock: number }> {
  try { return (await api.get<{ items: StockItem[]; lowStock: number }>('/inventory', { params: { messId } })).data } catch (e) { throw new Error(reason(e, 'Could not load stock.')) }
}
export async function addItem(input: { messId: string; name: string; unit: string; category: string; quantity: number; reorderLevel: number }): Promise<StockItem> {
  try { return (await api.post<StockItem>('/inventory', input)).data } catch (e) { throw new Error(reason(e, 'Could not add that item.')) }
}
export async function moveStock(id: string, kind: MoveKind, qty: number, note?: string): Promise<StockItem> {
  try { return (await api.post<StockItem>(`/inventory/${encodeURIComponent(id)}/move`, { kind, qty, ...(note ? { note } : {}) })).data } catch (e) { throw new Error(reason(e, 'Could not record that.')) }
}
export async function setReorderLevel(id: string, reorderLevel: number): Promise<StockItem> {
  try { return (await api.patch<StockItem>(`/inventory/${encodeURIComponent(id)}`, { reorderLevel })).data } catch (e) { throw new Error(reason(e, 'Could not save that.')) }
}
export async function archiveItem(id: string): Promise<void> {
  try { await api.patch(`/inventory/${encodeURIComponent(id)}`, { archived: true }) } catch (e) { throw new Error(reason(e, 'Could not remove that item.')) }
}
export async function listMoves(id: string): Promise<StockMove[]> {
  try { return (await api.get<StockMove[]>(`/inventory/${encodeURIComponent(id)}/moves`)).data } catch (e) { throw new Error(reason(e, 'Could not load the history.')) }
}
