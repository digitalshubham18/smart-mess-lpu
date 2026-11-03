import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, Star } from 'lucide-react'
import type { Supplier } from '@/types'
import * as procurementService from '@/services/procurementService'
import { supplierSchema, type SupplierForm } from '@/utils/validators'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Modal } from '@/components/ui/Modal'
import { DemoBanner } from '@/components/ui/DemoBanner'

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  function refresh() {
    setLoading(true)
    procurementService.listSuppliers().then((s) => {
      setSuppliers(s)
      setLoading(false)
    })
  }
  useEffect(refresh, [])

  const { register, handleSubmit, reset } = useForm<SupplierForm>({ resolver: zodResolver(supplierSchema) })

  async function onSubmit(data: SupplierForm) {
    await procurementService.addSupplier(data)
    reset()
    setShowForm(false)
    refresh()
  }

  const columns: Column<Supplier>[] = [
    { key: 'name', header: 'Supplier', accessor: (s) => s.name, sortValue: (s) => s.name },
    { key: 'phone', header: 'Phone', accessor: (s) => s.phone },
    { key: 'email', header: 'Email', accessor: (s) => s.email },
    { key: 'address', header: 'Address', accessor: (s) => s.address, hideByDefault: true },
    {
      key: 'rating', header: 'Rating', accessor: (s) => (
        <span className="flex items-center gap-1"><Star size={12} className="text-amber-500 fill-amber-500" /> {s.rating.toFixed(1)}</span>
      ), sortValue: (s) => s.rating,
    },
  ]

  return (
    <div className="space-y-6">
      <DemoBanner what={'Suppliers and prices are sample data; edits are not saved.'} />
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100">Suppliers</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Manage vendor relationships and contact information.</p>
        </div>
        <button onClick={() => setShowForm(true)} className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2.5 rounded-lg bg-tech-500 text-white">
          <Plus size={14} /> Add supplier
        </button>
      </div>
      <DataTable data={suppliers} columns={columns} loading={loading} rowKey={(s) => s.id} searchableText={(s) => s.name} filename="suppliers.csv" />

      <Modal open={showForm} onClose={() => setShowForm(false)} title="Add Supplier">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <input {...register('name')} placeholder="Supplier name" className="w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm" />
          <input {...register('phone')} placeholder="Phone" className="w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm" />
          <input {...register('email')} placeholder="Email" className="w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm" />
          <input {...register('address')} placeholder="Address" className="w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm" />
          <input type="number" step="0.1" {...register('rating', { valueAsNumber: true })} placeholder="Rating (1-5)" className="w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm" />
          <button type="submit" className="w-full rounded-lg bg-tech-500 text-white text-sm font-semibold py-2.5">Add Supplier</button>
        </form>
      </Modal>
    </div>
  )
}
