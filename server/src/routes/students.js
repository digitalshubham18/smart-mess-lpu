import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { db, hostelExists, messIdForHostel, hostelOccupancy, hostelFullMessage, roomOccupancy, roomFullMessage, logAudit, directoryRecord, nextProvisionalId } from '../db.js'
import { toStudentJSON, maskEmail } from '../mappers.js'
import { photoNotice, recordPhotoConsent, erasePhoto, PHOTO_NOTICE_VERSION } from '../privacy.js'
import { rateLimit } from '../rateLimit.js'
import { requireAuth, signIdCard } from '../auth.js'
import {
  requireRoles, enforceHostelScope, inScopeOfHostel, canAccessStudent,
  ROSTER_ROLES, SUPER_ADMIN_ONLY,
} from '../authz.js'
import {
  validate, enrollStudentSchema, patchStudentSchema, transferStudentSchema,
  bulkStudentsSchema, bulkStudentRowSchema, assignUidSchema, uploadPhotoSchema,
} from '../schemas.js'

export const studentsRouter = Router()

// The student's "official enrollment photo" — deterministically generated from their
// UID (same input always produces the same image), served straight from the backend
// so it always matches the real enrollment record. There's no upload/edit endpoint —
// it can only ever reflect what the university's records say, never a student's own pick.
const PHOTO_COLORS = ['#3554D1', '#1F8A5F', '#D97D0A', '#C0392B', '#7C3AED', '#0EA5A5', '#2C46B3', '#8A5F1F']
function escapeXml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c])
}
function officialPhotoSvg(id, name) {
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  const color = PHOTO_COLORS[hash % PHOTO_COLORS.length]
  const initials = escapeXml(name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join(''))
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
    <rect width="128" height="128" rx="16" fill="${color}" />
    <text x="64" y="76" font-family="Manrope, Arial, sans-serif" font-size="48" font-weight="700" fill="#ffffff" text-anchor="middle">${initials}</text>
  </svg>`
}

/**
 * Works out what a new roster row looks like. With a UID the university's record is the source of truth for the
 * student's name and email (staff can't type over them — that is the point of "auto-detect"), and it fills phone,
 * branch and year unless the request overrides them. Without a UID it's the older manual entry.
 * Returns { fields } to insert, or { status, error, code } to refuse with.
 */
function resolveEnrollment(b) {
  if (!b.uid) return { fields: { id: nextProvisionalId(), provisional: true, name: b.name, email: b.email, phone: b.phone ?? '', year: b.year ?? 1, branch: b.branch ?? 'Not specified' } }
  const rec = directoryRecord(b.uid)
  if (!rec) return { status: 404, code: 'UID_NOT_IN_RECORDS', error: `UID ${b.uid} isn't in the university records, so its details can't be filled in. Check the number, or add the student by name and email instead.` }
  if (db.prepare('SELECT 1 FROM students WHERE id = ?').get(rec.uid)) return { status: 409, code: 'ALREADY_ON_MESS', error: `${rec.name} (${rec.uid}) has already taken mess and is on a roster.` }
  return { fields: { id: rec.uid, name: rec.name, email: rec.email, phone: b.phone ?? rec.phone ?? '', year: b.year ?? rec.year, branch: b.branch ?? rec.branch, photo: b.photoConsent === true ? (rec.photo_data ?? null) : null } }
}

/** Case-insensitive on purpose: login matches lower(email), so "A@x.com" and "a@x.com" would be ambiguous accounts. */
function emailTaken(email, exceptId) {
  const row = db.prepare('SELECT id FROM students WHERE lower(email) = lower(?)').get(email)
  return !!row && row.id !== exceptId
}

// Returns a plain array by default (existing callers expect that). Pass ?page=&pageSize=
// (pageSize capped at 500) to get { data, total, page, pageSize } instead — use that
// for any UI that would otherwise pull the whole roster at once.
//
// Roster staff only, and scoped: a non-Super-Admin always gets just their own hostel's
// students, whatever they put in ?hostelId=.
studentsRouter.get('/', requireAuth, requireRoles(...ROSTER_ROLES), (req, res) => {
  const { page, pageSize, search } = req.query
  let hostelId = req.query.hostelId
  if (req.auth.role !== 'SUPER_ADMIN') {
    if (hostelId && !enforceHostelScope(req, res, hostelId, 'student list')) return
    hostelId = req.auth.hostelId
  }
  const where = []
  const params = []
  if (hostelId) { where.push('hostel_id = ?'); params.push(hostelId) }
  if (search) { where.push('(name LIKE ? OR id LIKE ? OR email LIKE ?)'); const like = `%${search}%`; params.push(like, like, like) }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  if (page || pageSize) {
    const p = Math.max(1, Number(page) || 1)
    const size = Math.min(500, Math.max(1, Number(pageSize) || 50))
    const total = db.prepare(`SELECT COUNT(*) AS n FROM students ${whereSql}`).get(...params).n
    const rows = db.prepare(`SELECT * FROM students ${whereSql} ORDER BY name LIMIT ? OFFSET ?`).all(...params, size, (p - 1) * size)
    return res.json({ data: rows.map(toStudentJSON), total, page: p, pageSize: size })
  }
  const rows = db.prepare(`SELECT * FROM students ${whereSql} ORDER BY name`).all(...params)
  res.json(rows.map(toStudentJSON))
})

// Staff typing a UID into the "Add student" form: returns the university's record so the form can fill itself in.
// Roster staff only, and rate limited so it can't be used to page through the whole student body.
const directoryLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, scope: 'directory-lookup', message: 'Too many lookups — please wait a minute.' })
studentsRouter.get('/directory/:uid', requireAuth, requireRoles(...ROSTER_ROLES), directoryLimiter, (req, res) => {
  const uid = String(req.params.uid).trim()
  const rec = directoryRecord(uid)
  if (!rec) return res.status(404).json({ error: `UID ${uid} isn't in the university records.`, code: 'UID_NOT_IN_RECORDS' })
  const onRoster = db.prepare('SELECT hostel_id FROM students WHERE id = ?').get(uid)
  if (onRoster) {
    // Already taken mess. Staff of that mess see who it is; anyone else only learns the UID is taken.
    return res.json(inScopeOfHostel(req.auth, onRoster.hostel_id)
      ? { uid, name: rec.name, onMess: true, hostelId: onRoster.hostel_id }
      : { uid, onMess: true, outOfScope: true })
  }
  res.json({ uid, name: rec.name, email: rec.email, phone: rec.phone ?? '', branch: rec.branch, year: rec.year, onMess: false })
})

