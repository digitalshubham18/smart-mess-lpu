// Loads the university's student records (UID → name, email, phone, branch, year) into the directory that the
// "Add student" form and the student sign-up page look UIDs up in.
//
//   node scripts/import-directory.js students.csv
//
// CSV with a header row; columns (any order, case-insensitive): uid, name, email, phone, branch, year.
// Safe to re-run: a UID that is already there is updated, nothing else is touched. It never adds anyone to a mess —
// that is still the warden's decision — and it never changes who is already on a roster.
import fs from 'node:fs'
import { db } from '../src/db.js'

const file = process.argv[2]
if (!file) {
  console.error('Usage: node scripts/import-directory.js <students.csv>')
  process.exit(1)
}

/** Small RFC-4180 reader: quoted fields, doubled quotes, commas and newlines inside quotes. */
function parseCsv(text) {
  const rows = []
  let row = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some((v) => v.trim() !== '')) rows.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.some((v) => v.trim() !== '')) rows.push(row)
  return rows
}

const [header, ...body] = parseCsv(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
if (!header) { console.error('The file is empty.'); process.exit(1) }
const col = Object.fromEntries(header.map((h, i) => [h.trim().toLowerCase(), i]))
for (const need of ['uid', 'name', 'email']) {
  if (!(need in col)) { console.error(`Missing required column "${need}". Found: ${header.join(', ')}`); process.exit(1) }
}

const upsert = db.prepare(`
  INSERT INTO university_directory (uid, name, email, phone, branch, year) VALUES (@uid, @name, @email, @phone, @branch, @year)
  ON CONFLICT(uid) DO UPDATE SET name = excluded.name, email = excluded.email, phone = excluded.phone, branch = excluded.branch, year = excluded.year
`)
const get = (r, k) => (k in col ? (r[col[k]] ?? '').trim() : '')

let imported = 0
const rejected = []
db.transaction(() => {
  body.forEach((r, i) => {
    const line = i + 2
    const uid = get(r, 'uid'), name = get(r, 'name'), email = get(r, 'email')
    const year = get(r, 'year') === '' ? 1 : Number(get(r, 'year'))
    if (!/^\d{8}$/.test(uid)) return rejected.push(`line ${line}: UID "${uid}" is not 8 digits`)
    if (name.length < 2) return rejected.push(`line ${line}: name is missing`)
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return rejected.push(`line ${line}: "${email}" is not an email address`)
    if (!Number.isInteger(year) || year < 1 || year > 6) return rejected.push(`line ${line}: year must be 1-6`)
    upsert.run({ uid, name, email, phone: get(r, 'phone'), branch: get(r, 'branch') || 'Not specified', year })
    imported++
  })
})()

console.log(`Imported ${imported} record${imported === 1 ? '' : 's'} into the university directory.`)
if (rejected.length) {
  console.log(`${rejected.length} row${rejected.length === 1 ? '' : 's'} skipped:`)
  rejected.slice(0, 50).forEach((m) => console.log(`  ${m}`))
  if (rejected.length > 50) console.log(`  …and ${rejected.length - 50} more.`)
}
process.exit(rejected.length && !imported ? 1 : 0)
