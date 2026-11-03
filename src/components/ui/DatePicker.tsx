import { Calendar } from 'lucide-react'

export function DatePicker({
  value,
  onChange,
  label,
  min,
  max,
}: {
  value: string
  onChange: (value: string) => void
  label?: string
  min?: string
  max?: string
}) {
  return (
    <label className="flex flex-col gap-1">
      {label && <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span>}
      <div className="relative">
        <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          type="date"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(e.target.value)}
          className="pl-9 pr-3 py-2 text-sm rounded-lg border border-line dark:border-ink-700 bg-white dark:bg-ink-900 focus:outline-none focus:ring-2 focus:ring-tech-500/40"
        />
      </div>
    </label>
  )
}
