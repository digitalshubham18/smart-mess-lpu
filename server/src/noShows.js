import { randomUUID } from 'node:crypto'
import { db, logAudit } from './db.js'
import { sendEmailQuietly } from './email.js'

export const DEFAULT_FINE = 100
export const SYSTEM_ACTOR = { actorId: 'system', actorName: 'Automatic no-show processing', actorRole: 'SYSTEM' }

/** Per-mess automatic-processing settings. No row = on, with the default fine (the env var NO_SHOW_FINE_AMOUNT overrides the default). */
export function autoSettings(messId) {
  const row = db.prepare('SELECT auto_no_shows, fine_amount FROM mess_auto_settings WHERE mess_id = ?').get(messId)
  const defaultFine = Number.isFinite(Number(process.env.NO_SHOW_FINE_AMOUNT)) && process.env.NO_SHOW_FINE_AMOUNT !== undefined && process.env.NO_SHOW_FINE_AMOUNT !== '' ? Number(process.env.NO_SHOW_FINE_AMOUNT) : DEFAULT_FINE
  return { enabled: row ? !!row.auto_no_shows : process.env.AUTO_NO_SHOWS !== '0', fineAmount: row ? row.fine_amount : defaultFine }
}

/**
 * Issues no-show warnings (and the 3-in-a-month fine) for one meal at one mess. WHO was expected is read from the server's
 * own meal_intentions — never from a caller — minus students on approved leave and anyone who was checked in. Idempotent:
 * a student is warned at most once per meal. `actor` is the staff member pressing the button, or SYSTEM_ACTOR for the scheduler.
 */
export function processNoShows({ messId, date, meal, fineAmount, actor }) {
  const expected = db.prepare(`
    SELECT s.* FROM meal_intentions i JOIN students s ON s.id = i.student_id
    WHERE i.date = ? AND i.meal = ? AND i.status = 'will_eat'
      AND s.hostel_id = (SELECT hostel_id FROM messes WHERE id = ?)
      AND (s.leave_until IS NULL OR s.leave_until < ?)
  `).all(date, meal, messId, date)

  const out = { checked: 0, noShows: 0, warningsIssued: 0, finesIssued: 0 }
  const notices = []
  db.transaction(() => {
    for (const student of expected) {
      out.checked++
      if (db.prepare('SELECT 1 FROM attendance WHERE student_id = ? AND date = ? AND meal = ?').get(student.id, date, meal)) continue
      if (db.prepare('SELECT 1 FROM warnings WHERE student_id = ? AND date = ? AND meal = ?').get(student.id, date, meal)) continue
      out.noShows++
      db.prepare('INSERT INTO warnings (id, student_id, mess_id, date, meal, issued_at, reason) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), student.id, messId, date, meal, new Date().toISOString(), `Marked "will eat" for ${meal} on ${date} but wasn't checked in at the counter.`)
      out.warningsIssued++
      logAudit({ ...actor, action: 'no_show_warning_issued', messId, summary: `Issued a no-show warning to ${student.name} (${student.id}) for ${meal} on ${date}` })

      const month = date.slice(0, 7)
      const monthWarnings = db.prepare('SELECT id FROM warnings WHERE student_id = ? AND substr(date, 1, 7) = ? ORDER BY issued_at, rowid').all(student.id, month)
      let fined = false
      if (monthWarnings.length % 3 === 0 && fineAmount > 0) {
        db.prepare('INSERT INTO fines (id, student_id, mess_id, amount, month, issued_at, warning_ids, paid) VALUES (?, ?, ?, ?, ?, ?, ?, 0)')
          .run(randomUUID(), student.id, messId, fineAmount, month, new Date().toISOString(), JSON.stringify(monthWarnings.slice(-3).map((w) => w.id)))
        out.finesIssued++
        fined = true
        logAudit({ ...actor, action: 'no_show_fine_issued', messId, summary: `Fined ${student.name} (${student.id}) ₹${fineAmount} — 3 no-show warnings in ${month}` })
      }
      notices.push({ student, meal, date, monthCount: monthWarnings.length, fined, fineAmount })
    }
  })()

  // Emails go out after the transaction commits, and never delay or fail the caller.
  setImmediate(() => {
    for (const n of notices) {
      const text = n.fined
        ? `Hi ${n.student.name},\n\nYou marked "will eat" for ${n.meal} on ${n.date} but weren't checked in. That's no-show warning number ${n.monthCount} this month, so a fine of ₹${n.fineAmount} has been added to your account. Your mess staff can take payment at the counter.\n\nIf you won't be eating, mark "will not eat" before 2:00 AM that day.`
        : `Hi ${n.student.name},\n\nYou marked "will eat" for ${n.meal} on ${n.date} but weren't checked in at the counter, so you've received a no-show warning (${n.monthCount} this month). Three warnings in a calendar month trigger a fine.\n\nIf you won't be eating, mark "will not eat" before 2:00 AM that day.`
      void sendEmailQuietly({ to: n.student.email, subject: n.fined ? 'LPU Smart Mess — no-show fine issued' : 'LPU Smart Mess — no-show warning', text })
    }
  })
  return out
}

/**
 * A scan that reaches the server late (a counter that was offline) can prove a student DID eat after a no-show was
 * already issued. Take the warning back — and the fine it triggered, if that fine hasn't been paid. A paid fine is left
 * alone and the audit log says so, so a person can refund it.
 */
export function retractNoShow(student, date, meal, actor) {
  const w = db.prepare('SELECT id, mess_id FROM warnings WHERE student_id = ? AND date = ? AND meal = ?').get(student.id, date, meal)
  if (!w) return false
  const fines = db.prepare('SELECT id, paid, amount, warning_ids FROM fines WHERE student_id = ?').all(student.id).filter((f) => JSON.parse(f.warning_ids).includes(w.id))
  let paidNote = ''
  db.transaction(() => {
    for (const f of fines) {
      if (f.paid) paidNote = ` A ₹${f.amount} fine that included it was already paid and was NOT reversed — refund it if due.`
      else db.prepare('DELETE FROM fines WHERE id = ?').run(f.id)
    }
    db.prepare('DELETE FROM warnings WHERE id = ?').run(w.id)
  })()
  logAudit({ ...actor, action: 'no_show_retracted', messId: w.mess_id, summary: `Withdrew the ${meal} no-show warning of ${student.name} (${student.id}) for ${date}: a late-synced check-in proves they were there.${paidNote}` })
  return true
}