// Unauthenticated (a student needs it before they have a login), so it returns the bare
// minimum to show "this is the right hostel" and to block double sign-up — NO name, email,
// phone or room. (Returning the name used to defeat the name check on /register: anyone
// could look up a UID, copy the name, and claim the account.) The name is masked to initials.
// Rate limited so it can't be used to sweep the UID space quickly.
const lookupLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, scope: 'student-lookup', message: 'Too many lookups — please wait a minute.' })
function maskName(name) {
  return String(name).split(/\s+/).filter(Boolean).map((w) => `${w[0]}${'•'.repeat(Math.min(5, Math.max(1, w.length - 1)))}`).join(' ')
}
studentsRouter.get('/lookup/:uid', lookupLimiter, (req, res) => {
  const row = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.uid.trim())
  if (!row) return res.json(null)
  res.json({
    maskedName: maskName(row.name),
    maskedEmail: maskEmail(row.email),
    hostelName: db.prepare('SELECT name FROM hostels WHERE id = ?').get(row.hostel_id)?.name ?? row.hostel_id,
    messId: messIdForHostel(row.hostel_id),
    messName: db.prepare('SELECT name FROM messes WHERE hostel_id = ?').get(row.hostel_id)?.name ?? '',
    alreadyRegistered: !!row.password_hash,
  })
})

