import { useMemo, useState } from 'react'
import { dailyWasteSeries, mealWiseWaste, topWasteContributors, wasteByReason, recordWaste, type WasteEntryInput } from '@/services/wasteService'
import { useMessStore } from '@/store/useMessStore'

export function useWaste() {
  const messId = useMessStore((s) => s.currentMessId)
  const [version, setVersion] = useState(0)

  const dailySeries = useMemo(() => dailyWasteSeries(messId, 30), [messId, version])
  const mealWise = useMemo(() => mealWiseWaste(messId), [messId, version])
  const topContributors = useMemo(() => topWasteContributors(messId, 5), [messId, version])
  const byReason = useMemo(() => wasteByReason(messId), [messId, version])

  async function submit(input: Omit<WasteEntryInput, 'messId'>) {
    const result = await recordWaste({ ...input, messId })
    setVersion((v) => v + 1)
    return result
  }

  return { dailySeries, mealWise, topContributors, byReason, submit, messId }
}
