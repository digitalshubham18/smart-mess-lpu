import { useEffect, useState } from 'react'
import { ScrollText, X } from 'lucide-react'
import type { AuditAction, AuditLogEntry } from '@/types'
import * as auditService from '@/services/auditService'
import { messName } from '@/data/mockMesses'
import { ROLE_LABELS } from '@/data/mockUsers'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'

const ACTION_LABELS: Record<AuditAction, string> = {
  staff_added: 'Staff added',
  staff_removed: 'Staff removed',
  hostel_created: 'Hostel created',
  student_transferred: 'Student transferred',
  change_request_resolved: 'Change request resolved',
  event_added: 'Event added',
  event_updated: 'Event updated',
  event_deleted: 'Event deleted',
  parent_access_granted: 'Parent access granted',
  meal_checked_in: 'Meal checked in',
  no_show_warning_issued: 'No-show warning issued',
  no_show_fine_issued: 'No-show fine issued',
  student_registered: 'Student registered',
  fine_paid: 'Fine marked paid',
}
const ACTION_TONE: Record<AuditAction, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  staff_added: 'success',
  staff_removed: 'danger',
  hostel_created: 'success',
  student_transferred: 'info',
  change_request_resolved: 'info',
  event_added: 'success',
  event_updated: 'info',
  event_deleted: 'danger',
  parent_access_granted: 'info',
  meal_checked_in: 'success',
  no_show_warning_issued: 'warning',
  no_show_fine_issued: 'danger',
  student_registered: 'success',
  fine_paid: 'success',
}

export default function AuditLog() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState('')
  const [actorId, setActorId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  function refresh() {
    setLoading(true)
    auditService
      .listAuditLog({
        action: (action || undefined) as AuditAction | undefined,
        actorId: actorId.trim() || undefined,
        from: from ? `${from}T00:00:00.000Z` : undefined,
        to: to ? `${to}T23:59:59.999Z` : undefined,
      })
      .then((rows) => {
        setEntries(rows)
        setLoading(false)
      })
  }
  useEffect(refresh, [action, actorId, from, to])

  const hasFilters = action || actorId || from || to
  function clearFilters() {
    setAction('')
    setActorId('')
    setFrom('')
    setTo('')
  }

  const columns: Column<AuditLogEntry>[] = [
    { key: 'at', header: 'When', accessor: (e) => new Date(e.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }), sortValue: (e) => e.at },
    { key: 'action', header: 'Action', accessor: (e) => <StatusBadge tone={ACTION_TONE[e.action] ?? 'neutral'}>{ACTION_LABELS[e.action] ?? e.action}</StatusBadge>, sortValue: (e) => e.action },
    { key: 'summary', header: 'Details', accessor: (e) => e.summary },
    { key: 'mess', header: 'Mess', accessor: (e) => (e.messId ? messName(e.messId) : '—') },
    {
      key: 'actor', header: 'By', accessor: (e) => (
        <span>{e.actorName} <span className="text-slate-400">({ROLE_LABELS[e.actorRole] ?? e.actorRole}) · {e.actorId}</span></span>
      ), sortValue: (e) => e.actorName,
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <ScrollText size={20} className="text-tech-500" /> Audit Log
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Who did what, across every mess at LPU — now a real, persisted record for backend-side actions (staff changes, registrations, check-ins, warnings, fines), merged with the remaining frontend-only actions (calendar edits, hostel topology, meal-request decisions).</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line dark:border-ink-700 bg-white dark:bg-ink-900 p-3">
        <div>
          <label className="text-xs font-medium text-slate-500 block mb-1">Action</label>
          <select value={action} onChange={(e) => setAction(e.target.value)} className="rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-2.5 py-1.5 text-sm">
            <option value="">All actions</option>
            {Object.entries(ACTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500 block mb-1">Actor UID</label>
          <input value={actorId} onChange={(e) => setActorId(e.target.value)} placeholder="e.g. 10001" className="rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-2.5 py-1.5 text-sm w-32" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500 block mb-1">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-2.5 py-1.5 text-sm" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500 block mb-1">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-2.5 py-1.5 text-sm" />
        </div>
        {hasFilters && (
          <button onClick={clearFilters} className="flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 pb-1.5">
            <X size={13} /> Clear
          </button>
        )}
      </div>

      {!loading && entries.length === 0 ? (
        <p className="text-sm text-slate-400 rounded-lg border border-dashed border-line dark:border-ink-700 p-6 text-center">
          {hasFilters ? 'No audit entries match these filters.' : 'No activity recorded yet — actions like adding staff, transferring a student, or checking a student in will show up here.'}
        </p>
      ) : (
        <DataTable data={entries} columns={columns} loading={loading} rowKey={(e) => e.id} searchableText={(e) => `${e.summary} ${e.actorName}`} pageSize={25} filename="audit-log.csv" />
      )}
    </div>
  )
}
