import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SMTPServer } from 'smtp-server'
import { simpleParser } from 'mailparser'

/**
 * The SMTP path, against REAL SMTP servers (smtp-server, in-process) and a REAL API process — nothing mocked.
 * Covers: delivery + headers, AUTH, a dead server, a black-holed server (accepts TCP, never speaks), and the
 * failure behaviour of every kind of email the app sends.
 */
const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let portSeq = 2700

function startSmtp({ auth = false } = {}) {
  const inbox = []
  const server = new SMTPServer({
    authOptional: !auth, allowInsecureAuth: true, disabledCommands: ['STARTTLS'],
    onAuth(a, _s, cb) { a.username === 'mailer' && a.password === 's3cret' ? cb(null, { user: 'mailer' }) : cb(new Error('Invalid login')) },
    onData(stream, _s, cb) { simpleParser(stream).then((m) => { inbox.push(m); cb() }).catch(cb) },
  })
  const port = portSeq++
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ inbox, port, close: () => new Promise((r) => server.close(r)) })))
}

async function startApi(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartmess-mail-'))
  const port = 4900 + Math.floor(Math.random() * 400)
  const child = spawn('node', ['src/index.js'], { cwd: SERVER_DIR, env: { ...process.env, PORT: String(port), DB_PATH: path.join(dir, 'd.sqlite'), OUTBOX_DIR: path.join(dir, 'o'), JWT_SECRET: 't', REQUIRE_2FA_ROLES: '', SCHEDULER: '0', SMTP_FROM: 'Smart Mess <mess@lpu.example>', ...env }, stdio: 'ignore' })
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break } catch { /* booting */ } await sleep(250) }
  const api = async (p, { token, body, timeout = 60000 } = {}) => {
    const t0 = Date.now()
    const res = await fetch(`http://127.0.0.1:${port}/api${p}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout) })
    return { status: res.status, body: await res.json().catch(() => null), ms: Date.now() - t0 }
  }
  const admin = async () => (await api('/auth/login', { body: { identifier: '10001', password: 'demo1234' } })).body.token
  return { api, admin, base: `http://127.0.0.1:${port}/api`, stop: () => { child.kill(); fs.rmSync(dir, { recursive: true, force: true }) } }
}
const waitFor = async (fn, ms = 5000) => { for (let t = 0; t < ms; t += 100) { const v = fn(); if (v) return v; await sleep(100) } return null }

test('smtp: a verification code is really delivered, with the right From / To / Subject and a usable code', async () => {
  const smtp = await startSmtp()
  const app = await startApi({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port) })
  try {
    const r = await app.api('/auth/send-otp', { body: { email: 'Student@Example.com' } })
    assert.equal(r.status, 200)
    const mail = await waitFor(() => smtp.inbox.at(-1))
    assert.ok(mail, 'the SMTP server received a message')
    assert.equal(mail.to.value[0].address, 'student@example.com')
    assert.equal(mail.from.value[0].address, 'mess@lpu.example')
    assert.equal(mail.from.value[0].name, 'Smart Mess')
    assert.match(mail.subject, /verification code/)
    const code = mail.text.match(/code is (\d{6})/)?.[1]
    assert.ok(code)
    assert.equal((await app.api('/auth/verify-otp', { body: { email: 'student@example.com', code } })).status, 200, 'the emailed code is the real one')
  } finally { app.stop(); await smtp.close() }
})

test('smtp: header-injection attempts in user-controlled fields do not create extra recipients or headers', async () => {
  const smtp = await startSmtp()
  const app = await startApi({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port) })
  try {
    const token = await app.admin()
    const evil = await app.api('/staff', { token, body: { name: 'Eve\r\nBcc: attacker@evil.example', role: 'KITCHEN_STAFF', hostelId: 'BH2', email: 'eve@example.com' } })
    await sleep(500)
    const mails = smtp.inbox.filter((m) => /eve/i.test(m.to?.text ?? ''))
    for (const m of mails) {
      assert.ok(!JSON.stringify(m.headers ? [...m.headers.keys()] : []).includes('bcc'), 'no injected Bcc header')
      assert.ok(!(m.bcc || m.to?.text?.includes('attacker@evil.example')), 'no injected recipient')
    }
    assert.ok([201, 400].includes(evil.status))
  } finally { app.stop(); await smtp.close() }
})

