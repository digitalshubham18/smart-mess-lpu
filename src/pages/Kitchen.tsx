import { useMemo, useState } from 'react'
import { CheckSquare, Square, ArrowRight } from 'lucide-react'
import { MEAL_TYPES, getRecord } from '@/data/mockOperations'
import { useMessStore } from '@/store/useMessStore'
import { buildMenuForDate, ITEMS_BY_ID } from '@/data/mockMenus'
import { TODAY_ISO, formatFull } from '@/utils/dateUtils'
import { DashboardCard } from '@/components/ui/DashboardCard'
import { ProgressBar } from '@/components/ui/StatusBadge'
import { formatKg } from '@/utils/formatters'
import { DemoBanner } from '@/components/ui/DemoBanner'

const WORKFLOW = ['Forecast', 'Meal Plan', 'Ingredient Calc', 'Inventory Check', 'Procurement', 'Food Prep', 'Meal Service', 'Consumption', 'Leftover', 'Waste Recording', 'Analytics', 'Next Forecast']

export default function Kitchen() {
  const messId = useMessStore((s) => s.currentMessId)
  const [tasks, setTasks] = useState(() => buildTasks())
  const done = tasks.filter((t) => t.done).length

  function toggle(id: string) {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)))
  }

  return (
    <div className="space-y-6">
      <DemoBanner what={'Preparation quantities shown here come from sample data.'} />
      <div>
        <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100">Kitchen Dashboard</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">{formatFull(TODAY_ISO)}</p>
      </div>

      <DashboardCard title="Today's Tasks" action={<span className="text-xs font-semibold text-slate-500">{done}/{tasks.length} completed</span>}>
        <ProgressBar value={done} max={tasks.length} tone="success" />
        <ul className="mt-4 space-y-1.5">
          {tasks.map((t) => (
            <li key={t.id}>
              <button onClick={() => toggle(t.id)} className="w-full flex items-center gap-2.5 text-sm text-left px-2 py-2 rounded-lg hover:bg-surface-dim dark:hover:bg-ink-800">
                {t.done ? <CheckSquare size={16} className="text-eco-500 shrink-0" /> : <Square size={16} className="text-slate-400 shrink-0" />}
                <span className={t.done ? 'line-through text-slate-400' : 'text-slate-700 dark:text-slate-200'}>{t.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </DashboardCard>

      <div>
        <h2 className="font-display font-semibold text-slate-800 dark:text-slate-100 mb-3">Today's Production Requirements</h2>
        <div className="grid md:grid-cols-2 gap-4">
          {MEAL_TYPES.map((mt) => {
            const rec = getRecord(messId, TODAY_ISO, mt.key)
            const menu = buildMenuForDate(TODAY_ISO, mt.key)
            const items = menu.itemIds.map((id) => ITEMS_BY_ID[id]).filter(Boolean)
            return (
              <DashboardCard key={mt.key} title={mt.label}>
                <p className="text-xs text-slate-400 mb-2">Recommended: {rec ? formatKg(rec.recommendedKg) : '—'} for {rec?.predictedStudents ?? '—'} students</p>
                <ul className="text-sm text-slate-600 dark:text-slate-300 space-y-1">
                  {items.map((i) => <li key={i.id}>{i.name}</li>)}
                </ul>
              </DashboardCard>
            )
          })}
        </div>
      </div>

      <DashboardCard title="Meal Production Workflow">
        <div className="flex flex-wrap items-center gap-2">
          {WORKFLOW.map((step, i) => (
            <div key={step} className="flex items-center gap-2">
              <span className="text-xs font-medium px-2.5 py-1.5 rounded-full bg-surface dark:bg-ink-800 text-slate-600 dark:text-slate-300">{step}</span>
              {i < WORKFLOW.length - 1 && <ArrowRight size={12} className="text-slate-300" />}
            </div>
          ))}
        </div>
      </DashboardCard>
    </div>
  )
}

function buildTasks() {
  const base = ['Check inventory levels', 'Prepare rice', 'Prepare dal', 'Prepare vegetables', 'Prepare roti', 'Prepare curry / protein', 'Set up serving counters', 'Record actual attendance', 'Record leftovers', 'Record waste']
  return base.map((label, i) => ({ id: `T-${i}`, label, done: i < 3 }))
}
