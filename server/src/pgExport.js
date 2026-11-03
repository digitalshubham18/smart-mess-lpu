import Database from 'better-sqlite3'

/**
 * SQLite → PostgreSQL export, generated from the LIVE schema (PRAGMA introspection), so it can
 * never drift from what the app actually uses — add a column or table and the next export
 * includes it. Output is plain SQL you load with `psql -f`. No side effects on import.
 *
 * Deliberate, documented choices (see README § Moving to PostgreSQL):
 *  - Timestamps/dates stay TEXT (ISO-8601), exactly as the app reads and writes them. Moving to
 *    TIMESTAMPTZ/DATE is a good follow-up but it changes application code, not just data.
 *  - Two 0/1 flag columns become real BOOLEANs (BOOLEAN_COLUMNS below).
 *  - Other INTEGER columns stay INTEGER, REAL becomes DOUBLE PRECISION.
 *
 * This produces the SCHEMA and DATA for Postgres. It does NOT port the server's queries —
 * routes still use better-sqlite3 — so it's a migration path, not a drop-in switch.
 */

const BOOLEAN_COLUMNS = new Set(['fines.paid', 'password_reset_tokens.used'])
const NOW_TEXT = "to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS')" // what SQLite's datetime('now') yields

const qi = (name) => `"${String(name).replace(/"/g, '""')}"`

function sqlLiteral(value, isBool) {
  if (value === null || value === undefined) return 'NULL'
  if (isBool) return Number(value) ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Cannot export non-finite number ${value}`)
    return String(value)
  }
  if (typeof value === 'bigint') return value.toString()
  if (Buffer.isBuffer(value)) return `'\\x${value.toString('hex')}'::bytea`
  const text = String(value)
  if (text.includes('\0')) throw new Error('A text value contains a NUL byte, which PostgreSQL cannot store.')
  return `'${text.replace(/'/g, "''")}'`
}

function pgType(table, col) {
  if (BOOLEAN_COLUMNS.has(`${table}.${col.name}`)) return 'BOOLEAN'
  const t = String(col.type).toUpperCase()
  if (t.includes('INT')) return 'INTEGER'
  if (t.includes('REAL') || t.includes('FLOA') || t.includes('DOUB')) return 'DOUBLE PRECISION'
  if (t.includes('BLOB')) return 'BYTEA'
  return 'TEXT'
}

function pgDefault(table, col) {
  const d = col.dflt_value
  if (d === null || d === undefined) return null
  if (BOOLEAN_COLUMNS.has(`${table}.${col.name}`)) return Number(d) ? 'true' : 'false'
  if (/datetime\s*\(\s*'now'\s*\)|CURRENT_TIMESTAMP/i.test(d)) return `(${NOW_TEXT})`
  return d // numeric and 'string' literals are valid as-is
}

/** Tables ordered so every table comes after the ones it references (so INSERTs satisfy FKs). */
function orderedTables(conn) {
  const names = conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name)
  const deps = new Map(names.map((n) => [n, new Set(conn.prepare(`PRAGMA foreign_key_list(${qi(n)})`).all().map((f) => f.table).filter((t) => t !== n))]))
  const out = []
  const done = new Set()
  while (out.length < names.length) {
    const ready = names.filter((n) => !done.has(n) && [...deps.get(n)].every((d) => done.has(d)))
    if (ready.length === 0) throw new Error(`Circular foreign keys among: ${names.filter((n) => !done.has(n)).join(', ')}`)
    for (const n of ready) { out.push(n); done.add(n) }
  }
  return out
}

function createTableSql(conn, table) {
  const cols = conn.prepare(`PRAGMA table_info(${qi(table)})`).all()
  const fks = conn.prepare(`PRAGMA foreign_key_list(${qi(table)})`).all()
  const pkCols = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name)
  const lines = cols.map((c) => {
    const def = pgDefault(table, c)
    return `  ${qi(c.name)} ${pgType(table, c)}${c.notnull || pkCols.includes(c.name) ? ' NOT NULL' : ''}${def !== null ? ` DEFAULT ${def}` : ''}`
  })
  if (pkCols.length) lines.push(`  PRIMARY KEY (${pkCols.map(qi).join(', ')})`)
  // UNIQUE constraints (column-level UNIQUE and table-level UNIQUE(...)): SQLite lists them as indexes with origin 'u'.
  for (const idx of conn.prepare(`PRAGMA index_list(${qi(table)})`).all().filter((i) => i.origin === 'u')) {
    const icols = conn.prepare(`PRAGMA index_info(${qi(idx.name)})`).all().sort((a, b) => a.seqno - b.seqno).map((c) => qi(c.name))
    lines.push(`  UNIQUE (${icols.join(', ')})`)
  }
  const byId = new Map()
  for (const f of fks) { if (!byId.has(f.id)) byId.set(f.id, []); byId.get(f.id).push(f) }
  for (const group of byId.values()) {
    const g = group.sort((a, b) => a.seq - b.seq)
    const del = g[0].on_delete && g[0].on_delete !== 'NO ACTION' ? ` ON DELETE ${g[0].on_delete}` : ''
    lines.push(`  FOREIGN KEY (${g.map((f) => qi(f.from)).join(', ')}) REFERENCES ${qi(g[0].table)} (${g.map((f) => qi(f.to)).join(', ')})${del}`)
  }
  return `CREATE TABLE ${qi(table)} (\n${lines.join(',\n')}\n);`
}

/** Returns the full export as a string (schema, then data, then indices — indices last so the bulk load is fast). */
export function exportToPostgres(sqlitePath, { schemaOnly = false, batchSize = 500 } = {}) {
  const conn = new Database(sqlitePath, { readonly: true, fileMustExist: true })
  try {
    const out = []
    out.push('-- Smart Mess: SQLite → PostgreSQL export', `-- Generated ${new Date().toISOString()} from ${sqlitePath}`, '-- Load with: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f postgres-export.sql', 'BEGIN;', '')
    const tables = orderedTables(conn)
    for (const t of tables) out.push(createTableSql(conn, t), '')

    const counts = {}
    for (const t of tables) {
      const cols = conn.prepare(`PRAGMA table_info(${qi(t)})`).all()
      counts[t] = conn.prepare(`SELECT COUNT(*) AS n FROM ${qi(t)}`).get().n
      if (schemaOnly || counts[t] === 0) continue
      const colList = cols.map((c) => qi(c.name)).join(', ')
      const bools = cols.map((c) => BOOLEAN_COLUMNS.has(`${t}.${c.name}`))
      const pk = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => qi(c.name)).join(', ') || 'rowid'
      let batch = []
      const flush = () => {
        if (batch.length) out.push(`INSERT INTO ${qi(t)} (${colList}) VALUES\n${batch.join(',\n')};`)
        batch = []
      }
      for (const row of conn.prepare(`SELECT ${colList} FROM ${qi(t)} ORDER BY ${pk}`).iterate()) {
        batch.push(`  (${cols.map((c, i) => sqlLiteral(row[c.name], bools[i])).join(', ')})`)
        if (batch.length >= batchSize) flush()
      }
      flush()
      out.push('')
    }

    for (const r of conn.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
      out.push(`${r.sql.replace(/\s*--[^\n]*/g, '').replace(/\s+/g, ' ').trim()};`)
    }
    out.push('', 'COMMIT;', '')
    return { sql: out.join('\n'), counts, tables }
  } finally {
    conn.close()
  }
}
