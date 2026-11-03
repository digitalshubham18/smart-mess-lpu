import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'
import { Users, Target, CheckCircle2, ChefHat, Leaf, IndianRupee, PiggyBank, Gauge, ShieldCheck, Megaphone } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useMeals } from '@/hooks/useMeals'
import { useChangeRequestsStore } from '@/store/useChangeRequestsStore'
import { StatCard, ChartCard, DashboardCard } from '@/components/ui/DashboardCard'
import { AlertCard } from '@/components/ui/AlertCard'
import { AIInsight } from '@/components/ui/AIInsight'
import { SustainabilityScore } from '@/components/ui/SustainabilityScore'
import { MealCard } from '@/components/ui/MealCard'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { formatINR, formatKg, formatNumber, formatPct } from '@/utils/formatters'
import { formatFull, TODAY_ISO, addDaysISO } from '@/utils/dateUtils'
import { getDashboardKPIs, forecastVsActualSeries, wasteTrendSeries, generateAIInsights, detectAnomalies, getSustainability, collegeWideWasteSummary, getCollegeWideKPIsToday, type DashboardKPIs } from '@/services/analyticsService'
import { getIntention, setIntention, isConfirmationClosed, submitChangeRequest } from '@/services/mealService'
import * as studentService from '@/services/studentService'
import { setLeave as setLeaveApi } from '@/services/studentService'
import { StudentAvatar } from '@/components/ui/StudentAvatar'
import type { Student } from '@/types'
import { MEAL_TYPES } from '@/data/mockOperations'
import { buildMenuForDate, ITEMS_BY_ID } from '@/data/mockMenus'
import { RequestChangeModal } from '@/components/ui/RequestChangeModal'
import { STUDENTS } from '@/data/mockStudents'
import { DEMO_USERS } from '@/data/mockUsers'
import { MESSES, messName, messIdForHostel } from '@/data/mockMesses'
import { hostelName } from '@/data/mockHostels'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useMessStore } from '@/store/useMessStore'
import { DemoBanner } from '@/components/ui/DemoBanner'

export default function Dashboard() {
  const { user } = useAuth()
  if (user?.role === 'STUDENT') return <StudentDashboard studentId={user.studentId ?? '21000001'} />
  if (user?.role === 'PARENT') return <ParentDashboard studentId={user.studentId ?? ''} />
  return <OperationsDashboard />
}

