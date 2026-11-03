import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { MEAL_TYPES } from '@/data/mockOperations'
import {
  getIntention, setIntention, intentionSummary, isConfirmationClosed,
  submitChangeRequest, listChangeRequests, resolveChangeRequest,
  listChangeRequestsForStudent, cancelChangeRequest,
} from '@/services/mealService'
import { buildMenuForDate, ITEMS_BY_ID } from '@/data/mockMenus'
import { MealCard } from '@/components/ui/MealCard'
import { RequestChangeModal } from '@/components/ui/RequestChangeModal'
import { DashboardCard, StatCard } from '@/components/ui/DashboardCard'
import { DatePicker } from '@/components/ui/DatePicker'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { addDaysISO, TODAY_ISO, formatFull } from '@/utils/dateUtils'
import { useMessStore } from '@/store/useMessStore'
import { Users, CheckCircle2, XCircle, Inbox } from 'lucide-react'
import type { MealType, MealChangeRequest } from '@/types'
import { useT } from '@/i18n/useLanguage'

type IntentionStatus = 'will_eat' | 'will_not' | 'unconfirmed'

const STATUS_LABEL: Record<Exclude<IntentionStatus, 'unconfirmed'>, string> = {
  will_eat: 'Going', will_not: "Won't eat",
}

export default function MealIntention() {
  const { user } = useAuth()
  if (user?.role === 'STUDENT') return <StudentIntentions studentId={user.studentId ?? 'S-1000'} />
  return <IntentionSummary />
}

