/** Lowercases, trims, and collapses whitespace/punctuation for a forgiving comparison. */
function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ')
}

/** Classic edit-distance (insertions/deletions/substitutions) between two strings. */
function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp: number[] = Array(n + 1)
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

/** 0 (nothing alike) to 1 (identical) similarity ratio based on edit distance. */
function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  return 1 - levenshtein(a, b) / maxLen
}

/**
 * Forgiving name comparison for identity checks: exact match after normalization, one
 * name being fully contained in the other (nicknames, middle names, initials), or an
 * overall edit-distance similarity above the threshold (typos, transliteration, spacing).
 * Not cryptographic — this is a UX safety net, paired with the UI pre-filling the real
 * record's name so a mismatch should be rare in the first place.
 */
export function namesLikelyMatch(a: string, b: string, threshold = 0.72): boolean {
  const na = normalize(a)
  const nb = normalize(b)
  if (!na || !nb) return false
  if (na === nb) return true
  if (na.includes(nb) || nb.includes(na)) return true
  return similarity(na, nb) >= threshold
}
