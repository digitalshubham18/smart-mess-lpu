import { Bell, AlertTriangle, Info, CheckCircle2 } from 'lucide-react'
import type { Notification } from '@/types'
import { EmptyState } from './EmptyState'

const TYPE_ICON: Record<Notification['type'], typeof Bell> = {
  meal_reminder: Bell,
  menu_update: Info,
  intention_reminder: Bell,
  waste_alert: AlertTriangle,
  inventory_alert: AlertTriangle,
  expiry_alert: AlertTriangle,
  forecast_update: Info,
  announcement: Info,
  change_request_update: CheckCircle2,
}

export function NotificationPanel({
  notifications,
  onMarkRead,
  onMarkAllRead,
}: {
  notifications: Notification[]
  onMarkRead: (id: string) => void
  onMarkAllRead: () => void
}) {
  if (!notifications.length) {
    return <EmptyState icon={Bell} title="No notifications" description="You're all caught up." />
  }
  return (
    <div>
      <div className="flex justify-end mb-2">
        <button onClick={onMarkAllRead} className="text-xs font-medium text-tech-600 dark:text-tech-500 hover:underline">
          Mark all as read
        </button>
      </div>
      <ul className="divide-y divide-line dark:divide-ink-700">
        {notifications.map((n) => {
          const Icon = TYPE_ICON[n.type]
          return (
            <li key={n.id} className={`flex gap-3 py-3 px-1 ${!n.read ? 'bg-tech-50/50 dark:bg-tech-500/5' : ''}`}>
              <div className="shrink-0 mt-0.5">
                <Icon size={16} className={!n.read ? 'text-tech-600' : 'text-slate-400'} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-700 dark:text-slate-200">{n.title}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{n.message}</div>
                <div className="text-[11px] text-slate-400 mt-1">{new Date(n.createdAt).toLocaleString('en-IN')}</div>
              </div>
              {!n.read && (
                <button onClick={() => onMarkRead(n.id)} className="shrink-0 self-start text-[11px] font-medium text-tech-600 hover:underline">
                  Mark read
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function AlertCard({
  title,
  description,
  tone = 'warning',
}: {
  title: string
  description: string
  tone?: 'warning' | 'danger' | 'info' | 'success'
}) {
  const ICON = { warning: AlertTriangle, danger: AlertTriangle, info: Info, success: CheckCircle2 }[tone]
  const cls = {
    warning: 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-400',
    danger: 'bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-500/10 dark:border-rose-500/30 dark:text-rose-400',
    info: 'bg-tech-50 border-tech-200 text-tech-700 dark:bg-tech-500/10 dark:border-tech-500/30 dark:text-tech-400',
    success: 'bg-eco-50 border-eco-200 text-eco-700 dark:bg-eco-500/10 dark:border-eco-500/30 dark:text-eco-400',
  }[tone]
  return (
    <div className={`flex items-start gap-3 rounded-xl border p-4 ${cls}`}>
      <ICON size={18} className="shrink-0 mt-0.5" />
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs mt-0.5 opacity-90">{description}</div>
      </div>
    </div>
  )
}