function OperationsDashboard() {
  const { user } = useAuth()
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  const isMessAdmin = user?.role === 'ADMIN'
  const messId = useMessStore((s) => s.currentMessId)
  const [kpis, setKpis] = useState<DashboardKPIs | null>(null)
  const [collegeKpis, setCollegeKpis] = useState<Awaited<ReturnType<typeof getCollegeWideKPIsToday>> | null>(null)
  const { meals, loading: mealsLoading } = useMeals(TODAY_ISO)
  const insights = generateAIInsights(messId)
  const anomalies = detectAnomalies(messId)
  const sustainability = getSustainability(messId)
  const fvActual = forecastVsActualSeries(messId, 14)
  const wasteTrend = wasteTrendSeries(messId, 14)
  const pendingRequests = useChangeRequestsStore((s) => s.pendingCount)
  const staffCount = DEMO_USERS.filter((u) => u.role !== 'STUDENT').length
  const messStaffCount = DEMO_USERS.filter((u) => u.role !== 'STUDENT' && u.role !== 'SUPER_ADMIN' && u.hostelId && messName(messId) && MESSES.find((m) => m.id === messId)?.hostelIds.includes(u.hostelId)).length
  const wasteSummary = isSuperAdmin ? collegeWideWasteSummary() : null

  useEffect(() => {
    getDashboardKPIs(messId, TODAY_ISO).then(setKpis)
  }, [messId])

  useEffect(() => {
    if (isSuperAdmin) getCollegeWideKPIsToday(TODAY_ISO).then(setCollegeKpis)
  }, [isSuperAdmin])

  return (
    <div className="space-y-7">
      <DemoBanner what={'Some figures on this dashboard are sample data (the real ones are attendance, the roster and forecasts).'} />
      <div>
        <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100">{isSuperAdmin ? 'Super Admin Overview' : isMessAdmin ? 'Mess Admin Overview' : "Today's Overview"}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">{formatFull(TODAY_ISO)} · Viewing {messName(messId)}</p>
      </div>

      {isSuperAdmin && (
        <div className="rounded-xl bg-ink-950 text-white p-5">
          <div className="flex items-center gap-2 text-tech-500 text-xs font-semibold uppercase tracking-wide mb-3">
            <ShieldCheck size={14} /> Super Admin only · University-wide (all {MESSES.length} messes)
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg bg-white/5 p-3">
              <div className="text-[10px] text-slate-400">Total Students</div>
              <div className="text-xl font-bold font-display mt-0.5">{formatNumber(STUDENTS.length)}</div>
            </div>
            <div className="rounded-lg bg-white/5 p-3">
              <div className="text-[10px] text-slate-400">Staff Accounts</div>
              <div className="text-xl font-bold font-display mt-0.5">{staffCount}</div>
            </div>
            <div className="rounded-lg bg-white/5 p-3">
              <div className="text-[10px] text-slate-400">Pending Meal Requests</div>
              <div className="text-xl font-bold font-display mt-0.5 text-amber-400">{pendingRequests}</div>
            </div>
            <Link to="/notifications" className="rounded-lg bg-tech-500 hover:bg-tech-600 p-3 flex flex-col justify-center items-center gap-1 transition-colors">
              <Megaphone size={16} />
              <span className="text-xs font-semibold">Send Announcement</span>
            </Link>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
            <div className="rounded-lg bg-white/5 p-3">
              <div className="text-[10px] text-slate-400">Today's Waste (all messes)</div>
              <div className="text-xl font-bold font-display mt-0.5 text-rose-400">{collegeKpis ? formatKg(collegeKpis.foodWastedKg) : '—'}</div>
            </div>
            <div className="rounded-lg bg-white/5 p-3">
              <div className="text-[10px] text-slate-400">Today's Waste Cost (all messes)</div>
              <div className="text-xl font-bold font-display mt-0.5 text-rose-400">{collegeKpis ? formatINR(collegeKpis.wasteCost) : '—'}</div>
            </div>
            <div className="rounded-lg bg-white/5 p-3">
              <div className="text-[10px] text-slate-400">Total Waste — Last 90 Days</div>
              <div className="text-xl font-bold font-display mt-0.5 text-rose-400">{wasteSummary ? formatKg(wasteSummary.totalWasteKg) : '—'}</div>
            </div>
          </div>

          {wasteSummary && (
            <div className="mt-3 rounded-lg bg-white/5 p-3">
              <div className="text-[10px] text-slate-400 mb-2">Waste by mess (last 90 days) — {formatINR(wasteSummary.totalWasteCost)} total cost</div>
              <div className="space-y-1.5">
                {wasteSummary.perMess.map((m) => (
                  <div key={m.messId} className="flex items-center justify-between text-xs">
                    <span className="text-slate-300">{m.messName}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-slate-400">{m.wastePct}% rate</span>
                      <span className="font-semibold">{formatKg(m.totalWasteKg)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {isMessAdmin && (
        <div className="rounded-xl border border-tech-500/30 bg-tech-500/5 p-4 flex items-center gap-2">
          <ShieldCheck size={14} className="text-tech-500 shrink-0" />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            You're the Mess Admin for <strong className="text-slate-700 dark:text-slate-200">{messName(messId)}</strong> — {messStaffCount} staff, scoped to this mess only. University-wide data is visible to the Super Admin only.
          </p>
        </div>
      )}

      {!kpis ? (
        <LoadingSpinner label="Loading KPIs…" />
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <StatCard label="Expected Students" value={formatNumber(kpis.expectedToday)} icon={Users} accent="tech" />
          <StatCard label="Actual Attendance" value={formatNumber(kpis.actualAttendanceToday)} icon={CheckCircle2} accent="eco" />
          <StatCard label="Meals Prepared" value={formatKg(kpis.mealsPrepared)} icon={ChefHat} accent="neutral" />
          <StatCard label="Food Wasted" value={formatKg(kpis.foodWastedKg)} sub={formatPct(kpis.wastePct)} icon={Leaf} accent="rose" />
          <StatCard label="Forecast Accuracy" value={formatPct(kpis.forecastAccuracy)} icon={Target} accent="tech" />
          <StatCard label="Waste Cost Today" value={formatINR(kpis.wasteCost)} icon={IndianRupee} accent="rose" />
          <StatCard label="Money Saved (est.)" value={formatINR(kpis.moneySaved)} icon={PiggyBank} accent="eco" />
          <StatCard label="Meals Consumed" value={formatKg(kpis.mealsConsumed)} icon={Gauge} accent="neutral" />
        </div>
      )}

      <div>
        <h2 className="font-display font-semibold text-slate-800 dark:text-slate-100 mb-3">Meal-by-Meal Breakdown</h2>
        {mealsLoading ? (
          <LoadingSpinner />
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {meals.map((m) => {
              const mt = MEAL_TYPES.find((x) => x.key === m.meal)!
              return (
                <DashboardCard key={m.meal} title={mt.label}>
                  <div className="space-y-1.5 text-xs">
                    <Row label="Expected" value={formatNumber(m.predictedStudents)} />
                    <Row label="Actual" value={m.actualStudents != null ? formatNumber(m.actualStudents) : '—'} />
                    <Row label="Prepared" value={m.preparedKg != null ? formatKg(m.preparedKg) : '—'} />
                    <Row label="Consumed" value={m.consumedKg != null ? formatKg(m.consumedKg) : '—'} />
                    <Row label="Waste" value={m.wasteKg != null ? formatKg(m.wasteKg) : '—'} highlight />
                  </div>
                </DashboardCard>
              )
            })}
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <ChartCard title="Demand Forecast — Predicted vs Actual" subtitle="Last 14 days">
          <LineChart data={fvActual}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-line dark:stroke-ink-700" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => d.slice(5)} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="predicted" name="Predicted" stroke="#3554D1" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="actual" name="Actual" stroke="#1F8A5F" strokeWidth={2} dot={false} />
          </LineChart>
        </ChartCard>
        <ChartCard title="Food Waste Trend" subtitle="kg per day, last 14 days">
          <AreaChart data={wasteTrend}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-line dark:stroke-ink-700" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => d.slice(5)} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Area type="monotone" dataKey="wasteKg" name="Waste (kg)" stroke="#C0392B" fill="#C0392B" fillOpacity={0.15} strokeWidth={2} />
          </AreaChart>
        </ChartCard>
      </div>

      {anomalies.length > 0 && (
        <div className="space-y-2.5">
          <h2 className="font-display font-semibold text-slate-800 dark:text-slate-100">Alerts</h2>
          {anomalies.map((a) => (
            <AlertCard key={a.id} tone={a.severity === 'high' ? 'danger' : 'warning'} title="Anomaly detected" description={a.text} />
          ))}
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-2.5">
          <h2 className="font-display font-semibold text-slate-800 dark:text-slate-100">AI Insights</h2>
          <div className="grid sm:grid-cols-2 gap-2.5">
            {insights.map((i) => <AIInsight key={i.id} insight={i} />)}
          </div>
        </div>
        <DashboardCard title="Sustainability Score">
          <SustainabilityScore score={sustainability.score} badge={sustainability.badge} />
        </DashboardCard>
      </div>
    </div>
  )
}

function StudentDashboard({ studentId }: { studentId: string }) {
  const { user } = useAuth()
  const tomorrow = addDaysISO(TODAY_ISO, 1)
  const { meals: todayMeals } = useMeals(TODAY_ISO)
  const { meals: tomorrowMeals } = useMeals(tomorrow)
  const [intentions, setIntentions] = useState<Record<string, MealIntentionStatus>>({})
  const [requestTarget, setRequestTarget] = useState<{ meal: string; menuLabel: string } | null>(null)
  const [leaveUntil, setLeaveUntil] = useState<string | undefined>(undefined)
  const [leaveDraft, setLeaveDraft] = useState('')

  useEffect(() => {
    studentService.getStudent(studentId).then((s) => setLeaveUntil(s?.leaveUntil))
  }, [studentId])

  useEffect(() => {
    MEAL_TYPES.forEach((mt) => {
      getIntention(studentId, tomorrow, mt.key).then((rec) => {
        setIntentions((prev) => ({ ...prev, [mt.key]: rec?.status ?? 'unconfirmed' }))
      })
    })
  }, [studentId, tomorrow])

  const [pickError, setPickError] = useState('')
  async function pick(meal: string, status: 'will_eat' | 'will_not') {
    setPickError('')
    try {
      await setIntention(studentId, tomorrow, meal as any, status)
      setIntentions((prev) => ({ ...prev, [meal]: status }))
    } catch (e) {
      setPickError(e instanceof Error ? e.message : 'Could not save your choice.')
    }
  }

  async function saveLeave() {
    if (!leaveDraft) return
    await setLeaveApi(studentId, leaveDraft)
    setLeaveUntil(leaveDraft)
    setLeaveDraft('')
  }

  async function clearLeave() {
    await setLeaveApi(studentId, null)
    setLeaveUntil(undefined)
  }

  const onLeave = !!leaveUntil && leaveUntil >= TODAY_ISO
  const closed = onLeave || isConfirmationClosed(tomorrow)

  return (
    <div className="space-y-7">
      <DemoBanner what={'Some figures on this dashboard are sample data (the real ones are attendance, the roster and forecasts).'} />
      {pickError && <div role="alert" className="rounded-lg px-3 py-2 text-xs text-rose-600 bg-rose-50 dark:bg-rose-500/10">{pickError}</div>}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <StudentAvatar studentId={studentId} name={user?.name ?? 'Student'} size={44} />
          <div>
            <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100">Today's Meals</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">{formatFull(TODAY_ISO)}</p>
          </div>
        </div>
        <div className="rounded-lg border border-line dark:border-ink-700 bg-white dark:bg-ink-900 p-3">
          {onLeave ? (
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                <strong className="text-slate-700 dark:text-slate-200">Away until {leaveUntil}</strong> — meals auto-skipped
              </span>
              <button onClick={clearLeave} className="text-xs font-semibold text-tech-600 dark:text-tech-500 hover:underline shrink-0">I'm back</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">Going home?</span>
              <input type="date" min={TODAY_ISO} value={leaveDraft} onChange={(e) => setLeaveDraft(e.target.value)} className="text-xs rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-2 py-1.5" />
              <button onClick={saveLeave} className="text-xs font-semibold text-tech-600 dark:text-tech-500 hover:underline shrink-0">Mark away</button>
            </div>
          )}
        </div>
      </div>
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
        {todayMeals.map((m) => {
          const mt = MEAL_TYPES.find((x) => x.key === m.meal)!
          return <MealCard key={m.meal} title={mt.label} menuLabel={menuLabelFor(TODAY_ISO, m.meal)} />
        })}
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display font-semibold text-slate-800 dark:text-slate-100">Confirm Tomorrow's Meals</h2>
          <span className="text-xs text-slate-400">Marking closes at 2:00 AM · once marked, your choice locks</span>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          {tomorrowMeals.map((m) => {
            const mt = MEAL_TYPES.find((x) => x.key === m.meal)!
            const menuLabel = menuLabelFor(tomorrow, m.meal)
            return (
              <MealCard
                key={m.meal}
                title={mt.label}
                menuLabel={menuLabel}
                cutoffLabel={mt.cutoffLabel}
                closed={closed}
                intentionStatus={onLeave ? 'will_not' : intentions[m.meal] ?? 'unconfirmed'}
                onSelect={onLeave ? undefined : (v) => pick(m.meal, v)}
                onRequestChange={onLeave ? undefined : () => setRequestTarget({ meal: m.meal, menuLabel })}
              />
            )
          })}
        </div>
      </div>

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
              meal: requestTarget.meal as any,
              requestedStatus: status,
              reason,
            })
          }}
        />
      )}
    </div>
  )
}

type MealIntentionStatus = 'will_eat' | 'will_not' | 'unconfirmed'

function ParentDashboard({ studentId }: { studentId: string }) {
  const [student, setStudent] = useState<Student | null>(null)
  const [loading, setLoading] = useState(true)
  const tomorrow = addDaysISO(TODAY_ISO, 1)
  const { meals: tomorrowMeals } = useMeals(tomorrow)
  const [intentions, setIntentions] = useState<Record<string, MealIntentionStatus>>({})

  useEffect(() => {
    if (!studentId) {
      setLoading(false)
      return
    }
    studentService.getStudent(studentId).then((s) => {
      setStudent(s)
      setLoading(false)
    })
  }, [studentId])

  useEffect(() => {
    MEAL_TYPES.forEach((mt) => {
      getIntention(studentId, tomorrow, mt.key).then((rec) => {
        setIntentions((prev) => ({ ...prev, [mt.key]: rec?.status ?? 'unconfirmed' }))
      })
    })
  }, [studentId, tomorrow])

  if (loading) return <p className="text-sm text-slate-400">Loading…</p>

  if (!student) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">No student is linked to this account.</p>
  }

  const onLeave = !!student.leaveUntil && student.leaveUntil >= TODAY_ISO

  return (
    <div className="space-y-7">
      <div className="flex items-center gap-3">
        <StudentAvatar studentId={student.id} name={student.name} size={48} />
        <div>
          <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100">{student.name}'s Meal Plan</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {hostelName(student.hostelId)} · {messName(messIdForHostel(student.hostelId))} · Room {student.room} · Read-only view for {formatFull(TODAY_ISO)}
          </p>
        </div>
      </div>

      {onLeave && (
        <AlertCard tone="warning" title="On leave" description={`Marked away until ${student.leaveUntil} — meals are automatically skipped, no action needed.`} />
      )}

      <div className="grid sm:grid-cols-3 gap-4">
        <StatCard label="Sustainability points" value={formatNumber(student.points)} icon={Leaf} accent="eco" />
        <StatCard label="Badges earned" value={student.badges.length} accent="tech" />
        <StatCard label="Missed cutoffs (all time)" value={student.missedCutoffCount} accent="neutral" />
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display font-semibold text-slate-800 dark:text-slate-100">Tomorrow's Meal Status</h2>
          <span className="text-xs text-slate-400">Read-only — {student.name} confirms their own meals</span>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          {tomorrowMeals.map((m) => {
            const mt = MEAL_TYPES.find((x) => x.key === m.meal)!
            return (
              <MealCard
                key={m.meal}
                title={mt.label}
                menuLabel={menuLabelFor(tomorrow, m.meal)}
                intentionStatus={onLeave ? 'will_not' : intentions[m.meal] ?? 'unconfirmed'}
                closed
              />
            )
          })}
        </div>
      </div>

      {student.badges.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {student.badges.map((b) => <StatusBadge key={b} tone="success">{b}</StatusBadge>)}
        </div>
      )}
    </div>
  )
}

function menuLabelFor(date: string, meal: string) {
  const menu = buildMenuForDate(date as any, meal as any)
  return menu.itemIds.map((id) => ITEMS_BY_ID[id]?.name).filter(Boolean).slice(0, 3).join(' + ')
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-400">{label}</span>
      <span className={highlight ? 'font-semibold text-rose-500' : 'font-medium text-slate-700 dark:text-slate-200'}>{value}</span>
    </div>
  )
}
