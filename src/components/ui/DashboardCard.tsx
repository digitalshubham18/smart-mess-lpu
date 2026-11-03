import type { LucideIcon } from 'lucide-react'
import { ResponsiveContainer } from 'recharts'
import { LoadingSpinner } from './LoadingSpinner'

export function DashboardCard({
  title,
  action,
  children,
  className = '',
}: {
  title?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`rounded-xl border border-line dark:border-ink-700 bg-white dark:bg-ink-900 p-5 ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between mb-4">
          {title && <h3 className="font-display font-semibold text-sm text-slate-700 dark:text-slate-200">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </div>
  )
}

const ACCENT_BORDER: Record<string, string> = {
  tech: 'border-l-tech-500',
  eco: 'border-l-eco-500',
  amber: 'border-l-amber-500',
  rose: 'border-l-rose-500',
  neutral: 'border-l-slate-300 dark:border-l-ink-700',
}

export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  accent = 'neutral',
  changeLabel,
  changePositive,
}: {
  label: string
  value: React.ReactNode
  sub?: string
  icon?: LucideIcon
  accent?: 'tech' | 'eco' | 'amber' | 'rose' | 'neutral'
  changeLabel?: string
  changePositive?: boolean
}) {
  return (
    <div className={`rounded-xl border border-line dark:border-ink-700 border-l-4 ${ACCENT_BORDER[accent]} bg-white dark:bg-ink-900 p-4`}>
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">{label}</div>
          <div className="mt-1.5 text-2xl font-bold font-display text-slate-800 dark:text-slate-50 truncate">{value}</div>
          <div className="mt-1 flex items-center gap-1.5 text-xs">
            {changeLabel && (
              <span className={changePositive ? 'text-eco-600 dark:text-eco-500 font-medium' : 'text-rose-500 font-medium'}>{changeLabel}</span>
            )}
            {sub && <span className="text-slate-400">{sub}</span>}
          </div>
        </div>
        {Icon && (
          <div className="shrink-0 rounded-lg p-2 bg-surface-dim dark:bg-ink-800">
            <Icon size={17} className="text-slate-500 dark:text-slate-400" />
          </div>
        )}
      </div>
    </div>
  )
}

export function ChartCard({
  title,
  subtitle,
  loading,
  height = 260,
  action,
  children,
}: {
  title: string
  subtitle?: string
  loading?: boolean
  height?: number
  action?: React.ReactNode
  children: React.ReactElement
}) {
  return (
    <DashboardCard
      title={title}
      action={action}
      className=""
    >
      {subtitle && <p className="text-xs text-slate-400 -mt-3 mb-3">{subtitle}</p>}
      {loading ? (
        <LoadingSpinner label="Loading chart…" />
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          {children}
        </ResponsiveContainer>
      )}
    </DashboardCard>
  )
}