test('smtp: AUTH — correct credentials deliver; wrong credentials fail cleanly (503, no code left behind, password never logged)', async () => {
  const smtp = await startSmtp({ auth: true })
  const good = await startApi({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), SMTP_USER: 'mailer', SMTP_PASS: 's3cret' })
  try {
    assert.equal((await good.api('/auth/send-otp', { body: { email: 'a@example.com' } })).status, 200)
    assert.ok(await waitFor(() => smtp.inbox.length === 1))
  } finally { good.stop() }
  const bad = await startApi({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), SMTP_USER: 'mailer', SMTP_PASS: 'WRONG-PASSWORD-123' })
  try {
    const r = await bad.api('/auth/send-otp', { body: { email: 'b@example.com' } })
    assert.equal(r.status, 503)
    assert.equal(r.body.code, 'EMAIL_UNAVAILABLE')
    assert.ok(!JSON.stringify(r.body).includes('WRONG-PASSWORD'), 'credentials never reach the client')
    assert.equal(smtp.inbox.length, 1, 'nothing was delivered with bad credentials')
    // and the unusable code was not left behind to be "verified"
    assert.equal((await bad.api('/auth/verify-otp', { body: { email: 'b@example.com', code: '123456' } })).status, 400)
  } finally { bad.stop(); await smtp.close() }
})

test('smtp DOWN: sending a verification code is a clear 503 — fast, not a 500 and not a hang', async () => {
  const app = await startApi({ SMTP_HOST: '127.0.0.1', SMTP_PORT: '2599' }) // nothing listening
  try {
    const r = await app.api('/auth/send-otp', { body: { email: 'student@example.com' } })
    assert.equal(r.status, 503)
    assert.equal(r.body.code, 'EMAIL_UNAVAILABLE')
    assert.match(r.body.error, /couldn't send the verification email/i)
    assert.ok(r.ms < 3000, `${r.ms}ms`)
  } finally { app.stop() }
})

test('smtp DOWN: creating staff / parent access / resetting a password still succeed and hand back the one-time password (emailSent:false)', async () => {
  const app = await startApi({ SMTP_HOST: '127.0.0.1', SMTP_PORT: '2599' })
  try {
    const token = await app.admin()
    const staff = await app.api('/staff', { token, body: { name: 'Mail Down Hire', role: 'KITCHEN_STAFF', hostelId: 'BH2' } })
    assert.equal(staff.status, 201, 'a 5xx here would lose the only copy of the password')
    assert.ok(staff.body.tempPassword)
    assert.equal(staff.body.emailSent, false)
    assert.equal((await app.api('/auth/login', { body: { identifier: staff.body.id, password: staff.body.tempPassword } })).status, 200, 'the returned password really works')

    const parent = await app.api('/staff/parent-access/21000101', { token, body: {} })
    assert.equal(parent.status, 201)
    assert.ok(parent.body.tempPassword)
    assert.equal(parent.body.emailSent, false)

    const reset = await app.api(`/staff/${staff.body.id}/reset-password`, { token, body: {} })
    assert.equal(reset.status, 200)
    assert.ok(reset.body.tempPassword)
    assert.equal(reset.body.emailSent, false)
  } finally { app.stop() }
})

test('smtp UP: the same calls report emailSent:true and the credential email arrives', async () => {
  const smtp = await startSmtp()
  const app = await startApi({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port) })
  try {
    const token = await app.admin()
    const staff = await app.api('/staff', { token, body: { name: 'Mail Up Hire', role: 'MESS_MANAGER', hostelId: 'BH2', email: 'hire@example.com' } })
    assert.equal(staff.body.emailSent, true)
    const mail = await waitFor(() => smtp.inbox.find((m) => /staff account/.test(m.subject)))
    assert.ok(mail.text.includes(staff.body.tempPassword))
  } finally { app.stop(); await smtp.close() }
})

