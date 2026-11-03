import { useEffect, useState, useCallback } from 'react'
import type { ForecastMethod, MealType } from '@/types'
import { computeForecast, type ForecastOutput } from '@/services/forecastService'
import { useMessStore } from '@/store/useMessStore'

export function useForecast(date: string, meal: MealType, method: ForecastMethod) {
  const messId = useMessStore((s) => s.currentMessId)
  const [data, setData] = useState<ForecastOutput | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setLoading(true)
    setError(null)
    computeForecast({ messId, date, meal, method })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to compute forecast'))
      .finally(() => setLoading(false))
  }, [messId, date, meal, method])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { data, loading, error, refresh }
}
