export function wastePercent(prepared: number, waste: number): number {
  if (!prepared) return 0
  return (waste / prepared) * 100
}

export function wasteCost(wasteKg: number, costPerKg: number): number {
  return wasteKg * costPerKg
}

export function requiredQuantityKg(predictedStudents: number, servingSizeKg: number): number {
  return predictedStudents * servingSizeKg
}

export function recommendedQuantityKg(requiredKg: number, safetyBufferPct: number): number {
  return requiredKg * (1 + safetyBufferPct / 100)
}

export interface ForecastErrorStats {
  mae: number
  mape: number
  rmse: number
  accuracy: number
}

export function forecastErrorStats(pairs: { predicted: number; actual: number }[]): ForecastErrorStats {
  const valid = pairs.filter((p) => p.actual > 0)
  if (!valid.length) return { mae: 0, mape: 0, rmse: 0, accuracy: 0 }
  let sumAbs = 0
  let sumAPE = 0
  let sumSq = 0
  valid.forEach((p) => {
    const err = p.actual - p.predicted
    sumAbs += Math.abs(err)
    sumAPE += Math.abs(err) / p.actual
    sumSq += err * err
  })
  const mae = sumAbs / valid.length
  const mape = (sumAPE / valid.length) * 100
  const rmse = Math.sqrt(sumSq / valid.length)
  const accuracy = Math.max(0, 100 - mape)
  return {
    mae: Math.round(mae * 10) / 10,
    mape: Math.round(mape * 10) / 10,
    rmse: Math.round(rmse * 10) / 10,
    accuracy: Math.round(accuracy * 10) / 10,
  }
}

export function costPerMeal(totalCost: number, totalMeals: number): number {
  if (!totalMeals) return 0
  return totalCost / totalMeals
}

export function mealParticipationRate(attended: number, enrolled: number): number {
  if (!enrolled) return 0
  return (attended / enrolled) * 100
}

export interface SustainabilityInputs {
  wasteReductionScore: number // 0-100, higher = less waste vs baseline
  forecastAccuracy: number // 0-100
  foodUtilization: number // 0-100, consumed/prepared
  studentParticipation: number // 0-100
}

export function sustainabilityScore(inputs: SustainabilityInputs): number {
  const { wasteReductionScore, forecastAccuracy, foodUtilization, studentParticipation } = inputs
  const score =
    wasteReductionScore * 0.35 +
    forecastAccuracy * 0.25 +
    foodUtilization * 0.25 +
    studentParticipation * 0.15
  return Math.round(Math.min(100, Math.max(0, score)))
}

export function sustainabilityBadge(score: number): string {
  if (score >= 90) return 'Eco Mess'
  if (score >= 80) return 'Waste Warrior'
  if (score >= 65) return 'Smart Planner'
  return 'Efficient Kitchen'
}

export function co2SavedKgEstimate(wasteSavedKg: number): number {
  // ~2.5kg CO2e avoided per kg of food waste prevented (rough illustrative estimate)
  return Math.round(wasteSavedKg * 2.5)
}

export function waterSavedLitresEstimate(wasteSavedKg: number): number {
  // ~1500 litres embedded water per kg of mixed food, illustrative estimate
  return Math.round(wasteSavedKg * 1500)
}

export function inventoryTurnover(consumedQty: number, avgStock: number): number {
  if (!avgStock) return 0
  return Math.round((consumedQty / avgStock) * 100) / 100
}

export function daysUntil(dateISO: string): number {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const target = new Date(dateISO)
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - now.getTime()) / 86400000)
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10
}