// The notice text (public: a student reads it before they have anything to sign in with, and it contains nothing personal).
studentsRouter.get('/photo-notice', (_req, res) => res.json(photoNotice()))

// A student's own view of what is held about their photo, and the two things only they can do about it: agree, withdraw.
const selfPrivacy = (row) => ({
  photoOnFile: !!row.photo_data, consentGiven: !!row.photo_consent_at, consentAt: row.photo_consent_at ?? null,
  consentMethod: row.photo_consent_method ?? null, consentNoticeVersion: row.photo_notice_version ?? null, currentNoticeVersion: PHOTO_NOTICE_VERSION,
})
studentsRouter.get('/me/privacy', requireAuth, (req, res) => {
  if (req.auth.role !== 'STUDENT') return res.status(403).json({ error: 'Only students have a photo on file.', code: 'ROLE_FORBIDDEN' })
  res.json(selfPrivacy(db.prepare('SELECT photo_data, photo_consent_at, photo_consent_method, photo_notice_version FROM students WHERE id = ?').get(req.auth.sub)))
})
studentsRouter.post('/me/photo-consent', requireAuth, (req, res) => {
  if (req.auth.role !== 'STUDENT') return res.status(403).json({ error: 'Only the student can give this consent.', code: 'ROLE_FORBIDDEN' })
  recordPhotoConsent(req.auth.sub, { method: 'student_app', by: req.auth.sub })
  logAudit({ actorId: req.auth.sub, actorName: req.auth.name, actorRole: 'STUDENT', action: 'photo_consent_given', messId: messIdForHostel(req.auth.hostelId), summary: `${req.auth.name} agreed to the photo notice (${PHOTO_NOTICE_VERSION})` })
  res.json(selfPrivacy(db.prepare('SELECT photo_data, photo_consent_at, photo_consent_method, photo_notice_version FROM students WHERE id = ?').get(req.auth.sub)))
})
// Withdrawing is immediate and complete: the photo is deleted, not merely hidden.
studentsRouter.delete('/me/photo-consent', requireAuth, (req, res) => {
  if (req.auth.role !== 'STUDENT') return res.status(403).json({ error: 'Only the student can withdraw this consent.', code: 'ROLE_FORBIDDEN' })
  erasePhoto(req.auth.sub, { reason: 'consent withdrawn by the student', actor: { sub: req.auth.sub, name: req.auth.name, role: 'STUDENT' } })
  res.json(selfPrivacy(db.prepare('SELECT photo_data, photo_consent_at, photo_consent_method, photo_notice_version FROM students WHERE id = ?').get(req.auth.sub)))
})

