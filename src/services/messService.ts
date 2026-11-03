import type { Mess } from '@/types'
import { MESSES, createMess, updateMess as updateMessRecord, deleteMess as deleteMessRecord, unassignedHostels } from '@/data/mockMesses'
import { ensureOperationsForMess, regenerateOperationsForMess } from '@/data/mockOperations'
import { regenerateWasteDetailForMess } from '@/data/mockWasteDetail'
import { ensureInventoryForMess } from './inventoryService'
import { ensureExpensesForMess, regenerateExpensesForMess } from './financeService'
import { ensureSettingsForMess } from './messSettingsService'
import { withDelay } from './api'

export async function listMesses(): Promise<Mess[]> {
  return withDelay([...MESSES], 150)
}

export function availableHostels() {
  return unassignedHostels()
}

export async function addMess(input: { name: string; hostelIds: string[]; seatingCapacity: number; location: string }): Promise<Mess> {
  const { mess, affectedMessIds } = createMess(input)
  // The new mess gets a full, independent 90-day forecast history + stock room + expense ledger immediately.
  ensureOperationsForMess(mess.id)
  ensureInventoryForMess(mess.id)
  ensureExpensesForMess(mess.id)
  ensureSettingsForMess(mess.id)
  regenerateWasteDetailForMess(mess.id)
  // Any OTHER mess that lost a hostel to this one has a smaller student base now —
  // regenerate its history so demand figures don't stay stale.
  affectedMessIds
    .filter((id) => id !== mess.id)
    .forEach((id) => {
      regenerateOperationsForMess(id)
      regenerateExpensesForMess(id)
      regenerateWasteDetailForMess(id)
    })
  return withDelay(mess, 400)
}

export async function editMess(id: string, patch: Partial<Omit<Mess, 'id'>>): Promise<Mess | null> {
  const result = updateMessRecord(id, patch)
  if (!result) return withDelay(null, 300)
  // Regenerate every mess whose hostel roster changed (the edited mess, and whichever
  // mess(es) it took hostels away from) so history reflects the new student totals.
  result.affectedMessIds.forEach((messId) => {
    regenerateOperationsForMess(messId)
    regenerateExpensesForMess(messId)
    regenerateWasteDetailForMess(messId)
  })
  return withDelay(result.mess, 300)
}

export async function removeMess(id: string): Promise<boolean> {
  const ok = deleteMessRecord(id)
  return withDelay(ok, 250)
}
