import { useEffect, useMemo, useState } from 'react'
import { Plus, Copy, Sparkles, Trash2, Pencil } from 'lucide-react'
import type { MealType, MenuItem } from '@/types'
import { MEAL_TYPES } from '@/data/mockOperations'
import { getMenu, setMenuItems, duplicateWeek } from '@/services/mealService'
import { listMenuItems, addMenuItem, deleteMenuItem } from '@/services/menuItemService'
import { randomSpecialMenuLabel } from '@/data/mockMenus'
import { mealPopularityRanking } from '@/services/analyticsService'
import { addDaysISO, TODAY_ISO, formatShort, formatWeekday } from '@/utils/dateUtils'
import { DashboardCard } from '@/components/ui/DashboardCard'
import { Modal } from '@/components/ui/Modal'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { menuItemSchema, type MenuItemForm } from '@/utils/validators'
import { useMessStore } from '@/store/useMessStore'
import { DemoBanner } from '@/components/ui/DemoBanner'

export default function MenuPlanner() {
  const [weekStart, setWeekStart] = useState(TODAY_ISO)
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i)), [weekStart])
  const [grid, setGrid] = useState<Record<string, MenuItem[]>>({})
  const [allItems, setAllItems] = useState<MenuItem[]>([])
  const [editing, setEditing] = useState<{ date: string; meal: MealType } | null>(null)
  const [showCatalog, setShowCatalog] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    listMenuItems().then(setAllItems)
  }, [showCatalog])

  useEffect(() => {
    let active = true
    async function load() {
      const next: Record<string, MenuItem[]> = {}
      for (const date of days) {
        for (const mt of MEAL_TYPES) {
          const menu = await getMenu(date, mt.key)
          next[`${date}|${mt.key}`] = menu.itemIds.map((id) => allItems.find((i) => i.id === id)).filter(Boolean) as MenuItem[]
        }
      }
      if (active) setGrid(next)
    }
    if (allItems.length) load()
    return () => {
      active = false
    }
  }, [days, allItems, refreshKey])

  async function duplicatePreviousWeek() {
    const prevWeekStart = addDaysISO(weekStart, -7)
    await duplicateWeek(prevWeekStart, weekStart)
    setRefreshKey((k) => k + 1)
  }

  async function markSpecial(date: string, meal: MealType) {
    const current = grid[`${date}|${meal}`] ?? []
    await setMenuItems(date, meal, current.map((i) => i.id), randomSpecialMenuLabel())
    setRefreshKey((k) => k + 1)
  }

  return (
    <div className="space-y-6">
      <DemoBanner what={'Menus are sample data; changes are not saved.'} />
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100">Weekly Menu Planner</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Week of {formatShort(weekStart)}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setWeekStart((w) => addDaysISO(w, -7))} className="text-xs font-medium px-3 py-2 rounded-lg border border-line dark:border-ink-700">← Prev week</button>
          <button onClick={() => setWeekStart(TODAY_ISO)} className="text-xs font-medium px-3 py-2 rounded-lg border border-line dark:border-ink-700">This week</button>
          <button onClick={() => setWeekStart((w) => addDaysISO(w, 7))} className="text-xs font-medium px-3 py-2 rounded-lg border border-line dark:border-ink-700">Next week →</button>
          <button onClick={duplicatePreviousWeek} className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-line dark:border-ink-700">
            <Copy size={13} /> Duplicate previous week
          </button>
          <button onClick={() => setShowCatalog(true)} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-tech-500 text-white">
            <Plus size={13} /> Manage menu items
          </button>
        </div>
      </div>

      <div className="grid gap-4">
        {days.map((date) => (
          <DashboardCard key={date} title={`${formatWeekday(date)} · ${formatShort(date)}`}>
            <div className="grid md:grid-cols-4 gap-3">
              {MEAL_TYPES.map((mt) => {
                const items = grid[`${date}|${mt.key}`] ?? []
                return (
                  <div key={mt.key} className="rounded-lg bg-surface dark:bg-ink-800 p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{mt.label}</span>
                      <div className="flex gap-1">
                        <button onClick={() => markSpecial(date, mt.key)} title="Mark as special menu" className="text-amber-500"><Sparkles size={13} /></button>
                        <button onClick={() => setEditing({ date, meal: mt.key })} title="Edit menu" className="text-slate-400"><Pencil size={13} /></button>
                      </div>
                    </div>
                    <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-0.5 min-h-[40px]">
                      {items.map((i) => <li key={i.id}>{i.name}</li>)}
                    </ul>
                  </div>
                )
              })}
            </div>
          </DashboardCard>
        ))}
      </div>

      <PopularityRanking allItems={allItems} />

      {editing && (
        <EditMenuModal
          date={editing.date}
          meal={editing.meal}
          allItems={allItems}
          current={(grid[`${editing.date}|${editing.meal}`] ?? []).map((i) => i.id)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            setRefreshKey((k) => k + 1)
          }}
        />
      )}

      <Modal open={showCatalog} onClose={() => setShowCatalog(false)} title="Menu Item Catalog" widthClass="max-w-3xl">
        <MenuItemCatalog items={allItems} onChanged={() => listMenuItems().then(setAllItems)} />
      </Modal>
    </div>
  )
}

