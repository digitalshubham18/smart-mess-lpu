import type { ForecastMethod, MealType } from '@/types'
import { MEAL_TYPES } from '@/data/mockOperations'
import { getMessSettingsSync } from './messSettingsService'
import { api } from './api'

export interface ForecastInput {
  messId: string
  date: string
  meal: MealType
  method: ForecastMethod
}

/** What the forecast was built from — shown to the person so a number is never a black box. */
export interface ForecastEvidence {
  historyDays: number
  backtestDays: number
  eligibleStudents: number
  willEat: number
  willNot: number
  historicalAverage: number | null
}

export interface ForecastOutput {
  /** null = nothing real to forecast from yet (no check-ins, no intentions). */
  predictedStudents: number | null
  /** Measured: 100 − this method's own walk-forward error on this mess's real history. null until enough history exists. */
  confidence: number | null
  basis: 'none' | 'history' | 'history+intentions' | 'intentions-only'
  evidence: ForecastEvidence
  /** Kitchen quantities — only when there is a predicted number. */
  recommendedKg: number | null
  expectedCost: number | null
  method: ForecastMethod
  note?: string
}

export const FORECAST_METHOD_LABELS: Record<ForecastMethod, string> = {
  historical_average: 'Historical Average (28 days)',
  moving_average: 'Moving Average (7-day)',
  weighted_moving_average: 'Weighted Moving Average',
  exponential_smoothing: 'Exponential Smoothing',
  linear_regression: 'Linear Regression (trend)',
  weekday_average: 'Same-weekday Average',
  // Not offered anywhere: there is no ML service, and the app no longer pretends there is one.
  random_forest: 'Random Forest (not available)',
  xgboost: 'XGBoost (not available)',
  lstm: 'LSTM (not available)',
}

/**
 * Demand forecast for one meal, computed by the real backend from this mess's recorded check-ins and the meal
 * intentions students submitted (GET /api/forecast). Kitchen quantities (serving size × safety buffer × cost per
 * kg) are then worked out from the mess's own settings. With no history it returns no number — never a guess.
 */
export async function computeForecast(input: ForecastInput): Promise<ForecastOutput> {
  let data: Omit<ForecastOutput, 'recommendedKg' | 'expectedCost'>
  try {
    const res = await api.get<typeof data>('/forecast', { params: input })
    data = res.data
  } catch (e) {
    const err = e as { response?: { data?: { error?: string } } }
    throw new Error(err.response?.data?.error ?? 'Could not load the forecast — is the API server running?')
  }
  if (data.predictedStudents == null) return { ...data, recommendedKg: null, expectedCost: null }

  const mealCfg = MEAL_TYPES.find((m) => m.key === input.meal)!
  const settings = getMessSettingsSync(input.messId)
  const recommendedKg = data.predictedStudents * mealCfg.servingSizeKg * (1 + settings.bufferPct / 100)
  return {
    ...data,
    recommendedKg: Math.round(recommendedKg * 10) / 10,
    expectedCost: Math.round(recommendedKg * settings.avgCostPerKg),
  }
}

export interface AccuracyRow {
  date: string
  meal: MealType
  predicted: number
  actual: number
}

/** Walk-forward backtest from the backend: every day predicted using only the days before it. */
export async function getForecastAccuracy(messId: string, days: number, method: ForecastMethod): Promise<AccuracyRow[]> {
  try {
    const { data } = await api.get<{ rows: AccuracyRow[] }>('/forecast/accuracy', { params: { messId, days, method } })
    return data.rows
  } catch (e) {
    const err = e as { response?: { data?: { error?: string } } }
    throw new Error(err.response?.data?.error ?? 'Could not load forecast accuracy — is the API server running?')
  }
}

/** Only methods that really run. The ML-tier ones are gone until a model actually exists. */
export function allForecastMethods(): ForecastMethod[] {
  return ['weekday_average', 'weighted_moving_average', 'moving_average', 'exponential_smoothing', 'linear_regression', 'historical_average']
}
