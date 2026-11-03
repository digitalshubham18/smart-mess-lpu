import { Router } from 'express'
import { db } from '../db.js'
import { requireAuth } from '../auth.js'
import { requireRoles, enforceHostelScope, SUPER_ADMIN_ONLY, TEAM_ADMIN_ROLES } from '../authz.js'
import { validate, createHostelMirrorSchema, patchHostelSchema } from '../schemas.js'
import { logAudit, messIdForHostel } from '../db.js'

export const hostelsRouter = Router()

hostelsRouter.get('/', (_req, res) => {
  const rows = db.prepare(`
    SELECT h.id, h.name, h.category, h.capacity, h.room_capacity AS roomCapacity, COUNT(s.id) AS students,
      MAX(h.capacity - COUNT(s.id), 0) AS available
    FROM hostels h LEFT JOIN students s ON s.hostel_id = h.id
    GROUP BY h.id ORDER BY h.id
  `).all()
  res.json(rows)
})

// Mirrors a hostel created on the frontend (topology lives there) into the real
// database too, so students can actually be registered/enrolled/checked-in against it.
// Creating a hostel (and with it a whole new mess) is a university-level action.
hostelsRouter.post('/', requireAuth, requireRoles(...SUPER_ADMIN_ONLY), validate(createHostelMirrorSchema), (req, res) => {
  const { id, name, category, capacity, roomCapacity } = req.body
  if (db.prepare('SELECT 1 FROM hostels WHERE id = ?').get(id)) return res.status(409).json({ error: `Hostel "${id}" already exists.` })
  db.prepare('INSERT INTO hostels (id, name, category, capacity, room_capacity) VALUES (?, ?, ?, ?, ?)').run(id, name, category, capacity, roomCapacity ?? null)
  const messId = `MESS-${id}`
  db.prepare('INSERT INTO messes (id, name, hostel_id) VALUES (?, ?, ?)').run(messId, `${id} Mess`, id)
  res.status(201).json({ id, name, category, capacity, messId })
})

// Adjust a hostel's limits. Beds per room: the hostel's own Admin or the Super Admin. Total
// bed capacity: Super Admin only (it's a university-level number) — and neither may be set
// below what is already occupied, since that would make existing residents "over capacity"
// the moment they're next edited.
hostelsRouter.patch('/:id', requireAuth, requireRoles(...TEAM_ADMIN_ROLES), validate(patchHostelSchema), (req, res) => {
  const hostel = db.prepare('SELECT * FROM hostels WHERE id = ?').get(req.params.id)
  if (!hostel) return res.status(404).json({ error: 'Hostel not found.' })
  if (!enforceHostelScope(req, res, hostel.id, `changing limits of ${hostel.id}`)) return
  const { capacity, roomCapacity } = req.body

  if (capacity !== undefined && capacity !== hostel.capacity) {
    if (req.auth.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Only the Super Admin can change a hostel\'s total bed capacity.', code: 'ROLE_FORBIDDEN' })
    const occupied = db.prepare('SELECT COUNT(*) AS n FROM students WHERE hostel_id = ?').get(hostel.id).n
    if (capacity < occupied) return res.status(409).json({ error: `${hostel.id} already has ${occupied} students — capacity can't be set below that.`, code: 'BELOW_OCCUPANCY' })
  }
  if (roomCapacity !== undefined && roomCapacity !== null) {
    const over = db.prepare(`
      SELECT room, COUNT(*) AS n FROM students WHERE hostel_id = ? AND lower(room) != 'unassigned' GROUP BY lower(room) HAVING COUNT(*) > ? ORDER BY n DESC
    `).all(hostel.id, roomCapacity)
    if (over.length > 0) {
      const sample = over.slice(0, 3).map((r) => `${r.room} (${r.n})`).join(', ')
      return res.status(409).json({ error: `${over.length} room${over.length === 1 ? ' has' : 's have'} more than ${roomCapacity} students already — e.g. ${sample}. Move them first.`, code: 'ROOMS_OVER_LIMIT' })
    }
  }
  db.prepare('UPDATE hostels SET capacity = ?, room_capacity = ? WHERE id = ?').run(
    capacity ?? hostel.capacity, roomCapacity === undefined ? hostel.room_capacity : roomCapacity, hostel.id
  )
  logAudit({ actorId: req.auth.sub, actorName: req.auth.name, actorRole: req.auth.role, action: 'hostel_limits_changed', messId: messIdForHostel(hostel.id), summary: `Updated ${hostel.id} limits${capacity !== undefined ? ` — beds: ${capacity}` : ''}${roomCapacity !== undefined ? ` — per room: ${roomCapacity ?? 'no limit'}` : ''}` })
  const row = db.prepare('SELECT id, name, category, capacity, room_capacity AS roomCapacity FROM hostels WHERE id = ?').get(hostel.id)
  res.json(row)
})
