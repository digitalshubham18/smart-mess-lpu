import { useMemo, useState } from 'react'
import { MEAL_TYPES } from '@/data/mockOperations'
import { buildMenuForDate, ITEMS_BY_ID } from '@/data/mockMenus'
import { addDaysISO, TODAY_ISO, formatShort, formatWeekday } from '@/utils/dateUtils'
import { DashboardCard } from '@/components/ui/DashboardCard'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Leaf, Beef } from 'lucide-react'
import { DemoBanner } from '@/components/ui/DemoBanner'

export default function Meals() {
  const [weekStart] = useState(TODAY_ISO)
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i)), [weekStart])

  return (
    <div className="space-y-6">
      <DemoBanner what={'Menus are sample data.'} />
      <div>
        <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100">Meals This Week</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Every meal, every day — with its scheduled menu.</p>
      </div>

      <div className="grid gap-4">
        {days.map((date) => (
          <DashboardCard key={date} title={`${formatWeekday(date)} · ${formatShort(date)}`}>
            <div className="grid md:grid-cols-4 gap-3">
              {MEAL_TYPES.map((mt) => {
                const menu = buildMenuForDate(date, mt.key)
                const items = menu.itemIds.map((id) => ITEMS_BY_ID[id]).filter(Boolean)
                const veg = items.every((i) => i.veg)
                return (
                  <div key={mt.key} className="rounded-lg bg-surface dark:bg-ink-800 p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{mt.label}</span>
                      <StatusBadge tone={veg ? 'success' : 'neutral'}>
                        {veg ? <Leaf size={11} /> : <Beef size={11} />}
                      </StatusBadge>
                    </div>
                    <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-0.5">
                      {items.map((i) => <li key={i.id}>{i.name}</li>)}
                    </ul>
                  </div>
                )
              })}
            </div>
          </DashboardCard>
        ))}
      </div>
    </div>
  )
}
