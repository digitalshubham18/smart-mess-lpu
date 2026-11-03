import { withDelay } from './api'

export interface WeatherForecast {
  date: string
  condition: 'clear' | 'rain' | 'extreme_heat' | 'cold'
  tempC: number
  demandImpactPct: number
}

const CONDITIONS: WeatherForecast['condition'][] = ['clear', 'clear', 'clear', 'rain', 'cold']

export async function getWeatherForecast(date: string): Promise<WeatherForecast> {
  const seedNum = Array.from(date).reduce((a, c) => a + c.charCodeAt(0), 0)
  const condition = CONDITIONS[seedNum % CONDITIONS.length]
  const tempC = condition === 'cold' ? 12 + (seedNum % 5) : condition === 'extreme_heat' ? 38 + (seedNum % 4) : 22 + (seedNum % 8)
  const impact = { clear: 0, rain: -8, extreme_heat: 6, cold: 4 }[condition]
  return withDelay({ date, condition, tempC, demandImpactPct: impact }, 200)
}
