import { ChevronLeft, ChevronRight } from 'lucide-react'

export function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number
  totalPages: number
  onChange: (page: number) => void
}) {
  return (
    <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
      <button disabled={page <= 1} onClick={() => onChange(page - 1)} className="p-1.5 rounded-md border border-line dark:border-ink-700 disabled:opacity-40">
        <ChevronLeft size={14} />
      </button>
      <span>
        Page {page} / {totalPages}
      </span>
      <button disabled={page >= totalPages} onClick={() => onChange(page + 1)} className="p-1.5 rounded-md border border-line dark:border-ink-700 disabled:opacity-40">
        <ChevronRight size={14} />
      </button>
    </div>
  )
}
