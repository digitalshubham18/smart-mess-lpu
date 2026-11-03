import { Sparkles, ArrowDownCircle, ArrowUpCircle, AlertTriangle, ShoppingCart } from 'lucide-react'
import type { AIInsight as AIInsightType, Recommendation } from '@/services/analyticsService'

const TONE_CLASS: Record<AIInsightType['tone'], string> = {
  info: 'bg-tech-50 dark:bg-tech-500/10 text-tech-700 dark:text-tech-500',
  warning: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-500',
  success: 'bg-eco-50 dark:bg-eco-500/10 text-eco-700 dark:text-eco-500',
}

export function AIInsight({ insight }: { insight: AIInsightType }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-line dark:border-ink-700 bg-white dark:bg-ink-900 p-4">
      <div className={`rounded-lg p-1.5 ${TONE_CLASS[insight.tone]}`}>
        <Sparkles size={14} />
      </div>
      <p className="text-sm text-slate-700 dark:text-slate-200">{insight.text}</p>
    </div>
  )
}

const KIND_META: Record<Recommendation['kind'], { icon: typeof Sparkles; label: string; cls: string }> = {
  prepare_less: { icon: ArrowDownCircle, label: 'PREPARE LESS', cls: 'text-amber-600 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-500' },
  prepare_more: { icon: ArrowUpCircle, label: 'PREPARE MORE', cls: 'text-eco-600 bg-eco-50 dark:bg-eco-500/10 dark:text-eco-500' },
  menu_alert: { icon: AlertTriangle, label: 'MENU ALERT', cls: 'text-rose-600 bg-rose-50 dark:bg-rose-500/10 dark:text-rose-500' },
  purchase_alert: { icon: ShoppingCart, label: 'PURCHASE ALERT', cls: 'text-tech-600 bg-tech-50 dark:bg-tech-500/10 dark:text-tech-500' },
}

export function RecommendationCard({ rec }: { rec: Recommendation }) {
  const meta = KIND_META[rec.kind]
  const Icon = meta.icon
  return (
    <div className="rounded-xl border border-line dark:border-ink-700 bg-white dark:bg-ink-900 p-4">
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ${meta.cls}`}>
        <Icon size={12} /> {meta.label}
      </span>
      <div className="font-display font-semibold text-sm text-slate-800 dark:text-slate-100 mt-2.5">{rec.title}</div>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{rec.detail}</p>
    </div>
  )
}
