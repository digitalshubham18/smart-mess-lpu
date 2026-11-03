import { create } from 'zustand'
import type { User } from '@/types'
import { MESSES } from '@/data/mockMesses'
import { messIdForStaff } from '@/data/mockUsers'

interface MessState {
  currentMessId: string
  setCurrentMessId: (id: string) => void
  messesVersion: number
  bumpMessesVersion: () => void
  /** True only for the Super Admin — everyone else is locked to their own hostel's mess. */
  canSwitchMess: boolean
  /** Locks the current mess to whatever the signed-in user is scoped to (their own hostel's
   *  mess for every staff role, unrestricted for the Super Admin). Call on login/session load. */
  syncToUser: (user: User | null) => void
}

const saved = localStorage.getItem('smartmess.currentMessId')
const initial = MESSES.find((m) => m.id === saved)?.id ?? MESSES[0].id

export const useMessStore = create<MessState>((set, get) => ({
  currentMessId: initial,
  canSwitchMess: false,
  setCurrentMessId: (id) => {
    if (!get().canSwitchMess) return // non-Super-Admin roles cannot leave their own mess's data
    localStorage.setItem('smartmess.currentMessId', id)
    set({ currentMessId: id })
  },
  messesVersion: 0,
  bumpMessesVersion: () => set({ messesVersion: get().messesVersion + 1 }),
  syncToUser: (user) => {
    if (!user) {
      set({ canSwitchMess: false })
      return
    }
    if (user.role === 'SUPER_ADMIN') {
      // Super Admin can see every mess; keep whichever one was last selected (or the first).
      set({ canSwitchMess: true })
      return
    }
    const ownMessId = messIdForStaff(user)
    set({ canSwitchMess: false, currentMessId: ownMessId ?? get().currentMessId })
    if (ownMessId) localStorage.setItem('smartmess.currentMessId', ownMessId)
  },
}))
