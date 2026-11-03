import { NavLink } from 'react-router-dom'
import {
  LayoutGrid, TrendingUp, Target, ClipboardCheck, UtensilsCrossed, CalendarRange, Leaf, BarChart3,
  Boxes, TrendingDown as TrendingDownIcon, Truck, ShoppingCart, Users, Building2, MessageSquare, Bell,
  ChefHat, FileText, Sparkles, SlidersHorizontal, GitCompare, Calendar as CalendarIcon, Wallet, Settings, X, Layers, UserCog,
  Trophy, ScrollText, AlertTriangle,
} from 'lucide-react'
import type { Role } from '@/types'
import { useUIStore } from '@/store/useUIStore'
import { useChangeRequestsStore } from '@/store/useChangeRequestsStore'
import { useT } from '@/i18n/useLanguage'
import type { Key } from '@/i18n/translations'

interface NavItem {
  to: string
  label: string
  icon: typeof LayoutGrid
  roles: Role[]
  /** Not backed by the server — shows a "demo" tag so nobody trusts it before they even open it. */
  demo?: boolean
}

const ALL_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER', 'KITCHEN_STAFF', 'STUDENT', 'FINANCE_MANAGER', 'HOSTEL_WARDEN']
const MESS_STAFF: Role[] = ['SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER']

export const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutGrid, roles: [...ALL_ROLES, 'PARENT'] },
  { to: '/college-overview', label: 'University Overview', icon: Layers, roles: ['SUPER_ADMIN'], demo: true },
  { to: '/forecast', label: 'Forecast', icon: TrendingUp, roles: MESS_STAFF },
  { to: '/forecast-accuracy', label: 'Forecast Accuracy', icon: Target, roles: MESS_STAFF },
  { to: '/meal-intention', label: 'Meal Intention', icon: ClipboardCheck, roles: ['STUDENT', 'SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER'] },
  { to: '/attendance', label: 'Attendance', icon: ClipboardCheck, roles: ['SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER', 'HOSTEL_WARDEN', 'KITCHEN_STAFF', 'STUDENT', 'PARENT', 'FINANCE_MANAGER'] },
  { to: '/meals', label: 'Meals', icon: UtensilsCrossed, roles: ['SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER', 'KITCHEN_STAFF', 'STUDENT'], demo: true },
  { to: '/menu-planner', label: 'Menu Planner', icon: CalendarRange, roles: MESS_STAFF, demo: true },
  { to: '/food-waste', label: 'Food Waste', icon: Leaf, roles: ['SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER', 'KITCHEN_STAFF'] },
  { to: '/waste-analytics', label: 'Waste Analytics', icon: BarChart3, roles: ['SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER', 'FINANCE_MANAGER'], demo: true },
  { to: '/system-errors', label: 'System errors', icon: AlertTriangle, roles: ['SUPER_ADMIN'] },
  { to: '/inventory', label: 'Inventory', icon: Boxes, roles: ['SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER', 'KITCHEN_STAFF', 'FINANCE_MANAGER'] },
  { to: '/inventory-forecast', label: 'Inventory Forecast', icon: TrendingDownIcon, roles: MESS_STAFF, demo: true },
  { to: '/suppliers', label: 'Suppliers', icon: Truck, roles: ['SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER', 'FINANCE_MANAGER'], demo: true },
  { to: '/procurement', label: 'Procurement', icon: ShoppingCart, roles: ['SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER', 'FINANCE_MANAGER'], demo: true },
  { to: '/students', label: 'Students', icon: Users, roles: ['SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER', 'HOSTEL_WARDEN'] },
  { to: '/hostels', label: 'Hostels', icon: Building2, roles: ['SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER', 'HOSTEL_WARDEN'] },
  { to: '/messes', label: 'Messes', icon: UtensilsCrossed, roles: ['SUPER_ADMIN'] },
  { to: '/staff', label: 'Staff', icon: UserCog, roles: ['SUPER_ADMIN', 'ADMIN'] },
  { to: '/leaderboard', label: 'Leaderboard', icon: Trophy, roles: ['SUPER_ADMIN'], demo: true },
  { to: '/audit-log', label: 'Audit Log', icon: ScrollText, roles: ['SUPER_ADMIN'] },
  { to: '/feedback', label: 'Feedback', icon: MessageSquare, roles: ['SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER', 'KITCHEN_STAFF', 'HOSTEL_WARDEN', 'STUDENT'] },
  { to: '/notifications', label: 'Notifications', icon: Bell, roles: ALL_ROLES, demo: true },
  { to: '/kitchen', label: 'Kitchen', icon: ChefHat, roles: ['SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER', 'KITCHEN_STAFF'], demo: true },
  { to: '/reports', label: 'Reports', icon: FileText, roles: ['SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER', 'FINANCE_MANAGER'], demo: true },
  { to: '/sustainability', label: 'Sustainability', icon: Sparkles, roles: ALL_ROLES, demo: true },
  { to: '/simulator', label: 'What-If Simulator', icon: SlidersHorizontal, roles: MESS_STAFF, demo: true },
  { to: '/scenarios', label: 'Scenario Planner', icon: GitCompare, roles: MESS_STAFF, demo: true },
  { to: '/calendar', label: 'Calendar', icon: CalendarIcon, roles: ALL_ROLES, demo: true },
  { to: '/finance', label: 'Finance', icon: Wallet, roles: ['SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER'], demo: true },
  { to: '/settings', label: 'Settings', icon: Settings, roles: ALL_ROLES },
]

