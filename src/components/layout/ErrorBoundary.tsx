import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportError } from '@/services/errorReporter'

/** Without this, one bad render blanks the whole app. With it: a plain page with a way out, and the crash is reported. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) { reportError(error.message, `${error.stack ?? ''}\n${info.componentStack ?? ''}`) }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" className="min-h-screen grid place-items-center bg-surface dark:bg-ink-950 px-6">
        <div className="max-w-sm text-center">
          <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100">Something went wrong</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">The problem has been reported. Your meals and attendance are safe — nothing is lost by reloading.</p>
          <button onClick={() => window.location.reload()} className="mt-4 rounded-xl bg-tech-500 hover:bg-tech-600 text-white text-sm font-semibold py-2.5 px-5">Reload the app</button>
          <p className="mt-3 text-xs text-slate-400">At the counter? Your printed ID card still works.</p>
        </div>
      </div>
    )
  }
}
