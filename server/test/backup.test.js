import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { startTestServer } from '../test-support/harness.js'
import { backupDatabase, restoreDatabase, listBackups, verifyDatabaseFile } from '../src/backup.js'

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let t
let outDir
before(async () => {
  t = await startTestServer() // the real app + a real, seeded, WAL-mode database — still open and serving
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartmess-backups-'))
})
after(async () => {
  await t.close()
  fs.rmSync(outDir, { recursive: true, force: true })
})

const dbFile = () => process.env.DB_PATH
const studentRow = (file, id) => {
  const c = new Database(file, { readonly: true })
  try { return c.prepare('SELECT name, room FROM students WHERE id = ?').get(id) } finally { c.close() }
}

test('backup of a LIVE database includes a write that was just committed (it may still be only in the WAL)', async () => {
  assert.equal(t.db.pragma('journal_mode', { simple: true }), 'wal')
  t.db.prepare("UPDATE students SET room = 'BACKUP-PROBE' WHERE id = '21000001'").run()

  const result = await backupDatabase({ dbPath: dbFile(), outDir })
  assert.equal(result.integrity, 'ok')
  assert.equal(result.counts.students, 2000)
  assert.equal(result.counts.staff, 101)
  assert.equal(studentRow(result.file, '21000001').room, 'BACKUP-PROBE')
  assert.equal(fs.readdirSync(outDir).filter((f) => f.endsWith('.partial')).length, 0, 'no half-written files left behind')
})

test('a backup is a fully usable database: it opens, passes integrity_check, and has the indices', () => {
  const [file] = listBackups(outDir)
  const v = verifyDatabaseFile(file)
  assert.equal(v.integrity, 'ok')
  const c = new Database(file, { readonly: true })
  const idx = c.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'").all().map((r) => r.name)
  c.close()
  assert.ok(idx.includes('idx_students_room') && idx.includes('idx_attendance_mess_meal'))
})