// The official photo is personal data, so unlike a staff avatar it is NOT public: the student themself, their linked
// parent, or staff of the student's own mess. (An <img> sends the session cookie, so the app needs no special handling.)
// With no photo on file this serves the generated initials tile, and `hasPhoto` on the student record says which it is.
studentsRouter.get('/:id/photo', requireAuth, (req, res) => {
  const row = db.prepare('SELECT id, name, hostel_id, photo_data FROM students WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).end()
  if (!canAccessStudent(req.auth, row)) return res.status(403).json({ error: "You don't have access to that student's photo.", code: 'OUT_OF_SCOPE' })
  res.set('Cache-Control', 'private, no-store')
  if (row.photo_data) {
    const [, mime, base64] = row.photo_data.match(/^data:([^;]+);base64,(.+)$/) ?? []
    if (base64) return res.type(mime || 'image/png').send(Buffer.from(base64, 'base64'))
  }
  res.type('image/svg+xml').send(officialPhotoSvg(row.id, row.name))
})

// Only the staff who run the roster can set or replace it — a student can never change their own official photo.
studentsRouter.post('/:id/photo', requireAuth, requireRoles(...ROSTER_ROLES), validate(uploadPhotoSchema), (req, res) => {
  const row = db.prepare('SELECT id, name, hostel_id FROM students WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Student not found.' })
  if (!enforceHostelScope(req, res, row.hostel_id, `photo upload for ${row.id}`)) return
  // No consent on record → the uploader must confirm the student (or guardian) has seen the notice and agreed.
  const consented = !!db.prepare('SELECT photo_consent_at FROM students WHERE id = ?').get(row.id).photo_consent_at
  if (!consented && req.body.consent !== true) {
    return res.status(400).json({ error: `${row.name} hasn't agreed to the photo notice yet. Show them the notice, and confirm they agree, before saving a photo.`, code: 'CONSENT_REQUIRED' })
  }
  db.prepare('UPDATE students SET photo_data = ? WHERE id = ?').run(req.body.dataUrl, row.id)
  if (!consented) recordPhotoConsent(row.id, { method: 'staff_attested', by: req.auth.sub })
  logAudit({ actorId: req.auth.sub, actorName: req.auth.name, actorRole: req.auth.role, action: 'student_photo_set', messId: messIdForHostel(row.hostel_id), summary: `Set the official photo of ${row.name} (${row.id})${consented ? '' : ' — consent confirmed by staff'}` })
  res.json({ success: true, hasPhoto: true })
})

studentsRouter.delete('/:id/photo', requireAuth, requireRoles(...ROSTER_ROLES), (req, res) => {
  const row = db.prepare('SELECT id, name, hostel_id FROM students WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Student not found.' })
  if (!enforceHostelScope(req, res, row.hostel_id, `photo removal for ${row.id}`)) return
  erasePhoto(row.id, { reason: `removed by ${req.auth.name}`, actor: req.auth }) // the photo and its consent record go together
  res.json({ success: true, hasPhoto: false })
})

// A student reads only themselves, a parent only their linked child, staff only their own mess.
studentsRouter.get('/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Student not found.' })
  if (!canAccessStudent(req.auth, row)) return res.status(403).json({ error: "You don't have access to that student's record.", code: 'OUT_OF_SCOPE' })
  res.json(toStudentJSON(row))
})

studentsRouter.post('/', requireAuth, requireRoles(...ROSTER_ROLES), validate(enrollStudentSchema), (req, res) => {
  const b = req.body
  // Scope BEFORE existence: someone outside the mess learns nothing about which hostels exist.
  if (!enforceHostelScope(req, res, b.hostelId, 'student enrollment')) return
  if (!hostelExists(b.hostelId)) return res.status(400).json({ error: `Unknown hostel "${b.hostelId}".` })

  const resolved = resolveEnrollment(b)
  if (resolved.error) return res.status(resolved.status).json({ error: resolved.error, code: resolved.code })
  const f = resolved.fields
  if (emailTaken(f.email)) return res.status(409).json({ error: 'A student with that email already exists.' })

  // better-sqlite3 is synchronous, so the capacity check and the insert below can't be
  // interleaved with another request's — no "two people both took the last bed" race.
  const occ = hostelOccupancy(b.hostelId)
  if (occ.available < 1) return res.status(409).json({ error: hostelFullMessage(occ), code: 'HOSTEL_FULL', capacity: occ.capacity, occupied: occ.occupied })

  const roomOcc = roomOccupancy(b.hostelId, b.room)
  if (roomOcc && roomOcc.available < 1) return res.status(409).json({ error: roomFullMessage(roomOcc), code: 'ROOM_FULL', capacity: roomOcc.capacity, occupied: roomOcc.occupied })

  const id = f.id
  db.prepare(`
    INSERT INTO students (id, name, email, phone, hostel_id, room, year, branch, meal_preference, status, points, badges, missed_cutoff_count, provisional, photo_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '[]', 0, ?, ?)
  `).run(id, f.name, f.email, f.phone, b.hostelId, b.room ?? 'Unassigned', f.year, f.branch, b.mealPreference ?? 'either', b.status ?? 'active', f.provisional ? 1 : 0, f.photo ?? null)

  if (f.photo) recordPhotoConsent(id, { method: 'staff_attested', by: req.auth.sub })
  if (f.provisional) {
    logAudit({
      actorId: req.auth.sub, actorName: req.auth.name, actorRole: req.auth.role, action: 'student_enrolled_no_uid',
      messId: messIdForHostel(b.hostelId), summary: `Enrolled ${f.name} in ${b.hostelId} with temporary ID ${id} — no UID yet (${b.noUidReason})`,
    })
  }
  if (b.uid) {
    logAudit({
      actorId: req.auth.sub, actorName: req.auth.name, actorRole: req.auth.role, action: 'student_enrolled',
      messId: messIdForHostel(b.hostelId), summary: `Enrolled ${f.name} (${id}) in ${b.hostelId} from the university record`,
    })
  }
  res.status(201).json(toStudentJSON(db.prepare('SELECT * FROM students WHERE id = ?').get(id)))
})

