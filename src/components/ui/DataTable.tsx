import { useMemo, useState } from 'react'
import { ChevronUp, ChevronDown, Search, Download, SlidersHorizontal, ChevronLeft, ChevronRight } from 'lucide-react'
import { LoadingSpinner } from './LoadingSpinner'
import { EmptyState } from './EmptyState'
import { downloadCSV } from '@/services/reportService'

export interface Column<T> {
  key: string
  header: string
  accessor: (row: T) => React.ReactNode
  sortValue?: (row: T) => string | number
  exportValue?: (row: T) => string | number
  hideByDefault?: boolean
}

export function DataTable<T>({
  data,
  columns,
  loading = false,
  searchableText,
  pageSize = 10,
  emptyTitle = 'No records found',
  emptyDescription = 'Try adjusting your filters or search.',
  filename = 'export.csv',
  rowKey,
}: {
  data: T[]
  columns: Column<T>[]
  loading?: boolean
  searchableText?: (row: T) => string
  pageSize?: number
  emptyTitle?: string
  emptyDescription?: string
  filename?: string
  rowKey: (row: T) => string
}) {
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)
  const [hidden, setHidden] = useState<Set<string>>(new Set(columns.filter((c) => c.hideByDefault).map((c) => c.key)))
  const [showColumnMenu, setShowColumnMenu] = useState(false)

  const visibleColumns = columns.filter((c) => !hidden.has(c.key))

  const filtered = useMemo(() => {
    if (!query.trim() || !searchableText) return data
    const q = query.toLowerCase()
    return data.filter((row) => searchableText(row).toLowerCase().includes(q))
  }, [data, query, searchableText])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const col = columns.find((c) => c.key === sortKey)
    if (!col?.sortValue) return filtered
    const copy = [...filtered]
    copy.sort((a, b) => {
      const av = col.sortValue!(a)
      const bv = col.sortValue!(b)
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return copy
  }, [filtered, sortKey, sortDir, columns])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageRows = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  function exportCSV() {
    const rows = sorted.map((row) => {
      const r: Record<string, string | number> = {}
      visibleColumns.forEach((c) => {
        r[c.header] = c.exportValue ? c.exportValue(row) : String(c.accessor(row))
      })
      return r
    })
    downloadCSV(filename, rows)
  }

  return (
    <div className="rounded-xl border border-line dark:border-ink-700 bg-white dark:bg-ink-900 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 justify-between px-4 py-3 border-b border-line dark:border-ink-700">
        {searchableText ? (
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setPage(1)
              }}
              placeholder="Search…"
              className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 focus:outline-none focus:ring-2 focus:ring-tech-500/40"
            />
          </div>
        ) : (
          <div />
        )}
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setShowColumnMenu((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-line dark:border-ink-700 text-slate-600 dark:text-slate-300"
            >
              <SlidersHorizontal size={13} /> Columns
            </button>
            {showColumnMenu && (
              <div className="absolute right-0 mt-1 w-48 rounded-lg border border-line dark:border-ink-700 bg-white dark:bg-ink-900 shadow-lg z-10 p-2">
                {columns.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-md hover:bg-surface-dim dark:hover:bg-ink-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!hidden.has(c.key)}
                      onChange={() =>
                        setHidden((prev) => {
                          const next = new Set(prev)
                          if (next.has(c.key)) next.delete(c.key)
                          else next.add(c.key)
                          return next
                        })
                      }
                    />
                    {c.header}
                  </label>
                ))}
              </div>
            )}
          </div>
          <button onClick={exportCSV} className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-line dark:border-ink-700 text-slate-600 dark:text-slate-300">
            <Download size={13} /> Export CSV
          </button>
        </div>
      </div>

      {loading ? (
        <LoadingSpinner label="Loading records…" />
      ) : sorted.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface dark:bg-ink-800">
                <tr>
                  {visibleColumns.map((c) => (
                    <th key={c.key} className="text-left px-4 py-2.5 font-semibold text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {c.sortValue ? (
                        <button onClick={() => toggleSort(c.key)} className="flex items-center gap-1">
                          {c.header}
                          {sortKey === c.key && (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                        </button>
                      ) : (
                        c.header
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => (
                  <tr key={rowKey(row)} className="border-t border-line dark:border-ink-700">
                    {visibleColumns.map((c) => (
                      <td key={c.key} className="px-4 py-2.5 whitespace-nowrap text-slate-700 dark:text-slate-200">
                        {c.accessor(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-4 py-3 border-t border-line dark:border-ink-700 text-xs text-slate-500 dark:text-slate-400">
            <div>
              Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, sorted.length)} of {sorted.length}
            </div>
            <div className="flex items-center gap-1">
              <button disabled={currentPage <= 1} onClick={() => setPage((p) => p - 1)} className="p-1.5 rounded-md border border-line dark:border-ink-700 disabled:opacity-40">
                <ChevronLeft size={14} />
              </button>
              <span>
                Page {currentPage} / {totalPages}
              </span>
              <button disabled={currentPage >= totalPages} onClick={() => setPage((p) => p + 1)} className="p-1.5 rounded-md border border-line dark:border-ink-700 disabled:opacity-40">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
