import fs from 'node:fs'
import path from 'node:path'
import { expect, type Page, type APIRequestContext } from '@playwright/test'

export const API = 'http://localhost:4010/api'
export const OUTBOX = path.resolve('e2e/.tmp/outbox')

/** Signs in through the real login form. */
export async function signIn(page: Page, uid: string, password = 'demo1234') {
  await page.goto('/login')
  await page.getByPlaceholder(/e\.g\. 21000001/i).fill(uid)
  await page.getByPlaceholder('••••••••').fill(password)
  await page.getByRole('button', { name: /^sign in$/i }).click()
  // Each role lands on its own home page (staff on /dashboard, kitchen on /kitchen…) — all that matters is that we left /login.
  await expect(page).not.toHaveURL(/\/login/)
  await expect(page.getByRole('button', { name: /account menu/i })).toBeVisible()
}

/** A non-browser API login (no client header → the token comes back in the body), for reading data the UI hides. */
export async function apiToken(request: APIRequestContext, uid: string, password = 'demo1234'): Promise<string> {
  const res = await request.post(`${API}/auth/login`, { data: { identifier: uid, password } })
  expect(res.ok()).toBeTruthy()
  return (await res.json()).token
}

/** The most recent 6-digit code "emailed" to an address (dev mail goes to files in the outbox). */
export async function emailedCode(email: string): Promise<string> {
  const tag = email.replace(/[^a-z0-9]/gi, '_')
  for (let i = 0; i < 40; i++) {
    const files = fs.existsSync(OUTBOX) ? fs.readdirSync(OUTBOX).filter((f) => f.endsWith(`-${tag}.txt`)).sort() : []
    const last = files.at(-1)
    if (last) {
      const m = fs.readFileSync(path.join(OUTBOX, last), 'utf8').match(/code is (\d{6})/)
      if (m) return m[1]
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`no emailed code found for ${email}`)
}
