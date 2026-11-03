import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { ProtectedRoute } from '@/components/layout/ProtectedRoute'
import { useAuth } from '@/hooks/useAuth'
import { ROLE_HOME } from '@/data/mockUsers'

import Login from '@/pages/auth/Login'
import ChangePasswordRequired from '@/pages/auth/ChangePasswordRequired'
import SystemErrors from '@/pages/SystemErrors'
import SetupTwoFactorRequired from '@/pages/auth/SetupTwoFactorRequired'
import Register from '@/pages/auth/Register'
import ForgotPassword from '@/pages/auth/ForgotPassword'
import ResetPassword from '@/pages/auth/ResetPassword'

import Dashboard from '@/pages/Dashboard'
import CollegeOverview from '@/pages/CollegeOverview'
import Forecast from '@/pages/Forecast'
import ForecastAccuracy from '@/pages/ForecastAccuracy'
import MealIntention from '@/pages/MealIntention'
import Attendance from '@/pages/Attendance'
import Meals from '@/pages/Meals'
import MenuPlanner from '@/pages/MenuPlanner'
import FoodWaste from '@/pages/FoodWaste'
import WasteAnalytics from '@/pages/WasteAnalytics'
import Inventory from '@/pages/Inventory'
import InventoryForecast from '@/pages/InventoryForecast'
import Suppliers from '@/pages/Suppliers'
import Procurement from '@/pages/Procurement'
import Students from '@/pages/Students'
import Hostels from '@/pages/Hostels'
import Messes from '@/pages/Messes'
import Staff from '@/pages/Staff'
import Leaderboard from '@/pages/Leaderboard'
import AuditLog from '@/pages/AuditLog'
import FeedbackPage from '@/pages/Feedback'
import Notifications from '@/pages/Notifications'
import Kitchen from '@/pages/Kitchen'
import Reports from '@/pages/Reports'
import Sustainability from '@/pages/Sustainability'
import Simulator from '@/pages/Simulator'
import Scenarios from '@/pages/Scenarios'
import CalendarPage from '@/pages/Calendar'
import Finance from '@/pages/Finance'
import SettingsPage from '@/pages/Settings'
import Profile from '@/pages/Profile'
import NotFound from '@/pages/NotFound'

function IndexRedirect() {
  const { user, isAuthenticated } = useAuth()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <Navigate to={user ? ROLE_HOME[user.role] ?? '/dashboard' : '/dashboard'} replace />
}

const OPS_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER'] as const
const FINANCE_ROLES = ['SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER'] as const

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/change-password" element={<ChangePasswordRequired />} />
        <Route path="/setup-two-factor" element={<SetupTwoFactorRequired />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/college-overview" element={<ProtectedRoute roles={['SUPER_ADMIN']}><CollegeOverview /></ProtectedRoute>} />
          <Route path="/forecast" element={<ProtectedRoute roles={[...OPS_ROLES]}><Forecast /></ProtectedRoute>} />
          <Route path="/forecast-accuracy" element={<ProtectedRoute roles={[...OPS_ROLES]}><ForecastAccuracy /></ProtectedRoute>} />
          <Route path="/meal-intention" element={<MealIntention />} />
          <Route path="/attendance" element={<Attendance />} />
          <Route path="/meals" element={<Meals />} />
          <Route path="/menu-planner" element={<ProtectedRoute roles={[...OPS_ROLES]}><MenuPlanner /></ProtectedRoute>} />
          <Route path="/food-waste" element={<ProtectedRoute roles={['SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER', 'KITCHEN_STAFF']}><FoodWaste /></ProtectedRoute>} />
          <Route path="/waste-analytics" element={<ProtectedRoute roles={['SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER', 'FINANCE_MANAGER']}><WasteAnalytics /></ProtectedRoute>} />
          <Route path="/system-errors" element={<ProtectedRoute roles={['SUPER_ADMIN']}><SystemErrors /></ProtectedRoute>} />
          <Route path="/inventory" element={<ProtectedRoute roles={['SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER', 'KITCHEN_STAFF', 'FINANCE_MANAGER']}><Inventory /></ProtectedRoute>} />
          <Route path="/inventory-forecast" element={<ProtectedRoute roles={[...OPS_ROLES]}><InventoryForecast /></ProtectedRoute>} />
          <Route path="/suppliers" element={<ProtectedRoute roles={['SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER', 'FINANCE_MANAGER']}><Suppliers /></ProtectedRoute>} />
          <Route path="/procurement" element={<ProtectedRoute roles={['SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER', 'FINANCE_MANAGER']}><Procurement /></ProtectedRoute>} />
          <Route path="/students" element={<ProtectedRoute roles={['SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER', 'HOSTEL_WARDEN']}><Students /></ProtectedRoute>} />
          <Route path="/hostels" element={<ProtectedRoute roles={['SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER', 'HOSTEL_WARDEN']}><Hostels /></ProtectedRoute>} />
          <Route path="/messes" element={<ProtectedRoute roles={['SUPER_ADMIN']}><Messes /></ProtectedRoute>} />
          <Route path="/staff" element={<ProtectedRoute roles={['SUPER_ADMIN', 'ADMIN']}><Staff /></ProtectedRoute>} />
          <Route path="/leaderboard" element={<ProtectedRoute roles={['SUPER_ADMIN']}><Leaderboard /></ProtectedRoute>} />
          <Route path="/audit-log" element={<ProtectedRoute roles={['SUPER_ADMIN']}><AuditLog /></ProtectedRoute>} />
          <Route path="/feedback" element={<FeedbackPage />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/kitchen" element={<ProtectedRoute roles={['SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER', 'KITCHEN_STAFF']}><Kitchen /></ProtectedRoute>} />
          <Route path="/reports" element={<ProtectedRoute roles={['SUPER_ADMIN', 'ADMIN', 'FINANCE_MANAGER', 'MESS_MANAGER']}><Reports /></ProtectedRoute>} />
          <Route path="/sustainability" element={<Sustainability />} />
          <Route path="/simulator" element={<ProtectedRoute roles={[...OPS_ROLES]}><Simulator /></ProtectedRoute>} />
          <Route path="/scenarios" element={<ProtectedRoute roles={[...OPS_ROLES]}><Scenarios /></ProtectedRoute>} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/finance" element={<ProtectedRoute roles={[...FINANCE_ROLES]}><Finance /></ProtectedRoute>} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/profile" element={<Profile />} />
        </Route>

        <Route path="/" element={<IndexRedirect />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  )
}
