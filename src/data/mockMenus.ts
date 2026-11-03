import type { MenuItem, MealType, Menu } from '@/types'
import { pick, rnd } from '@/lib/rng'

let seq = 1
function item(partial: Omit<MenuItem, 'id'>): MenuItem {
  return { id: `MI-${seq++}`, ...partial }
}

export const MENU_ITEMS: MenuItem[] = [
  item({ name: 'Steamed Rice', category: 'Rice', veg: true, calories: 205, protein: 4.3, carbs: 45, fat: 0.4, fiber: 0.6, popularity: 1.1, servingSizeKg: 0.18, costPerKg: 48 }),
  item({ name: 'Jeera Rice', category: 'Rice', veg: true, calories: 220, protein: 4.5, carbs: 46, fat: 3.2, fiber: 0.7, popularity: 1.15, servingSizeKg: 0.18, costPerKg: 52 }),
  item({ name: 'Veg Pulao', category: 'Rice', veg: true, calories: 260, protein: 5.5, carbs: 48, fat: 5.8, fiber: 2.1, popularity: 1.22, servingSizeKg: 0.2, costPerKg: 62 }),
  item({ name: 'Dal Tadka', category: 'Pulses', veg: true, calories: 180, protein: 9, carbs: 22, fat: 6, fiber: 5.2, popularity: 1.18, servingSizeKg: 0.15, costPerKg: 95 }),
  item({ name: 'Rajma Masala', category: 'Pulses', veg: true, calories: 210, protein: 11, carbs: 28, fat: 6.5, fiber: 8, popularity: 1.3, servingSizeKg: 0.15, costPerKg: 105 }),
  item({ name: 'Chole Masala', category: 'Pulses', veg: true, calories: 220, protein: 10, carbs: 30, fat: 7, fiber: 7.5, popularity: 1.34, servingSizeKg: 0.15, costPerKg: 98 }),
  item({ name: 'Sambar', category: 'Pulses', veg: true, calories: 160, protein: 7, carbs: 20, fat: 4.5, fiber: 4.8, popularity: 1.05, servingSizeKg: 0.15, costPerKg: 88 }),
  item({ name: 'Roti', category: 'Bread', veg: true, calories: 120, protein: 3.5, carbs: 20, fat: 2.5, fiber: 2, popularity: 1.2, servingSizeKg: 0.05, costPerKg: 42 }),
  item({ name: 'Naan', category: 'Bread', veg: true, calories: 260, protein: 6, carbs: 45, fat: 5.5, fiber: 1.8, popularity: 1.1, servingSizeKg: 0.08, costPerKg: 58 }),
  item({ name: 'Paneer Butter Masala', category: 'Curry', veg: true, calories: 340, protein: 13, carbs: 12, fat: 26, fiber: 2, popularity: 1.36, servingSizeKg: 0.15, costPerKg: 320 }),
  item({ name: 'Chicken Curry', category: 'Curry', veg: false, calories: 300, protein: 25, carbs: 8, fat: 18, fiber: 1.5, popularity: 1.28, servingSizeKg: 0.18, costPerKg: 280 }),
  item({ name: 'Egg Curry', category: 'Curry', veg: false, calories: 260, protein: 14, carbs: 9, fat: 18, fiber: 1.2, popularity: 1.12, servingSizeKg: 0.15, costPerKg: 150 }),
  item({ name: 'Mixed Veg Curry', category: 'Curry', veg: true, calories: 150, protein: 4, carbs: 15, fat: 8, fiber: 4.5, popularity: 0.88, servingSizeKg: 0.15, costPerKg: 65 }),
  item({ name: 'Lauki Sabzi', category: 'Curry', veg: true, calories: 90, protein: 2, carbs: 10, fat: 4, fiber: 3, popularity: 0.62, servingSizeKg: 0.15, costPerKg: 45 }),
  item({ name: 'Bhindi Masala', category: 'Curry', veg: true, calories: 130, protein: 3, carbs: 12, fat: 7, fiber: 4, popularity: 0.9, servingSizeKg: 0.15, costPerKg: 55 }),
  item({ name: 'Aloo Gobi', category: 'Curry', veg: true, calories: 160, protein: 3.5, carbs: 18, fat: 8, fiber: 3.6, popularity: 0.96, servingSizeKg: 0.15, costPerKg: 48 }),
  item({ name: 'Kadhi Pakora', category: 'Curry', veg: true, calories: 190, protein: 6, carbs: 16, fat: 11, fiber: 1.8, popularity: 0.84, servingSizeKg: 0.15, costPerKg: 58 }),
  item({ name: 'Curd', category: 'Dairy', veg: true, calories: 98, protein: 5, carbs: 7, fat: 5, fiber: 0, popularity: 1.15, servingSizeKg: 0.1, costPerKg: 65 }),
  item({ name: 'Buttermilk', category: 'Dairy', veg: true, calories: 40, protein: 2, carbs: 4, fat: 1.5, fiber: 0, popularity: 1.05, servingSizeKg: 0.1, costPerKg: 30 }),
  item({ name: 'Sweet Lassi', category: 'Dairy', veg: true, calories: 150, protein: 4, carbs: 25, fat: 3.5, fiber: 0, popularity: 1.1, servingSizeKg: 0.12, costPerKg: 40 }),
  item({ name: 'Cucumber Salad', category: 'Salad', veg: true, calories: 40, protein: 1, carbs: 8, fat: 0.2, fiber: 1.5, popularity: 0.9, servingSizeKg: 0.08, costPerKg: 30 }),
  item({ name: 'Kachumber Salad', category: 'Salad', veg: true, calories: 55, protein: 1.5, carbs: 10, fat: 0.5, fiber: 2, popularity: 0.95, servingSizeKg: 0.08, costPerKg: 32 }),
  item({ name: 'Sprouts Salad', category: 'Salad', veg: true, calories: 90, protein: 6, carbs: 12, fat: 1.5, fiber: 4, popularity: 0.8, servingSizeKg: 0.08, costPerKg: 55 }),
  item({ name: 'Banana', category: 'Fruit', veg: true, calories: 105, protein: 1.3, carbs: 27, fat: 0.4, fiber: 3.1, popularity: 1, servingSizeKg: 0.12, costPerKg: 45 }),
  item({ name: 'Apple', category: 'Fruit', veg: true, calories: 95, protein: 0.5, carbs: 25, fat: 0.3, fiber: 4.4, popularity: 1.05, servingSizeKg: 0.15, costPerKg: 120 }),
  item({ name: 'Seasonal Fruit Bowl', category: 'Fruit', veg: true, calories: 110, protein: 1.2, carbs: 26, fat: 0.4, fiber: 3.8, popularity: 1.02, servingSizeKg: 0.15, costPerKg: 90 }),
  item({ name: 'Masala Chai', category: 'Beverage', veg: true, calories: 60, protein: 1.5, carbs: 10, fat: 2, fiber: 0, popularity: 1.25, servingSizeKg: 0.1, costPerKg: 25 }),
  item({ name: 'Filter Coffee', category: 'Beverage', veg: true, calories: 55, protein: 1.2, carbs: 8, fat: 1.8, fiber: 0, popularity: 1.1, servingSizeKg: 0.1, costPerKg: 32 }),
  item({ name: 'Fresh Lime Water', category: 'Beverage', veg: true, calories: 30, protein: 0.1, carbs: 8, fat: 0, fiber: 0.1, popularity: 0.9, servingSizeKg: 0.15, costPerKg: 15 }),
  item({ name: 'Samosa', category: 'Snack', veg: true, calories: 260, protein: 4, carbs: 30, fat: 14, fiber: 2, popularity: 1.3, servingSizeKg: 0.08, costPerKg: 90 }),
  item({ name: 'Bread Pakora', category: 'Snack', veg: true, calories: 240, protein: 5, carbs: 26, fat: 12, fiber: 1.6, popularity: 1.05, servingSizeKg: 0.08, costPerKg: 75 }),
  item({ name: 'Bhel Puri', category: 'Snack', veg: true, calories: 180, protein: 3.5, carbs: 32, fat: 4, fiber: 2.4, popularity: 1.12, servingSizeKg: 0.1, costPerKg: 60 }),
  item({ name: 'Vada Pav', category: 'Snack', veg: true, calories: 290, protein: 6, carbs: 40, fat: 11, fiber: 2.8, popularity: 1.2, servingSizeKg: 0.12, costPerKg: 70 }),
  item({ name: 'Idli', category: 'Snack', veg: true, calories: 140, protein: 4, carbs: 28, fat: 0.6, fiber: 1.2, popularity: 1.08, servingSizeKg: 0.12, costPerKg: 45 }),
  item({ name: 'Dosa', category: 'Snack', veg: true, calories: 190, protein: 4.5, carbs: 33, fat: 4, fiber: 1.4, popularity: 1.22, servingSizeKg: 0.12, costPerKg: 50 }),
  item({ name: 'Upma', category: 'Snack', veg: true, calories: 170, protein: 4, carbs: 28, fat: 5, fiber: 2, popularity: 0.78, servingSizeKg: 0.15, costPerKg: 40 }),
  item({ name: 'Poha', category: 'Snack', veg: true, calories: 165, protein: 3.6, carbs: 30, fat: 3.8, fiber: 1.8, popularity: 0.8, servingSizeKg: 0.15, costPerKg: 38 }),
  item({ name: 'Aloo Paratha', category: 'Bread', veg: true, calories: 280, protein: 6, carbs: 40, fat: 10, fiber: 3, popularity: 1.24, servingSizeKg: 0.15, costPerKg: 55 }),
  item({ name: 'Bread Omelette', category: 'Curry', veg: false, calories: 260, protein: 12, carbs: 24, fat: 12, fiber: 1.4, popularity: 1.02, servingSizeKg: 0.15, costPerKg: 68 }),
  item({ name: 'Boiled Eggs', category: 'Curry', veg: false, calories: 155, protein: 13, carbs: 1.1, fat: 11, fiber: 0, popularity: 0.98, servingSizeKg: 0.1, costPerKg: 90 }),
  item({ name: 'Chicken Biryani', category: 'Rice', veg: false, calories: 380, protein: 20, carbs: 42, fat: 14, fiber: 1.8, popularity: 1.38, servingSizeKg: 0.25, costPerKg: 210 }),
  item({ name: 'Veg Biryani', category: 'Rice', veg: true, calories: 320, protein: 8, carbs: 46, fat: 10, fiber: 3.2, popularity: 1.18, servingSizeKg: 0.22, costPerKg: 95 }),
  item({ name: 'Gulab Jamun', category: 'Sweet', veg: true, calories: 150, protein: 2, carbs: 22, fat: 6, fiber: 0.3, popularity: 1.32, servingSizeKg: 0.06, costPerKg: 180 }),
  item({ name: 'Kheer', category: 'Sweet', veg: true, calories: 180, protein: 4, carbs: 28, fat: 6, fiber: 0.4, popularity: 1.15, servingSizeKg: 0.1, costPerKg: 95 }),
  item({ name: 'Halwa', category: 'Sweet', veg: true, calories: 220, protein: 3, carbs: 30, fat: 10, fiber: 0.6, popularity: 1.08, servingSizeKg: 0.08, costPerKg: 110 }),
  item({ name: 'Khichdi', category: 'Rice', veg: true, calories: 190, protein: 7, carbs: 32, fat: 4, fiber: 3.5, popularity: 0.7, servingSizeKg: 0.2, costPerKg: 55 }),
  item({ name: 'Paneer Tikka', category: 'Curry', veg: true, calories: 260, protein: 15, carbs: 8, fat: 18, fiber: 1.5, popularity: 1.28, servingSizeKg: 0.15, costPerKg: 300 }),
  item({ name: 'Mushroom Masala', category: 'Curry', veg: true, calories: 140, protein: 5, carbs: 10, fat: 8, fiber: 2.8, popularity: 0.92, servingSizeKg: 0.15, costPerKg: 160 }),
  item({ name: 'Fish Curry', category: 'Curry', veg: false, calories: 220, protein: 22, carbs: 6, fat: 12, fiber: 0.8, popularity: 1.05, servingSizeKg: 0.18, costPerKg: 260 }),
  item({ name: 'Papad', category: 'Snack', veg: true, calories: 70, protein: 2.5, carbs: 9, fat: 3, fiber: 0.9, popularity: 1, servingSizeKg: 0.02, costPerKg: 120 }),
]

