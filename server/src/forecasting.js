import { db } from './db.js'

// Demand forecasting from the server's OWN records: who actually checked in (attendance) and who said they would
// eat (meal_intentions). Nothing here is simulated — with no history it says so instead of inventing a number.

export const METHODS = ['historical_average', 'moving_average', 'weighted_moving_average', 'exponential_smoothing', 'linear_regression', 'weekday_average']
const MIN_HISTORY = 3          // days of real check-ins needed before a statistical forecast is offered
const MIN_BACKTEST = 5         // backtested days needed before a confidence figure is claimed

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)

/** history = [{ date, count }] oldest → newest, strictly BEFORE the date being predicted. */
export function predictFrom(history, method, targetDate) {
  const v = history.map((h) => h.count)
  if (!v.length) return null
  switch (method) {
    case 'historical_average': return mean(v.slice(-28))
    case 'moving_average': return mean(v.slice(-7))
    case 'weighted_moving_average': {
      const s = v.slice(-7)
      const w = s.map((_, i) => i + 1)
      return s.reduce((t, x, i) => t + x * w[i], 0) / w.reduce((a, b) => a + b, 0)
    }
    case 'exponential_smoothing': {
      let s = v[0]
      for (let i = 1; i < v.length; i++) s = 0.35 * v[i] + 0.65 * s
      return s
    }
    case 'linear_regression': {
      const w = v.slice(-28), n = w.length
      if (n < 2) return mean(w)
      const xm = (n - 1) / 2, ym = mean(w)
      let num = 0, den = 0
      w.forEach((y, i) => { num += (i - xm) * (y - ym); den += (i - xm) ** 2 })
      const slope = den === 0 ? 0 : num / den
      return Math.max(0, ym - slope * xm + slope * n)
    }
    case 'weekday_average': {
      // Mess demand has a weekly rhythm (Sunday brunch, empty Saturday nights…): average the same weekday only.
      const dow = new Date(`${targetDate}T00:00:00Z`).getUTCDay()
      const same = history.filter((h) => new Date(`${h.date}T00:00:00Z`).getUTCDay() === dow).map((h) => h.count)
      return same.length >= 2 ? mean(same.slice(-6)) : mean(v.slice(-7)) // too few of that weekday yet → recent average
    }
    default: return null
  }
}

/** Days on which this mess actually scanned anyone — a day with zero scans of ANY meal is "not recorded", not "0 ate". */
export function messHistory(messId, meal, beforeDate, days = 120) {
  return db.prepare(`
    SELECT a.date AS date, COUNT(*) AS count FROM attendance a
    WHERE a.mess_id = ? AND a.meal = ? AND a.date < ? AND a.date >= date(?, ?)
    GROUP BY a.date ORDER BY a.date`).all(messId, meal, beforeDate, beforeDate, `-${days} days`)
}

/** Students who could be expected at this mess on this date: active, and not on approved leave. */
export function eligibleCount(messId, date) {
  return db.prepare(`
    SELECT COUNT(*) AS n FROM students s JOIN messes m ON m.hostel_id = s.hostel_id
    WHERE m.id = ? AND s.status = 'active' AND (s.leave_until IS NULL OR s.leave_until < ?)`).get(messId, date).n
}

export function intentionTally(messId, date, meal) {
  const rows = db.prepare(`
    SELECT i.status AS status, COUNT(*) AS n FROM meal_intentions i
    JOIN students s ON s.id = i.student_id JOIN messes m ON m.hostel_id = s.hostel_id
    WHERE m.id = ? AND i.date = ? AND i.meal = ? GROUP BY i.status`).all(messId, date, meal)
  const get = (k) => rows.find((r) => r.status === k)?.n ?? 0
  return { willEat: get('will_eat'), willNot: get('will_not') }
}

/** Walk-forward backtest: predict each recorded day using only the days before it. */
export function backtest(messId, meal, method, { days = 60, today = new Date().toISOString().slice(0, 10) } = {}) {
  const all = messHistory(messId, meal, today, 400)
  const rows = []
  for (let i = MIN_HISTORY; i < all.length; i++) {
    const target = all[i]
    if (target.date < new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10)) continue
    const p = predictFrom(all.slice(0, i), method, target.date)
    if (p !== null) rows.push({ date: target.date, meal, predicted: Math.round(p), actual: target.count })
  }
  return rows
}

const mape = (rows) => {
  const ok = rows.filter((r) => r.actual > 0)
  return ok.length ? mean(ok.map((r) => Math.abs(r.actual - r.predicted) / r.actual)) : null
}

export function forecast({ messId, date, meal, method }) {
  const history = messHistory(messId, meal, date)
  const eligible = eligibleCount(messId, date)
  const { willEat, willNot } = intentionTally(messId, date, meal)
  const responded = willEat + willNot
  const coverage = eligible ? responded / eligible : 0

  const base = history.length >= MIN_HISTORY ? predictFrom(history, method, date) : null
  let predicted = null
  let basis = 'none'
  if (base !== null && responded > 0) {
    // Students who haven't answered are assumed to behave like the average day; the answered ones are known.
    const rate = eligible ? Math.min(1, base / eligible) : 0
    const fromIntentions = willEat + (eligible - responded) * rate
    const w = Math.min(0.6, coverage) // trust intentions in proportion to how many students actually answered
    predicted = base * (1 - w) + fromIntentions * w
    basis = 'history+intentions'
  } else if (base !== null) {
    predicted = base
    basis = 'history'
  } else if (responded > 0) {
    predicted = willEat // a floor, not an estimate: nothing is known about the unanswered students
    basis = 'intentions-only'
  }

  const bt = backtest(messId, meal, method)
  const err = bt.length >= MIN_BACKTEST ? mape(bt) : null
  return {
    messId, date, meal, method,
    predictedStudents: predicted === null ? null : Math.round(predicted),
    // Measured, not asserted: 100 − the method's own walk-forward error on this mess's real history.
    confidence: err === null ? null : Math.max(0, Math.round((1 - err) * 100)),
    basis,
    evidence: { historyDays: history.length, backtestDays: bt.length, eligibleStudents: eligible, willEat, willNot, historicalAverage: history.length ? Math.round(mean(history.slice(-28).map((h) => h.count))) : null },
    note: predicted === null
      ? 'No check-in history or meal intentions recorded for this mess yet — nothing to forecast from. Forecasts appear as check-ins are recorded.'
      : basis === 'intentions-only'
        ? `Only ${responded} intention${responded === 1 ? '' : 's'} so far and no check-in history — this is the number of students who said they'll eat, not an estimate of the total.`
        : history.length < MIN_HISTORY ? undefined : (err === null ? `Confidence appears after ${MIN_BACKTEST} days of history (have ${bt.length}).` : undefined),
  }
}
