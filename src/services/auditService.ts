import type { AuditAction, AuditLogEntry, User } from '@/types'
import { api, withDelay } from './api'

/**
 * Two sources, merged: the real backend now persists its own audit entries for the
 * actions that moved to /server (staff added/removed, student registered/transferred,
 * meal check-ins, no-show warnings/fines, fine payments — see server/src/db.js's
 * logAudit). Actions that are still frontend-only (calendar events, hostel topology
 * creation, meal change-request decisions) are logged here, in memory, exactly as
 * before. listAuditLog() merges both, newest first.
 */

const LOCAL_LOG: AuditLogEntry[] = []
let seq = 1

/** Records a frontend-only audit event (one not covered by the real backend). */
export function logEvent(actor: User | null | undefined, action: AuditAction, summary: string, messId?: string) {
  LOCAL_LOG.unshift({
    id: `AUD-${seq++}`,
    at: new Date().toISOString(),
    actorId: actor?.id ?? 'system',
    actorName: actor?.name ?? 'System',
    actorRole: actor?.role ?? 'SUPER_ADMIN',
    action,
    messId,
    summary,
  })
  // Keep the in-memory log bounded for a long demo session.
  if (LOCAL_LOG.length > 500) LOCAL_LOG.length = 500
}

interface RemoteAuditRow {
  id: string
  at: string
  actor_id: string
  actor_name: string
  actor_role: AuditLogEntry['actorRole']
  action: AuditAction
  mess_id: string | null
  summary: string
}

export interface AuditLogFilters {
  messId?: string
  actorId?: string
  action?: AuditAction
  /** ISO date/datetime, inclusive */
  from?: string
  /** ISO date/datetime, inclusive */
  to?: string
}

export async function listAuditLog(filters: AuditLogFilters = {}): Promise<AuditLogEntry[]> {
  let remote: AuditLogEntry[] = []
  try {
    const { data } = await api.get<RemoteAuditRow[]>('/audit-log', { params: filters })
    remote = data.map((r) => ({ id: r.id, at: r.at, actorId: r.actor_id, actorName: r.actor_name, actorRole: r.actor_role, action: r.action, messId: r.mess_id ?? undefined, summary: r.summary }))
  } catch {
    // Real API not reachable — the merged log just falls back to local-only entries.
  }
  let local = LOCAL_LOG
  if (filters.messId) local = local.filter((e) => e.messId === filters.messId)
  if (filters.actorId) local = local.filter((e) => e.actorId === filters.actorId)
  if (filters.action) local = local.filter((e) => e.action === filters.action)
  if (filters.from) local = local.filter((e) => e.at >= filters.from!)
  if (filters.to) local = local.filter((e) => e.at <= filters.to!)
  const merged = [...remote, ...local].sort((a, b) => b.at.localeCompare(a.at))
  return withDelay(merged, 150)
}
