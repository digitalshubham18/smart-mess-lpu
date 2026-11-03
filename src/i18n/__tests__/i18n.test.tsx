import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { en, DICTIONARIES, LANGS, translate, type Key } from '../translations'
import { useLanguageStore, useT } from '../useLanguage'
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher'

const keys = Object.keys(en) as Key[]
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('translations', () => {
  it('Hindi and Punjabi translate EVERY key (nothing silently falls back to English)', () => {
    for (const lang of ['hi', 'pa'] as const) {
      const missing = keys.filter((k) => !DICTIONARIES[lang][k])
      expect(missing, `${lang} is missing: ${missing.join(', ')}`).toEqual([])
    }
  })
  it('no translation has a key English does not have (a typo would never show)', () => {
    for (const lang of ['hi', 'pa'] as const) expect(Object.keys(DICTIONARIES[lang]).filter((k) => !(k in en))).toEqual([])
  })
  it('every translation keeps exactly the same {placeholders} as the English (so a countdown/date never breaks)', () => {
    for (const lang of ['hi', 'pa'] as const) for (const k of keys) expect(placeholders(DICTIONARIES[lang][k] ?? ''), `${lang} ${k}`).toEqual(placeholders(en[k]))
  })
  it('Hindi and Punjabi really are in their own scripts, not copies of English', () => {
    for (const k of keys.filter((k) => k.startsWith('nav.'))) {
      expect(DICTIONARIES.hi[k]).toMatch(/[\u0900-\u097F]/)
      expect(DICTIONARIES.pa[k]).toMatch(/[\u0A00-\u0A7F]/)
    }
  })
  it('fills placeholders, and falls back to English for an unknown language key', () => {
    expect(translate('en', 'qr.offlineBadge', { s: 42 })).toBe('Offline code — no internet needed (42s)')
    expect(translate('hi', 'qr.offlineBadge', { s: 42 })).toContain('42')
    expect(translate('pa', 'mi.subtitle', { date: '5 Nov' })).toContain('5 Nov')
    delete (DICTIONARIES.hi as Record<string, string>)['login.signin']
    expect(translate('hi', 'login.signin')).toBe('Sign in')
  })
})

function Probe() { const t = useT(); return <p data-testid="probe">{t('nav./attendance')}</p> }

describe('language switching', () => {
  beforeEach(() => { act(() => useLanguageStore.getState().setLang('en')); localStorage.clear() })
  it('defaults to English, switches live, remembers the choice, and sets the page language for screen readers', async () => {
    render(<><LanguageSwitcher /><Probe /></>)
    expect(screen.getByTestId('probe')).toHaveTextContent('Attendance')
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: /language/i }), 'hi')
    expect(screen.getByTestId('probe')).toHaveTextContent('उपस्थिति')
    expect(localStorage.getItem('smartmess.lang')).toBe('hi')
    expect(document.documentElement.lang).toBe('hi')
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: /language/i }), 'pa')
    expect(screen.getByTestId('probe')).toHaveTextContent('ਹਾਜ਼ਰੀ')
    expect(document.documentElement.lang).toBe('pa')
  })
  it('offers each language under its own name', () => {
    render(<LanguageSwitcher />)
    expect(LANGS.map((l) => l.label)).toEqual(['English', 'हिन्दी', 'ਪੰਜਾਬੀ'])
    expect(screen.getByRole('option', { name: 'ਪੰਜਾਬੀ' })).toBeInTheDocument()
  })
})
