import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Backup / restore for the SQLite database. No side effects on import — in particular it
 * does NOT import db.js (which opens the live database and seeds it if empty).
 *
 * Why not just `cp smartmess.sqlite`? The database runs in WAL mode, so recent committed
 * writes can live in smartmess.sqlite-wal rather than the main file. A plain file copy
 * taken while the server is running can miss them, or capture a torn state. This uses
 * SQLite's online backup API instead (better-sqlite3's db.backup()), which produces a
 * consistent snapshot while the server keeps serving requests.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Mirrors db.js: DB_PATH env var, else server/data/smartmess.sqlite. */
export function resolveDbPath() {
  return process.env.DB_PATH || path.resolve(__dirname, '../data/smartmess.sqlite')
}

export function resolveBackupDir() {
  return process.env.BACKUP_DIR || path.resolve(__dirname, '../backups')
}

const BACKUP_NAME = /^smartmess-\d{8}-\d{6}-\d{3}\.sqlite$/
const REQUIRED_TABLES = ['hostels', 'messes', 'students', 'staff', 'attendance', 'audit_log']

function stamp(date) {
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}-${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}-${p(date.getUTCMilliseconds(), 3)}`
}

/** Opens a file read-only and checks it's a healthy SQLite database with this app's schema. Throws with a clear reason if not. */
export function verifyDatabaseFile(file) {
  let conn
  try {
    conn = new Database(file, { readonly: true, fileMustExist: true })
  } catch (e) {
    throw new Error(`${file} is not a readable SQLite database (${e.message})`)
  }
  try {
    const integrity = conn.pragma('integrity_check', { simple: true })
    if (integrity !== 'ok') throw new Error(`integrity_check failed for ${file}: ${integrity}`)
    const fkViolations = conn.pragma('foreign_key_check')
    if (fkViolations.length > 0) throw new Error(`foreign_key_check found ${fkViolations.length} violation(s) in ${file}`)
    const have = new Set(conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name))
    const missing = REQUIRED_TABLES.filter((t) => !have.has(t))
    if (missing.length > 0) throw new Error(`${file} doesn't look like a Smart Mess database — missing table(s): ${missing.join(', ')}`)
    const counts = {}
    for (const t of REQUIRED_TABLES) counts[t] = conn.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n
    return { integrity, counts }
  } finally {
    conn.close()
  }
}

/** Newest-first list of this tool's own backup files in a directory. */
export function listBackups(outDir) {
  if (!fs.existsSync(outDir)) return []
  return fs.readdirSync(outDir).filter((f) => BACKUP_NAME.test(f)).sort().reverse().map((f) => path.join(outDir, f))
}

/**
 * Writes a verified, consistent snapshot to `<outDir>/smartmess-<UTC timestamp>.sqlite`,
 * then prunes the oldest so at most `keep` remain.
 *
 * The snapshot is written to a `.partial` file, verified, and only then renamed into
 * place — so a crash mid-backup can never leave something that looks like a good backup
 * but isn't, and pruning never runs unless the new backup is known-good.
 */
export async function backupDatabase({ dbPath = resolveDbPath(), outDir = resolveBackupDir(), keep = 14, now = new Date() } = {}) {
  if (!fs.existsSync(dbPath)) throw new Error(`No database at ${dbPath} — nothing to back up.`)
  if (!Number.isInteger(keep) || keep < 1) throw new Error('keep must be a whole number of at least 1.')
  fs.mkdirSync(outDir, { recursive: true })

  const dest = path.join(outDir, `smartmess-${stamp(now)}.sqlite`)
  const partial = `${dest}.partial`
  fs.rmSync(partial, { force: true })

  const source = new Database(dbPath, { fileMustExist: true })
  try {
    await source.backup(partial)
  } catch (e) {
    fs.rmSync(partial, { force: true })
    throw new Error(`Backup failed: ${e.message}`)
  } finally {
    source.close()
  }

  let verified
  try {
    verified = verifyDatabaseFile(partial)
  } catch (e) {
    fs.rmSync(partial, { force: true })
    throw new Error(`Backup was written but failed verification, so it was discarded: ${e.message}`)
  }
  fs.renameSync(partial, dest)
  try { fs.chmodSync(dest, 0o600) } catch { /* best-effort: the file holds password hashes and PII — owner-only where the OS supports it */ }

  const pruned = listBackups(outDir).slice(keep)
  for (const old of pruned) fs.rmSync(old, { force: true })

  return { file: dest, bytes: fs.statSync(dest).size, integrity: verified.integrity, counts: verified.counts, pruned }
}

/**
 * Replaces the live database with a backup. STOP THE SERVER FIRST — this swaps the file
 * out from under it.
 *
 *  1. The backup is verified before anything is touched.
 *  2. The current database (if any) is itself snapshotted to `<db>.before-restore-<ts>`,
 *     so a mistaken restore is always reversible.
 *  3. Stale -wal/-shm files are deleted. They belong to the OLD database; leaving them
 *     next to the restored file would make SQLite replay the wrong history into it.
 *  4. The restored file is staged beside the target and renamed into place atomically.
 */
export async function restoreDatabase({ backupPath, dbPath = resolveDbPath(), now = new Date() }) {
  if (!backupPath || !fs.existsSync(backupPath)) throw new Error(`Backup file not found: ${backupPath}`)
  const verified = verifyDatabaseFile(backupPath)

  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  let safetyCopy = null
  if (fs.existsSync(dbPath)) {
    safetyCopy = `${dbPath}.before-restore-${stamp(now)}`
    const current = new Database(dbPath, { fileMustExist: true })
    try { await current.backup(safetyCopy) } finally { current.close() }
  }

  const staged = `${dbPath}.restoring`
  fs.copyFileSync(backupPath, staged)
  for (const ext of ['-wal', '-shm']) fs.rmSync(dbPath + ext, { force: true })
  fs.renameSync(staged, dbPath)

  return { restoredFrom: backupPath, dbPath, safetyCopy, counts: verified.counts }
}

/** Hours since the newest backup in the backup directory was written, or null if there is none. Used by /api/health/ready. */
export function newestBackupAgeHours(outDir = resolveBackupDir(), now = Date.now()) {
  const newest = listBackups(outDir)[0]
  if (!newest) return null
  return Math.max(0, (now - fs.statSync(newest).mtimeMs) / 3_600_000)
}
