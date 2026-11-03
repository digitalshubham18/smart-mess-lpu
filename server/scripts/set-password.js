#!/usr/bin/env node
import 'dotenv/config'
import { db, revokeAllTokens, logAudit } from '../src/db.js'
import { hashPassword } from '../src/password.js'

// Sets a staff account's password from the server console — the FIRST thing to do on a new deployment, BEFORE the site is
// reachable. The demo seed gives the Super Admin the published password `demo1234`; because Admin/Super Admin accounts must
// then set up two-factor at their first sign-in, whoever signs in first would also be the one who enrols their own
// authenticator. Closing that window means replacing the password while nobody else can reach the login page.
//
//   docker compose -f docker-compose.prod.yml exec -T api node scripts/set-password.js 10001      (reads the new password from stdin)
//   echo 'a long passphrase' | node scripts/set-password.js 10001
// The password is read from stdin, never from the command line (which other users can see and shells keep in history).
const uid = process.argv[2]
if (!uid) { console.error('Usage: node scripts/set-password.js <staff UID>   (new password on stdin)'); process.exit(1) }
const row = db.prepare('SELECT id, name, role FROM staff WHERE id = ?').get(uid)
if (!row) { console.error(`[set-password] No staff account with UID ${uid}.`); process.exit(1) }

let input = ''
for await (const chunk of process.stdin) input += chunk
const password = input.replace(/\r?\n$/, '')
if (password.length < 12) { console.error('[set-password] Use at least 12 characters (a passphrase of several words is easiest).'); process.exit(1) }
if (/^demo1234$/i.test(password)) { console.error('[set-password] That is the published demo password.'); process.exit(1) }

const hash = await hashPassword(password)
db.transaction(() => {
  db.prepare("UPDATE staff SET password_hash = ?, must_change_password = 0, failed_attempts = 0, locked_until = NULL, password_changed_at = ? WHERE id = ?").run(hash, new Date().toISOString(), uid)
  revokeAllTokens('staff', uid)
})()
logAudit({ actorId: 'system', actorName: 'Server console', actorRole: 'SYSTEM', action: 'staff_password_set_console', summary: `Password for ${row.name} (${row.role.replace('_', ' ').toLowerCase()}) set from the server console` })
console.log(`[set-password] Password set for ${row.name} (${row.role}, UID ${uid}). Every existing session was signed out.`)
