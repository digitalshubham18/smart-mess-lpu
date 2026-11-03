import type { FoodWaste, WasteReason } from '@/types'
import { pick, rnd } from '@/lib/rng'
import { MENU_ITEMS } from './mockMenus'
import { OPERATIONS, WASTE_REASONS } from './mockOperations'
import { MESSES } from './mockMesses'

let seq = 1

function generateWasteDetailForMess(messId: string): FoodWaste[] {
  const records: FoodWaste[] = []
  const recent = OPERATIONS.filter((r) => r.messId === messId && !r.isFuture).slice(-84) // last 21 days x 4 meals

  recent.forEach((r) => {
    if (r.wasteKg == null || r.preparedKg == null || r.consumedKg == null) return
    const itemCount = 2 + Math.floor(rnd() * 2)
    const items = pick_n(MENU_ITEMS, itemCount)
    const wasteShares = splitRandom(items.length, r.wasteKg)
    const preparedShares = splitRandom(items.length, r.preparedKg)
    const consumedShares = splitRandom(items.length, r.consumedKg)

    items.forEach((item, idx) => {
      const wasteKg = wasteShares[idx]
      const preparedKg = Math.max(preparedShares[idx], wasteKg)
      const consumedKg = Math.max(0, consumedShares[idx])
      records.push({
        id: `FW-${seq++}`,
        messId,
        date: r.date,
        meal: r.meal,
        itemId: item.id,
        preparedKg: Math.round(preparedKg * 10) / 10,
        servedKg: Math.round((preparedKg - preparedKg * 0.02) * 10) / 10,
        consumedKg: Math.round(consumedKg * 10) / 10,
        leftoverKg: Math.round(wasteKg * 10) / 10,
        wasteKg: Math.round(wasteKg * 10) / 10,
        reason: pick(WASTE_REASONS) as WasteReason,
        costPerKg: item.costPerKg,
      })
    })
  })
  return records
}

export let WASTE_DETAIL: FoodWaste[] = MESSES.flatMap((m) => generateWasteDetailForMess(m.id))

/** Regenerates a mess's item-level waste breakdown to match its (now current) operations data. */
export function regenerateWasteDetailForMess(messId: string) {
  WASTE_DETAIL = [...WASTE_DETAIL.filter((w) => w.messId !== messId), ...generateWasteDetailForMess(messId)]
}

function pick_n<T>(arr: T[], n: number): T[] {
  const copy = [...arr]
  const out: T[] = []
  for (let i = 0; i < n && copy.length; i++) {
    const idx = Math.floor(rnd() * copy.length)
    out.push(copy[idx])
    copy.splice(idx, 1)
  }
  return out
}

function splitRandom(parts: number, total: number): number[] {
  if (parts <= 1) return [total]
  const cuts = Array.from({ length: parts - 1 }, () => rnd()).sort((a, b) => a - b)
  const shares: number[] = []
  let prev = 0
  cuts.forEach((c) => {
    shares.push((c - prev) * total)
    prev = c
  })
  shares.push((1 - prev) * total)
  return shares
}

export function topWasteContributors(messId: string, limit = 5): { itemId: string; name: string; wasteKg: number }[] {
  const totals: Record<string, number> = {}
  WASTE_DETAIL.filter((w) => w.messId === messId).forEach((w) => {
    totals[w.itemId] = (totals[w.itemId] ?? 0) + w.wasteKg
  })
  const named = Object.entries(totals).map(([itemId, wasteKg]) => ({
    itemId,
    name: MENU_ITEMS.find((m) => m.id === itemId)?.name ?? itemId,
    wasteKg: Math.round(wasteKg * 10) / 10,
  }))
  return named.sort((a, b) => b.wasteKg - a.wasteKg).slice(0, limit)
}

export function wasteByReason(messId: string): { reason: string; wasteKg: number }[] {
  const totals: Record<string, number> = {}
  WASTE_DETAIL.filter((w) => w.messId === messId).forEach((w) => {
    totals[w.reason] = (totals[w.reason] ?? 0) + w.wasteKg
  })
  return Object.entries(totals)
    .map(([reason, wasteKg]) => ({ reason, wasteKg: Math.round(wasteKg * 10) / 10 }))
    .sort((a, b) => b.wasteKg - a.wasteKg)
}
