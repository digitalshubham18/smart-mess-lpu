import { useEffect, useState } from 'react'
import * as attendanceService from '@/services/attendanceService'
import { PushToggle } from '@/components/ui/PushToggle'

/** Opt-in: an email each time you're checked in for a meal, so a scan you didn't make gets noticed. Off unless you turn it on. */
export function CheckinEmailToggle() {
  const [on, setOn] = useState<boolean | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [remind, setRemind] = useState<boolean | null>(null)

  useEffect(() => {
    let current = true
    attendanceService.getNotificationPrefs().then((v) => { if (current) { setOn(v.checkinEmail); setRemind(v.mealReminder) } }).catch((e) => { if (current) setError(e instanceof Error ? e.message : 'Could not load this setting.') })
    return () => { current = false }
  }, [])

  async function toggle(next: boolean) {
    setBusy(true); setError('')
    try { setOn(await attendanceService.setCheckinEmailPref(next)) } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.') } finally { setBusy(false) }
  }

  async function toggleRemind(next: boolean) {
    setBusy(true); setError('')
    try { setRemind(await attendanceService.setMealReminderPref(next)) } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.') } finally { setBusy(false) }
  }

  return (
    <div className="mt-4 pt-3 border-t border-line dark:border-ink-700 text-left">
      <label className="flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
        <input type="checkbox" role="switch" checked={!!on} disabled={on === null || busy} onChange={(e) => void toggle(e.target.checked)} className="mt-0.5 h-4 w-4 rounded accent-tech-500" aria-label="Email me when I'm checked in" />
        <span><strong>Email me when I'm checked in.</strong> A short note after each meal scan — if it ever says you ate when you didn't, tell the warden office.</span>
      </label>
      <label className="mt-3 flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
        <input type="checkbox" role="switch" checked={remind !== false} disabled={remind === null || busy} onChange={(e) => void toggleRemind(e.target.checked)} className="mt-0.5 h-4 w-4 rounded accent-tech-500" aria-label="Remind me at 9 PM to mark tomorrow's meals" />
        <span><strong>Remind me at 9 PM to mark tomorrow's meals.</strong> A notification on this phone (turn it on below) if you haven't answered yet — it helps the kitchen cook the right amount.</span>
      </label>
      {error && <p role="alert" className="mt-1.5 text-xs text-rose-500">{error}</p>}
      <PushToggle title="Notify this device" description="A push notification on this phone each time you're checked in for a meal — even when the site is closed." />
    </div>
  )
}
