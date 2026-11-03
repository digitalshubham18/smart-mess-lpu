import { test, expect } from '@playwright/test'
import { signIn, apiToken, emailedCode, API } from './helpers'

const KITCHEN_BH2 = '10009'
const ADMIN_BH2 = '10007'

test.describe('session security (real browser)', () => {
  test('the session is an httpOnly cookie: page JavaScript cannot read it and no token is stored', async ({ page, context }) => {
    await signIn(page, ADMIN_BH2)
    const cookie = (await context.cookies()).find((c) => c.name === 'smartmess_session')
    expect(cookie, 'session cookie is set').toBeTruthy()
    expect(cookie!.httpOnly).toBe(true)
    expect(cookie!.sameSite).toBe('Lax')
    expect(await page.evaluate(() => document.cookie)).not.toContain('smartmess_session')
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }))
    expect(stored).not.toMatch(/eyJ/) // no JWT anywhere in localStorage
    expect(stored).not.toContain('smartmess.token')
  })

  test('a reload keeps you signed in; signing out ends the session server-side', async ({ page, context }) => {
    await signIn(page, ADMIN_BH2)
    await page.reload()
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page.getByRole('button', { name: /account menu/i })).toBeVisible() // still signed in after a hard reload
    const before = (await context.cookies()).find((c) => c.name === 'smartmess_session')!.value
    await page.getByRole('button', { name: /account menu/i }).click()
    await page.getByRole('button', { name: /^logout$/i }).click()
    await expect(page).toHaveURL(/\/login/)
    // replaying the old cookie value must now fail — logout revoked it, not just the browser's copy
    const res = await context.request.get(`${API}/students/21000101`, { headers: { Cookie: `smartmess_session=${before}` } })
    expect(res.status()).toBe(401)
  })

  test('a cookie-authenticated write without the client header is refused (CSRF defense), with it is accepted', async ({ page, context }) => {
    await signIn(page, ADMIN_BH2)
    const body = { name: 'Csrf Probe', email: 'csrf.probe@example.com', hostelId: 'BH2' }
    const forged = await context.request.post(`${API}/students`, { data: body })
    expect(forged.status()).toBe(403)
    expect((await forged.json()).code).toBe('CSRF_BLOCKED')
    const legit = await context.request.post(`${API}/students`, { data: body, headers: { 'X-SmartMess-Client': 'web' } })
    expect(legit.status()).toBe(201)
  })
})

test.describe('mess-scoped check-in (real browser → real API)', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, KITCHEN_BH2)
    await page.goto('/attendance')
    await page.getByRole('button', { name: /^lunch/i }).click() // the meal is chosen first; only then can anyone be checked in
    await expect(page.getByPlaceholder(/enter student uid/i)).toBeEnabled()
  })

  test('checks a BH2 student in, then refuses the duplicate and a student from another mess', async ({ page }) => {
    const field = page.getByPlaceholder(/enter student uid/i)
    await field.fill('21000102')
    await page.getByRole('button', { name: /^mark$/i }).click()
    await expect(page.getByTestId('scan-success')).toContainText(/checked in/i)

    await field.fill('21000102')
    await page.getByRole('button', { name: /^mark$/i }).click()
    await expect(page.getByText(/already checked in/i)).toBeVisible()

    await field.fill('21000001') // lives in BH1, not this mess
    await page.getByRole('button', { name: /^mark$/i }).click()
    await expect(page.getByText(/not enrolled in this mess/i)).toBeVisible()
  })

  test('offline: the scan is queued, then syncs by itself when the connection returns', async ({ page, context }) => {
    await context.setOffline(true)
    await page.getByPlaceholder(/enter student uid/i).fill('21000103')
    await page.getByRole('button', { name: /^mark$/i }).click()
    await expect(page.getByText(/saved offline — 21000103/i)).toBeVisible()
    await expect(page.getByTestId('offline-queue')).toContainText('1 scan waiting to sync')

    await context.setOffline(false)
    await expect(page.getByTestId('offline-queue')).toBeHidden({ timeout: 20_000 })
    await expect(page.getByText('21000103').first()).toBeVisible() // now in "Checked in today"
  })
})

