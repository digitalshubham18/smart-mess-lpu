type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-surface-dim text-slate-600 dark:bg-ink-800 dark:text-slate-300',
  success: 'bg-eco-50 text-eco-700 dark:bg-eco-500/10 dark:text-eco-500',
  warning: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-500',
  danger: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-500',
  info: 'bg-tech-50 text-tech-700 dark:bg-tech-500/10 dark:text-tech-500',
}

export function StatusBadge({ tone = 'neutral', children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${TONE_CLASSES[tone]}`}>
      {children}
    </span>
  )
}

export function ProgressBar({ value, max = 100, tone = 'info' }: { value: number; max?: number; tone?: Tone }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))
  const barTone: Record<Tone, string> = {
    neutral: 'bg-slate-400', success: 'bg-eco-500', warning: 'bg-amber-500', danger: 'bg-rose-500', info: 'bg-tech-500',
  }
  return (
    <div className="w-full h-2 rounded-full bg-surface-dim dark:bg-ink-800 overflow-hidden">
      <div className={`h-full rounded-full ${barTone[tone]} transition-all duration-500`} style={{ width: `${pct}%` }} />
    </div>
  )
}
