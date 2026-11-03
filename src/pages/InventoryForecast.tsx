import { useMemo } from 'react'
import { useInventory } from '@/hooks/useInventory'
import { forecastConsumption } from '@/services/inventoryService'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatNumber, unitLabel } from '@/utils/formatters'
import type { InventoryItem } from '@/types'
import { DemoBanner } from '@/components/ui/DemoBanner'

interface Row extends InventoryItem {
  weeklyConsumption: number
  recommendedPurchase: number
  stockoutDays: number
}

export default function InventoryForecast() {
  const { items, loading } = useInventory()

  const rows: Row[] = useMemo(
    () =>
      items.map((item) => {
        const weeklyConsumption = Math.round(item.maxStock * 0.22 + item.minStock * 0.35)
        const { recommendedPurchase, stockoutDays } = forecastConsumption(item, weeklyConsumption)
        return { ...item, weeklyConsumption, recommendedPurchase, stockoutDays }
      }),
    [items]
  )

  const columns: Column<Row>[] = [
    { key: 'name', header: 'Item', accessor: (r) => r.name, sortValue: (r) => r.name },
    { key: 'quantity', header: 'Current Stock', accessor: (r) => `${formatNumber(r.quantity)} ${unitLabel(r.unit)}`, sortValue: (r) => r.quantity },
    { key: 'weeklyConsumption', header: 'Weekly Consumption', accessor: (r) => `${formatNumber(r.weeklyConsumption)} ${unitLabel(r.unit)}`, sortValue: (r) => r.weeklyConsumption },
    { key: 'recommendedPurchase', header: 'Recommended Purchase', accessor: (r) => `${formatNumber(r.recommendedPurchase)} ${unitLabel(r.unit)}`, sortValue: (r) => r.recommendedPurchase },
    {
      key: 'stockoutDays', header: 'Est. Stockout', accessor: (r) => (
        <StatusBadge tone={r.stockoutDays < 5 ? 'danger' : r.stockoutDays < 10 ? 'warning' : 'success'}>
          {r.stockoutDays >= 999 ? 'No risk' : `${r.stockoutDays} days`}
        </StatusBadge>
      ), sortValue: (r) => r.stockoutDays,
    },
  ]

  return (
    <div className="space-y-6">
      <DemoBanner what={'The stock forecast is built from sample inventory.'} />
      <div>
        <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100">Inventory Forecast</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Projected consumption and purchase recommendations, based on stock levels and historical usage.</p>
      </div>
      <DataTable data={rows} columns={columns} loading={loading} rowKey={(r) => r.id} searchableText={(r) => r.name} filename="inventory-forecast.csv" />
    </div>
  )
}