test('smtp BLACK HOLE (accepts the connection, never answers): fails within seconds, not the 30s–10min of nodemailer\'s defaults', async () => {
  const hole = net.createServer((s) => s.on('error', () => {})).listen(2688, '127.0.0.1')
  const app = await startApi({ SMTP_HOST: '127.0.0.1', SMTP_PORT: '2688', SMTP_TIMEOUT_MS: '2000' })
  try {
    const r = await app.api('/auth/send-otp', { body: { email: 'student@example.com' }, timeout: 20000 })
    assert.equal(r.status, 503)
    assert.ok(r.ms < 6000, `took ${r.ms}ms`)
  } finally { app.stop(); hole.close() }
})

test('password-reset request is NOT an account-enumeration oracle — same status, same body, same speed — even when mail is down or black-holed', async () => {
  for (const [label, env, setup] of [
    ['mail down', { SMTP_HOST: '127.0.0.1', SMTP_PORT: '2599' }],
    ['mail black-holed', { SMTP_HOST: '127.0.0.1', SMTP_PORT: '2689', SMTP_TIMEOUT_MS: '3000' }, () => net.createServer((s) => s.on('error', () => {})).listen(2689, '127.0.0.1')],
  ]) {
    const hole = setup?.()
    const app = await startApi(env)
    try {
      const real = await app.api('/auth/request-password-reset', { body: { identifier: '10001' } })
      const fake = await app.api('/auth/request-password-reset', { body: { identifier: '99999999' } })
      assert.equal(real.status, fake.status, `${label}: status differs (${real.status} vs ${fake.status})`)
      assert.deepEqual(real.body, fake.body, `${label}: body differs`)
      assert.ok(real.ms < 1500 && fake.ms < 1500, `${label}: ${real.ms}ms vs ${fake.ms}ms — latency would leak existence`)
    } finally { app.stop(); hole?.close() }
  }
})

test('password-reset request with a WORKING mail server: the code still arrives (sent in the background) and works', async () => {
  const smtp = await startSmtp()
  const app = await startApi({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port) })
  try {
    const r = await app.api('/auth/request-password-reset', { body: { identifier: '10001' } })
    assert.equal(r.status, 200)
    const mail = await waitFor(() => smtp.inbox.find((m) => /reset code/.test(m.subject)))
    assert.ok(mail, 'the reset email was delivered after the response')
    const code = mail.text.match(/code is (\d{6})/)[1]
    const done = await app.api('/auth/reset-password', { body: { identifier: '10001', code, newPassword: 'brand-new-pw' } })
    assert.equal(done.status, 200)
    assert.equal((await app.api('/auth/login', { body: { identifier: '10001', password: 'brand-new-pw' } })).status, 200)
  } finally { app.stop(); await smtp.close() }
})

test('smtp DOWN: no-show processing still succeeds (student notices are best-effort and never fail the counter\'s request)', async () => {
  const app = await startApi({ SMTP_HOST: '127.0.0.1', SMTP_PORT: '2599' })
  try {
    const token = await app.admin()
    const put = await fetch(`${app.base}/intentions/21000101`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ date: '2099-05-05', meal: 'dinner', status: 'will_eat' }) })
    assert.equal(put.status, 200)
    const r = await app.api('/attendance/process-no-shows', { token, body: { messId: 'MESS-BH2', date: '2099-05-05', meal: 'dinner', fineAmount: 100 } })
    assert.equal(r.status, 200)
    assert.equal(r.body.warningsIssued, 1)
    assert.equal((await app.api('/health')).status, 200, 'and the server is still up')
  } finally { app.stop() }
})