// Bulk CSV import. The browser parses the file and sends rows here; every row is checked
// independently (same rules as POST /, including role scope and bed capacity) and the
// response says exactly which lines were rejected and why. The whole batch runs in one
// transaction, so a 500-row import is one fast write, not 500 round trips — and capacity
// is checked against the live count as rows land, so a file that would overfill a hostel
// admits rows up to the last free bed and rejects the rest.
studentsRouter.post('/bulk', requireAuth, requireRoles(...ROSTER_ROLES), validate(bulkStudentsSchema), (req, res) => {
  const failed = []
  const touchedHostels = new Set()
  let created = 0

  const tx = db.transaction((rows) => {
    const insert = db.prepare(`
      INSERT INTO students (id, name, email, phone, hostel_id, room, year, branch, meal_preference, status, points, badges, missed_cutoff_count, provisional, photo_data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '[]', 0, ?, ?)
    `)
    for (const { line, data } of rows) {
      const parsed = bulkStudentRowSchema.safeParse(data)
      if (!parsed.success) {
        const issue = parsed.error.issues[0]
        failed.push({ line, error: issue ? `${issue.path.join('.') || 'row'}: ${issue.message}` : 'Invalid row.' })
        continue
      }
      const b = parsed.data
      const hostelId = b.hostelId ?? (req.auth.role === 'SUPER_ADMIN' ? null : req.auth.hostelId)
      if (!hostelId) { failed.push({ line, error: 'hostelId is required.' }); continue }
      if (!inScopeOfHostel(req.auth, hostelId)) { failed.push({ line, error: `You can only import students into your own hostel (${req.auth.hostelId}).`, code: 'OUT_OF_SCOPE' }); continue }
      if (!hostelExists(hostelId)) { failed.push({ line, error: `Unknown hostel "${hostelId}".` }); continue }
      const resolved = resolveEnrollment(b)
      if (resolved.error) { failed.push({ line, error: resolved.error, code: resolved.code }); continue }
      const f = resolved.fields
      if (emailTaken(f.email)) { failed.push({ line, error: `A student with the email ${f.email} already exists.` }); continue }
      const occ = hostelOccupancy(hostelId)
      if (occ.available < 1) { failed.push({ line, error: hostelFullMessage(occ), code: 'HOSTEL_FULL' }); continue }

      const roomOcc = roomOccupancy(hostelId, b.room)
      if (roomOcc && roomOcc.available < 1) { failed.push({ line, error: roomFullMessage(roomOcc), code: 'ROOM_FULL' }); continue }

      insert.run(f.id, f.name, f.email, f.phone, hostelId, b.room ?? 'Unassigned', f.year, f.branch, b.mealPreference ?? 'either', b.status ?? 'active', f.provisional ? 1 : 0, f.photo ?? null)
      if (f.photo) recordPhotoConsent(f.id, { method: 'staff_attested', by: req.auth.sub })
      touchedHostels.add(hostelId)
      created++
    }
  })
  tx(req.body.rows)

  if (created > 0 || failed.length > 0) {
    const hostels = [...touchedHostels]
    logAudit({
      actorId: req.auth.sub, actorName: req.auth.name, actorRole: req.auth.role, action: 'students_imported',
      messId: hostels.length === 1 ? messIdForHostel(hostels[0]) : undefined,
      summary: `Imported ${created} student${created === 1 ? '' : 's'} from CSV${hostels.length ? ` into ${hostels.join(', ')}` : ''}${failed.length ? ` (${failed.length} row${failed.length === 1 ? '' : 's'} rejected)` : ''}`,
    })
  }
  res.status(created > 0 || failed.length === 0 ? 201 : 422).json({ created, failed })
})

