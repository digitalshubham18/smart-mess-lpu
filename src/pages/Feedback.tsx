import { useCallback, useEffect, useState } from 'react'
import { Star, Loader2 } from 'lucide-react'
import type { MealType } from '@/types'
import { useAuth } from '@/hooks/useAuth'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import * as svc from '@/services/feedbackService'
import type { FeedbackItem, FeedbackSummary, ComplaintState } from '@/services/feedbackService'
import { useMessStore } from '@/store/useMessStore'
import { DashboardCard } from '@/components/ui/DashboardCard'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { MEAL_TYPES } from '@/data/mockOperations'
import { TODAY_ISO, addDaysISO, formatShort } from '@/utils/dateUtils'

const FIELD = 'rounded-lg border border-line dark:border-ink-700 bg-white dark:bg-ink-900 px-3 py-2 text-sm w-full'
const LABEL = 'text-xs font-medium text-slate-500 dark:text-slate-400'
const mealLabel = (m: string) => MEAL_TYPES.find((x) => x.key === m)?.label ?? m
const STATE_TEXT: Record<ComplaintState, string> = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved' }
const STATE_TONE: Record<ComplaintState, 'warning' | 'neutral' | 'success'> = { open: 'warning', in_progress: 'neutral', resolved: 'success' }
const DAYS = [0, 1, 2].map((n) => addDaysISO(TODAY_ISO, -n))
const dayLabel = (d: string, i: number) => (i === 0 ? 'Today' : i === 1 ? 'Yesterday' : formatShort(d))

export default function Feedback() {
  useDocumentTitle('Feedback')
  const { user } = useAuth()
  return user?.role === 'STUDENT' ? <StudentFeedback /> : <StaffFeedback />
}

function Stars({ value, onChange }: { value: number; onChange?: (n: number) => void }) {
  return (
    <div className="flex gap-1" role={onChange ? 'radiogroup' : undefined} aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" disabled={!onChange} role={onChange ? 'radio' : undefined} aria-checked={value === n} aria-label={`${n} star${n === 1 ? '' : 's'}`} onClick={() => onChange?.(n)} className="p-0.5">
          <Star size={22} className={n <= value ? 'fill-amber-400 text-amber-400' : 'text-slate-300 dark:text-slate-600'} />
        </button>
      ))}
    </div>
  )
}

function StudentFeedback() {
  const [mine, setMine] = useState<FeedbackItem[]>([])
  const [loadError, setLoadError] = useState('')
  const load = useCallback(() => { svc.listMine().then((m) => { setMine(m); setLoadError('') }).catch((e) => setLoadError(e instanceof Error ? e.message : 'Could not load.')) }, [])
  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100">Feedback &amp; Complaints</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Ratings are <strong>anonymous</strong> to the mess staff — only the averages and comments are shown, never who wrote them. A complaint carries your name so the manager can answer you.</p>
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <RateForm onDone={load} />
        <ComplaintForm onDone={load} />
      </div>
      <DashboardCard title="What you've sent">
        {loadError && <p role="alert" className="text-xs text-rose-600">{loadError}</p>}
        {mine.length === 0 && !loadError && <p className="text-xs text-slate-400">Nothing yet.</p>}
        <ul className="divide-y divide-line dark:divide-ink-700" data-testid="my-feedback">
          {mine.map((m) => (
            <li key={m.id} className="py-2.5 text-sm">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-slate-700 dark:text-slate-200">{m.kind === 'complaint' ? 'Complaint' : 'Rating'} · {mealLabel(m.meal)} · {formatShort(m.date)}</span>
                {m.kind === 'feedback' && m.rating !== null && <Stars value={m.rating} />}
                {m.kind === 'complaint' && <StatusBadge tone={STATE_TONE[m.status]}>{STATE_TEXT[m.status]}</StatusBadge>}
              </div>
              {m.comment && <p className="text-xs text-slate-500 mt-0.5">{m.comment}</p>}
              {m.response && <p className="text-xs mt-1 rounded-lg bg-eco-50 dark:bg-eco-500/10 text-eco-800 dark:text-eco-300 px-2.5 py-1.5">Reply from the mess: {m.response}</p>}
            </li>
          ))}
        </ul>
      </DashboardCard>
    </div>
  )
}

