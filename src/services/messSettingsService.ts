import { MESSES } from '@/data/mockMesses'
import { withDelay } from './api'

export interface MessSettings {
  bufferPct: number
  avgCostPerKg: number
  costs: { Rice: number; Dal: number; Roti: number; Sabzi: number }
  cutoffHour: number
  /** Monthly spend ceiling for this mess (INR). 0/undefined means no cap set. */
  monthlyBudgetCap: number
}

const DEFAULT_SETTINGS: MessSettings = {
  bufferPct: 5,
  avgCostPerKg: 85,
  costs: { Rice: 50, Dal: 110, Roti: 3, Sabzi: 60 },
  cutoffHour: 2,
  monthlyBudgetCap: 250000,
}

const settingsMap = new Map<string, MessSettings>(MESSES.map((m) => [m.id, { ...DEFAULT_SETTINGS, costs: { ...DEFAULT_SETTINGS.costs } }]))

/** Synchronous read used by other services (forecast/waste cost math) that can't await. */
export function getMessSettingsSync(messId: string): MessSettings {
  if (!settingsMap.has(messId)) settingsMap.set(messId, { ...DEFAULT_SETTINGS, costs: { ...DEFAULT_SETTINGS.costs } })
  return settingsMap.get(messId)!
}

export async function getMessSettings(messId: string): Promise<MessSettings> {
  return withDelay(getMessSettingsSync(messId), 150)
}

export async function updateMessSettings(messId: string, patch: Partial<Omit<MessSettings, 'costs'>> & { costs?: Partial<MessSettings['costs']> }): Promise<MessSettings> {
  const current = getMessSettingsSync(messId)
  const updated: MessSettings = {
    ...current,
    ...patch,
    costs: { ...current.costs, ...(patch.costs ?? {}) },
  }
  settingsMap.set(messId, updated)
  return withDelay(updated, 250)
}

/** Seeds default settings for a newly created mess. No-op if it already has some. */
export function ensureSettingsForMess(messId: string) {
  if (!settingsMap.has(messId)) settingsMap.set(messId, { ...DEFAULT_SETTINGS, costs: { ...DEFAULT_SETTINGS.costs } })
}
