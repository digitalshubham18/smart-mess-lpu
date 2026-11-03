import type { MenuItem } from '@/types'
import { StatusBadge } from './StatusBadge'
import { Star, Leaf, Beef, Lock, CheckCircle2, XCircle, AlertCircle } from 'lucide-react'

type IntentionStatus = 'will_eat' | 'will_not' | 'unconfirmed'

const STATUS_META: Record<Exclude<IntentionStatus, 'unconfirmed'>, { label: string; tone: 'success' | 'warning' | 'danger'; icon: typeof CheckCircle2 }> = {
  will_eat: { label: 'Going', tone: 'success', icon: CheckCircle2 },
  will_not: { label: "Won't eat", tone: 'danger', icon: XCircle },
}

export function MealCard({
  title,
  menuLabel,
  status,
  onSelect,
  cutoffLabel,
  closed,
  intentionStatus,
  onRequestChange,
}: {
  title: string
  menuLabel: string
  status?: React.ReactNode
  onSelect?: (value: 'will_eat' | 'will_not') => void
  cutoffLabel?: string
  closed?: boolean
  /** When provided, the card renders the confirm-and-lock / request-change flow instead of the plain `status` node. */
  intentionStatus?: IntentionStatus
  onRequestChange?: () => void
}) {
  const useIntentionFlow = intentionStatus !== undefined
  const confirmed = useIntentionFlow && intentionStatus !== 'unconfirmed'

  return (
    <div className="rounded-xl border border-line dark:border-ink-700 bg-white dark:bg-ink-900 p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</div>
          <div className="font-display font-semibold text-slate-800 dark:text-slate-100 mt-0.5">{menuLabel}</div>
          {cutoffLabel && <div className="text-[11px] text-slate-400 mt-1">Marking closes {cutoffLabel}</div>}
        </div>
        {!useIntentionFlow && status}
        {confirmed && intentionStatus && (
          <StatusBadge tone={STATUS_META[intentionStatus as Exclude<IntentionStatus, 'unconfirmed'>].tone}>
            <Lock size={11} /> {STATUS_META[intentionStatus as Exclude<IntentionStatus, 'unconfirmed'>].label}
          </StatusBadge>
        )}
      </div>

      {useIntentionFlow ? (
        <>
          {confirmed ? (
            <div className="mt-4 rounded-lg bg-surface-dim dark:bg-ink-800 p-3 flex items-center justify-between gap-2">
              <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <Lock size={12} /> Confirmed &amp; locked
              </span>
              {onRequestChange && (
                <button onClick={onRequestChange} className="text-xs font-semibold text-tech-600 dark:text-tech-500 hover:underline shrink-0">
                  Request change
                </button>
              )}
            </div>
          ) : closed ? (
            <div className="mt-4 rounded-lg bg-amber-50 dark:bg-amber-500/10 p-3 text-center">
              <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-500">
                <AlertCircle size={13} /> Marking closed — you didn't confirm in time.
              </div>
              {onRequestChange && (
                <button onClick={onRequestChange} className="mt-2 text-xs font-semibold text-tech-600 dark:text-tech-500 hover:underline">
                  Forgot to mark? Raise a request
                </button>
              )}
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button onClick={() => onSelect?.('will_eat')} className="rounded-lg py-2 text-xs font-semibold bg-eco-50 text-eco-700 hover:bg-eco-500 hover:text-white dark:bg-eco-500/10 dark:text-eco-500 transition-colors">
                Will eat
              </button>
              <button onClick={() => onSelect?.('will_not')} className="rounded-lg py-2 text-xs font-semibold bg-rose-50 text-rose-700 hover:bg-rose-500 hover:text-white dark:bg-rose-500/10 dark:text-rose-500 transition-colors">
                Will not eat
              </button>
            </div>
          )}
        </>
      ) : (
        onSelect && (
          closed ? (
            <div className="mt-4 rounded-lg bg-surface-dim dark:bg-ink-800 p-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 text-center">
              Intention submission is closed for this meal.
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button onClick={() => onSelect('will_eat')} className="rounded-lg py-2 text-xs font-semibold bg-eco-50 text-eco-700 hover:bg-eco-500 hover:text-white dark:bg-eco-500/10 dark:text-eco-500 transition-colors">
                Will eat
              </button>
              <button onClick={() => onSelect('will_not')} className="rounded-lg py-2 text-xs font-semibold bg-rose-50 text-rose-700 hover:bg-rose-500 hover:text-white dark:bg-rose-500/10 dark:text-rose-500 transition-colors">
                Will not eat
              </button>
            </div>
          )
        )
      )}
    </div>
  )
}

export function MenuCard({ item, onRate }: { item: MenuItem; onRate?: () => void }) {
  return (
    <div className="rounded-xl border border-line dark:border-ink-700 bg-white dark:bg-ink-900 p-4 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {item.veg ? <Leaf size={14} className="text-eco-500 shrink-0" /> : <Beef size={14} className="text-rose-500 shrink-0" />}
          <span className="font-medium text-sm text-slate-800 dark:text-slate-100 truncate">{item.name}</span>
        </div>
        <div className="text-[11px] text-slate-400 mt-0.5">{item.category} · {item.calories} kcal · {item.protein}g protein</div>
      </div>
      {onRate && (
        <button onClick={onRate} className="shrink-0 flex items-center gap-1 text-xs font-medium text-amber-600">
          <Star size={13} /> Rate
        </button>
      )}
    </div>
  )
}
