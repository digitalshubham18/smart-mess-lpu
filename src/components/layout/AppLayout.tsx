import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar, NAV_ITEMS } from './Sidebar'
import { Navbar } from './Navbar'
import { useAuth } from '@/hooks/useAuth'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'

export function AppLayout() {
  const { user } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()

  // Keeps the browser tab/history title in sync with whichever page is open — React
  // Router doesn't do this on its own, and it's the one page-level SEO/UX lever that
  // still matters for a client-rendered SPA where almost everything sits behind login.
  useDocumentTitle(NAV_ITEMS.find((n) => n.to === location.pathname)?.label)

  if (!user) return null

  return (
    <div className="flex h-screen overflow-hidden bg-surface dark:bg-ink-950">
      <Sidebar role={user.role} mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <Navbar onOpenMobileMenu={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-y-auto px-4 md:px-7 py-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
