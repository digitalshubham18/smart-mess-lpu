#!/usr/bin/env node
import 'dotenv/config'
import { backupDatabase, resolveDbPath, resolveBackupDir } from '../src/backup.js'

// Usage: node scripts/backup.js [--out <dir>] [--keep <n>] [--db <path>]
// Env:   DB_PATH, BACKUP_DIR, BACKUP_KEEP (flags win over env; defaults: server/data/…, server/backups, 14)
// Safe to run while the server is running.

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 ? process.argv[i + 1] : undefined
}

const keep = Number(arg('keep') ?? process.env.BACKUP_KEEP ?? 14)
try {
  const result = await backupDatabase({
    dbPath: arg('db') ?? resolveDbPath(),
    outDir: arg('out') ?? resolveBackupDir(),
    keep,
  })
  const c = result.counts
  console.log(`[backup] OK  ${result.file}  (${(result.bytes / 1024).toFixed(0)} KB, integrity ${result.integrity})`)
  console.log(`[backup]     ${c.students} students · ${c.staff} staff · ${c.attendance} check-ins · ${c.audit_log} audit entries`)
  if (result.pruned.length) console.log(`[backup]     pruned ${result.pruned.length} old backup${result.pruned.length === 1 ? '' : 's'} (keeping ${keep})`)
} catch (e) {
  console.error(`[backup] FAILED: ${e.message}`)
  process.exit(1)
}
