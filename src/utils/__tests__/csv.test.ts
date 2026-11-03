import { describe, it, expect } from 'vitest'
import { parseCsv, csvToObjects } from '../csv'

describe('parseCsv', () => {
  it('parses plain rows and skips blank lines', () => {
    expect(parseCsv('a,b\n\n1,2\n').map((r) => r.cells)).toEqual([['a', 'b'], ['1', '2']])
  })
  it('keeps commas inside quoted fields in one cell', () => {
    expect(parseCsv('name,branch\n"Rao, A",CS').map((r) => r.cells)[1]).toEqual(['Rao, A', 'CS'])
  })
  it('handles escaped quotes, CRLF and a BOM', () => {
    const out = parseCsv('\uFEFFname,note\r\n"A ""B"" C",x\r\n')
    expect(out.map((r) => r.cells)).toEqual([['name', 'note'], ['A "B" C', 'x']])
  })
  it('reports the line a record starts on, even after a multi-line quoted cell', () => {
    const out = parseCsv('a,b\n"x\ny",1\nz,2')
    expect(out.map((r) => r.line)).toEqual([1, 2, 4])
  })
})

describe('csvToObjects', () => {
  const aliases = { name: 'name', email: 'email', 'hostel id': 'hostelId', hostel: 'hostelId' }
  it('maps headers case-insensitively with aliases, and reports unknown columns', () => {
    const r = csvToObjects('Name,E-mail?,Hostel ID,Shoe Size\nA B,a@x.com,BH1,9', { ...aliases, 'e-mail?': 'email' })
    expect(r.hasHeader).toBe(true)
    expect(r.unknownColumns).toEqual(['Shoe Size'])
    expect(r.rows).toEqual([{ line: 2, data: { name: 'A B', email: 'a@x.com', hostelId: 'BH1' } }])
  })
  it('refuses a file with no recognisable header rather than guessing column order', () => {
    expect(csvToObjects('A B,a@x.com\nC D,c@x.com', aliases).hasHeader).toBe(false)
  })
})
