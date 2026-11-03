import { useEffect, useState } from 'react'
import { getTodayOverview } from '@/services/mealService'
import type { DayMealRecord } from '@/data/mockOperations'
import { useMessStore } from '@/store/useMessStore'

export function useMeals(date: string) {
  const messId = useMessStore((s) => s.currentMessId)
  const [meals, setMeals] = useState<DayMealRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    getTodayOverview(messId, date).then((data) => {
      if (active) {
        setMeals(data)
        setLoading(false)
      }
    })
    return () => {
      active = false
    }
  }, [messId, date])

  return { meals, loading }
}
