import { create } from 'zustand'

interface ChangeRequestsState {
  pendingCount: number
  setPendingCount: (n: number) => void
}

export const useChangeRequestsStore = create<ChangeRequestsState>((set) => ({
  pendingCount: 0,
  setPendingCount: (n) => set({ pendingCount: n }),
}))
