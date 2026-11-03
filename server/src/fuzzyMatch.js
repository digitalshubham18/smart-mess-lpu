function normalize(s) {
  return s.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ')
}

function levenshtein(a, b) {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp = Array(n + 1)
  for (let j = 0; j <= n; j++) dp[j] = j
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1])
      prev = tmp
    }
  }
  return dp[n]
}

const tokens = (s) => normalize(s).split(' ').filter(Boolean)

/**
 * Does the name someone typed match the enrolled name? Used to stop a stranger who knows a UID
 * from claiming that student's account, so it has to be STRICT:
 *
 *  - every word must match — same number of words, each pair equal, any order ("Mehta Riya" is fine);
 *  - the only forgiveness is a single typo in a word of 6+ letters ("Ananyya" for "Ananya"), because
 *    a one-letter slip in a short name changes it into a different name.
 *
 * What it used to do (accept any substring, or ≥72% similarity) accepted a bare first name for every
 * student, an "R•••• M•••••" initials mask for ~8%, and another student's name for ~3%.
 */
export function namesLikelyMatch(enrolled, typed) {
  const want = tokens(enrolled)
  const got = tokens(typed)
  if (want.length === 0 || want.length !== got.length) return false
  const remaining = [...got]
  for (const w of want) {
    const i = remaining.findIndex((g) => g === w || (w.length >= 6 && g.length >= 6 && levenshtein(w, g) <= 1))
    if (i === -1) return false
    remaining.splice(i, 1)
  }
  return true
}
