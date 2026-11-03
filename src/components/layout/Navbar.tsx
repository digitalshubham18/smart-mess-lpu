import { useState, useEffect } from 'react'
import { Menu, Search, Sun, Moon, Bell, ChevronDown, LogOut, User as UserIcon, PanelLeftClose, PanelLeft, UtensilsCrossed } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useUIStore } from '@/store/useUIStore'
import { useMessStore } from '@/store/useMessStore'
import { useNotifications } from '@/hooks/useNotifications'
import { initials } from '@/utils/formatters'
import { ROLE_LABELS } from '@/data/mockUsers'
import { globalSearch } from '@/services/searchService'
import { useDebounce } from '@/hooks/useDebounce'
import * as messService from '@/services/messService'
import type { Mess, Role } from '@/types'

// Only the Super Admin can switch between messes — every other staff role is
// permanently scoped to their own hostel's mess (see useMessStore.syncToUser).
const MESS_SWITCHER_ROLES: Role[] = ['SUPER_ADMIN']

export function Navbar({ onOpenMobileMenu }: { onOpenMobileMenu: () => void }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)
  const collapsed = useUIStore((s) => s.sidebarCollapsed)
  const toggleCollapsed = useUIStore((s) => s.toggleCollapsed)
  const { unread } = useNotifications(user?.role, user?.studentId)
  const currentMessId = useMessStore((s) => s.currentMessId)
  const setCurrentMessId = useMessStore((s) => s.setCurrentMessId)
  const messesVersion = useMessStore((s) => s.messesVersion)
  const [messes, setMesses] = useState<Mess[]>([])
  const [messSwitcherOpen, setMessSwitcherOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounce(query, 200)
  const [results, setResults] = useState<ReturnType<typeof globalSearch>>([])
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    if (debouncedQuery.trim().length > 1) {
      setResults(globalSearch(debouncedQuery))
      setSearchOpen(true)
    } else {
      setResults([])
      setSearchOpen(false)
    }
  }, [debouncedQuery])

  useEffect(() => {
    if (user) {
      messService.listMesses().then(setMesses)
    }
  }, [user, messesVersion])

  const showMessSwitcher = user && MESS_SWITCHER_ROLES.includes(user.role)
  const showMessBadge = user && user.role !== 'STUDENT' && !showMessSwitcher
  const currentMess = messes.find((m) => m.id === currentMessId)

  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 px-4 md:px-6 py-3 border-b border-line dark:border-ink-700 bg-white/90 dark:bg-ink-900/90 backdrop-blur">
      <button onClick={onOpenMobileMenu} className="md:hidden p-1.5 text-slate-500" aria-label="Open menu">
        <Menu size={20} />
      </button>
      <button onClick={toggleCollapsed} className="hidden md:flex p-1.5 text-slate-400 hover:text-slate-600" aria-label="Toggle sidebar">
        {collapsed ? <PanelLeft size={17} /> : <PanelLeftClose size={17} />}
      </button>

      <div className="relative flex-1 max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.length > 1 && setSearchOpen(true)}
          onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
          placeholder="Search students, meals, inventory…"
          className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 focus:outline-none focus:ring-2 focus:ring-tech-500/40"
        />
        {searchOpen && results.length > 0 && (
          <div className="absolute mt-1 w-full rounded-lg border border-line dark:border-ink-700 bg-white dark:bg-ink-900 shadow-lg max-h-80 overflow-y-auto z-40">
            {results.map((r) => (
              <button
                key={r.id}
                onMouseDown={() => {
                  navigate(r.path)
                  setQuery('')
                  setSearchOpen(false)
                }}
                className="w-full text-left px-3.5 py-2.5 text-sm hover:bg-surface-dim dark:hover:bg-ink-800 flex items-center justify-between"
              >
                <span className="text-slate-700 dark:text-slate-200">{r.label}</span>
                <span className="text-[10px] uppercase text-slate-400">{r.category}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 ml-auto">
        {showMessSwitcher && (
          <div className="relative hidden sm:block">
            <button
              onClick={() => setMessSwitcherOpen((v) => !v)}
              className="flex items-center gap-1.5 pl-2.5 pr-2 py-1.5 rounded-lg border border-line dark:border-ink-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-surface-dim dark:hover:bg-ink-800"
            >
              <UtensilsCrossed size={13} className="text-tech-500" />
              {currentMess?.name ?? 'Select mess'}
              <ChevronDown size={12} className="text-slate-400" />
            </button>
            {messSwitcherOpen && (
              <div className="absolute right-0 mt-1 w-56 rounded-lg border border-line dark:border-ink-700 bg-white dark:bg-ink-900 shadow-lg py-1 z-40">
                {messes.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      setCurrentMessId(m.id)
                      setMessSwitcherOpen(false)
                    }}
                    className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-surface-dim dark:hover:bg-ink-800 ${m.id === currentMessId ? 'text-tech-600 dark:text-tech-500 font-semibold' : 'text-slate-600 dark:text-slate-300'}`}
                  >
                    {m.name}
                    {m.id === currentMessId && <span className="w-1.5 h-1.5 rounded-full bg-tech-500" />}
                  </button>
                ))}
                {user?.role === 'SUPER_ADMIN' && (
                  <button
                    onClick={() => {
                      navigate('/messes')
                      setMessSwitcherOpen(false)
                    }}
                    className="w-full text-left px-3 py-2 text-xs font-semibold text-tech-600 dark:text-tech-500 border-t border-line dark:border-ink-700 mt-1 pt-2"
                  >
                    Manage messes →
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {showMessBadge && (
          <div
            title="Your account is scoped to this mess only"
            className="hidden sm:flex items-center gap-1.5 pl-2.5 pr-2.5 py-1.5 rounded-lg border border-line dark:border-ink-700 text-xs font-semibold text-slate-600 dark:text-slate-300"
          >
            <UtensilsCrossed size={13} className="text-tech-500" />
            {currentMess?.name ?? 'Your mess'}
          </div>
        )}
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="p-2 rounded-lg text-slate-500 hover:bg-surface-dim dark:hover:bg-ink-800"
          aria-label="Toggle dark mode"
        >
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>
        <button onClick={() => navigate('/notifications')} className="relative p-2 rounded-lg text-slate-500 hover:bg-surface-dim dark:hover:bg-ink-800" aria-label="Notifications">
          <Bell size={17} />
          {unread > 0 && <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-rose-500" />}
        </button>

        <div className="relative">
          <button onClick={() => setProfileOpen((v) => !v)} aria-label="Account menu" aria-haspopup="menu" aria-expanded={profileOpen} className="flex items-center gap-2 pl-2 pr-1 py-1 rounded-lg hover:bg-surface-dim dark:hover:bg-ink-800">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: user?.avatarColor ?? '#3554D1' }}>
              {user ? initials(user.name) : '?'}
            </div>
            <div className="hidden sm:block text-left">
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 leading-tight">{user?.name}</div>
              <div className="text-[10px] text-slate-400 leading-tight">{user ? ROLE_LABELS[user.role] : ''}</div>
            </div>
            <ChevronDown size={14} className="text-slate-400" />
          </button>
          {profileOpen && (
            <div className="absolute right-0 mt-1 w-44 rounded-lg border border-line dark:border-ink-700 bg-white dark:bg-ink-900 shadow-lg py-1 z-40">
              <button
                onClick={() => {
                  navigate('/profile')
                  setProfileOpen(false)
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-surface-dim dark:hover:bg-ink-800"
              >
                <UserIcon size={14} /> Profile
              </button>
              <button
                onClick={() => {
                  logout()
                  navigate('/login')
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-rose-500 hover:bg-surface-dim dark:hover:bg-ink-800"
              >
                <LogOut size={14} /> Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
