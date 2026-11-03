import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import * as hostelService from '@/services/hostelService'
import { hostelWiseDemandAll } from '@/services/analyticsService'
import { messName, messIdForHostel } from '@/data/mockMesses'
import { lateMarkRequestCounts } from '@/services/mealService'
import { STUDENTS } from '@/data/mockStudents'
import { HOSTELS } from '@/data/mockHostels'
import { StatCard, DashboardCard } from '@/components/ui/DashboardCard'
import { ProgressBar, StatusBadge } from '@/components/ui/StatusBadge'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { FilterBar } from '@/components/ui/FilterBar'
import { Modal } from '@/components/ui/Modal'
import { formatNumber } from '@/utils/formatters'
import { Building2, AlertTriangle, Plus, Upload } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useMessStore } from '@/store/useMessStore'

interface HostelRow { id: string; name: string; category: string; capacity: number; occupancy: number; students: number; roomCapacity: number | null }

interface OffenderRow {
  id: string
  name: string
  hostel: string
  room: string
  seedMisses: number
  liveRequests: number
  total: number
}

interface AddHostelForm {
  category: 'boys' | 'girls' | 'general'
  name?: string
  capacity: number
  adminName: string
  adminEmail?: string
}

function severity(total: number): { label: string; tone: 'danger' | 'warning' | 'neutral' } {
  if (total >= 10) return { label: 'Frequent', tone: 'danger' }
  if (total >= 5) return { label: 'Occasional', tone: 'warning' }
  return { label: 'Rare', tone: 'neutral' }
}

