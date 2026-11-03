import { useEffect, useState } from 'react'
import { useUIStore } from '@/store/useUIStore'
import { useAuth } from '@/hooks/useAuth'
import { useMessStore } from '@/store/useMessStore'
import { DashboardCard } from '@/components/ui/DashboardCard'
import { getMessSettings, updateMessSettings, type MessSettings } from '@/services/messSettingsService'
import { messName } from '@/data/mockMesses'
import { Sun, Moon, Monitor } from 'lucide-react'

export default function Settings() {
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)
  const { user } = useAuth()
  const messId = useMessStore((s) => s.currentMessId)
  const isOps = user && user.role !== 'STUDENT'

  const [settings, setSettings] = useState<MessSettings | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (isOps) getMessSettings(messId).then(setSettings)
  }, [messId, isOps])

  async function save() {
    if (!settings) return
    const updated = await updateMessSettings(messId, settings)
    setSettings(updated)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100">Settings</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {isOps ? `Preferences and operational configuration for ${messName(messId)}.` : 'Preferences.'}
        </p>
      </div>

      <DashboardCard title="Appearance">
        <div className="flex gap-2">
          {([['light', Sun, 'Light'], ['dark', Moon, 'Dark'], ['system', Monitor, 'System']] as const).map(([mode, Icon, label]) => (
            <button
              key={mode}
              onClick={() => setTheme(mode)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border ${theme === mode ? 'bg-tech-500 text-white border-tech-500' : 'border-line dark:border-ink-700 text-slate-600 dark:text-slate-300'}`}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
      </DashboardCard>

      {isOps && settings && (
        <>
          <DashboardCard title="Preparation Buffer">
            <p className="text-xs text-slate-400 -mt-2 mb-2">Applied live to every new forecast computed for {messName(messId)} — see the Forecast page.</p>
            <label className="text-xs font-medium text-slate-500">Safety buffer (%)</label>
            <input
              type="number"
              value={settings.bufferPct}
              onChange={(e) => setSettings({ ...settings, bufferPct: +e.target.value })}
              className="mt-1 w-32 rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm block"
            />
          </DashboardCard>

          <DashboardCard title="Food Costs">
            <p className="text-xs text-slate-400 -mt-2 mb-3">Used to estimate expected forecast cost and recorded waste cost for {messName(messId)}.</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-500">Avg. cost per kg (₹) — blended</label>
                <input
                  type="number"
                  value={settings.avgCostPerKg}
                  onChange={(e) => setSettings({ ...settings, avgCostPerKg: +e.target.value })}
                  className="mt-1 w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm"
                />
              </div>
              {(['Rice', 'Dal', 'Roti', 'Sabzi'] as const).map((item) => (
                <div key={item}>
                  <label className="text-xs font-medium text-slate-500">{item} (₹/{item === 'Roti' ? 'unit' : 'kg'})</label>
                  <input
                    type="number"
                    value={settings.costs[item]}
                    onChange={(e) => setSettings({ ...settings, costs: { ...settings.costs, [item]: +e.target.value } })}
                    className="mt-1 w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm"
                  />
                </div>
              ))}
            </div>
          </DashboardCard>

          <DashboardCard title="Monthly Budget">
            <p className="text-xs text-slate-400 -mt-2 mb-2">A spend ceiling for {messName(messId)} — the Finance page warns when you're near or over it. Set to 0 for no cap.</p>
            <label className="text-xs font-medium text-slate-500">Monthly budget cap (₹)</label>
            <input
              type="number"
              value={settings.monthlyBudgetCap}
              onChange={(e) => setSettings({ ...settings, monthlyBudgetCap: +e.target.value })}
              className="mt-1 w-48 rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm block"
            />
          </DashboardCard>

          <button onClick={save} className="rounded-lg bg-tech-500 hover:bg-tech-600 text-white text-sm font-semibold px-5 py-2.5">
            Save Settings
          </button>
          {saved && <p className="text-xs text-eco-600">Settings saved — new forecasts for {messName(messId)} will use these values.</p>}
        </>
      )}
    </div>
  )
}