function RateForm({ onDone }: { onDone: () => void }) {
  const [date, setDate] = useState(DAYS[0])
  const [meal, setMeal] = useState<MealType>('lunch')
  const [rating, setRating] = useState(0)
  const [category, setCategory] = useState<svc.FeedbackCategory>('Taste')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setDone(false)
    try { await svc.submitFeedback({ kind: 'feedback', date, meal, rating, category, ...(comment.trim() ? { comment: comment.trim() } : {}) }); setDone(true); setComment(''); onDone() }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not send that.') } finally { setBusy(false) }
  }
  return (
    <DashboardCard title="Rate a meal">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1"><span className={LABEL}>Day</span><select aria-label="Day" value={date} onChange={(e) => setDate(e.target.value)} className={FIELD}>{DAYS.map((d, i) => <option key={d} value={d}>{dayLabel(d, i)}</option>)}</select></label>
          <label className="flex flex-col gap-1"><span className={LABEL}>Meal</span><select aria-label="Meal" value={meal} onChange={(e) => setMeal(e.target.value as MealType)} className={FIELD}>{MEAL_TYPES.map((mt) => <option key={mt.key} value={mt.key}>{mt.label}</option>)}</select></label>
        </div>
        <Stars value={rating} onChange={setRating} />
        <label className="flex flex-col gap-1"><span className={LABEL}>What is it about?</span><select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value as svc.FeedbackCategory)} className={FIELD}>{svc.FEEDBACK_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="flex flex-col gap-1"><span className={LABEL}>Comment (optional)</span><textarea aria-label="Comment" value={comment} maxLength={1000} rows={2} onChange={(e) => setComment(e.target.value)} className={FIELD} /></label>
        <button type="submit" disabled={rating === 0 || busy} className="w-full rounded-lg bg-tech-500 hover:bg-tech-600 text-white text-sm font-semibold py-2.5 disabled:opacity-60 flex items-center justify-center gap-2">{busy && <Loader2 size={14} className="animate-spin" />}Send rating</button>
        {done && <p role="status" className="text-xs text-eco-600">Thanks — your rating was saved. Rating the same meal again replaces it.</p>}
        {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
      </form>
    </DashboardCard>
  )
}

function ComplaintForm({ onDone }: { onDone: () => void }) {
  const [date, setDate] = useState(DAYS[0])
  const [meal, setMeal] = useState<MealType>('lunch')
  const [category, setCategory] = useState<svc.FeedbackCategory>('Hygiene')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setDone(false)
    try { await svc.submitFeedback({ kind: 'complaint', date, meal, category, comment: comment.trim() }); setDone(true); setComment(''); onDone() }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not send that.') } finally { setBusy(false) }
  }
  return (
    <DashboardCard title="Make a complaint">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1"><span className={LABEL}>Day</span><select aria-label="Complaint day" value={date} onChange={(e) => setDate(e.target.value)} className={FIELD}>{DAYS.map((d, i) => <option key={d} value={d}>{dayLabel(d, i)}</option>)}</select></label>
          <label className="flex flex-col gap-1"><span className={LABEL}>Meal</span><select aria-label="Complaint meal" value={meal} onChange={(e) => setMeal(e.target.value as MealType)} className={FIELD}>{MEAL_TYPES.map((mt) => <option key={mt.key} value={mt.key}>{mt.label}</option>)}</select></label>
        </div>
        <label className="flex flex-col gap-1"><span className={LABEL}>Category</span><select aria-label="Complaint category" value={category} onChange={(e) => setCategory(e.target.value as svc.FeedbackCategory)} className={FIELD}>{svc.FEEDBACK_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="flex flex-col gap-1"><span className={LABEL}>What went wrong?</span><textarea aria-label="What went wrong" value={comment} maxLength={1000} rows={3} onChange={(e) => setComment(e.target.value)} className={FIELD} /></label>
        <p className="text-[11px] text-slate-400">Complaints are not anonymous — the manager sees your name and room so they can reply.</p>
        <button type="submit" disabled={comment.trim().length < 5 || busy} className="w-full rounded-lg border border-line dark:border-ink-700 text-sm font-semibold py-2.5 disabled:opacity-60 flex items-center justify-center gap-2">{busy && <Loader2 size={14} className="animate-spin" />}Send complaint</button>
        {done && <p role="status" className="text-xs text-eco-600">Sent. You'll get a notification when the mess replies.</p>}
        {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
      </form>
    </DashboardCard>
  )
}

function StaffFeedback() {
  const { user } = useAuth()
  const messId = useMessStore((s) => s.currentMessId)
  const canRespond = ['SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER', 'HOSTEL_WARDEN'].includes(user?.role ?? '')
  const [data, setData] = useState<{ items: FeedbackItem[]; summary: FeedbackSummary } | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => { svc.listForMess(messId).then((d) => { setData(d); setError('') }).catch((e) => setError(e instanceof Error ? e.message : 'Could not load.')) }, [messId])
  useEffect(() => { load() }, [load])
  const complaints = (data?.items ?? []).filter((i) => i.kind === 'complaint')
  const comments = (data?.items ?? []).filter((i) => i.kind === 'feedback' && i.comment)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100">Feedback &amp; Complaints</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">The last 30 days. Ratings are anonymous; complaints are named so you can reply.</p>
      </div>
      {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="feedback-summary">
          <Stat label="Average rating" value={data.summary.avgRating === null ? '—' : `${data.summary.avgRating} / 5`} />
          <Stat label="Ratings" value={String(data.summary.count)} />
          <Stat label="Open complaints" value={String(data.summary.openComplaints)} />
          <Stat label="Top topic" value={data.summary.byCategory[0]?.category ?? '—'} />
        </div>
      )}
      {data && (
        <DashboardCard title="By meal">
          <ul className="space-y-1.5 text-sm" data-testid="feedback-by-meal">
            {data.summary.byMeal.map((m) => (
              <li key={m.meal} className="flex items-center gap-3"><span className="w-24 text-slate-600 dark:text-slate-300">{mealLabel(m.meal)}</span>
                <span className="flex-1 h-2 rounded-full bg-surface-dim dark:bg-ink-800 overflow-hidden"><span className="block h-full bg-amber-400" style={{ width: `${((m.avgRating ?? 0) / 5) * 100}%` }} /></span>
                <span className="w-24 text-right text-xs text-slate-500">{m.avgRating === null ? 'no ratings' : `${m.avgRating} (${m.count})`}</span></li>
            ))}
          </ul>
        </DashboardCard>
      )}
      <DashboardCard title={`Complaints (${complaints.length})`}>
        {complaints.length === 0 && <p className="text-xs text-slate-400">No complaints in this period.</p>}
        <ul className="divide-y divide-line dark:divide-ink-700">
          {complaints.map((c) => <ComplaintRow key={c.id} c={c} canRespond={canRespond} onChanged={load} />)}
        </ul>
      </DashboardCard>
      <DashboardCard title="Recent comments (anonymous)">
        {comments.length === 0 && <p className="text-xs text-slate-400">No written comments yet.</p>}
        <ul className="space-y-2 text-sm">{comments.slice(0, 15).map((c) => <li key={c.id}><span className="text-xs text-slate-400">{mealLabel(c.meal)} · {formatShort(c.date)} · {c.category} · {c.rating}/5</span><br />{c.comment}</li>)}</ul>
      </DashboardCard>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-line dark:border-ink-700 bg-white dark:bg-ink-900 p-3.5"><div className="text-[11px] text-slate-400">{label}</div><div className="font-display text-lg font-bold text-slate-800 dark:text-slate-100">{value}</div></div>
}

