import { defineConfig } from '@playwright/test'
import path from 'node:path'

// End-to-end tests drive the REAL app in a real browser: the Vite frontend talking to the real
// Express API on a throwaway SQLite database. Nothing is mocked.
//
//   npx playwright install chromium   # once (CI does this); then:
//   npm run test:e2e
//
// If you can't download Playwright's browser, point at any installed Chrome/Chromium instead:
//   CHROME_PATH=/usr/bin/chromium npm run test:e2e
const API_PORT = 4010
const WEB_PORT = 5183
export const E2E_DB = path.resolve('e2e/.tmp/e2e.sqlite')
export const E2E_OUTBOX = path.resolve('e2e/.tmp/outbox')

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts', // (not *.spec.ts — Vitest would pick those up)
  fullyParallel: false,
  workers: 1, // tests share one database
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] } : {},
  },
  webServer: [
    {
      command: 'node e2e/start-api.mjs',
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { PORT: String(API_PORT), DB_PATH: E2E_DB, OUTBOX_DIR: E2E_OUTBOX, JWT_SECRET: 'e2e-secret', ENFORCE_MEAL_WINDOWS: '0' /* these tests run at any hour; meal timing is covered by the server and component tests */, REQUIRE_2FA_ROLES: '' /* Admin/Super Admin two-factor is mandatory in real life; these tests sign in with a password only (the requirement is covered by server/test/mandatory-2fa.test.js and the UI tests) */, SCHEDULER: '0' /* no background reminders/no-show runs during a browser test */, CORS_ORIGIN: `http://localhost:${WEB_PORT}` },
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_API_URL: `http://localhost:${API_PORT}/api` },
    },
  ],
})
