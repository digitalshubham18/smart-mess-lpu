#!/usr/bin/env node
import 'dotenv/config'
import fs from 'node:fs'
import { exportToPostgres } from '../src/pgExport.js'
import { resolveDbPath } from '../src/backup.js'

// Usage: node scripts/export-postgres.js [--db <sqlite>] [--out postgres-export.sql] [--schema-only]
// Reads the SQLite file read-only (safe while the server runs; for a consistent snapshot, export a BACKUP of it).
function arg(name) { const i = process.argv.indexOf(`--${name}`); return i !== -1 ? process.argv[i + 1] : undefined }

try {
  const db = arg('db') ?? resolveDbPath()
  const out = arg('out') ?? 'postgres-export.sql'
  const { sql, counts } = exportToPostgres(db, { schemaOnly: process.argv.includes('--schema-only') })
  fs.writeFileSync(out, sql)
  console.log(`[export] wrote ${out} (${(Buffer.byteLength(sql) / 1024).toFixed(0)} KB)`)
  console.log(`[export] ${Object.entries(counts).map(([t, n]) => `${t}: ${n}`).join(' · ')}`)
  console.log('[export] load it with: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ' + out)
} catch (e) {
  console.error(`[export] FAILED: ${e.message}`)
  process.exit(1)
}
