import type { Notification, Role } from '@/types'
import { NOTIFICATIONS } from '@/data/mockNotifications'
import { withDelay } from './api'

let notifications: Notification[] = [...NOTIFICATIONS]
let seq = 1000

function visibleTo(n: Notification, role: Role, studentId?: string): boolean {
  if (n.targetStudentId) return n.targetStudentId === studentId
  return !n.targetRoles || n.targetRoles.includes(role)
}

export async function listNotifications(role: Role, studentId?: string): Promise<Notification[]> {
  const filtered = notifications.filter((n) => visibleTo(n, role, studentId))
  return withDelay([...filtered].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)), 200)
}

export async function markRead(id: string): Promise<void> {
  notifications = notifications.map((n) => (n.id === id ? { ...n, read: true } : n))
  return withDelay(undefined, 100)
}

export async function markAllRead(role: Role, studentId?: string): Promise<void> {
  notifications = notifications.map((n) => (visibleTo(n, role, studentId) ? { ...n, read: true } : n))
  return withDelay(undefined, 150)
}

export function unreadCount(role: Role, studentId?: string): number {
  return notifications.filter((n) => visibleTo(n, role, studentId) && !n.read).length
}

/** Push a notification aimed at exactly one student — used for e.g. change-request decisions. */
export function notifyStudent(studentId: string, title: string, message: string, type: Notification['type'] = 'change_request_update') {
  notifications = [
    { id: `N-${seq++}`, title, message, type, read: false, createdAt: new Date().toISOString(), targetStudentId: studentId },
    ...notifications,
  ]
}

/** Admin broadcast — pushes an announcement to the chosen roles, or everyone if none specified. */
export function broadcastNotification(title: string, message: string, targetRoles?: Role[]) {
  notifications = [
    {
      id: `N-${seq++}`,
      title,
      message,
      type: 'announcement',
      read: false,
      createdAt: new Date().toISOString(),
      targetRoles: targetRoles && targetRoles.length ? targetRoles : undefined,
    },
    ...notifications,
  ]
}