function EditMenuModal({
  date, meal, allItems, current, onClose, onSaved,
}: { date: string; meal: MealType; allItems: MenuItem[]; current: string[]; onClose: () => void; onSaved: () => void }) {
  const [selected, setSelected] = useState<string[]>(current)

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  return (
    <Modal open onClose={onClose} title={`Edit ${meal} — ${formatShort(date)}`} widthClass="max-w-md">
      <div className="max-h-72 overflow-y-auto space-y-1">
        {allItems.map((item) => (
          <label key={item.id} className="flex items-center gap-2 text-sm px-2 py-1.5 rounded-md hover:bg-surface-dim dark:hover:bg-ink-800 cursor-pointer">
            <input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggle(item.id)} />
            {item.name}
            <span className="text-[10px] text-slate-400 ml-auto">{item.category}</span>
          </label>
        ))}
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-3.5 py-2 rounded-lg text-sm border border-line dark:border-ink-700">Cancel</button>
        <button
          onClick={async () => {
            await setMenuItems(date, meal, selected)
            onSaved()
          }}
          className="px-3.5 py-2 rounded-lg text-sm font-semibold bg-tech-500 text-white"
        >
          Save menu
        </button>
      </div>
    </Modal>
  )
}

function MenuItemCatalog({ items, onChanged }: { items: MenuItem[]; onChanged: () => void }) {
  const [showForm, setShowForm] = useState(false)
  const { register, handleSubmit, reset } = useForm<MenuItemForm>({ resolver: zodResolver(menuItemSchema) })

  async function onSubmit(data: MenuItemForm) {
    await addMenuItem({ ...data, carbs: 0, fat: 0, fiber: 0 } as any)
    reset()
    setShowForm(false)
    onChanged()
  }

  const columns: Column<MenuItem>[] = [
    { key: 'name', header: 'Name', accessor: (i) => i.name, sortValue: (i) => i.name },
    { key: 'category', header: 'Category', accessor: (i) => i.category, sortValue: (i) => i.category },
    { key: 'veg', header: 'Type', accessor: (i) => <StatusBadge tone={i.veg ? 'success' : 'neutral'}>{i.veg ? 'Veg' : 'Non-veg'}</StatusBadge> },
    { key: 'calories', header: 'Calories', accessor: (i) => i.calories, sortValue: (i) => i.calories },
    { key: 'protein', header: 'Protein (g)', accessor: (i) => i.protein, sortValue: (i) => i.protein },
    {
      key: 'actions', header: '', accessor: (i) => (
        <button onClick={async () => { await deleteMenuItem(i.id); onChanged() }} className="text-rose-500">
          <Trash2 size={14} />
        </button>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowForm((v) => !v)} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-tech-500 text-white">
          <Plus size={13} /> Add item
        </button>
      </div>
      {showForm && (
        <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-2 gap-2 p-3 rounded-lg bg-surface dark:bg-ink-800">
          <input {...register('name')} placeholder="Name" className="rounded-lg border border-line dark:border-ink-700 px-2.5 py-1.5 text-sm bg-white dark:bg-ink-900" />
          <select {...register('category')} className="rounded-lg border border-line dark:border-ink-700 px-2.5 py-1.5 text-sm bg-white dark:bg-ink-900">
            {['Rice', 'Pulses', 'Bread', 'Curry', 'Dairy', 'Salad', 'Fruit', 'Beverage', 'Snack', 'Sweet'].map((c) => <option key={c}>{c}</option>)}
          </select>
          <input type="number" {...register('calories', { valueAsNumber: true })} placeholder="Calories" className="rounded-lg border border-line dark:border-ink-700 px-2.5 py-1.5 text-sm bg-white dark:bg-ink-900" />
          <input type="number" {...register('protein', { valueAsNumber: true })} placeholder="Protein (g)" className="rounded-lg border border-line dark:border-ink-700 px-2.5 py-1.5 text-sm bg-white dark:bg-ink-900" />
          <input type="number" step="0.01" {...register('servingSizeKg', { valueAsNumber: true })} placeholder="Serving size (kg)" className="rounded-lg border border-line dark:border-ink-700 px-2.5 py-1.5 text-sm bg-white dark:bg-ink-900" />
          <input type="number" {...register('costPerKg', { valueAsNumber: true })} placeholder="Cost per kg (₹)" className="rounded-lg border border-line dark:border-ink-700 px-2.5 py-1.5 text-sm bg-white dark:bg-ink-900" />
          <label className="flex items-center gap-2 text-xs col-span-2"><input type="checkbox" {...register('veg')} defaultChecked /> Vegetarian</label>
          <button type="submit" className="col-span-2 rounded-lg bg-tech-500 text-white text-sm font-semibold py-2">Add to catalog</button>
        </form>
      )}
      <DataTable data={items} columns={columns} rowKey={(i) => i.id} searchableText={(i) => i.name} pageSize={8} filename="menu-items.csv" />
    </div>
  )
}

function PopularityRanking({ allItems }: { allItems: MenuItem[] }) {
  const messId = useMessStore((s) => s.currentMessId)
  const ranking = useMemo(() => mealPopularityRanking(messId), [messId])
  return (
    <div>
      <h2 className="font-display font-semibold text-slate-800 dark:text-slate-100 mb-3">Menu Preference Analytics</h2>
      <div className="grid md:grid-cols-2 gap-4">
        <DashboardCard title="Most Liked Menus">
          <ol className="space-y-2 text-sm">
            {ranking.slice(0, 5).map((r, i) => (
              <li key={r.menuId} className="flex justify-between gap-2">
                <span className="truncate">{i + 1}. {r.label}</span>
                <StatusBadge tone="success">{r.avgAttendance} avg{r.avgRating ? ` · ★${r.avgRating}` : ''}</StatusBadge>
              </li>
            ))}
          </ol>
        </DashboardCard>
        <DashboardCard title="Least Liked Menus">
          <ol className="space-y-2 text-sm">
            {ranking.slice(-5).reverse().map((r, i) => (
              <li key={r.menuId} className="flex justify-between gap-2">
                <span className="truncate">{i + 1}. {r.label}</span>
                <StatusBadge tone="danger">{r.avgAttendance} avg{r.avgRating ? ` · ★${r.avgRating}` : ''}</StatusBadge>
              </li>
            ))}
          </ol>
        </DashboardCard>
      </div>
    </div>
  )
}
