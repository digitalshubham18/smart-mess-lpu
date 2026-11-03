import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import type { CalendarEvent, EventType } from '@/types'
import * as eventService from '@/services/eventService'
import { PURCHASE_ORDERS } from '@/data/mockPurchaseOrders'
import { INVENTORY } from '@/data/mockInventory'
import { TODAY_ISO } from '@/utils/dateUtils'
import { useAuth } from '@/hooks/useAuth'
import { Modal, ConfirmDialog } from '@/components/ui/Modal'
import { DemoBanner } from '@/components/ui/DemoBanner'

const EVENT_COLORS: Record<string, string> = {
  holiday: 'bg-rose-500', exam: 'bg-amber-500', event: 'bg-tech-500', festival: 'bg-eco-500', sports: 'bg-purple-500', vacation: 'bg-slate-400',
}
const EVENT_TYPES: EventType[] = ['holiday', 'exam', 'event', 'festival', 'sports', 'vacation']

interface EventForm { title: string; date: string; type: EventType; demandImpactPct: number }

export default function CalendarPage() {
  const { user } = useAuth()
  // Deliveries and stock expiries are the kitchen's internal business — students and parents see only campus events.
  const seesOperations = !!user && user.role !== 'STUDENT' && user.role !== 'PARENT'
  const canEdit = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.role === 'MESS_MANAGER'
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [showForm, setShowForm] = useState<{ date?: string; edit?: CalendarEvent } | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [cursor, setCursor] = useState(() => {
    const d = new Date(TODAY_ISO)
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })

  function refresh() {
    eventService.listEvents().then(setEvents)
  }
  useEffect(refresh, [])

  const monthLabel = cursor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
  const firstWeekday = cursor.getDay()

  const entriesByDate = useMemo(() => {
    const map: Record<string, { label: string; color: string; event?: CalendarEvent }[]> = {}
    events.forEach((e) => {
      map[e.date] ??= []
      map[e.date].push({ label: e.title, color: EVENT_COLORS[e.type], event: e })
    })
    if (seesOperations) {
      PURCHASE_ORDERS.forEach((po) => {
        map[po.deliveryDate] ??= []
        map[po.deliveryDate].push({ label: `${po.poNumber} delivery`, color: 'bg-tech-500' })
      })
      INVENTORY.forEach((i) => {
        map[i.expiryDate] ??= []
        map[i.expiryDate].push({ label: `${i.name} expires`, color: 'bg-rose-500' })
      })
    }
    return map
  }, [events, seesOperations])

  const cells: (string | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => {
      const d = new Date(cursor.getFullYear(), cursor.getMonth(), i + 1)
      return d.toISOString().slice(0, 10)
    }),
  ]

  return (
    <div className="space-y-6">
      <DemoBanner what={'Events are sample data; changes are not saved.'} />
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100">Operational Calendar</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {seesOperations ? 'Holidays, exams, festivals, deliveries, and expiries — all in one view.' : 'Holidays, exams, festivals and campus events.'}
            {canEdit && ' Click a day to add an event, or an event chip to edit it.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <button onClick={() => setShowForm({ date: TODAY_ISO })} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-tech-500 text-white">
              <Plus size={13} /> Add event
            </button>
          )}
          <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} className="p-1.5 rounded-lg border border-line dark:border-ink-700"><ChevronLeft size={15} /></button>
          <span className="text-sm font-semibold w-36 text-center">{monthLabel}</span>
          <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} className="p-1.5 rounded-lg border border-line dark:border-ink-700"><ChevronRight size={15} /></button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-slate-500 dark:text-slate-400">
        {Object.entries(EVENT_COLORS).map(([k, c]) => (
          <span key={k} className="flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${c}`} /> {k}</span>
        ))}
      </div>

      <div className="rounded-xl border border-line dark:border-ink-700 bg-white dark:bg-ink-900 overflow-hidden">
        <div className="grid grid-cols-7 text-center text-xs font-semibold text-slate-400 border-b border-line dark:border-ink-700">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="py-2">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((date, i) => (
            <div
              key={i}
              onClick={() => canEdit && date && setShowForm({ date })}
              className={`min-h-24 border-b border-r border-line dark:border-ink-700 p-1.5 ${date === TODAY_ISO ? 'bg-tech-50 dark:bg-tech-500/10' : ''} ${canEdit && date ? 'cursor-pointer hover:bg-surface-dim dark:hover:bg-ink-800' : ''}`}
            >
              {date && (
                <>
                  <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{date.slice(-2)}</div>
                  <div className="mt-1 space-y-0.5">
                    {(entriesByDate[date] ?? []).slice(0, 3).map((e, idx) => (
                      <div
                        key={idx}
                        onClick={(ev) => {
                          if (e.event && canEdit) {
                            ev.stopPropagation()
                            setShowForm({ edit: e.event })
                          }
                        }}
                        className={`text-[9px] px-1 py-0.5 rounded text-white truncate ${e.color} ${e.event && canEdit ? 'hover:opacity-80' : ''}`}
                      >
                        {e.label}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {canEdit && showForm && (
        <Modal open onClose={() => setShowForm(null)} title={showForm.edit ? 'Edit event' : 'Add calendar event'}>
          <EventFormFields
            initial={showForm.edit}
            defaultDate={showForm.date}
            onDelete={showForm.edit ? () => { setDeleteId(showForm.edit!.id); setShowForm(null) } : undefined}
            onSubmit={async (data) => {
              if (showForm.edit) await eventService.updateEvent(showForm.edit.id, data, user)
              else await eventService.addEvent(data, user)
              setShowForm(null)
              refresh()
            }}
          />
        </Modal>
      )}

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && eventService.deleteEvent(deleteId, user).then(refresh)}
        title="Delete this event?"
        danger
        confirmLabel="Delete"
      />
    </div>
  )
}

function EventFormFields({ initial, defaultDate, onSubmit, onDelete }: { initial?: CalendarEvent; defaultDate?: string; onSubmit: (data: EventForm) => void; onDelete?: () => void }) {
  const { register, handleSubmit } = useForm<EventForm>({
    defaultValues: initial ?? { title: '', date: defaultDate ?? TODAY_ISO, type: 'event', demandImpactPct: 0 },
  })
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
      <input {...register('title', { required: true })} placeholder="Event title" className="w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm" />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Date</label>
          <input type="date" {...register('date', { required: true })} className="mt-1 w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Type</label>
          <select {...register('type')} className="mt-1 w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm">
            {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Expected demand impact (%)</label>
        <input type="number" {...register('demandImpactPct', { valueAsNumber: true })} placeholder="e.g. -30 for a holiday, +20 for a festival" className="mt-1 w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm" />
        <p className="text-[11px] text-slate-400 mt-1">Used to adjust the demand forecast around this date.</p>
      </div>
      <div className="flex gap-2 pt-1">
        {onDelete && (
          <button type="button" onClick={onDelete} className="flex items-center justify-center gap-1.5 rounded-lg border border-rose-200 text-rose-600 dark:border-rose-500/30 text-sm font-semibold py-2.5 px-4">
            <Trash2 size={14} /> Delete
          </button>
        )}
        <button type="submit" className="flex-1 rounded-lg bg-tech-500 text-white text-sm font-semibold py-2.5">
          {onDelete ? 'Save changes' : 'Add event'}
        </button>
      </div>
    </form>
  )
}
