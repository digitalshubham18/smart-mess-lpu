export function SustainabilityScore({ score, badge }: { score: number; badge: string }) {
  const circumference = 2 * Math.PI * 54
  const offset = circumference - (score / 100) * circumference
  const color = score >= 80 ? '#1f8a5f' : score >= 60 ? '#d97d0a' : '#c0392b'
  return (
    <div className="flex items-center gap-5">
      <svg width="120" height="120" viewBox="0 0 120 120" className="shrink-0">
        <circle cx="60" cy="60" r="54" fill="none" stroke="currentColor" className="text-surface-dim dark:text-ink-800" strokeWidth="10" />
        <circle
          cx="60" cy="60" r="54" fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset} transform="rotate(-90 60 60)"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
        <text x="60" y="56" textAnchor="middle" fontSize="26" fontWeight="700" fill="currentColor" className="text-slate-800 dark:text-slate-100" fontFamily="Manrope, sans-serif">
          {score}
        </text>
        <text x="60" y="74" textAnchor="middle" fontSize="10" fill="currentColor" className="text-slate-400">
          / 100
        </text>
      </svg>
      <div>
        <div className="text-xs text-slate-400">Sustainability Score</div>
        <div className="font-display font-bold text-lg text-slate-800 dark:text-slate-100 mt-0.5">{badge}</div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-[220px]">
          Blends waste reduction, forecast accuracy, food utilization and student participation.
        </p>
      </div>
    </div>
  )
}