function StudentIntentions({ studentId }: { studentId: string }) {
  const t = useT()
  const { user } = useAuth()
  const tomorrow = addDaysISO(TODAY_ISO, 1)
  const [intentions, setIntentions] = useState<Record<string, IntentionStatus>>({})
  const [requestTarget, setRequestTarget] = useState<{ meal: MealType; menuLabel: string } | null>(null)
  const [myRequests, setMyRequests] = useState<MealChangeRequest[]>([])

  useEffect(() => {
    MEAL_TYPES.forEach((mt) => {
      getIntention(studentId, tomorrow, mt.key).then((rec) => setIntentions((p) => ({ ...p, [mt.key]: rec?.status ?? 'unconfirmed' })))
    })
  }, [studentId, tomorrow])

  function refreshMyRequests() {
    listChangeRequestsForStudent(studentId).then(setMyRequests)
  }
  useEffect(refreshMyRequests, [studentId])

  const [pickError, setPickError] = useState('')
  async function pick(meal: MealType, status: 'will_eat' | 'will_not') {
    setPickError('')
    try {
      await setIntention(studentId, tomorrow, meal, status)
      setIntentions((p) => ({ ...p, [meal]: status }))
    } catch (e) {
      setPickError(e instanceof Error ? e.message : 'Could not save your choice.')
    }
  }

  async function cancel(id: string) {
    await cancelChangeRequest(id, studentId)
    refreshMyRequests()
  }

  const closed = isConfirmationClosed(tomorrow)
  const pendingMine = myRequests.filter((r) => r.status === 'pending')

  return (
    <div className="space-y-6">
      {pickError && <div role="alert" className="rounded-lg px-3 py-2 text-xs text-rose-600 bg-rose-50 dark:bg-rose-500/10">{pickError}</div>}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100">{t('mi.title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('mi.subtitle', { date: formatFull(tomorrow) })}</p>
        </div>
        <span className="text-xs text-slate-400">{t('mi.closes')}</span>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {MEAL_TYPES.map((mt) => {
          const menu = buildMenuForDate(tomorrow, mt.key)
          const menuLabel = menu.itemIds.map((id) => ITEMS_BY_ID[id]?.name).filter(Boolean).join(' + ')
          return (
            <MealCard
              key={mt.key}
              title={mt.label}
              menuLabel={menuLabel}
              cutoffLabel={mt.cutoffLabel}
              closed={closed}
              intentionStatus={intentions[mt.key] ?? 'unconfirmed'}
              onSelect={(v) => pick(mt.key, v)}
              onRequestChange={() => setRequestTarget({ meal: mt.key, menuLabel })}
            />
          )
        })}
      </div>

      {myRequests.length > 0 && (
        <div>
          <h2 className="font-display font-semibold text-slate-800 dark:text-slate-100 mb-3">{t('mi.requests')}</h2>
          <div className="rounded-xl border border-line dark:border-ink-700 bg-white dark:bg-ink-900 divide-y divide-line dark:divide-ink-700">
            {myRequests.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    {MEAL_TYPES.find((m) => m.key === r.meal)?.label} · {r.date} → requesting <strong>{STATUS_LABEL[r.requestedStatus]}</strong>
                  </div>
                  {r.status !== 'pending' && (
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {r.status === 'approved' ? 'Approved' : r.status === 'rejected' ? 'Rejected' : 'Cancelled'}
                      {r.resolvedBy ? ` by ${r.resolvedBy}` : ''}
                    </div>
                  )}
                </div>
                {r.status === 'pending' ? (
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge tone="warning">{t('mi.pending')}</StatusBadge>
                    <button onClick={() => cancel(r.id)} className="text-xs font-semibold text-rose-500 hover:underline">{t('mi.cancel')}</button>
                  </div>
                ) : (
                  <StatusBadge tone={r.status === 'approved' ? 'success' : r.status === 'rejected' ? 'danger' : 'neutral'}>{r.status}</StatusBadge>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {requestTarget && (
        <RequestChangeModal
          open
          onClose={() => setRequestTarget(null)}
          mealLabel={MEAL_TYPES.find((x) => x.key === requestTarget.meal)!.label}
          menuLabel={requestTarget.menuLabel}
          onSubmit={async (status, reason) => {
            await submitChangeRequest({
              studentId,
              studentName: user?.name ?? 'Student',
              date: tomorrow,
              meal: requestTarget.meal,
              requestedStatus: status,
              reason,
            })
            refreshMyRequests()
          }}
        />
      )}
    </div>
  )
}

function IntentionSummary() {
  const { user } = useAuth()
  const messId = useMessStore((s) => s.currentMessId)
  const [date, setDate] = useState(addDaysISO(TODAY_ISO, 1))
  const [summaries, setSummaries] = useState<Record<string, { will_eat: number; will_not: number; unconfirmed: number; total: number }>>({})
  const [requests, setRequests] = useState<MealChangeRequest[]>([])
  const [loadingRequests, setLoadingRequests] = useState(true)

  useEffect(() => {
    MEAL_TYPES.forEach((mt) => {
      intentionSummary(messId, date, mt.key).then((s) => setSummaries((prev) => ({ ...prev, [mt.key]: s })))
    })
  }, [messId, date])

  function refreshRequests() {
    setLoadingRequests(true)
    listChangeRequests(messId).then((r) => {
      setRequests(r)
      setLoadingRequests(false)
    })
  }
  useEffect(refreshRequests, [messId])

  async function decide(id: string, decision: 'approved' | 'rejected') {
    await resolveChangeRequest(id, decision, user?.name ?? 'Mess Admin', user)
    refreshRequests()
    MEAL_TYPES.forEach((mt) => {
      intentionSummary(messId, date, mt.key).then((s) => setSummaries((prev) => ({ ...prev, [mt.key]: s })))
    })
  }

  const pending = requests.filter((r) => r.status === 'pending')
  const resolved = requests.filter((r) => r.status !== 'pending')

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100">Meal Intention Summary</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Aggregate student confirmations, used directly in demand forecasting.</p>
        </div>
        <DatePicker label="Date" value={date} onChange={setDate} min={TODAY_ISO} />
      </div>
      <div className="grid md:grid-cols-2 gap-5">
        {MEAL_TYPES.map((mt) => {
          const s = summaries[mt.key]
          return (
            <DashboardCard key={mt.key} title={mt.label}>
              {!s ? (
                <div className="text-sm text-slate-400">Loading…</div>
              ) : (
                <div className="grid grid-cols-3 gap-2.5">
                  <StatCard label="Will eat" value={s.will_eat} icon={CheckCircle2} accent="eco" />
                  <StatCard label="Will not eat" value={s.will_not} icon={XCircle} accent="rose" />
                  <StatCard label="Unconfirmed" value={s.unconfirmed} icon={Users} accent="neutral" />
                </div>
              )}
            </DashboardCard>
          )
        })}
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <h2 className="font-display font-semibold text-slate-800 dark:text-slate-100">Late Change Requests</h2>
          {pending.length > 0 && <StatusBadge tone="warning">{pending.length} pending</StatusBadge>}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          Students who missed the 2:00 AM cutoff — or who need to change an already-locked choice — land here for review.
        </p>

        {loadingRequests ? (
          <div className="text-sm text-slate-400">Loading…</div>
        ) : requests.length === 0 ? (
          <div className="rounded-xl border border-line dark:border-ink-700 bg-white dark:bg-ink-900 p-8 text-center">
            <Inbox size={22} className="mx-auto text-slate-300" />
            <p className="text-sm text-slate-400 mt-2">No change requests yet.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-line dark:border-ink-700 bg-white dark:bg-ink-900 divide-y divide-line dark:divide-ink-700">
            {[...pending, ...resolved].map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    {r.studentName} · {MEAL_TYPES.find((m) => m.key === r.meal)?.label} · {r.date}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {r.previousStatus === 'unconfirmed' ? 'Missed the cutoff' : `Wants to change from ${r.previousStatus.replace('_', ' ')}`} → requesting{' '}
                    <strong className="text-slate-600 dark:text-slate-300">{STATUS_LABEL[r.requestedStatus]}</strong>
                  </div>
                  {r.reason && <div className="text-xs text-slate-400 italic mt-0.5">"{r.reason}"</div>}
                  {r.status !== 'pending' && (
                    <div className="text-[11px] text-slate-400 mt-1">
                      {r.status === 'approved' ? 'Approved' : 'Rejected'} by {r.resolvedBy}
                    </div>
                  )}
                </div>
                {r.status === 'pending' ? (
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => decide(r.id, 'approved')} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-eco-500 text-white">Approve</button>
                    <button onClick={() => decide(r.id, 'rejected')} className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-line dark:border-ink-700 text-slate-600 dark:text-slate-300">Reject</button>
                  </div>
                ) : (
                  <StatusBadge tone={r.status === 'approved' ? 'success' : 'danger'}>{r.status}</StatusBadge>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
