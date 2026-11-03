import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// globals are off in vitest.config.ts, so RTL's auto-cleanup doesn't register itself.
afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
})

// jsdom doesn't implement these; components that touch them (charts, media queries) would throw.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
if (!('ResizeObserver' in globalThis)) (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}
