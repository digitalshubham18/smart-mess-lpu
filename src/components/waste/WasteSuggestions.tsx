import { useEffect, useState } from 'react'
import { Lightbulb } from 'lucide-react'
import { getWasteSuggestions, type WasteSuggestion } from '@/services/wasteLogService'

/** Advice from the kitchen's own recorded waste: where it is consistently over-cooking, and by roughly how much. Silent when there is nothing to say. */
export function WasteSuggestions({ messId, refreshKey }: { messId: string; refreshKey?: number }) {
  const [list, setList] = useState<WasteSuggestion[]>([])
  useEffect(() => {
    let current = true
    getWasteSuggestions(messId).then((v) => { if (current) setList(v) }).catch(() => { if (current) setList([]) })
    return () => { current = false }
  }, [messId, refreshKey])
  if (list.length === 0) return null
  return (
    <div className="rounded-xl border border-eco-200 dark:border-eco-500/30 bg-eco-50 dark:bg-eco-500/10 p-4" data-testid="waste-suggestions">
      <p className="text-sm font-semibold text-eco-800 dark:text-eco-300 flex items-center gap-2"><Lightbulb size={15} />What your own numbers suggest</p>
      <ul className="mt-2 space-y-1.5 text-xs text-eco-900 dark:text-eco-200 list-disc pl-5">{list.map((s) => <li key={s.meal}>{s.advice}</li>)}</ul>
      <p className="mt-2 text-[11px] text-eco-700/80 dark:text-eco-400/80">Based on the last 14 days of entries (3 or more per meal). A suggestion, not an instruction — you know the kitchen.</p>
    </div>
  )
}
