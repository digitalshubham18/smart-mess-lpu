import { Link } from 'react-router-dom'
import { ChefHat } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-surface dark:bg-ink-950 px-4 text-center">
      <ChefHat size={32} className="text-tech-500" />
      <h1 className="font-display text-2xl font-bold mt-4 text-slate-800 dark:text-slate-100">404 — Page not found</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">The page you're looking for doesn't exist.</p>
      <Link to="/dashboard" className="mt-5 rounded-lg bg-tech-500 text-white text-sm font-semibold px-4 py-2.5">
        Back to Dashboard
      </Link>
    </div>
  )
}
