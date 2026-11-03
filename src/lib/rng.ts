// Deterministic PRNG so mock data is stable across reloads/builds.
export function mulberry32(seed: number) {
  let a = seed
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rng = mulberry32(1337)

export function rnd(): number {
  return rng()
}

export function randInt(min: number, max: number): number {
  return Math.floor(rnd() * (max - min + 1)) + min
}

export function randFloat(min: number, max: number, decimals = 1): number {
  const v = rnd() * (max - min) + min
  const p = Math.pow(10, decimals)
  return Math.round(v * p) / p
}

export function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rnd() * arr.length)]
}

export function pickMany<T>(arr: T[], n: number): T[] {
  const copy = [...arr]
  const out: T[] = []
  for (let i = 0; i < n && copy.length; i++) {
    const idx = Math.floor(rnd() * copy.length)
    out.push(copy[idx])
    copy.splice(idx, 1)
  }
  return out
}

export function uid(prefix: string, n: number | string): string {
  return `${prefix}-${n}`
}
