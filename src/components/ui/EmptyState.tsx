import type { LucideIcon } from 'lucide-react'
import { Inbox, AlertTriangle } from 'lucide-react'

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      <div className="w-12 h-12 rounded-full bg-surface-dim dark:bg-ink-800 flex items-center justify-center mb-4">
        <Icon size={20} className="text-slate-400" />
      </div>
      <div className="font-display font-semibold text-slate-700 dark:text-slate-200">{title}</div>
      {description && <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorState({ title = 'Something went wrong', description, onRetry }: { title?: string; description?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      <div className="w-12 h-12 rounded-full bg-rose-50 dark:bg-rose-500/10 flex items-center justify-center mb-4">
        <AlertTriangle size={20} className="text-rose-500" />
      </div>
      <div className="font-display font-semibold text-slate-700 dark:text-slate-200">{title}</div>
      {description && <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-sm">{description}</p>}
      {onRetry && (
        <button onClick={onRetry} className="mt-4 text-sm font-semibold text-tech-600 dark:text-tech-500 hover:underline">
          Try again
        </button>
      )}
    </div>
  )
}