test.describe('roster management (real browser → real API)', () => {
  test('Students CSV import is real: good rows land, bad rows are reported by line, and capacity/duplicates are enforced', async ({ page, request }) => {
    await signIn(page, ADMIN_BH2)
    await page.goto('/students')
    await page.setInputFiles('input[type=file]', {
      name: 'students.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('name,email,room\nE2E Import One,e2e.import.one@example.com,Z-1\nBad Email Person,not-an-email,Z-2\nE2E Import One,e2e.import.one@example.com,Z-3\n'),
    })
    const banner = page.getByTestId('import-result')
    await expect(banner).toContainText('Imported 1 student · 2 rows rejected.')
    await expect(banner).toContainText('Line 3:')
    await expect(banner).toContainText(/Line 4: .*already exists/)
    // …and it genuinely persisted server-side (the table is paged, so check the API rather than the page).
    const token = await apiToken(request, ADMIN_BH2)
    const found = await (await request.get(`${API}/students?search=E2E%20Import%20One`, { headers: { Authorization: `Bearer ${token}` } })).json()
    expect(found).toHaveLength(1)
    expect(found[0].hostelId).toBe('BH2') // defaulted to the importing admin's own hostel
  })

  test('Admin adds staff, is shown the real one-time password, and the new person is FORCED to replace it before doing anything', async ({ page, browser }) => {
    await signIn(page, ADMIN_BH2)
    await page.goto('/staff')
    await page.getByRole('button', { name: /add staff member/i }).click()
    const dialog = page.getByRole('dialog', { name: /add staff member/i })
    await dialog.getByPlaceholder('Full name').fill('E2E New Cook')
    await dialog.getByRole('button', { name: /add to team/i }).click()
    const creds = page.getByTestId('credentials-list')
    await expect(creds).toBeVisible()
    const text = (await creds.innerText()).replace(/\s+/g, ' ')
    const uid = text.match(/UID: (\d+)/)![1]
    const temp = text.match(/Password: (\S+)/)![1]
    expect(temp).not.toBe('demo1234')

    // the newcomer signs in with the temporary password…
    const ctx = await browser.newContext()
    const other = await ctx.newPage()
    await other.goto('/login')
    await other.getByPlaceholder(/e\.g\. 21000001/i).fill(uid)
    await other.getByPlaceholder('••••••••').fill(temp)
    await other.getByRole('button', { name: /^sign in$/i }).click()
    await expect(other).toHaveURL(/\/change-password/)
    await expect(other.getByText(/choose your own password/i)).toBeVisible()

    // …and cannot reach anything else, however they try
    for (const path of ['/dashboard', '/kitchen', '/attendance', '/profile']) {
      await other.goto(path)
      await expect(other).toHaveURL(/\/change-password/)
    }
    // the API itself refuses too, not just the UI
    const blocked = await ctx.request.get(`${API}/attendance?messId=MESS-BH2`)
    expect(blocked.status()).toBe(403)
    expect((await blocked.json()).code).toBe('PASSWORD_CHANGE_REQUIRED')

    // bad attempts are rejected with reasons; the right one lets them in
    await other.getByLabel('Current password', { exact: true }).fill(temp)
    await other.getByLabel('New password', { exact: true }).fill('password1')
    await other.getByLabel('Confirm new password', { exact: true }).fill('password1')
    await other.getByRole('button', { name: /save and continue/i }).click()
    await expect(other.getByRole('alert')).toContainText(/too common/i)
    await other.getByLabel('New password', { exact: true }).fill('Cook-Harbour-Granite-52')
    await other.getByLabel('Confirm new password', { exact: true }).fill('Cook-Harbour-Granite-52')
    await other.getByRole('button', { name: /save and continue/i }).click()
    await expect(other).not.toHaveURL(/\/change-password/)
    await expect(other.getByRole('button', { name: /account menu/i })).toBeVisible()

    // the temporary password is dead; the chosen one works; and it persists across a reload
    expect((await ctx.request.post(`${API}/auth/login`, { data: { identifier: uid, password: temp } })).status()).toBe(401)
    await other.reload()
    await expect(other.getByRole('button', { name: /account menu/i })).toBeVisible()
    const again = await browser.newPage()
    await signIn(again, uid, 'Cook-Harbour-Granite-52')
    await again.close()
    await ctx.close()
  })
})

test.describe('student registration — UID only, code goes to the email on file', () => {
  test('a student on the mess signs up with just a UID; one who has not taken mess is sent to the warden office', async ({ page, request }) => {
    const superToken = await apiToken(request, '10001')
    const uid = '21000110'
    const student = await (await request.get(`${API}/students/${uid}`, { headers: { Authorization: `Bearer ${superToken}` } })).json()

    // Not on the mess roster: told so, cannot continue.
    await page.goto('/register')
    await page.getByPlaceholder(/e\.g\. 21000001/i).fill('29999999')
    await expect(page.getByRole('alert')).toContainText("You haven't taken mess. For any query, visit the warden office.")
    await expect(page.getByRole('button', { name: /send verification code/i })).toBeDisabled()

    // On the mess: nothing to type but the UID, then the code, then a password.
    await page.getByPlaceholder(/e\.g\. 21000001/i).fill(uid)
    await expect(page.getByText(/you're on the mess/i)).toBeVisible()
    await expect(page.getByText(student.name)).toHaveCount(0) // the real name is not shown before the inbox is proven
    await page.getByRole('button', { name: /send verification code/i }).click()

    const real = await emailedCode(student.email)
    await page.getByPlaceholder('000000').fill(real === '000000' ? '111111' : '000000')
    await page.getByRole('button', { name: /^verify$/i }).click()
    await expect(page.getByText(/incorrect or has expired/i)).toBeVisible()

    await page.getByPlaceholder('000000').fill(real)
    await page.getByRole('button', { name: /^verify$/i }).click()
    await expect(page.getByText(new RegExp(`welcome, ${student.name}`, 'i'))).toBeVisible()
    await page.locator('input[name=password]').fill('password1')
    await page.locator('input[name=confirmPassword]').fill('password1')
    await page.getByRole('button', { name: /create account/i }).click()
    await expect(page).toHaveURL(/\/dashboard/)
  })
})
