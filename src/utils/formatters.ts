export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount)
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-IN').format(Math.round(n))
}

/** One decimal when it matters: 9.5 kg must not read as "10 kg". */
export function formatKg(n: number): string {
  return Number.isInteger(n) || Math.abs(n) >= 1000 ? `${formatNumber(n)} kg` : `${Math.round(n * 10) / 10} kg`
}

export function formatLitres(n: number): string {
  return `${formatNumber(n)} L`
}

export function formatPct(n: number, decimals = 1): string {
  return `${n.toFixed(decimals)}%`
}

export function formatPctChange(current: number, previous: number): { label: string; positive: boolean } {
  if (!previous) return { label: '—', positive: true }
  const change = ((current - previous) / previous) * 100
  const positive = change >= 0
  return { label: `${positive ? '+' : ''}${change.toFixed(1)}%`, positive }
}

export function unitLabel(unit: 'kg' | 'litres' | 'pieces'): string {
  return { kg: 'kg', litres: 'L', pieces: 'pcs' }[unit]
}

export function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}
