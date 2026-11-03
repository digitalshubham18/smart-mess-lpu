import { Loader2 } from 'lucide-react'

export function LoadingSpinner({ label = 'Loading…', size = 18 }: { label?: string; size?: number }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 py-6 justify-center">
      <Loader2 size={size} className="animate-spin" />
      {label}
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-slate-200 dark:bg-ink-700 ${className}`} />
}

export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-line bg-white dark:bg-ink-900 dark:border-ink-700 p-5">
      <Skeleton className="h-3 w-24 mb-3" />
      <Skeleton className="h-7 w-32 mb-2" />
      <Skeleton className="h-3 w-20" />
    </div>
  )
}