export default function Hostels() {
  const { user } = useAuth()
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  const scopedHostelId = !isSuperAdmin ? user?.hostelId : undefined
  const visibleHostelOptions = scopedHostelId ? HOSTELS.filter((h) => h.id === scopedHostelId) : HOSTELS
  const bumpMessesVersion = useMessStore((s) => s.bumpMessesVersion)
  const [hostels, setHostels] = useState<HostelRow[]>([])
  const [hostelFilter, setHostelFilter] = useState<Record<string, string>>({})
  const [showAddHostel, setShowAddHostel] = useState(false)
  const [importMsg, setImportMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const demand = hostelWiseDemandAll()

  function refresh() {
    hostelService.listHostels().then((rows) => {
      setHostels((scopedHostelId ? rows.filter((h) => h.id === scopedHostelId) : rows) as any)
    })
  }
  useEffect(refresh, [scopedHostelId])

  // Bulk-onboard hostels at once. CSV columns: category,name,capacity,adminName,adminEmail
  // — category must be boys/girls/general, name and capacity are optional (auto-generated
  // if blank), adminName is required per row (a real person, never a placeholder).
  function importHostelsCSV(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async () => {
      const lines = (reader.result as string).split('\n').map((l) => l.trim()).filter(Boolean)
      const dataLines = lines[0]?.toLowerCase().startsWith('category') ? lines.slice(1) : lines
      let created = 0
      let skipped = 0
      for (const line of dataLines) {
        const [categoryRaw, name, capacityRaw, adminName, adminEmail] = line.split(',').map((c) => c?.trim())
        const category = categoryRaw?.toLowerCase() as 'boys' | 'girls' | 'general'
        if (!['boys', 'girls', 'general'].includes(category) || !adminName) {
          skipped++
          continue
        }
        const capacity = Number(capacityRaw)
        try {
          await hostelService.createHostel(
            { category, name: name || undefined, capacity: Number.isFinite(capacity) && capacity > 0 ? capacity : undefined, adminName, adminEmail: adminEmail || undefined },
            user
          )
          created++
        } catch {
          skipped++
        }
      }
      bumpMessesVersion()
      setImportMsg(`Created ${created} hostel${created === 1 ? '' : 's'}${skipped ? `, skipped ${skipped} invalid row${skipped === 1 ? '' : 's'}` : ''}.`)
      refresh()
      if (fileRef.current) fileRef.current.value = ''
    }
    reader.readAsText(file)
  }

  const offenders: OffenderRow[] = useMemo(() => {
    const liveCounts = lateMarkRequestCounts()
    return STUDENTS.filter((s) => !scopedHostelId || s.hostelId === scopedHostelId)
      .map((s) => {
        const liveRequests = liveCounts[s.id] ?? 0
        return {
          id: s.id,
          name: s.name,
          hostel: HOSTELS.find((h) => h.id === s.hostelId)?.name ?? s.hostelId,
          room: s.room,
          seedMisses: s.missedCutoffCount,
          liveRequests,
          total: s.missedCutoffCount + liveRequests,
        }
      })
      .filter((o) => !hostelFilter.hostelId || STUDENTS.find((s) => s.id === o.id)?.hostelId === hostelFilter.hostelId)
      .sort((a, b) => b.total - a.total)
      .slice(0, 20)
  }, [hostelFilter, scopedHostelId])

  const columns: Column<OffenderRow>[] = [
    { key: 'name', header: 'Student', accessor: (o) => o.name, sortValue: (o) => o.name },
    { key: 'hostel', header: 'Hostel', accessor: (o) => o.hostel },
    { key: 'room', header: 'Room', accessor: (o) => o.room },
    { key: 'total', header: 'Times missed cutoff', accessor: (o) => o.total, sortValue: (o) => o.total },
    {
      key: 'severity', header: 'Flag', accessor: (o) => {
        const sev = severity(o.total)
        return <StatusBadge tone={sev.tone}>{sev.label}</StatusBadge>
      }, sortValue: (o) => o.total,
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100">Hostel Management</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {scopedHostelId ? 'Capacity, occupancy and meal participation for your hostel.' : `Capacity, occupancy and meal participation across all ${hostels.length} hostels at LPU.`}
          </p>
        </div>
        {isSuperAdmin && (
          <div className="flex gap-2">
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={importHostelsCSV} />
            <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2.5 rounded-lg border border-line dark:border-ink-700">
              <Upload size={13} /> Import CSV
            </button>
            <button onClick={() => setShowAddHostel(true)} className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2.5 rounded-lg bg-tech-500 text-white">
              <Plus size={14} /> Add hostel
            </button>
          </div>
        )}
      </div>

      {importMsg && <p className="text-xs text-eco-600 bg-eco-50 dark:bg-eco-500/10 rounded-lg px-3 py-2">{importMsg}</p>}

      <div className="grid md:grid-cols-2 gap-5">
        {hostels.map((h) => {
          const d = demand.find((x) => x.hostel === h.name)
          const occupancyPct = h.capacity ? Math.round((h.students / h.capacity) * 100) : 0
          return (
            <DashboardCard key={h.id} title={h.name}>
              <div className="flex items-center gap-2 mb-3">
                <Building2 size={16} className="text-tech-500" />
                <span className="text-xs uppercase font-semibold text-slate-400">{h.category}</span>
                <span className="text-xs text-slate-400">· served by {messName(messIdForHostel(h.id))}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <StatCard label="Capacity" value={formatNumber(h.capacity)} accent="neutral" />
                <StatCard label="Students enrolled" value={formatNumber(h.students)} accent="tech" />
              </div>
              <div className="mt-4">
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>Occupancy rate</span>
                  <span>{occupancyPct}%</span>
                </div>
                <ProgressBar value={h.students} max={h.capacity} tone={h.students > h.capacity ? 'danger' : 'info'} />
              </div>
              {(isSuperAdmin || user?.role === 'ADMIN') && <RoomLimitControl hostelId={h.id} current={h.roomCapacity} onSaved={refresh} />}
              {h.students === 0 && <p className="text-xs text-amber-500 mt-3">No students enrolled yet — add real students from the Students page.</p>}
              {d && h.students > 0 && <p className="text-xs text-slate-400 mt-3">Est. mess demand: <strong className="text-slate-600 dark:text-slate-300">{formatNumber(d.students)} students/day</strong></p>}
            </DashboardCard>
          )
        })}
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle size={16} className="text-amber-500" />
          <h2 className="font-display font-semibold text-slate-800 dark:text-slate-100">Repeat Late-Marking Offenders</h2>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          Students who most often miss the 2:00 AM meal-intention cutoff — historical count plus any live "forgot to mark" requests raised this session.
        </p>
        <div className="mb-3">
          <FilterBar
            filters={[{ key: 'hostelId', label: 'Hostel', options: visibleHostelOptions.map((h) => ({ value: h.id, label: h.name })) }]}
            values={hostelFilter}
            onChange={(k, v) => setHostelFilter((prev) => ({ ...prev, [k]: v }))}
          />
        </div>
        <DataTable data={offenders} columns={columns} rowKey={(o) => o.id} searchableText={(o) => o.name} pageSize={10} filename="repeat-late-markers.csv" />
      </div>

      {isSuperAdmin && (
        <Modal open={showAddHostel} onClose={() => setShowAddHostel(false)} title="Add a new hostel">
          <AddHostelFormFields
            onSubmit={async (data) => {
              await hostelService.createHostel(data, user)
              bumpMessesVersion()
              setShowAddHostel(false)
              refresh()
            }}
          />
        </Modal>
      )}
    </div>
  )
}

function AddHostelFormFields({ onSubmit }: { onSubmit: (data: AddHostelForm) => void }) {
  const { register, handleSubmit, formState: { errors } } = useForm<AddHostelForm>({ defaultValues: { category: 'boys', capacity: 112 } })
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
      <div>
        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Category</label>
        <select {...register('category')} className="mt-1 w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm">
          <option value="boys">Boys hostel</option>
          <option value="girls">Girls hostel</option>
          <option value="general">General hostel</option>
        </select>
      </div>
      <input {...register('name')} placeholder="Hostel name (optional — a standard name/code is generated if left blank)" className="w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm" />
      <div>
        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Bed capacity</label>
        <input type="number" {...register('capacity', { valueAsNumber: true })} className="mt-1 w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm" />
      </div>
      <div className="border-t border-line dark:border-ink-700 pt-3">
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">Mess Admin for this hostel <span className="text-rose-500">*</span></p>
        <input {...register('adminName', { required: 'Enter the new Admin\'s real name — no placeholder names' })} placeholder="Admin's full name" className="w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm mb-1" />
        {errors.adminName && <p className="text-xs text-rose-500 mb-2">{errors.adminName.message}</p>}
        <input {...register('adminEmail')} placeholder="Admin email (optional)" className="w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm" />
      </div>
      <p className="text-[11px] text-slate-400">
        This creates the hostel, its own dedicated mess, and a Mess Admin account for the real person you name above (a staff UID +
        demo password are generated automatically). The hostel starts with no students and no other staff — the new Admin adds real
        students and builds their team (Mess Manager, Kitchen Staff, Finance Manager, Hostel Warden) from the Students and Staff pages
        after signing in.
      </p>
      <button type="submit" className="w-full rounded-lg bg-tech-500 text-white text-sm font-semibold py-2.5">Create hostel</button>
    </form>
  )
}

/** Beds-per-room limit for one hostel. Blank = no limit. The server is the judge: it refuses a limit that existing rooms already exceed. */
export function RoomLimitControl({ hostelId, current, onSaved }: { hostelId: string; current: number | null; onSaved: () => void }) {
  const [value, setValue] = useState(current === null ? '' : String(current))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => setValue(current === null ? '' : String(current)), [current])
  const parsed = value.trim() === '' ? null : Number(value)
  const invalid = parsed !== null && (!Number.isInteger(parsed) || parsed < 1 || parsed > 20)
  const unchanged = parsed === current

  async function save() {
    setSaving(true)
    setError('')
    try {
      await hostelService.setRoomCapacity(hostelId, parsed)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-4 border-t border-line dark:border-ink-700 pt-3">
      <label htmlFor={`room-limit-${hostelId}`} className="text-xs font-medium text-slate-500 dark:text-slate-400">Beds per room <span className="font-normal">(blank = no limit)</span></label>
      <div className="mt-1 flex items-center gap-2">
        <input
          id={`room-limit-${hostelId}`}
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-20 rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-2 py-1.5 text-sm"
        />
        <button onClick={save} disabled={saving || invalid || unchanged} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-tech-500 text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
      </div>
      {invalid && <p className="text-xs text-rose-500 mt-1">Enter a whole number from 1 to 20, or leave blank.</p>}
      {error && <p role="alert" className="text-xs text-rose-600 mt-1">{error}</p>}
    </div>
  )
}