export const ITEMS_BY_ID = Object.fromEntries(MENU_ITEMS.map((m) => [m.id, m]))

const BY_MEAL: Record<MealType, MenuItem[]> = {
  breakfast: MENU_ITEMS.filter((m) => ['Bread', 'Snack', 'Beverage', 'Dairy', 'Fruit'].includes(m.category)),
  lunch: MENU_ITEMS.filter((m) => ['Rice', 'Pulses', 'Bread', 'Curry', 'Dairy', 'Salad', 'Sweet'].includes(m.category)),
  snacks: MENU_ITEMS.filter((m) => ['Snack', 'Beverage', 'Sweet'].includes(m.category)),
  dinner: MENU_ITEMS.filter((m) => ['Rice', 'Pulses', 'Bread', 'Curry', 'Dairy', 'Salad', 'Sweet'].includes(m.category)),
}

const COUNT_BY_MEAL: Record<MealType, number> = { breakfast: 4, lunch: 6, snacks: 3, dinner: 5 }

export function buildMenuForDate(dateISO: string, meal: MealType): Menu {
  const pool = BY_MEAL[meal]
  const count = COUNT_BY_MEAL[meal]
  // deterministic-ish rotation based on date+meal so the same date always yields the same menu
  const seedIdx = Array.from(dateISO + meal).reduce((a, c) => a + c.charCodeAt(0), 0)
  const items: MenuItem[] = []
  for (let i = 0; i < count; i++) {
    items.push(pool[(seedIdx + i * 7) % pool.length])
  }
  const uniqueIds = Array.from(new Set(items.map((i) => i.id)))
  return { id: `MENU-${dateISO}-${meal}`, date: dateISO, meal, itemIds: uniqueIds }
}

export function randomSpecialMenuLabel(): string {
  return pick(['Founders Day Special', 'Regional Cuisine Day', "Chef's Special", 'Festival Feast', 'Health Day Menu'])
}

export function menuPopularity(menu: Menu): number {
  const items = menu.itemIds.map((id) => ITEMS_BY_ID[id]).filter(Boolean)
  if (!items.length) return 1
  return items.reduce((s, i) => s + i.popularity, 0) / items.length
}

export function isMenuVeg(menu: Menu): boolean {
  return menu.itemIds.every((id) => ITEMS_BY_ID[id]?.veg)
}

export { rnd as _rnd }
