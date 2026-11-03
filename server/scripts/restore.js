#!/usr/bin/env node
import 'dotenv/config'
import path from 'node:path'
import { restoreDatabase, listBackups, resolveDbPath, resolveBackupDir } from '../src/backup.js'

// Usage: node scripts/restore.js <backup-file | --latest> --yes [--db <path>] [--from <backup-dir>]
// STOP THE SERVER FIRST. Refuses to run without --yes.

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 ? process.argv[i + 1] : undefined
}
const flag = (name) => process.argv.includes(`--${name}`)

const dbPath = arg('db') ?? resolveDbPath()
const dir = arg('from') ?? resolveBackupDir()
const positional = process.argv.slice(2).find((a, i, all) => !a.startsWith('--') && !['--db', '--from'].includes(all[i - 1]))
const backupPath = flag('latest') ? listBackups(dir)[0] : positional

if (!backupPath) {
  console.error('Usage: node scripts/restore.js <backup-file | --latest> --yes')
  const found = listBackups(dir).slice(0, 5)
  if (found.length) console.error(`\nMost recent backups in ${dir}:\n${found.map((f) => `  ${path.basename(f)}`).join('\n')}`)
  else console.error(`\nNo backups found in ${dir}.`)
  process.exit(1)
}
if (!flag('yes')) {
  console.error(`This will REPLACE the database at ${dbPath} with ${backupPath}.`)
  console.error('Stop the server first. The current database is saved alongside it as *.before-restore-<time> so this can be undone.')
  console.error('Re-run with --yes to proceed.')
  process.exit(1)
}

try {
  const r = await restoreDatabase({ backupPath, dbPath })
  console.log(`[restore] OK  ${r.dbPath} ← ${r.restoredFrom}`)
  if (r.safetyCopy) console.log(`[restore]     previous database kept at ${r.safetyCopy}`)
  console.log(`[restore]     ${r.counts.students} students · ${r.counts.staff} staff · ${r.counts.attendance} check-ins. Start the server again.`)
} catch (e) {
  console.error(`[restore] FAILED: ${e.message}`)
  process.exit(1)
}
