import type { Notification } from '@/types'
import { addDaysISO, TODAY_ISO } from '@/utils/dateUtils'

export const NOTIFICATIONS: Notification[] = [
  { id: 'N-1', title: 'Lunch intention reminder', message: 'Submit your lunch intention before 10:30 AM today.', type: 'intention_reminder', read: false, createdAt: `${TODAY_ISO}T07:30:00`, targetRoles: ['STUDENT'] },
  { id: 'N-2', title: 'Menu updated', message: "Tomorrow's dinner menu now includes Paneer Butter Masala.", type: 'menu_update', read: false, createdAt: `${TODAY_ISO}T08:15:00`, targetRoles: ['STUDENT'] },
  { id: 'N-3', title: 'High waste detected', message: 'Dinner waste yesterday was 32% above the weekly average.', type: 'waste_alert', read: false, createdAt: `${addDaysISO(TODAY_ISO, -1)}T21:40:00`, targetRoles: ['ADMIN', 'MESS_MANAGER'] },
  { id: 'N-4', title: 'Low inventory: Toor Dal', message: 'Toor Dal stock has fallen below the minimum threshold.', type: 'inventory_alert', read: true, createdAt: `${addDaysISO(TODAY_ISO, -1)}T09:00:00`, targetRoles: ['ADMIN', 'MESS_MANAGER', 'KITCHEN_STAFF'] },
  { id: 'N-5', title: 'Milk expires tomorrow', message: '180 litres of milk expire tomorrow — plan usage accordingly.', type: 'expiry_alert', read: false, createdAt: `${TODAY_ISO}T06:45:00`, targetRoles: ['ADMIN', 'MESS_MANAGER', 'KITCHEN_STAFF'] },
  { id: 'N-6', title: 'Forecast updated', message: "Tomorrow's lunch forecast has been recalculated: 1,180 students expected.", type: 'forecast_update', read: false, createdAt: `${TODAY_ISO}T18:00:00`, targetRoles: ['ADMIN', 'MESS_MANAGER'] },
  { id: 'N-7', title: 'Breakfast starts in 30 minutes', message: 'Breakfast service begins at 7:30 AM in the Central Mess.', type: 'meal_reminder', read: true, createdAt: `${TODAY_ISO}T07:00:00`, targetRoles: ['STUDENT'] },
  { id: 'N-8', title: 'Admin announcement', message: 'The mess will remain closed for maintenance next Sunday morning.', type: 'announcement', read: false, createdAt: `${addDaysISO(TODAY_ISO, -2)}T12:00:00` },
  { id: 'N-9', title: 'New complaint received', message: 'A student reported cold food during dinner service yesterday.', type: 'announcement', read: true, createdAt: `${addDaysISO(TODAY_ISO, -1)}T22:10:00`, targetRoles: ['ADMIN', 'MESS_MANAGER'] },
  { id: 'N-10', title: 'Meal intention reminder', message: "Don't forget to confirm tomorrow's meals before the cutoff.", type: 'intention_reminder', read: false, createdAt: `${TODAY_ISO}T19:00:00`, targetRoles: ['STUDENT'] },
]
