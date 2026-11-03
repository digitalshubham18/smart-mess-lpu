import { chromium } from '@playwright/test'
const BASE = process.env.BASE_URL ?? 'http://localhost:8080' // the built site served the way production serves it (nginx + CSP)
const ROUTES = ['/dashboard','/college-overview','/forecast','/forecast-accuracy','/meal-intention','/attendance','/meals','/menu-planner','/food-waste','/waste-analytics','/inventory','/inventory-forecast','/suppliers','/procurement','/students','/hostels','/messes','/staff','/leaderboard','/audit-log','/feedback','/notifications','/kitchen','/reports','/sustainability','/simulator','/scenarios','/calendar','/finance','/settings','/profile']
const ROLES = [['Super Admin','10001'],['Admin BH2','10007'],['Kitchen BH2','10009'],['Student','21000020']]
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] })
let totalPages = 0, failures = []
for (const [label, uid] of ROLES) {
  const ctx = await browser.newContext(); const page = await ctx.newPage()
  const csp = [], errors = []
  await page.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ← ${e.blockedURI || 'inline'}`)) })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0,120)}`))
  page.on('console', (m) => { const t = m.text(); if (m.type()==='error' && /content security policy|refused to/i.test(t)) csp.push(t.slice(0,160)) })
  await page.goto(BASE + '/login')
  await page.getByPlaceholder(/e\.g\. 21000001/i).fill(uid)
  await page.getByPlaceholder('••••••••').fill(uid==='21000020' ? 'password1' : 'demo1234')
  await page.getByRole('button', { name: /^sign in$/i }).click()
  try { await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 8000 }) } catch { failures.push(`${label}: login did not complete`); await ctx.close(); continue }
  let visited = 0
  for (const r of ROUTES) {
    await page.goto(BASE + r, { waitUntil: 'load' }).catch(()=>{})
    await page.waitForTimeout(250); visited++; totalPages++
    const v = await page.evaluate(() => window.__csp).catch(()=>[])
    for (const x of v) csp.push(`${r}: ${x}`)
    const blank = await page.evaluate(() => document.body.innerText.trim().length < 5).catch(()=>false)
    if (blank) errors.push(`${r}: rendered blank`)
  }
  const uniq = [...new Set(csp)]
  console.log(`${errors.length||uniq.length ? 'FAIL' : 'PASS'}  ${label.padEnd(12)} ${visited} pages — CSP violations: ${uniq.length}, JS errors/blank pages: ${errors.length}`)
  uniq.slice(0,5).forEach(x=>console.log('      CSP:',x)); [...new Set(errors)].slice(0,5).forEach(x=>console.log('      ERR:',x))
  if (uniq.length||errors.length) failures.push(label)
  await ctx.close()
}
await browser.close()
console.log(`\n${totalPages} page loads through nginx under the production CSP; roles with problems: ${failures.length ? failures.join(', ') : 'none'}`)