studentsRouter.patch('/:id', requireAuth, requireRoles(...ROSTER_ROLES), validate(patchStudentSchema), (req, res) => {
  const existing = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Student not found.' })
  if (!enforceHostelScope(req, res, existing.hostel_id, `edit of student ${existing.id}`)) return
  const b = req.body

  // Moving a student between hostels is a transfer (Super Admin only, capacity-checked).
  // Letting PATCH do it would be a back door around both rules.
  const movingHostel = b.hostelId !== undefined && b.hostelId !== existing.hostel_id
  if (movingHostel) {
    if (req.auth.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Only the Super Admin can move a student to a different hostel.', code: 'ROLE_FORBIDDEN' })
    }
    if (!hostelExists(b.hostelId)) return res.status(400).json({ error: `Unknown hostel "${b.hostelId}".` })
    const occ = hostelOccupancy(b.hostelId)
    if (occ.available < 1) return res.status(409).json({ error: hostelFullMessage(occ), code: 'HOSTEL_FULL', capacity: occ.capacity, occupied: occ.occupied })
  }
  const targetHostel = b.hostelId ?? existing.hostel_id
  const targetRoom = b.room ?? existing.room
  if (movingHostel || (b.room !== undefined && b.room !== existing.room)) {
    const roomOcc = roomOccupancy(targetHostel, targetRoom, existing.id)
    if (roomOcc && roomOcc.available < 1) return res.status(409).json({ error: roomFullMessage(roomOcc), code: 'ROOM_FULL', capacity: roomOcc.capacity, occupied: roomOcc.occupied })
  }
  if (b.email !== undefined && emailTaken(b.email, existing.id)) {
    return res.status(409).json({ error: 'A student with that email already exists.' })
  }

  const merged = {
    name: b.name ?? existing.name,
    email: b.email ?? existing.email,
    phone: b.phone ?? existing.phone,
    hostel_id: b.hostelId ?? existing.hostel_id,
    room: b.room ?? existing.room,
    year: b.year ?? existing.year,
    branch: b.branch ?? existing.branch,
    meal_preference: b.mealPreference ?? existing.meal_preference,
    status: b.status ?? existing.status,
    leave_until: b.leaveUntil === null ? null : (b.leaveUntil ?? existing.leave_until),
  }
  db.prepare(`
    UPDATE students SET name=@name, email=@email, phone=@phone, hostel_id=@hostel_id, room=@room, year=@year,
      branch=@branch, meal_preference=@meal_preference, status=@status, leave_until=@leave_until WHERE id = @id
  `).run({ ...merged, id: req.params.id })
  // Leaving the mess (status no longer 'active') ends the reason for holding the photo: erase it now, not at some later sweep.
  if (merged.status !== 'active') erasePhoto(req.params.id, { reason: `student is now ${merged.status}`, actor: req.auth })
  res.json(toStudentJSON(db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id)))
})

