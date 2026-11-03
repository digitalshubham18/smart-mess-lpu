import { Router } from 'express'
import { hashPassword, verifyPassword } from '../password.js'
import crypto from 'node:crypto'
import { db, nextStaffId, hostelExists, messIdForHostel, logAudit, revokeAllTokens, clearFailedLogins } from '../db.js'
import { toStaffUserJSON } from '../mappers.js'
import { requireAuth } from '../auth.js'
import { requireRoles, enforceHostelScope, TEAM_ADMIN_ROLES, ROSTER_ROLES } from '../authz.js'
import { validate, createStaffSchema, uploadPhotoSchema } from '../schemas.js'
import { sendEmailQuietly } from '../email.js'

/** A real, random one-time password — not a fixed default. */
function generateTempPassword() {
  return crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 10)
}

export const staffRouter = Router()

const PHOTO_COLORS = ['#3554D1', '#1F8A5F', '#D97D0A', '#C0392B', '#7C3AED', '#0EA5A5', '#2C46B3', '#8A5F1F']
function escapeXml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c])
}
function initialsPhotoSvg(id, name) {
  let hash = 0
  for (const ch of String(id)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  const color = PHOTO_COLORS[hash % PHOTO_COLORS.length]
  const initials = escapeXml(name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join(''))
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
    <rect width="128" height="128" rx="16" fill="${color}" />
    <text x="64" y="76" font-family="Manrope, Arial, sans-serif" font-size="48" font-weight="700" fill="#ffffff" text-anchor="middle">${initials}</text>
  </svg>`
}

// Team management is the Admin's / Super Admin's — and an Admin only ever sees their own
// mess's team (names, emails, phone numbers), whatever ?hostelId= they send.
staffRouter.get('/', requireAuth, requireRoles(...TEAM_ADMIN_ROLES), (req, res) => {
  let { hostelId } = req.query
  if (req.auth.role !== 'SUPER_ADMIN') {
    if (hostelId && !enforceHostelScope(req, res, hostelId, 'staff list')) return
    hostelId = req.auth.hostelId
  }
  const rows = hostelId
    ? db.prepare('SELECT * FROM staff WHERE hostel_id = ? ORDER BY role').all(hostelId)
    : db.prepare('SELECT * FROM staff ORDER BY role').all()
  res.json(rows.map(toStaffUserJSON))
})

// Staffing a new mess is that mess's own Admin's responsibility — the Super Admin only
// ever creates the Admin account (see hostels.js's mirrored-hostel-creation flow, which
// still generates the Admin locally for now). This endpoint is for the four buildable
// team roles a real Admin adds afterwards.
staffRouter.post('/', requireAuth, requireRoles(...TEAM_ADMIN_ROLES), validate(createStaffSchema), async (req, res) => {
  const { name, email, phone, role, hostelId } = req.body
  // Scope BEFORE existence, so someone outside the mess can't use this to probe which hostels exist.
  if (!enforceHostelScope(req, res, hostelId, `adding ${role} staff`)) return
  if (!hostelExists(hostelId)) return res.status(400).json({ error: `Unknown hostel "${hostelId}".` })

  const id = nextStaffId()
  const finalEmail = email || `${role.toLowerCase()}.${hostelId.toLowerCase()}.${id}@lpu.smartmess.edu`
  if (db.prepare('SELECT 1 FROM staff WHERE email = ?').get(finalEmail)) {
    return res.status(409).json({ error: 'A staff account with that email already exists.' })
  }
  const tempPassword = generateTempPassword()
  const passwordHash = await hashPassword(tempPassword, 10)
  db.prepare('INSERT INTO staff (id, name, email, phone, role, hostel_id, password_hash, must_change_password) VALUES (?, ?, ?, ?, ?, ?, ?, 1)').run(
    id, name, finalEmail, phone ?? null, role, hostelId, passwordHash
  )
  logAudit({ actorId: req.auth.sub, actorName: req.auth.name ?? req.auth.sub, actorRole: req.auth.role, action: 'staff_added', messId: messIdForHostel(hostelId), summary: `Added ${name} as ${role.replace('_', ' ').toLowerCase()}` })
  const emailSent = await sendEmailQuietly({
    to: finalEmail,
    subject: 'Your LPU Smart Mess staff account',
    text: `Hi ${name},\n\nAn account was created for you — UID ${id}, role ${role.replace('_', ' ')}.\nTemporary password: ${tempPassword}\n\nThe first time you sign in you'll be asked to choose your own password.`,
  })
  // The temporary password is returned once, here, so the Admin who just created the
  // account can relay it — it is never retrievable again after this response (only its
  // bcrypt hash is stored). The email is a courtesy copy: if the mail server is down the account still exists and
  // this response must still carry the password (a 5xx here would lose it forever), so it reports `emailSent` instead.
  res.status(201).json({ ...toStaffUserJSON(db.prepare('SELECT * FROM staff WHERE id = ?').get(id)), tempPassword, emailSent })
})