function ComplaintRow({ c, canRespond, onChanged }: { c: FeedbackItem; canRespond: boolean; onChanged: () => void }) {
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function act(patch: { status?: ComplaintState; response?: string }) {
    setBusy(true); setError('')
    try { await svc.respond(c.id, patch); setReply(''); onChanged() } catch (e) { setError(e instanceof Error ? e.message : 'Could not update.') } finally { setBusy(false) }
  }
  return (
    <li className="py-3 text-sm" data-testid="complaint-row">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium text-slate-700 dark:text-slate-200">{c.studentName ?? 'Student'}{c.studentRoom ? ` · room ${c.studentRoom}` : ''}</span>
        <span className="text-xs text-slate-400">{mealLabel(c.meal)} · {formatShort(c.date)} · {c.category}</span>
        <StatusBadge tone={STATE_TONE[c.status]}>{STATE_TEXT[c.status]}</StatusBadge>
      </div>
      <p className="mt-1 text-slate-600 dark:text-slate-300">{c.comment}</p>
      {c.response && <p className="mt-1 text-xs rounded-lg bg-eco-50 dark:bg-eco-500/10 text-eco-800 dark:text-eco-300 px-2.5 py-1.5">Your reply: {c.response}</p>}
      {canRespond && c.status !== 'resolved' && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input aria-label={`Reply to ${c.studentName ?? 'student'}`} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write a reply…" maxLength={1000} className={`${FIELD} flex-1 min-w-[12rem]`} />
          <button disabled={busy || !reply.trim()} onClick={() => void act({ response: reply.trim(), status: 'in_progress' })} className="rounded-lg border border-line dark:border-ink-700 text-xs font-semibold py-2 px-3 disabled:opacity-60">Reply</button>
          <button disabled={busy} onClick={() => void act({ status: 'resolved', ...(reply.trim() ? { response: reply.trim() } : {}) })} className="rounded-lg bg-eco-600 hover:bg-eco-700 text-white text-xs font-semibold py-2 px-3 disabled:opacity-60">Mark resolved</button>
        </div>
      )}
      {error && <p role="alert" className="mt-1 text-xs text-rose-600">{error}</p>}
    </li>
  )
}