// A printable, permanent meal QR for a student — for those with no phone login (a temporary TMP- ID, a new admission) or a
// lost phone. The QR carries a card id, not the student's UID, so it keeps working when a TMP- ID becomes the real UID.
// Asking again returns the same card; `reissue: true` (a lost or photocopied card) replaces it and the old one stops working at once.
studentsRouter.post('/:id/id-card', requireAuth, requireRoles(...ROSTER_ROLES), (req, res) => {
  const row = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Student not found.' })
  if (!enforceHostelScope(req, res, row.hostel_id, `ID card for ${row.id}`)) return
  const reissue = req.body?.reissue === true
  const hadCard = !!row.card_id
  let cardId = row.card_id
  if (!cardId || reissue) {
    cardId = randomUUID()
    db.prepare('UPDATE students SET card_id = ? WHERE id = ?').run(cardId, row.id)
    logAudit({
      actorId: req.auth.sub, actorName: req.auth.name, actorRole: req.auth.role, action: reissue && hadCard ? 'id_card_reissued' : 'id_card_issued',
      messId: messIdForHostel(row.hostel_id), summary: `${reissue && hadCard ? 'Reissued (the old card no longer works)' : 'Issued'} the ID card of ${row.name} (${row.id})`,
    })
  }
  const hostel = db.prepare('SELECT name FROM hostels WHERE id = ?').get(row.hostel_id)
  res.json({
    token: signIdCard(cardId), studentId: row.id, name: row.name, hostelName: hostel?.name ?? row.hostel_id, room: row.room,
    provisional: !!row.provisional, hasPhoto: !!row.photo_data, reissued: reissue && hadCard,
  })
})

// A student who was enrolled with a temporary ID (no UID at the time) finally has one. Swaps TMP-xxxxx for the real UID
// everywhere the student appears — check-ins, meal intentions, fines, warnings, parent links — in ONE transaction, so
// their history follows them and nothing is left pointing at the old ID. If the university record for the new UID exists
// it becomes the source of truth for name/email/branch/year, exactly as when a student is added by UID.
studentsRouter.post('/:id/assign-uid', requireAuth, requireRoles(...ROSTER_ROLES), validate(assignUidSchema), (req, res) => {
  const existing = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Student not found.' })
  if (!enforceHostelScope(req, res, existing.hostel_id, `UID assignment for ${existing.id}`)) return
  if (!existing.provisional) return res.status(409).json({ error: `${existing.name} already has a real UID (${existing.id}).`, code: 'NOT_PROVISIONAL' })
  const { uid } = req.body
  const holder = db.prepare('SELECT name, hostel_id FROM students WHERE id = ?').get(uid)
  if (holder) {
    const mine = inScopeOfHostel(req.auth, holder.hostel_id)
    return res.status(409).json({ error: mine ? `UID ${uid} already belongs to ${holder.name} on the roster.` : `UID ${uid} is already on a roster.`, code: 'UID_TAKEN' })
  }
  const rec = directoryRecord(uid)
  if (rec && rec.email.toLowerCase() !== existing.email.toLowerCase() && emailTaken(rec.email, existing.id)) {
    return res.status(409).json({ error: `The university record for ${uid} uses an email already held by another student — resolve that first.`, code: 'EMAIL_TAKEN' })
  }

  db.transaction(() => {
    // Every table that has a student_id column follows the student. Looked up from the schema, so a table added later is not forgotten.
    db.pragma('defer_foreign_keys = ON')
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name)
    for (const t of tables) {
      if (t === 'students') continue
      if (db.prepare(`PRAGMA table_info(${t})`).all().some((c) => c.name === 'student_id')) {
        db.prepare(`UPDATE ${t} SET student_id = ? WHERE student_id = ?`).run(uid, existing.id)
      }
    }
    if (rec) {
      db.prepare('UPDATE students SET id = ?, provisional = 0, name = ?, email = ?, phone = ?, branch = ?, year = ?, photo_data = COALESCE(photo_data, ?) WHERE id = ?')
        .run(uid, rec.name, rec.email, rec.phone ?? existing.phone, rec.branch, rec.year, existing.photo_consent_at ? (rec.photo_data ?? null) : null, existing.id) // a university photo only joins a record that already has consent
    } else {
      db.prepare('UPDATE students SET id = ?, provisional = 0 WHERE id = ?').run(uid, existing.id)
    }
  })()

  logAudit({
    actorId: req.auth.sub, actorName: req.auth.name, actorRole: req.auth.role, action: 'student_uid_assigned',
    messId: messIdForHostel(existing.hostel_id), summary: `Assigned UID ${uid} to ${existing.name} (was temporary ID ${existing.id})`,
  })
  res.json(toStudentJSON(db.prepare('SELECT * FROM students WHERE id = ?').get(uid)))
})

