import type { Supplier } from '@/types'
import { randInt, rnd } from '@/lib/rng'

const NAMES = [
  'Punjab Grains Traders', 'Annapurna Wholesale Foods', 'Green Valley Vegetables', 'Sunrise Dairy Suppliers',
  'National Pulses Co.', 'Fresh Farm Produce', 'Spice World Distributors', 'Golden Harvest Rice Mills',
  'City Oil & Ghee Traders', 'Metro Fruit Suppliers', 'Krishna Flour Mills', 'Om Sai Vegetable Mandi',
  'Amrit Dairy Products', 'Shakti Pulses & Grains', 'Blue Ocean Fish Suppliers', 'Farm Fresh Poultry',
  'Himalayan Spice Traders', 'Royal Bakery Supplies', 'Indus Valley Foods', 'Clean Harvest Organics',
  'Sona Masoori Rice Depot', 'Gupta Kirana Wholesale',
]

export const SUPPLIERS: Supplier[] = NAMES.map((name, i) => ({
  id: `SUP-${100 + i}`,
  name,
  phone: `9${randInt(100000000, 999999999)}`,
  email: `contact@${name.toLowerCase().replace(/[^a-z]+/g, '')}.in`,
  address: `${randInt(1, 200)}, Industrial Area, Phase ${randInt(1, 3)}, Ludhiana, Punjab`,
  rating: Math.round((3 + rnd() * 2) * 10) / 10,
  itemsSupplied: [],
}))
