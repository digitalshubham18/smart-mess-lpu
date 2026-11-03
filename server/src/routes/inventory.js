import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { db, logAudit } from '../db.js'
import { requireAuth } from '../auth.js'
import { requireRoles, enforceMessScope } from '../authz.js'
import { validate, inventoryItemSchema, inventoryPatchSchema, inventoryMoveSchema } from '../schemas.js'
import { notifyManagers } from '../push.js'

export const inventoryRouter = Router()

// Real stock. Every change is a recorded movement (who, when, why) and the shelf can never go below zero, so the number on
// screen is always the sum of what actually happened — not a figure someone typed over.
const WRITE_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER', 'KITCHEN_STAFF']
const READ_ROLES = [...WRITE_ROLES, 'FINANCE_MANAGER']
const round = (n) => Math.round(n * 1000) / 1000
const itemJSON = (r) => ({ id: r.id, messId: r.mess_id, name: r.name, unit: r.unit, category: r.category, quantity: r.quantity, reorderLevel: r.reorder_level, low: r.reorder_level > 0 && r.quantity <= r.reorder_level, archived: !!r.archived })

function loadItem(req, res) {
  const row = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(req.params.id)
  if (!row) { res.status(404).json({ error: 'Item not found.' }); return null }
  return enforceMessScope(req, res, row.mess_id, `inventory item ${row.id}`) ? row : null
}

inventoryRouter.get('/', requireAuth, requireRoles(...READ_ROLES), (req, res) => {
  const messId = String(req.query.messId ?? '')
  if (!messId) return res.status(400).json({ error: 'messId is required.' })
  if (!enforceMessScope(req, res, messId, 'inventory')) return
  const rows = db.prepare('SELECT * FROM inventory_items WHERE mess_id = ? AND archived = ? ORDER BY name').all(messId, req.query.archived === '1' ? 1 : 0)
  const items = rows.map(itemJSON)
  res.json({ items, lowStock: items.filter((i) => i.low).length })
})

inventoryRouter.post('/', requireAuth, requireRoles(...WRITE_ROLES), validate(inventoryItemSchema), (req, res) => {
  const b = req.body
  if (!enforceMessScope(req, res, b.messId, 'adding an inventory item')) return
  if (db.prepare('SELECT 1 FROM inventory_items WHERE mess_id = ? AND lower(name) = lower(?)').get(b.messId, b.name)) return res.status(409).json({ error: `${b.name} is already in your stock list.`, code: 'DUPLICATE_ITEM' })
  const id = randomUUID(), now = new Date().toISOString()
  db.transaction(() => {
    db.prepare('INSERT INTO inventory_items (id, mess_id, name, unit, category, quantity, reorder_level, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, b.messId, b.name, b.unit, b.category, b.quantity, b.reorderLevel, now)
    if (b.quantity > 0) db.prepare("INSERT INTO inventory_moves (id, item_id, mess_id, kind, delta, balance, note, by_id, by_name, at) VALUES (?, ?, ?, 'receive', ?, ?, 'Opening stock', ?, ?, ?)").run(randomUUID(), id, b.messId, b.quantity, b.quantity, req.auth.sub, req.auth.name, now)
  })()
  logAudit({ actorId: req.auth.sub, actorName: req.auth.name, actorRole: req.auth.role, action: 'inventory_item_added', messId: b.messId, summary: `Added ${b.name} (${b.unit}) to stock${b.quantity ? ` with ${b.quantity} ${b.unit}` : ''}` })
  res.status(201).json(itemJSON(db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(id)))
})

inventoryRouter.patch('/:id', requireAuth, requireRoles(...WRITE_ROLES), validate(inventoryPatchSchema), (req, res) => {
  const row = loadItem(req, res); if (!row) return
  const b = req.body
  if (b.name && b.name.toLowerCase() !== row.name.toLowerCase() && db.prepare('SELECT 1 FROM inventory_items WHERE mess_id = ? AND lower(name) = lower(?) AND id != ?').get(row.mess_id, b.name, row.id)) return res.status(409).json({ error: `${b.name} is already in your stock list.`, code: 'DUPLICATE_ITEM' })
  db.prepare('UPDATE inventory_items SET name = COALESCE(?, name), reorder_level = COALESCE(?, reorder_level), archived = COALESCE(?, archived) WHERE id = ?').run(b.name ?? null, b.reorderLevel ?? null, b.archived === undefined ? null : b.archived ? 1 : 0, row.id)
  logAudit({ actorId: req.auth.sub, actorName: req.auth.name, actorRole: req.auth.role, action: 'inventory_item_changed', messId: row.mess_id, summary: `Changed ${row.name}${b.archived ? ' (archived)' : ''}${b.reorderLevel !== undefined ? ` (reorder level ${b.reorderLevel})` : ''}` })
  res.json(itemJSON(db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(row.id)))
})

inventoryRouter.post('/:id/move', requireAuth, requireRoles(...WRITE_ROLES), validate(inventoryMoveSchema), (req, res) => {
  const row = loadItem(req, res); if (!row) return
  const { kind, qty, note } = req.body
  let result
  try {
    result = db.transaction(() => {
      const cur = db.prepare('SELECT quantity FROM inventory_items WHERE id = ?').get(row.id).quantity // re-read inside the transaction: two people at the store at once
      const next = kind === 'receive' ? cur + qty : kind === 'adjust' ? qty : cur - qty
      if (next < 0) { const e = new Error('insufficient'); e.insufficient = cur; throw e }
      const balance = round(next)
      db.prepare('UPDATE inventory_items SET quantity = ? WHERE id = ?').run(balance, row.id)
      db.prepare('INSERT INTO inventory_moves (id, item_id, mess_id, kind, delta, balance, note, by_id, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), row.id, row.mess_id, kind, round(balance - cur), balance, note ?? null, req.auth.sub, req.auth.name, new Date().toISOString())
      return { before: cur, after: balance }
    }).immediate()
  } catch (e) {
    if (e.insufficient !== undefined) return res.status(409).json({ error: `Only ${round(e.insufficient)} ${row.unit} of ${row.name} on the shelf — you can't take out ${qty}.`, code: 'INSUFFICIENT_STOCK' })
    throw e
  }
  logAudit({ actorId: req.auth.sub, actorName: req.auth.name, actorRole: req.auth.role, action: `inventory_${kind}`, messId: row.mess_id, summary: `${kind === 'adjust' ? 'Stock-take' : kind[0].toUpperCase() + kind.slice(1)} ${row.name}: ${result.before} → ${result.after} ${row.unit}${note ? ` (${note})` : ''}` })
  if (row.reorder_level > 0 && result.after <= row.reorder_level && result.before > row.reorder_level) {
    notifyManagers(row.mess_id, `lowstock-${row.id}`, { title: `Low stock: ${row.name}`, body: `${result.after} ${row.unit} left (reorder level ${row.reorder_level}).`, tag: `lowstock-${row.id}`, url: '/inventory' })
  }
  res.json(itemJSON(db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(row.id)))
})

inventoryRouter.get('/:id/moves', requireAuth, requireRoles(...READ_ROLES), (req, res) => {
  const row = loadItem(req, res); if (!row) return
  res.json(db.prepare('SELECT id, kind, delta, balance, note, by_name AS byName, at FROM inventory_moves WHERE item_id = ? ORDER BY at DESC, rowid DESC LIMIT 100').all(row.id))
})
