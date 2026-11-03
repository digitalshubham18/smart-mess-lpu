import { useState } from 'react'
import { Megaphone } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useNotifications } from '@/hooks/useNotifications'
import { broadcastNotification } from '@/services/notificationService'
import { NotificationPanel } from '@/components/ui/NotificationPanel'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { DashboardCard } from '@/components/ui/DashboardCard'
import type { Role } from '@/types'
import { DemoBanner } from '@/components/ui/DemoBanner'

const AUDIENCES: { label: string; roles: Role[] | undefined }[] = [
  { label: 'Everyone', roles: undefined },
  { label: 'Students only', roles: ['STUDENT'] },
  { label: 'Mess staff (Admin, Manager, Kitchen)', roles: ['ADMIN', 'MESS_MANAGER', 'KITCHEN_STAFF'] },
  { label: 'Finance Manager', roles: ['FINANCE_MANAGER'] },
  { label: 'Hostel Wardens', roles: ['HOSTEL_WARDEN'] },
]

export default function Notifications() {
  const { user } = useAuth()
  const { notifications, loading, markRead, markAllRead, refresh } = useNotifications(user?.role, user?.studentId)

  return (
    <div className="space-y-6 max-w-2xl">
      <DemoBanner what={'These announcements are kept only in this browser tab and are not delivered to anyone.'} detail={'real notifications are the push messages for check-ins and meal reminders.'} />
      <div>
        <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100">Notifications</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Meal reminders, alerts, and announcements relevant to your role.</p>
      </div>

      {(user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN') && <ComposeAnnouncement onSent={refresh} />}

      <div className="rounded-xl border border-line dark:border-ink-700 bg-white dark:bg-ink-900 p-4">
        {loading ? <LoadingSpinner /> : <NotificationPanel notifications={notifications} onMarkRead={markRead} onMarkAllRead={markAllRead} />}
      </div>
    </div>
  )
}

function ComposeAnnouncement({ onSent }: { onSent: () => void }) {
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [audience, setAudience] = useState(0)
  const [sent, setSent] = useState(false)

  function send() {
    if (!title.trim() || !message.trim()) return
    broadcastNotification(title.trim(), message.trim(), AUDIENCES[audience].roles)
    setTitle('')
    setMessage('')
    setSent(true)
    onSent()
    setTimeout(() => setSent(false), 2500)
  }

  return (
    <DashboardCard title="Send Announcement">
      <div className="flex items-center gap-2 text-xs text-slate-400 -mt-2 mb-3">
        <Megaphone size={13} /> Admin-only — pushes a real notification to the chosen audience.
      </div>
      <div className="space-y-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Announcement title"
          className="w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm"
        />
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Message"
          rows={3}
          className="w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap items-center gap-2">
          <select value={audience} onChange={(e) => setAudience(+e.target.value)} className="rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm">
            {AUDIENCES.map((a, i) => <option key={a.label} value={i}>{a.label}</option>)}
          </select>
          <button onClick={send} className="rounded-lg bg-tech-500 hover:bg-tech-600 text-white text-sm font-semibold px-4 py-2">
            Send
          </button>
          {sent && <span className="text-xs text-eco-600">Sent.</span>}
        </div>
      </div>
    </DashboardCard>
  )
}
