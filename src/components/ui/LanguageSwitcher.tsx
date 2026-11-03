import { LANGS, type Lang } from '@/i18n/translations'
import { useLanguageStore } from '@/i18n/useLanguage'

/** A plain select (works with any keyboard/screen reader); labels are each language's own name, so you can find yours. */
export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { lang, setLang } = useLanguageStore()
  return (
    <select aria-label="Language / भाषा / ਭਾਸ਼ਾ" value={lang} onChange={(e) => setLang(e.target.value as Lang)} className={`rounded-lg border border-line dark:border-ink-700 bg-white dark:bg-ink-900 px-2.5 py-1.5 text-sm ${className}`}>
      {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
    </select>
  )
}
