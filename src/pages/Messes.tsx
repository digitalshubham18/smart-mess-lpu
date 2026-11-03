import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Plus, Pencil, Trash2, UtensilsCrossed, Users, MapPin } from 'lucide-react'
import type { Mess } from '@/types'
import * as messService from '@/services/messService'
import { HOSTELS } from '@/data/mockHostels'
import { messForHostel, totalStudentsForMess } from '@/data/mockMesses'
import { useMessStore } from '@/store/useMessStore'
import { DashboardCard, StatCard } from '@/components/ui/DashboardCard'
import { Modal, ConfirmDialog } from '@/components/ui/Modal'
import { formatNumber } from '@/utils/formatters'

interface MessForm {
  name: string
  location: string
  seatingCapacity: number
  hostelIds: string[]
}

export default function Messes() {
  const [messes, setMesses] = useState<Mess[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<Mess | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const currentMessId = useMessStore((s) => s.currentMessId)
  const setCurrentMessId = useMessStore((s) => s.setCurrentMessId)
  const bumpMessesVersion = useMessStore((s) => s.bumpMessesVersion)

  function refresh() {
    setLoading(true)
    messService.listMesses().then((m) => {
      setMesses(m)
      setLoading(false)
    })
  }
  useEffect(refresh, [])

  async function handleDelete(id: string) {
    const ok = await messService.removeMess(id)
    if (!ok) {
      alert("Can't delete the only remaining mess — a college must have at least one.")
      return
    }
    bumpMessesVersion()
    if (currentMessId === id) {
      const remaining = messes.find((m) => m.id !== id)
      if (remaining) setCurrentMessId(remaining.id)
    }
    refresh()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100">Messes</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Every dining hall in the college, each with its own forecast, waste, and inventory.</p>
        </div>
        <button onClick={() => setShowForm(true)} className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2.5 rounded-lg bg-tech-500 text-white">
          <Plus size={14} /> Add Mess
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : (
        <div className="grid md:grid-cols-2 gap-5">
          {messes.map((m) => {
            const hostels = HOSTELS.filter((h) => m.hostelIds.includes(h.id))
            const total = totalStudentsForMess(m.id)
            return (
              <DashboardCard key={m.id} title={m.name}>
                <div className="flex items-center gap-2 text-xs text-slate-400 mb-3">
                  <MapPin size={13} /> {m.location}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <StatCard label="Students Served" value={formatNumber(total)} icon={Users} accent="tech" />
                  <StatCard label="Seating Capacity" value={formatNumber(m.seatingCapacity)} icon={UtensilsCrossed} accent="neutral" />
                </div>
                <div className="mt-3">
                  <div className="text-xs text-slate-400 mb-1.5">Hostels served</div>
                  <div className="flex flex-wrap gap-1.5">
                    {hostels.length === 0 && <span className="text-xs text-slate-400">No hostels assigned yet.</span>}
                    {hostels.map((h) => (
                      <span key={h.id} className="text-[11px] font-medium px-2 py-1 rounded-full bg-surface dark:bg-ink-800 text-slate-600 dark:text-slate-300">{h.name}</span>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2 mt-4">
                  <button onClick={() => setEditItem(m)} className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-line dark:border-ink-700 text-slate-600 dark:text-slate-300">
                    <Pencil size={12} /> Edit
                  </button>
                  <button onClick={() => setDeleteId(m.id)} className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-line dark:border-ink-700 text-rose-500">
                    <Trash2 size={12} /> Delete
                  </button>
                  {m.id === currentMessId ? (
                    <span className="ml-auto text-[11px] font-semibold text-tech-600 dark:text-tech-500 self-center">Currently viewing</span>
                  ) : (
                    <button onClick={() => setCurrentMessId(m.id)} className="ml-auto text-xs font-semibold text-tech-600 dark:text-tech-500">
                      Switch to this mess →
                    </button>
                  )}
                </div>
              </DashboardCard>
            )
          })}
        </div>
      )}

      <Modal open={showForm || !!editItem} onClose={() => { setShowForm(false); setEditItem(null) }} title={editItem ? 'Edit Mess' : 'Add Mess'}>
        <MessFormFields
          initial={editItem}
          onSubmit={async (data) => {
            if (editItem) await messService.editMess(editItem.id, data)
            else await messService.addMess(data)
            bumpMessesVersion()
            setShowForm(false)
            setEditItem(null)
            refresh()
          }}
        />
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && handleDelete(deleteId)}
        title="Delete this mess?"
        description="Its hostels will be unassigned until you move them to another mess. Its forecast, waste, and inventory history stay recorded but won't be shown anywhere."
        confirmLabel="Delete"
        danger
      />
    </div>
  )
}

function MessFormFields({ initial, onSubmit }: { initial: Mess | null; onSubmit: (data: MessForm) => void }) {
  const { register, handleSubmit, watch, setValue } = useForm<MessForm>({
    defaultValues: initial ?? { name: '', location: '', seatingCapacity: 300, hostelIds: [] },
  })
  const selectedHostels = watch('hostelIds') || []

  function toggleHostel(id: string) {
    const next = selectedHostels.includes(id) ? selectedHostels.filter((h) => h !== id) : [...selectedHostels, id]
    setValue('hostelIds', next)
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
      <div>
        <label className="text-xs font-medium text-slate-500">Mess name</label>
        <input {...register('name', { required: true })} placeholder="e.g. South Campus Mess" className="mt-1 w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm" />
      </div>
      <div>
        <label className="text-xs font-medium text-slate-500">Location</label>
        <input {...register('location', { required: true })} placeholder="e.g. Block C, Ground Floor" className="mt-1 w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm" />
      </div>
      <div>
        <label className="text-xs font-medium text-slate-500">Seating capacity</label>
        <input type="number" {...register('seatingCapacity', { valueAsNumber: true, required: true })} className="mt-1 w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm" />
      </div>
      <div>
        <label className="text-xs font-medium text-slate-500">Hostels served</label>
        <p className="text-[11px] text-slate-400 mb-1.5">Picking a hostel already assigned elsewhere moves it to this mess.</p>
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {HOSTELS.map((h) => {
            const currentOwner = messForHostel(h.id)
            const ownedByOther = currentOwner && currentOwner.id !== initial?.id
            return (
              <label key={h.id} className="flex items-center gap-2 text-sm px-2 py-1.5 rounded-md hover:bg-surface-dim dark:hover:bg-ink-800 cursor-pointer">
                <input type="checkbox" checked={selectedHostels.includes(h.id)} onChange={() => toggleHostel(h.id)} />
                <span className="flex-1">{h.name}</span>
                {ownedByOther && <span className="text-[10px] text-amber-600">currently: {currentOwner!.name}</span>}
              </label>
            )
          })}
        </div>
      </div>
      <button type="submit" className="w-full rounded-lg bg-tech-500 hover:bg-tech-600 text-white text-sm font-semibold py-2.5">
        {initial ? 'Save Changes' : 'Add Mess'}
      </button>
    </form>
  )
}
