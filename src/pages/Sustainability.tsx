import { useMemo } from 'react'
import { Award, Droplets, Leaf, Sparkles } from 'lucide-react'
import { getSustainability } from '@/services/analyticsService'
import { useMessStore } from '@/store/useMessStore'
import { STUDENTS } from '@/data/mockStudents'
import { HOSTELS } from '@/data/mockHostels'
import { SustainabilityScore } from '@/components/ui/SustainabilityScore'
import { DashboardCard, StatCard } from '@/components/ui/DashboardCard'
import { formatKg, formatLitres, formatNumber } from '@/utils/formatters'
import { DemoBanner } from '@/components/ui/DemoBanner'

const ALL_BADGES = ['Waste Warrior', 'Smart Planner', 'Eco Mess', 'Efficient Kitchen']

export default function Sustainability() {
  const messId = useMessStore((s) => s.currentMessId)
  const sustainability = useMemo(() => getSustainability(messId), [messId])

  const hostelLeaderboard = useMemo(() => {
    return HOSTELS.map((h) => {
      const hostelStudents = STUDENTS.filter((s) => s.hostelId === h.id)
      const avgPoints = hostelStudents.length ? hostelStudents.reduce((s, st) => s + st.points, 0) / hostelStudents.length : 0
      return { hostel: h.name, avgPoints: Math.round(avgPoints) }
    }).sort((a, b) => b.avgPoints - a.avgPoints)
  }, [])

  const studentLeaderboard = useMemo(() => [...STUDENTS].sort((a, b) => b.points - a.points).slice(0, 8), [])

  return (
    <div className="space-y-6">
      <DemoBanner what={'The sustainability scores and impact numbers are sample data.'} />
      <div>
        <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100">Sustainability Dashboard</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Waste reduction, forecast accuracy, and environmental impact — all in one place.</p>
      </div>

      <DashboardCard>
        <SustainabilityScore score={sustainability.score} badge={sustainability.badge} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
          <StatCard label="Waste Reduction" value={`${sustainability.wasteReduction}/100`} accent="eco" />
          <StatCard label="Forecast Accuracy" value={`${sustainability.forecastAccuracy}/100`} accent="tech" />
          <StatCard label="Food Utilization" value={`${sustainability.foodUtilization}/100`} accent="neutral" />
          <StatCard label="Participation" value={`${sustainability.studentParticipation}/100`} accent="amber" />
        </div>
      </DashboardCard>

      <div className="grid md:grid-cols-3 gap-4">
        <StatCard label="Food Saved" value={formatKg(sustainability.foodSavedKg)} icon={Leaf} accent="eco" />
        <StatCard label="CO₂ Impact Avoided (est.)" value={formatKg(sustainability.co2SavedKg)} icon={Sparkles} accent="tech" />
        <StatCard label="Water Saved (est.)" value={formatLitres(sustainability.waterSavedLitres)} icon={Droplets} accent="tech" />
      </div>

      <div>
        <h2 className="font-display font-semibold text-slate-800 dark:text-slate-100 mb-3">Badges</h2>
        <div className="flex flex-wrap gap-2">
          {ALL_BADGES.map((b) => (
            <span key={b} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${b === sustainability.badge ? 'bg-tech-500 text-white' : 'bg-surface-dim dark:bg-ink-800 text-slate-400'}`}>
              <Award size={12} /> {b}
            </span>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        <DashboardCard title="Hostel Leaderboard — Lowest Waste / Best Participation">
          <ol className="space-y-2 text-sm">
            {hostelLeaderboard.map((h, i) => (
              <li key={h.hostel} className="flex justify-between">
                <span>{i + 1}. {h.hostel}</span>
                <span className="font-semibold text-tech-600 dark:text-tech-500">{h.avgPoints} pts avg</span>
              </li>
            ))}
          </ol>
        </DashboardCard>
        <DashboardCard title="Student Leaderboard">
          <ol className="space-y-2 text-sm">
            {studentLeaderboard.map((s, i) => (
              <li key={s.id} className="flex justify-between items-center">
                <span>{i + 1}. {s.name}</span>
                <div className="flex items-center gap-2">
                  {s.badges.map((b) => <span key={b} className="text-[10px] px-1.5 py-0.5 rounded-full bg-eco-50 text-eco-700 dark:bg-eco-500/10 dark:text-eco-500">{b}</span>)}
                  <span className="font-semibold">{formatNumber(s.points)} pts</span>
                </div>
              </li>
            ))}
          </ol>
        </DashboardCard>
      </div>
    </div>
  )
}
