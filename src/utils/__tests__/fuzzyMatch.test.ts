import { describe, it, expect } from 'vitest'
import { namesLikelyMatch } from '../fuzzyMatch'

describe('namesLikelyMatch', () => {
  it('accepts an exact match regardless of case/spacing', () => {
    expect(namesLikelyMatch('Ananya Iyer', '  ananya   iyer ')).toBe(true)
  })

  it('accepts punctuation differences', () => {
    expect(namesLikelyMatch("O'Brien Singh", 'obrien singh')).toBe(true)
  })

  it('accepts one name containing the other (middle name / nickname)', () => {
    expect(namesLikelyMatch('Mohammed Rehan Khan', 'Rehan Khan')).toBe(true)
  })

  it('accepts a small typo', () => {
    expect(namesLikelyMatch('Siddharth Rao', 'Sidharth Rao')).toBe(true)
  })

  it('rejects an unrelated name', () => {
    expect(namesLikelyMatch('Ananya Iyer', 'Rohan Gupta')).toBe(false)
  })

  it('rejects empty input', () => {
    expect(namesLikelyMatch('Ananya Iyer', '')).toBe(false)
  })
})