export function Sidebar({ role, mobileOpen, onCloseMobile }: { role: Role; mobileOpen: boolean; onCloseMobile: () => void }) {
  const t = useT()
  const collapsed = useUIStore((s) => s.sidebarCollapsed)
  const pendingRequests = useChangeRequestsStore((s) => s.pendingCount)
  const items = NAV_ITEMS.filter((n) => n.roles.includes(role))

  const canReviewRequests = role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'MESS_MANAGER'
  const badges: Partial<Record<string, number>> = {
    '/meal-intention': canReviewRequests ? pendingRequests : 0,
  }

  const content = (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-5 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-tech-500 flex items-center justify-center">
          <ChefHat size={17} className="text-white" />
        </div>
        {!collapsed && (
          <div className="leading-tight">
            <span className="font-display font-bold text-slate-800 dark:text-slate-100 block">LPU Smart Mess</span>
            <span className="text-[10px] text-slate-400 block">Lovely Professional University</span>
          </div>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto px-2.5 space-y-0.5 pb-4">
        {items.map((item) => {
          const badge = badges[item.to]
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onCloseMobile}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-tech-500/10 text-tech-600 dark:text-tech-500'
                    : 'text-slate-500 dark:text-slate-400 hover:bg-surface-dim dark:hover:bg-ink-800'
                }`
              }
            >
              <item.icon size={16} className="shrink-0" />
              {!collapsed && <span className="flex-1 truncate">{t(`nav.${item.to}` as Key)}</span>}
              {!collapsed && item.demo && <span title="Sample data — not recorded by the server" className="shrink-0 text-[9px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">demo</span>}
              {!!badge && (
                <span className={`shrink-0 flex items-center justify-center text-[10px] font-bold rounded-full bg-rose-500 text-white ${collapsed ? 'w-4 h-4' : 'min-w-[18px] h-[18px] px-1'}`}>
                  {badge}
                </span>
              )}
            </NavLink>
          )
        })}
      </nav>
    </div>
  )

  return (
    <>
      <aside className={`hidden md:flex shrink-0 border-r border-line dark:border-ink-700 bg-white dark:bg-ink-900 transition-all ${collapsed ? 'w-16' : 'w-64'}`}>
        {content}
      </aside>

      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-ink-950/50" onClick={onCloseMobile} />
          <div className="relative w-72 bg-white dark:bg-ink-900 h-full">
            <button onClick={onCloseMobile} className="absolute top-4 right-4 p-1 text-slate-400" aria-label="Close menu">
              <X size={18} />
            </button>
            {content}
          </div>
        </div>
      )}
    </>
  )
}
