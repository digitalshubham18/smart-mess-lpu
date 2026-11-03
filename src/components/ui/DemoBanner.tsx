import { FlaskConical } from 'lucide-react'

/**
 * Marks a screen (or part of one) whose numbers are NOT recorded by the server: they are sample data, or live only in this
 * browser tab and vanish on reload. Nobody should run the mess on them, so the screen says so up front.
 */
export function DemoBanner({ what, detail }: { what?: string; detail?: string }) {
  return (
    <div role="note" data-testid="demo-banner" className="rounded-xl border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 px-4 py-3 flex items-start gap-3">
      <FlaskConical size={17} className="text-amber-600 shrink-0 mt-0.5" />
      <div className="text-xs text-amber-900 dark:text-amber-200">
        <p className="font-semibold">Demo data — not recorded by the server</p>
        <p className="mt-0.5">{what ?? "What you see here is sample data for demonstration, and anything you change lasts only until the page is reloaded."} Don't use it for decisions{detail ? ` — ${detail}` : '.'}</p>
      </div>
    </div>
  )
}
