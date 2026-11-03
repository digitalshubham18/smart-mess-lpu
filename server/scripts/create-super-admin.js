#!/usr/bin/env node
import 'dotenv/config'
import { db, logAudit } from '../src/db.js'
import { hashPassword } from '../src/password.js'

// Creates the first Super Admin on a deployment started with SEED_DEMO=0 (which has no people at all).
//   echo 'a long passphrase' | node scripts/create-super-admin.js "Dr. Name" name@example.edu
// The password is read from stdin (never argv). At first sign-in this account must set up two-factor (policy: Super Admin).
const [name, email] = process.argv.slice(2)
if (!name || !email) { console.error('Usage: node scripts/create-super-admin.js "<full name>" <email>   (password on stdin)'); process.exit(1) }
if (db.prepare("SELECT 1 FROM staff WHERE role = 'SUPER_ADMIN'").get()) { console.error('[create-super-admin] A Super Admin already exists. Use scripts/set-password.js to change a password.'); process.exit(1) }
let input = ''
for await (const c of process.stdin) input += c
const password = input.replace(/\r?\n$/, '')
if (password.length < 12) { console.error('[create-super-admin] Use at least 12 characters.'); process.exit(1) }
if (/^demo1234$/i.test(password)) { console.error('[create-super-admin] That is the published demo password.'); process.exit(1) }
const id = '10001'
db.prepare("INSERT INTO staff (id, name, email, phone, role, hostel_id, student_id, password_hash, must_change_password, password_changed_at) VALUES (?, ?, ?, NULL, 'SUPER_ADMIN', NULL, NULL, ?, 0, ?)")
  .run(id, name, email.toLowerCase(), await hashPassword(password), new Date().toISOString())
logAudit({ actorId: 'system', actorName: 'Server console', actorRole: 'SYSTEM', action: 'super_admin_created_console', summary: `Created the first Super Admin (${name}) from the server console` })
console.log(`[create-super-admin] Created ${name} as Super Admin, UID ${id}. Sign in, then set up two-factor.`)
