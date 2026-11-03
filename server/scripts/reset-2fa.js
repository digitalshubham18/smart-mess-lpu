#!/usr/bin/env node
import 'dotenv/config'
import { db, logAudit } from '../src/db.js'

// Break-glass for the case the app cannot fix: the ONLY Super Admin lost their authenticator AND their recovery codes, so
// nobody is left who can reset it from the Staff page. Run on the server, as the person who administers it:
//   node scripts/reset-2fa.js 10001
// The account's two-factor is cleared, every session is ended, and at next sign-in the person is made to set it up again.
const uid = process.argv[2]
if (!uid) { console.error('Usage: node scripts/reset-2fa.js <staff UID>'); process.exit(1) }
const row = db.prepare('SELECT id, name, role FROM staff WHERE id = ?').get(uid)
if (!row) { console.error(`[reset-2fa] No staff account with UID ${uid}.`); process.exit(1) }
db.transaction(() => {
  db.prepare('UPDATE staff SET totp_enabled = 0, totp_secret = NULL, totp_last_step = 0, token_version = token_version + 1 WHERE id = ?').run(uid)
  db.prepare("DELETE FROM totp_recovery_codes WHERE account_type = 'staff' AND account_id = ?").run(uid)
  db.prepare("UPDATE sessions SET revoked_at = ? WHERE account_type = 'staff' AND account_id = ? AND revoked_at IS NULL").run(new Date().toISOString(), uid)
})()
logAudit({ actorId: 'system', actorName: 'Server console', actorRole: 'SYSTEM', action: 'staff_two_factor_reset', summary: `Two-factor login reset from the server console for ${row.name} (${row.role.replace('_', ' ').toLowerCase()})` })
console.log(`[reset-2fa] Cleared two-factor for ${row.name} (${row.role}, UID ${uid}). They must set it up again at next sign-in.`)
