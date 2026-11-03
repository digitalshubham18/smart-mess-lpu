import { useEffect, useState } from 'react'
import type { PurchaseOrder, POStatus } from '@/types'
import * as procurementService from '@/services/procurementService'
import { SUPPLIERS } from '@/data/mockSuppliers'
import { useMessStore } from '@/store/useMessStore'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatINR } from '@/utils/formatters'
import { DemoBanner } from '@/components/ui/DemoBanner'

const STATUS_TONE: Record<POStatus, 'neutral' | 'warning' | 'info' | 'success' | 'danger'> = {
  Pending: 'neutral', Approved: 'warning', Ordered: 'info', Delivered: 'success', Cancelled: 'danger',
}
const NEXT_STATUS: Record<POStatus, POStatus | null> = {
  Pending: 'Approved', Approved: 'Ordered', Ordered: 'Delivered', Delivered: null, Cancelled: null,
}

export default function Procurement() {
  const messId = useMessStore((s) => s.currentMessId)
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)

  function refresh() {
    setLoading(true)
    procurementService.listPurchaseOrders(messId).then((o) => {
      setOrders(o)
      setLoading(false)
    })
  }
  useEffect(refresh, [messId])

  async function advance(po: PurchaseOrder) {
    const next = NEXT_STATUS[po.status]
    if (!next) return
    await procurementService.updatePOStatus(po.id, next)
    refresh()
  }

  const columns: Column<PurchaseOrder>[] = [
    { key: 'poNumber', header: 'PO Number', accessor: (o) => o.poNumber, sortValue: (o) => o.poNumber },
    { key: 'supplier', header: 'Supplier', accessor: (o) => SUPPLIERS.find((s) => s.id === o.supplierId)?.name ?? o.supplierId },
    { key: 'items', header: 'Items', accessor: (o) => `${o.items.length} item(s)`, sortValue: (o) => o.items.length },
    { key: 'total', header: 'Total', accessor: (o) => formatINR(o.total), sortValue: (o) => o.total },
    { key: 'deliveryDate', header: 'Delivery Date', accessor: (o) => o.deliveryDate, sortValue: (o) => o.deliveryDate },
    { key: 'status', header: 'Status', accessor: (o) => <StatusBadge tone={STATUS_TONE[o.status]}>{o.status}</StatusBadge>, sortValue: (o) => o.status },
    {
      key: 'actions', header: '', accessor: (o) =>
        NEXT_STATUS[o.status] ? (
          <button onClick={() => advance(o)} className="text-xs font-semibold text-tech-600 hover:underline">
            Mark {NEXT_STATUS[o.status]}
          </button>
        ) : null,
    },
  ]

  return (
    <div className="space-y-6">
      <DemoBanner what={'Purchase orders are sample data; edits are not saved.'} />
      <div>
        <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100">Procurement</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Purchase orders from pending through delivery.</p>
      </div>
      <DataTable data={orders} columns={columns} loading={loading} rowKey={(o) => o.id} searchableText={(o) => o.poNumber} filename="purchase-orders.csv" />
    </div>
  )
}