staffRouter.delete('/:id', requireAuth, requireRoles(...TEAM_ADMIN_ROLES), (req, res) => {
  const target = db.prepare('SELECT * FROM staff WHERE id = ?').get(req.params.id)
  if (!target) return res.status(404).json({ error: 'Staff account not found.' })
  if (!enforceHostelScope(req, res, target.hostel_id, `removing staff ${target.id}`)) return
  if (target.role === 'ADMIN' || target.role === 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Admin and Super Admin accounts cannot be removed here.' })
  }
  db.prepare('DELETE FROM staff WHERE id = ?').run(req.params.id)
  logAudit({ actorId: req.auth.sub, actorName: req.auth.name ?? req.auth.sub, actorRole: req.auth.role, action: 'staff_removed', messId: messIdForHostel(target.hostel_id), summary: `Removed ${target.name} (${target.role.replace('_', ' ').toLowerCase()}) from the team` })
  res.json({ success: true })
})

// Creates (or returns the existing) read-only Parent/Guardian account for a student.
staffRouter.post('/parent-access/:studentId', requireAuth, requireRoles(...ROSTER_ROLES), async (req, res) => {
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.studentId)
  if (!student) return res.status(404).json({ error: 'Student not found.' })
  if (!enforceHostelScope(req, res, student.hostel_id, `parent access for student ${student.id}`)) return
  const existing = db.prepare("SELECT * FROM staff WHERE role = 'PARENT' AND student_id = ?").get(student.id)
  if (existing) return res.json(toStaffUserJSON(existing))

  const id = `P${student.id}`
  const tempPassword = generateTempPassword()
  const passwordHash = await hashPassword(tempPassword, 10)
  const parentEmail = `parent.${student.id}@lpu.smartmess.edu`
  try {
    db.prepare('INSERT INTO staff (id, name, email, role, hostel_id, student_id, password_hash, must_change_password) VALUES (?, ?, ?, ?, ?, ?, ?, 1)').run(
      id, `${student.name}'s Parent/Guardian`, parentEmail, 'PARENT', student.hostel_id, student.id, passwordHash
    )
  } catch (e) {
    // A double-click / second admin got here first (the check above ran before the `await`): the account exists,
    // so answer exactly as if we'd seen it in the first place — without a password, since that was shown to the winner.
    if (String(e?.code).startsWith('SQLITE_CONSTRAINT')) return res.json(toStaffUserJSON(db.prepare("SELECT * FROM staff WHERE role = 'PARENT' AND student_id = ?").get(student.id)))
    throw e
  }
  logAudit({ actorId: req.auth.sub, actorName: req.auth.name ?? req.auth.sub, actorRole: req.auth.role, action: 'parent_access_granted', messId: messIdForHostel(student.hostel_id), summary: `Generated parent/guardian access for ${student.name}` })
  const emailSent = await sendEmailQuietly({
    to: parentEmail,
    subject: `Parent/guardian access for ${student.name}`,
    text: `UID ${id}\nTemporary password: ${tempPassword}\n\nShare these sign-in details with ${student.name}'s parent/guardian.`,
  })
  res.status(201).json({ ...toStaffUserJSON(db.prepare('SELECT * FROM staff WHERE id = ?').get(id)), tempPassword, emailSent })
})

