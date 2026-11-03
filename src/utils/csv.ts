/**
 * Minimal RFC-4180-style CSV parser: quoted fields, escaped quotes (""), commas and
 * newlines inside quotes, CRLF/LF, and a UTF-8 BOM (Excel adds one). The other two
 * importers split on "," — fine for their simple columns, but a student's branch like
 * "Computer Science, Data" or a quoted name would silently shift every later column.
 *
 * Returns one entry per non-blank record, with the 1-based line number it started on in
 * the file (so import errors can say "line 14", matching what the person sees in Excel).
 */
export interface CsvRecord {
  line: number
  cells: string[]
}

export function parseCsv(text: string): CsvRecord[] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const records: CsvRecord[] = []
  let cells: string[] = []
  let cell = ''
  let inQuotes = false
  let line = 1
  let recordStartLine = 1
  let sawAny = false

  const endCell = () => {
    cells.push(cell.trim())
    cell = ''
  }
  const endRecord = () => {
    endCell()
    if (sawAny && cells.some((c) => c !== '')) records.push({ line: recordStartLine, cells })
    cells = []
    sawAny = false
  }

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++ } else inQuotes = false
      } else {
        if (ch === '\n') line++
        cell += ch
      }
      continue
    }
    if (ch === '"' && cell === '') { inQuotes = true; sawAny = true; continue }
    if (ch === ',') { sawAny = true; endCell(); continue }
    if (ch === '\r') continue
    if (ch === '\n') { endRecord(); line++; recordStartLine = line; continue }
    sawAny = true
    cell += ch
  }
  endRecord()
  return records
}

/** Header-keyed rows. Header names are matched case-insensitively, ignoring spaces/underscores. */
export function csvToObjects(text: string, aliases: Record<string, string>): { rows: { line: number; data: Record<string, string> }[]; unknownColumns: string[]; hasHeader: boolean } {
  const records = parseCsv(text)
  if (records.length === 0) return { rows: [], unknownColumns: [], hasHeader: false }
  const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '')
  const lookup = new Map(Object.entries(aliases).map(([k, v]) => [norm(k), v]))
  const first = records[0].cells.map(norm)
  const hasHeader = first.some((c) => lookup.has(c))
  if (!hasHeader) return { rows: [], unknownColumns: [], hasHeader: false }

  const fields = records[0].cells.map((c) => lookup.get(norm(c)))
  const unknownColumns = records[0].cells.filter((_, i) => !fields[i] && records[0].cells[i] !== '')
  const rows = records.slice(1).map(({ line, cells }) => {
    const data: Record<string, string> = {}
    fields.forEach((f, i) => { if (f && cells[i] !== undefined && cells[i] !== '') data[f] = cells[i] })
    return { line, data }
  })
  return { rows, unknownColumns, hasHeader }
}
