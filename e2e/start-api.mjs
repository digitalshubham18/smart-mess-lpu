// Boots the real API for the e2e run on a brand-new throwaway database + outbox.
// (Playwright starts web servers BEFORE globalSetup, so the reset has to live here.)
import fs from 'node:fs'
import path from 'node:path'

const dir = path.resolve('e2e/.tmp')
fs.rmSync(dir, { recursive: true, force: true })
fs.mkdirSync(dir, { recursive: true })
await import('../server/src/index.js')
