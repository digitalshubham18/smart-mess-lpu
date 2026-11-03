// Loads official student photos from a folder of image files named by UID — 21000001.jpg, 21000002.png …
//
//   node scripts/import-photos.js ./photos
//
// For each file whose UID is on a roster, the photo is set on that student; for each UID in the university directory
// it is stored there too, so a student added later by UID arrives with their photo. Files with no matching UID are
// listed and skipped. Only JPEG, PNG and WebP (checked by the file's actual bytes, not its extension), up to 1 MB each.
// Safe to re-run: it replaces existing photos with the file's.
import fs from 'node:fs'
import path from 'node:path'
import { db } from '../src/db.js'

const dir = process.argv[2]
if (!dir || !fs.existsSync(dir)) {
  console.error('Usage: node scripts/import-photos.js <folder of UID-named images>')
  process.exit(1)
}

function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp'
  return null
}

const setStudent = db.prepare('UPDATE students SET photo_data = ? WHERE id = ?')
const setDirectory = db.prepare('UPDATE university_directory SET photo_data = ? WHERE uid = ?')
let students = 0, directory = 0
const skipped = []
for (const file of fs.readdirSync(dir)) {
  const uid = path.parse(file).name.trim()
  if (!/^\d{8}$/.test(uid)) { skipped.push(`${file}: file name is not an 8-digit UID`); continue }
  const buf = fs.readFileSync(path.join(dir, file))
  const mime = sniff(buf)
  if (!mime) { skipped.push(`${file}: not a JPEG, PNG or WebP image`); continue }
  if (buf.length > 1_000_000) { skipped.push(`${file}: larger than 1 MB`); continue }
  const dataUrl = `data:${mime};base64,${buf.toString('base64')}`
  const a = setStudent.run(dataUrl, uid).changes
  const b = setDirectory.run(dataUrl, uid).changes
  if (!a && !b) { skipped.push(`${file}: UID is on no roster and not in the university directory`); continue }
  students += a
  directory += b
}
console.log(`[photos] set ${students} student photo(s) and ${directory} university-record photo(s).`)
if (skipped.length) console.log(`[photos] skipped ${skipped.length}:\n  ${skipped.join('\n  ')}`)
