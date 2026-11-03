import { create } from 'zustand'
import { LANGS, translate, type Key, type Lang } from './translations'

const STORAGE_KEY = 'smartmess.lang'
const initial = (): Lang => {
  try { const v = localStorage.getItem(STORAGE_KEY); if (LANGS.some((l) => l.code === v)) return v as Lang } catch { /* private mode */ }
  return 'en'
}
const apply = (lang: Lang) => { if (typeof document !== 'undefined') document.documentElement.lang = lang }

/** The chosen language (remembered on this device; a preference, not personal data). */
export const useLanguageStore = create<{ lang: Lang; setLang: (l: Lang) => void }>((set) => {
  apply(initial())
  return { lang: initial(), setLang: (lang) => { try { localStorage.setItem(STORAGE_KEY, lang) } catch { /* ignore */ } apply(lang); set({ lang }) } }
})

/** `const t = useT(); t('mi.title')` — re-renders when the language changes. */
export function useT() {
  const lang = useLanguageStore((s) => s.lang)
  return (key: Key, vars?: Record<string, string | number>) => translate(lang, key, vars)
}