test('retention: only the newest N backups are kept, and the newest is never the one pruned', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartmess-retention-'))
  try {
    for (let i = 0; i < 4; i++) await backupDatabase({ dbPath: dbFile(), outDir: dir, keep: 2, now: new Date(Date.UTC(2026, 0, 1 + i, 3, 0, 0)) })
    const left = listBackups(dir).map((f) => path.basename(f))
    assert.equal(left.length, 2)
    assert.match(left[0], /^smartmess-20260104-/)
    assert.match(left[1], /^smartmess-20260103-/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('retention never touches files it didn\'t create', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartmess-foreign-'))
  try {
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'keep me')
    fs.writeFileSync(path.join(dir, 'my-own-copy.sqlite'), 'keep me too')
    await backupDatabase({ dbPath: dbFile(), outDir: dir, keep: 1, now: new Date(Date.UTC(2026, 0, 1)) })
    await backupDatabase({ dbPath: dbFile(), outDir: dir, keep: 1, now: new Date(Date.UTC(2026, 0, 2)) })
    assert.ok(fs.existsSync(path.join(dir, 'notes.txt')))
    assert.ok(fs.existsSync(path.join(dir, 'my-own-copy.sqlite')))
    assert.equal(listBackups(dir).length, 1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('backing up a path that doesn\'t exist fails loudly instead of creating an empty "backup"', async () => {
  await assert.rejects(backupDatabase({ dbPath: path.join(outDir, 'nope.sqlite'), outDir }), /nothing to back up/i)
})

test('restore: rolls the database back to the backup, keeps the pre-restore state as a safety copy, and discards the stale WAL', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'smartmess-restore-'))
  try {
    const target = path.join(work, 'live.sqlite')
    fs.copyFileSync(listBackups(outDir)[0], target)
    const live = new Database(target)
    live.pragma('journal_mode = WAL')
    live.prepare("UPDATE students SET room = 'BEFORE-DISASTER' WHERE id = '21000002'").run()
    const good = await backupDatabase({ dbPath: target, outDir: work, now: new Date(Date.UTC(2026, 5, 1)) })
    live.prepare("UPDATE students SET room = 'AFTER-DISASTER' WHERE id = '21000002'").run() // the bad thing we want to undo
    live.prepare("DELETE FROM students WHERE id = '21000003'").run()
    assert.ok(fs.existsSync(`${target}-wal`), 'precondition: there is a live WAL next to the database')
    live.close() // (the server is stopped before a real restore)
    // Re-create a stale WAL, as a crashed/killed server would leave behind:
    const crashed = new Database(target)
    crashed.pragma('journal_mode = WAL')
    crashed.prepare("UPDATE students SET room = 'STALE-WAL' WHERE id = '21000004'").run()
    assert.ok(fs.existsSync(`${target}-wal`), 'precondition: a stale WAL from the old database is sitting next to it')

    const r = await restoreDatabase({ backupPath: good.file, dbPath: target, now: new Date(Date.UTC(2026, 5, 2)) })
    try { crashed.close() } catch { /* handle belongs to the pre-restore file */ }

    assert.equal(studentRow(target, '21000002').room, 'BEFORE-DISASTER')
    assert.ok(studentRow(target, '21000003'), 'the deleted student is back')
    assert.notEqual(studentRow(target, '21000004').room, 'STALE-WAL', 'stale WAL history must not leak into the restored database')
    assert.equal(verifyDatabaseFile(target).integrity, 'ok')
    assert.ok(r.safetyCopy && fs.existsSync(r.safetyCopy))
    assert.equal(studentRow(r.safetyCopy, '21000002').room, 'AFTER-DISASTER', 'safety copy preserves the pre-restore state')
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
})

test('restore refuses a corrupt or non-database file and leaves the live database untouched', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'smartmess-badrestore-'))
  try {
    const target = path.join(work, 'live.sqlite')
    fs.copyFileSync(listBackups(outDir)[0], target)
    const before = fs.readFileSync(target)

    const garbage = path.join(work, 'garbage.sqlite')
    fs.writeFileSync(garbage, 'this is not a database'.repeat(500))
    await assert.rejects(restoreDatabase({ backupPath: garbage, dbPath: target }), /not a readable SQLite|integrity|database/i)

    const wrongSchema = path.join(work, 'other.sqlite')
    const other = new Database(wrongSchema)
    other.exec('CREATE TABLE unrelated (x INTEGER)')
    other.close()
    await assert.rejects(restoreDatabase({ backupPath: wrongSchema, dbPath: target }), /doesn't look like a Smart Mess database/)

    await assert.rejects(restoreDatabase({ backupPath: path.join(work, 'missing.sqlite'), dbPath: target }), /not found/)
    assert.deepEqual(fs.readFileSync(target), before, 'live database bytes unchanged after every refused restore')
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
})

test('CLI: backup runs end to end; restore refuses without --yes and works with it', () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'smartmess-cli-'))
  try {
    const target = path.join(work, 'live.sqlite')
    fs.copyFileSync(listBackups(outDir)[0], target)
    const run = (script, ...args) => spawnSync('node', [path.join(SERVER_DIR, 'scripts', script), ...args], { cwd: SERVER_DIR, encoding: 'utf8' })

    const b = run('backup.js', '--db', target, '--out', work, '--keep', '3')
    assert.equal(b.status, 0, b.stderr)
    assert.match(b.stdout, /\[backup\] OK/)
    assert.match(b.stdout, /2000 students/)

    const noYes = run('restore.js', '--latest', '--db', target, '--from', work)
    assert.equal(noYes.status, 1)
    assert.match(noYes.stderr, /--yes/)

    const yes = run('restore.js', '--latest', '--yes', '--db', target, '--from', work)
    assert.equal(yes.status, 0, yes.stderr)
    assert.match(yes.stdout, /\[restore\] OK/)

    const missing = run('backup.js', '--db', path.join(work, 'nope.sqlite'), '--out', work)
    assert.equal(missing.status, 1)
    assert.match(missing.stderr, /FAILED/)
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
})
