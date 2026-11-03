import type { InventoryItem } from '@/types'
import { pick, randInt, randFloat } from '@/lib/rng'
import { addDaysISO, TODAY_ISO } from '@/utils/dateUtils'
import { SUPPLIERS } from './mockSuppliers'
import { MESSES } from './mockMesses'

interface Spec { name: string; category: InventoryItem['category']; unit: InventoryItem['unit']; min: number; max: number; price: number }

const SPECS: Spec[] = [
  { name: 'Basmati Rice', category: 'Rice', unit: 'kg', min: 300, max: 1200, price: 62 },
  { name: 'Sona Masoori Rice', category: 'Rice', unit: 'kg', min: 300, max: 1000, price: 48 },
  { name: 'Toor Dal', category: 'Pulses', unit: 'kg', min: 150, max: 600, price: 112 },
  { name: 'Chana Dal', category: 'Pulses', unit: 'kg', min: 120, max: 500, price: 95 },
  { name: 'Rajma', category: 'Pulses', unit: 'kg', min: 80, max: 300, price: 128 },
  { name: 'Moong Dal', category: 'Pulses', unit: 'kg', min: 100, max: 400, price: 105 },
  { name: 'Potatoes', category: 'Vegetables', unit: 'kg', min: 200, max: 800, price: 28 },
  { name: 'Onions', category: 'Vegetables', unit: 'kg', min: 200, max: 800, price: 32 },
  { name: 'Tomatoes', category: 'Vegetables', unit: 'kg', min: 100, max: 400, price: 38 },
  { name: 'Cauliflower', category: 'Vegetables', unit: 'kg', min: 40, max: 200, price: 30 },
  { name: 'Bottle Gourd (Lauki)', category: 'Vegetables', unit: 'kg', min: 30, max: 150, price: 26 },
  { name: 'Okra (Bhindi)', category: 'Vegetables', unit: 'kg', min: 30, max: 150, price: 40 },
  { name: 'Mixed Vegetables', category: 'Vegetables', unit: 'kg', min: 60, max: 250, price: 35 },
  { name: 'Bananas', category: 'Fruits', unit: 'kg', min: 40, max: 150, price: 45 },
  { name: 'Apples', category: 'Fruits', unit: 'kg', min: 30, max: 120, price: 120 },
  { name: 'Seasonal Fruit Mix', category: 'Fruits', unit: 'kg', min: 30, max: 120, price: 90 },
  { name: 'Milk', category: 'Dairy', unit: 'litres', min: 200, max: 700, price: 56 },
  { name: 'Curd', category: 'Dairy', unit: 'kg', min: 80, max: 300, price: 65 },
  { name: 'Paneer', category: 'Dairy', unit: 'kg', min: 30, max: 120, price: 320 },
  { name: 'Butter', category: 'Dairy', unit: 'kg', min: 10, max: 50, price: 480 },
  { name: 'Turmeric Powder', category: 'Spices', unit: 'kg', min: 5, max: 30, price: 220 },
  { name: 'Red Chilli Powder', category: 'Spices', unit: 'kg', min: 5, max: 30, price: 280 },
  { name: 'Garam Masala', category: 'Spices', unit: 'kg', min: 3, max: 15, price: 450 },
  { name: 'Cumin Seeds', category: 'Spices', unit: 'kg', min: 5, max: 25, price: 380 },
  { name: 'Salt', category: 'Spices', unit: 'kg', min: 40, max: 200, price: 18 },
  { name: 'Refined Sunflower Oil', category: 'Oil', unit: 'litres', min: 100, max: 400, price: 145 },
  { name: 'Mustard Oil', category: 'Oil', unit: 'litres', min: 40, max: 150, price: 160 },
  { name: 'Ghee', category: 'Oil', unit: 'kg', min: 20, max: 80, price: 520 },
  { name: 'Wheat Flour (Atta)', category: 'Flour', unit: 'kg', min: 200, max: 900, price: 40 },
  { name: 'Maida', category: 'Flour', unit: 'kg', min: 60, max: 250, price: 42 },
  { name: 'Besan', category: 'Flour', unit: 'kg', min: 40, max: 150, price: 85 },
  { name: 'Sugar', category: 'Other', unit: 'kg', min: 80, max: 300, price: 46 },
  { name: 'Tea Leaves', category: 'Other', unit: 'kg', min: 15, max: 60, price: 380 },
  { name: 'Coffee Powder', category: 'Other', unit: 'kg', min: 8, max: 30, price: 520 },
  { name: 'Disposable Plates', category: 'Other', unit: 'pieces', min: 2000, max: 10000, price: 2 },
]

function expiryFor(category: InventoryItem['category']): string {
  const shelfDays: Record<string, [number, number]> = {
    Dairy: [-1, 6],
    Vegetables: [1, 10],
    Fruits: [1, 12],
    Rice: [60, 365],
    Pulses: [60, 365],
    Spices: [90, 400],
    Oil: [90, 365],
    Flour: [30, 180],
    Other: [30, 200],
  }
  const [min, max] = shelfDays[category] ?? [30, 180]
  return addDaysISO(TODAY_ISO, randInt(min, max))
}

let invSeq = 200

export function generateInventoryForMess(messId: string): InventoryItem[] {
  return SPECS.map((spec) => {
    const stockRatio = randFloat(0.15, 1.4, 2)
    return {
      id: `INV-${invSeq++}`,
      messId,
      name: spec.name,
      category: spec.category,
      quantity: Math.round(spec.min * stockRatio),
      unit: spec.unit,
      minStock: spec.min,
      maxStock: spec.max,
      expiryDate: expiryFor(spec.category),
      supplierId: pick(SUPPLIERS).id,
      purchasePrice: spec.price,
      updatedAt: addDaysISO(TODAY_ISO, -randInt(0, 5)),
    }
  })
}

export const INVENTORY: InventoryItem[] = MESSES.flatMap((m) => generateInventoryForMess(m.id))

export function inventoryStatus(item: InventoryItem): 'low' | 'expiring' | 'expired' | 'overstocked' | 'ok' {
  const daysToExpiry = Math.round((new Date(item.expiryDate).getTime() - new Date(TODAY_ISO).getTime()) / 86400000)
  if (daysToExpiry < 0) return 'expired'
  if (daysToExpiry <= 3) return 'expiring'
  if (item.quantity < item.minStock) return 'low'
  if (item.quantity > item.maxStock) return 'overstocked'
  return 'ok'
}
