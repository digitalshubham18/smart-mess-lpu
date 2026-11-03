import { useMemo } from 'react'
import { PieChart, Pie, Cell, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend } from 'recharts'
import * as financeService from '@/services/financeService'
import { useMessStore } from '@/store/useMessStore'
import { ChartCard, StatCard, DashboardCard } from '@/components/ui/DashboardCard'
import { AlertCard } from '@/components/ui/AlertCard'
import { ProgressBar } from '@/components/ui/StatusBadge'
import { formatINR } from '@/utils/formatters'
import { TODAY_ISO } from '@/utils/dateUtils'
import { IndianRupee, TrendingDown, PiggyBank } from 'lucide-react'
import { DemoBanner } from '@/components/ui/DemoBanner'

const COLORS: Record<string, string> = { ingredients: '#3554D1', labor: '#1F8A5F', utilities: '#D97D0A', transport: '#8B93A2', waste: '#C0392B' }

export default function Finance() {
  const messId = useMessStore((s) => s.currentMessId)
  const byCategory = useMemo(() => financeService.expensesByCategory(messId, 30), [messId])
  const costPerMeal = useMemo(() => financeService.costPerMealTrend(messId), [messId])
  const savings = useMemo(() => financeService.savingsCalculator(messId), [messId])
  const budget = useMemo(() => financeService.budgetStatus(messId, TODAY_ISO), [messId])

  const totalExpense = byCategory.reduce((s, c) => s + c.amount, 0)

  return (
    <div className="space-y-6">
      <DemoBanner what={'Costs, budgets and savings are sample figures.'} detail={'the server records no expenses yet.'} />
      <div>
        <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100">Finance Dashboard</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Food cost, waste cost, and monthly savings at a glance.</p>
      </div>

      {budget.cap > 0 && (budget.overBudget || budget.nearBudget) && (
        <AlertCard
          tone={budget.overBudget ? 'danger' : 'warning'}
          title={budget.overBudget ? 'Over monthly budget' : 'Approaching monthly budget'}
          description={`This mess has spent ${formatINR(budget.spent)} of its ${formatINR(budget.cap)} cap this month (${budget.pct}%). ${budget.overBudget ? 'Review discretionary spend or raise the cap in Settings.' : 'Keep an eye on procurement for the rest of the month.'}`}
        />
      )}

      {budget.cap > 0 && (
        <DashboardCard title="Monthly Budget">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-slate-500 dark:text-slate-400">{formatINR(budget.spent)} spent this month</span>
            <span className="font-semibold">{formatINR(budget.cap)} cap</span>
          </div>
          <ProgressBar value={budget.spent} max={budget.cap} tone={budget.overBudget ? 'danger' : budget.nearBudget ? 'warning' : 'info'} />
          <p className="text-xs text-slate-400 mt-2">{budget.pct}% used · adjust the cap from Settings.</p>
        </DashboardCard>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Expenditure (30d)" value={formatINR(totalExpense)} icon={IndianRupee} accent="neutral" />
        <StatCard label="Previous Month Waste Cost" value={formatINR(savings.previousMonthWaste)} icon={TrendingDown} accent="rose" />
        <StatCard label="Current Waste Cost" value={formatINR(savings.currentMonthWaste)} icon={TrendingDown} accent="amber" />
        <StatCard label="Monthly Savings" value={formatINR(savings.monthlySavings)} icon={PiggyBank} accent="eco" />
      </div>

      <DashboardCard title="Savings Calculator" className="bg-eco-50 dark:bg-eco-500/5">
        <div className="grid md:grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-xs text-slate-500">Before optimization</div>
            <div className="text-xl font-bold font-display text-slate-700 dark:text-slate-200">{formatINR(savings.previousMonthWaste)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">After optimization</div>
            <div className="text-xl font-bold font-display text-slate-700 dark:text-slate-200">{formatINR(savings.currentMonthWaste)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Annual projected savings</div>
            <div className="text-xl font-bold font-display text-eco-600">{formatINR(savings.annualProjectedSavings)}</div>
          </div>
        </div>
      </DashboardCard>

      <div className="grid lg:grid-cols-2 gap-5">
        <ChartCard title="Expense Breakdown" subtitle="Last 30 days">
          <PieChart>
            <Pie data={byCategory} dataKey="amount" nameKey="category" outerRadius={90} label={{ fontSize: 10 }}>
              {byCategory.map((c) => <Cell key={c.category} fill={COLORS[c.category]} />)}
            </Pie>
            <Tooltip formatter={(v: any) => formatINR(Number(v))} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </PieChart>
        </ChartCard>
        <ChartCard title="Cost Per Meal Trend">
          <LineChart data={costPerMeal}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-line dark:stroke-ink-700" />
            <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={(d) => String(d).slice(5)} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v: any) => formatINR(Number(v))} />
            <Line type="monotone" dataKey="costPerMeal" stroke="#3554D1" strokeWidth={2} dot={false} />
          </LineChart>
        </ChartCard>
      </div>
    </div>
  )
}