studentsRouter.delete('/:id', requireAuth, requireRoles(...ROSTER_ROLES), (req, res) => {
  const existing = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id)
  if (!existing) return res.json({ success: false })
  if (!enforceHostelScope(req, res, existing.hostel_id, `removal of student ${existing.id}`)) return
  try {
    const result = db.transaction(() => {
      const r = db.prepare('DELETE FROM students WHERE id = ?').run(req.params.id) // the photo and its consent go with the row
      if (r.changes > 0) {
        db.prepare("DELETE FROM push_subscriptions WHERE account_type = 'student' AND account_id = ?").run(req.params.id)
        db.prepare("DELETE FROM sessions WHERE account_type = 'student' AND account_id = ?").run(req.params.id)
        db.prepare('DELETE FROM reminder_log WHERE student_id = ?').run(req.params.id)
      }
      return r
    })()
    if (result.changes > 0) logAudit({ actorId: req.auth.sub, actorName: req.auth.name, actorRole: req.auth.role, action: 'student_removed', messId: messIdForHostel(existing.hostel_id), summary: `Removed ${existing.name} (${existing.id}) from the roster${existing.photo_data ? ' — their photo was deleted with the record' : ''}` })
    res.json({ success: result.changes > 0 })
  } catch (e) {
    if (String(e?.code).startsWith('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ error: `${existing.name} has attendance, warning, fine or parent-access records, so they can't be deleted — deactivate them instead.` })
    }
    throw e
  }
})

// Super Admin only (the Students page only ever offers this to them) — and, like every
// other way a student can land in a hostel, it can't push the destination past capacity.
studentsRouter.post('/:id/transfer', requireAuth, requireRoles(...SUPER_ADMIN_ONLY), validate(transferStudentSchema), (req, res) => {
  const { hostelId, room } = req.body
  if (!hostelExists(hostelId)) return res.status(400).json({ error: `Unknown hostel "${hostelId}".` })
  const existing = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Student not found.' })
  if (existing.hostel_id !== hostelId) {
    const occ = hostelOccupancy(hostelId)
    if (occ.available < 1) return res.status(409).json({ error: hostelFullMessage(occ), code: 'HOSTEL_FULL', capacity: occ.capacity, occupied: occ.occupied })
    const roomOcc = roomOccupancy(hostelId, room?.trim(), existing.id)
    if (roomOcc && roomOcc.available < 1) return res.status(409).json({ error: roomFullMessage(roomOcc), code: 'ROOM_FULL', capacity: roomOcc.capacity, occupied: roomOcc.occupied })
    db.prepare('UPDATE students SET hostel_id = ?, room = ? WHERE id = ?').run(hostelId, room?.trim() || 'Unassigned', req.params.id)
    logAudit({
      actorId: req.auth.sub, actorName: req.auth.name, actorRole: req.auth.role, action: 'student_transferred',
      messId: messIdForHostel(hostelId), summary: `Transferred ${existing.name} (${existing.id}) from ${existing.hostel_id} to ${hostelId}`,
    })
  }
  res.json(toStudentJSON(db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id)))
})
