import { useCallback, useEffect, useState } from 'react'
import type { Notification, Role } from '@/types'
import * as notificationService from '@/services/notificationService'

export function useNotifications(role: Role | undefined, studentId?: string) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(() => {
    if (!role) return
    setLoading(true)
    notificationService.listNotifications(role, studentId).then((data) => {
      setNotifications(data)
      setLoading(false)
    })
  }, [role, studentId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const unread = role ? notificationService.unreadCount(role, studentId) : 0

  async function markRead(id: string) {
    await notificationService.markRead(id)
    refresh()
  }
  async function markAllRead() {
    if (!role) return
    await notificationService.markAllRead(role, studentId)
    refresh()
  }

  return { notifications, loading, unread, markRead, markAllRead, refresh }
}
