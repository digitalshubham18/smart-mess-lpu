import { Search, Filter } from 'lucide-react'

export function SearchBar({
  value,
  onChange,
  placeholder = 'Search…',
  className = '',
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <div className={`relative ${className}`}>
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-line dark:border-ink-700 bg-white dark:bg-ink-900 focus:outline-none focus:ring-2 focus:ring-tech-500/40"
      />
    </div>
  )
}

export interface FilterOption {
  key: string
  label: string
  options: { value: string; label: string }[]
}

export function FilterBar({
  filters,
  values,
  onChange,
}: {
  filters: FilterOption[]
  values: Record<string, string>
  onChange: (key: string, value: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Filter size={14} className="text-slate-400" />
      {filters.map((f) => (
        <select
          key={f.key}
          value={values[f.key] ?? ''}
          onChange={(e) => onChange(f.key, e.target.value)}
          className="text-xs font-medium rounded-lg border border-line dark:border-ink-700 bg-white dark:bg-ink-900 px-2.5 py-1.5"
        >
          <option value="">{f.label}: All</option>
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ))}
    </div>
  )
}
