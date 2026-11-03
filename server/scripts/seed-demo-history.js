// OPTIONAL, DEMO ONLY. Fills the attendance table with SIMULATED past check-ins so the Forecast and Forecast
// Accuracy pages have something to chew on in a demo. Real deployments should NOT run this — forecasts there
// are built from real scans as they happen.
//
//   node scripts/seed-demo-history.js [days=45]
//
// Every row it writes has scanned_by = 'demo-history' so it is easy to find and remove:
//   node scripts/seed-demo-history.js --remove
import { randomUUID } from 'node:crypto'
import { db } from '../src/db.js'

if (process.argv.includes('--remove')) {
  const n = db.prepare("DELETE FROM attendance WHERE scanned_by = 'demo-history'").run().changes
  console.log(`[demo-history] removed ${n} simulated check-ins`)
  process.exit(0)
}

const days = Number(process.argv.find((a) => /^\d+$/.test(a))) || 45
// Share of enrolled students who eat each meal, by weekday (Sun=0): a believable weekly rhythm, plus noise.
const RATE = { breakfast: 0.5, lunch: 0.82, snacks: 0.35, dinner: 0.78 }
const WEEKDAY = [0.8, 1, 1, 1, 1, 0.95, 0.7] // Sunday brunch-and-away, quiet Saturday night
let seed = 12345
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)

const messes = db.prepare('SELECT m.id AS messId, m.hostel_id AS hostelId FROM messes m').all()
const insert = db.prepare('INSERT OR IGNORE INTO attendance (id, student_id, mess_id, date, meal, scanned_at, scanned_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
let written = 0
db.transaction(() => {
  for (const { messId, hostelId } of messes) {
    const ids = db.prepare("SELECT id FROM students WHERE hostel_id = ? AND status = 'active'").all(hostelId).map((r) => r.id)
    for (let d = 1; d <= days; d++) {
      const date = new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10)
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay()
      for (const [meal, base] of Object.entries(RATE)) {
        const p = Math.min(0.98, Math.max(0.05, base * WEEKDAY[dow] * (0.93 + rand() * 0.14)))
        for (const id of ids) if (rand() < p) written += insert.run(randomUUID(), id, messId, date, meal, `${date}T12:00:00.000Z`, 'demo-history').changes
      }
    }
  }
})()
console.log(`[demo-history] wrote ${written} SIMULATED check-ins across ${messes.length} messes for the last ${days} days. Undo with: node scripts/seed-demo-history.js --remove`)