// Issues a NEW temporary password for a team member or a parent account (the old one is
// gone — only a hash is ever stored — so this is the recovery path when a password was never
// relayed, e.g. an existing parent account). Revokes the account's sessions and clears any
// lockout. Who may: the Super Admin for anyone; an Admin for their own mess's team and
// parents; roster staff (manager/warden) for parent accounts only. Admin accounts: Super only.
staffRouter.post('/:id/reset-password', requireAuth, requireRoles(...ROSTER_ROLES), async (req, res) => {
  const target = db.prepare('SELECT * FROM staff WHERE id = ?').get(req.params.id)
  if (!target) return res.status(404).json({ error: 'Account not found.' })
  if (!enforceHostelScope(req, res, target.hostel_id, `resetting password of ${target.id}`)) return
  const isParent = target.role === 'PARENT'
  const allowed = req.auth.role === 'SUPER_ADMIN'
    || (isParent && ROSTER_ROLES.includes(req.auth.role))
    || (!isParent && target.role !== 'ADMIN' && target.role !== 'SUPER_ADMIN' && TEAM_ADMIN_ROLES.includes(req.auth.role))
  if (!allowed || target.id === req.auth.sub) {
    return res.status(403).json({ error: "You can't reset that account's password here.", code: 'ROLE_FORBIDDEN' })
  }
  const tempPassword = generateTempPassword()
  db.prepare('UPDATE staff SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(await hashPassword(tempPassword, 10), target.id)
  clearFailedLogins('staff', target.id)
  revokeAllTokens('staff', target.id)
  logAudit({ actorId: req.auth.sub, actorName: req.auth.name, actorRole: req.auth.role, action: 'staff_password_reset', messId: messIdForHostel(target.hostel_id), summary: `Issued a new temporary password for ${target.name} (${target.role.replace('_', ' ').toLowerCase()})` })
  const emailSent = await sendEmailQuietly({ to: target.email, subject: 'Your LPU Smart Mess password was reset', text: `Hi ${target.name},\n\nA new temporary password was issued for UID ${target.id}: ${tempPassword}\n\nThe first time you sign in you'll be asked to choose your own password.` })
  res.json({ id: target.id, tempPassword, emailSent })
})

// Lost authenticator? Clears two-factor for an account so it must be set up again at its next sign-in (the API refuses
// everything else until then, for roles that require it). Same reach as resetting a password: the Super Admin for anyone but
// themselves; an Admin for their own mess's team and parents. The reset is audited and signs the account out everywhere.
staffRouter.post('/:id/reset-2fa', requireAuth, requireRoles(...ROSTER_ROLES), (req, res) => {
  const target = db.prepare('SELECT * FROM staff WHERE id = ?').get(req.params.id)
  if (!target) return res.status(404).json({ error: 'Account not found.' })
  if (!enforceHostelScope(req, res, target.hostel_id, `resetting two-factor of ${target.id}`)) return
  const isParent = target.role === 'PARENT'
  const allowed = req.auth.role === 'SUPER_ADMIN'
    || (isParent && ROSTER_ROLES.includes(req.auth.role))
    || (!isParent && target.role !== 'ADMIN' && target.role !== 'SUPER_ADMIN' && TEAM_ADMIN_ROLES.includes(req.auth.role))
  if (!allowed || target.id === req.auth.sub) return res.status(403).json({ error: "You can't reset that account's two-factor login here.", code: 'ROLE_FORBIDDEN' })
  db.transaction(() => {
    db.prepare('UPDATE staff SET totp_enabled = 0, totp_secret = NULL, totp_last_step = 0 WHERE id = ?').run(target.id)
    db.prepare("DELETE FROM totp_recovery_codes WHERE account_type = 'staff' AND account_id = ?").run(target.id)
    revokeAllTokens('staff', target.id)
  })()
  logAudit({ actorId: req.auth.sub, actorName: req.auth.name, actorRole: req.auth.role, action: 'staff_two_factor_reset', messId: messIdForHostel(target.hostel_id), summary: `Reset two-factor login for ${target.name} (${target.role.replace('_', ' ').toLowerCase()}) — they must set it up again` })
  res.json({ success: true })
})

// Photo: generated initials by default; a staff member (or Super Admin, on their
// behalf) can upload their own — unlike a student's official photo, this one is
// editable, by design, since it isn't tied to an enrollment record.
staffRouter.get('/:id/photo', (req, res) => {
  const row = db.prepare('SELECT id, name, photo_data FROM staff WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).end()
  if (row.photo_data) {
    const [, mime, base64] = row.photo_data.match(/^data:([^;]+);base64,(.+)$/) ?? []
    if (base64) {
      res.type(mime || 'image/png').send(Buffer.from(base64, 'base64'))
      return
    }
  }
  res.type('image/svg+xml').send(initialsPhotoSvg(row.id, row.name))
})

staffRouter.post('/:id/photo', requireAuth, validate(uploadPhotoSchema), (req, res) => {
  if (req.auth.sub !== req.params.id && req.auth.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'You can only change your own photo.' })
  }
  const result = db.prepare('UPDATE staff SET photo_data = ? WHERE id = ?').run(req.body.dataUrl, req.params.id)
  if (result.changes === 0) return res.status(404).json({ error: 'Staff account not found.' })
  res.json({ success: true })
})

staffRouter.delete('/:id/photo', requireAuth, (req, res) => {
  if (req.auth.sub !== req.params.id && req.auth.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'You can only change your own photo.' })
  }
  db.prepare('UPDATE staff SET photo_data = NULL WHERE id = ?').run(req.params.id)
  res.json({ success: true })
})
