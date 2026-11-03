import { create } from 'zustand'

export type ThemeMode = 'light' | 'dark' | 'system'

function systemPrefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function applyTheme(mode: ThemeMode) {
  const dark = mode === 'dark' || (mode === 'system' && systemPrefersDark())
  document.documentElement.classList.toggle('dark', dark)
}

interface UIState {
  theme: ThemeMode
  sidebarOpen: boolean
  sidebarCollapsed: boolean
  setTheme: (mode: ThemeMode) => void
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  toggleCollapsed: () => void
}

const savedTheme = (localStorage.getItem('smartmess.theme') as ThemeMode) || 'light'
applyTheme(savedTheme)

export const useUIStore = create<UIState>((set, get) => ({
  theme: savedTheme,
  sidebarOpen: false,
  sidebarCollapsed: false,
  setTheme(mode) {
    localStorage.setItem('smartmess.theme', mode)
    applyTheme(mode)
    set({ theme: mode })
  },
  toggleSidebar() {
    set({ sidebarOpen: !get().sidebarOpen })
  },
  setSidebarOpen(open) {
    set({ sidebarOpen: open })
  },
  toggleCollapsed() {
    set({ sidebarCollapsed: !get().sidebarCollapsed })
  },
}))
