import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { startTestServer } from '../test-support/harness.js'

/**
 * Hardening and counter conveniences around the meal scan: single-use QR, revocable printed ID cards, a trail of suspicious
 * scans, unusual-volume alerts, leave warnings, opt-in check-in emails, live counts, and meals that run past midnight.
 */
let t, student, messId, studentToken, kitchen, manager, warden, mw, emailLib
const checkin = (body, token = kitchen) => t.api('/attendance/checkin', { token, body })
const getQr = async (token = studentToken) => (await t.api('/attendance/my-qr', { token })).body.token
const clear = () => { t.db.prepare('DELETE FROM attendance').run(); t.db.prepare('DELETE FROM used_qr').run() }
const audits = (action) => t.db.prepare('SELECT * FROM audit_log WHERE action = ? ORDER BY rowid').all(action)

function at(hhmm, daysBack = 0) {
  const today = mw.localParts().date
  let instant = Date.parse(`${today}T${hhmm}:00+05:30`) - daysBack * 86_400_000
  if (instant > Date.now() - 60_000) instant -= 86_400_000
  return { scannedAt: new Date(instant).toISOString(), local: mw.localParts(new Date(instant)) }
}
const lunch = () => { const a = at('13:00'); return { scannedAt: a.scannedAt, date: a.local.date, meal: 'lunch', messId } }

before(async () => {
  t = await startTestServer()
  mw = await import('../src/mealWindows.js')
  emailLib = await import('../src/email.js')
  student = t.db.prepare('SELECT id, hostel_id, name, email FROM students WHERE password_hash IS NOT NULL ORDER BY id LIMIT 1').get()
  messId = t.db.prepare('SELECT id FROM messes WHERE hostel_id = ?').get(student.hostel_id).id
  studentToken = await t.login(student.id)
  kitchen = await t.staffToken('KITCHEN_STAFF', student.hostel_id)
  manager = await t.staffToken('MESS_MANAGER', student.hostel_id)
  warden = await t.staffToken('HOSTEL_WARDEN', student.hostel_id)
})
after(() => t.close())

test('a live QR works exactly once: its id is burned by the check-in that used it, and a replay is refused and recorded', async () => {
  clear()
  const qr = await getQr()
  const jti = JSON.parse(Buffer.from(qr.split('.')[1], 'base64url')).jti
  assert.equal((await checkin({ ...lunch(), qr })).status, 201)
  assert.ok(t.db.prepare('SELECT 1 FROM used_qr WHERE jti = ?').get(jti), 'burned')
  // the same QR for a meal the student has NOT had yet is refused as already used (it can't check anyone in twice)
  const dinner = at('20:00')
  const replay = await checkin({ qr, messId, meal: 'dinner', scannedAt: dinner.scannedAt, date: dinner.local.date })
  assert.equal(replay.status, 409)
  assert.equal(replay.body.code, 'QR_ALREADY_USED')
  assert.equal(t.db.prepare("SELECT COUNT(*) n FROM attendance WHERE meal = 'dinner'").get().n, 0)
  assert.ok(audits('checkin_refused').some((a) => /QR_ALREADY_USED/.test(a.summary)))
})

test('a refused scan does NOT burn the QR — only a successful check-in does', async () => {
  clear()
  const qr = await getQr()
  process.env.ENFORCE_MEAL_WINDOWS = '1'
  try {
    const early = at('11:00')
    assert.equal((await checkin({ qr, messId, meal: 'lunch', scannedAt: early.scannedAt, date: early.local.date })).status, 409) // outside lunch time
    assert.equal(t.db.prepare('SELECT COUNT(*) n FROM used_qr').get().n, 0)
    assert.equal((await checkin({ ...lunch(), qr })).status, 201, 'the same QR still works for a valid scan')
  } finally { process.env.ENFORCE_MEAL_WINDOWS = '0' }
})

test('two counters scanning the same QR at the same instant: exactly one check-in is recorded', async () => {
  clear()
  const qr = await getQr()
  const kitchen2 = await t.staffToken('MESS_MANAGER', student.hostel_id)
  const [a, b] = await Promise.all([checkin({ ...lunch(), qr }), checkin({ ...lunch(), qr }, kitchen2)])
  assert.deepEqual([a.status, b.status].sort(), [201, 409])
  assert.equal(t.db.prepare('SELECT COUNT(*) n FROM attendance').get().n, 1)
})

test('suspicious scans leave a trail a manager can read: forged QR, wrong mess, inactive, revoked card — but a merely expired QR does not', async () => {
  clear()
  const base = lunch()
  await checkin({ ...base, qr: `${student.id}${student.id}` })
  const jwt = (await import('jsonwebtoken')).default
  await checkin({ ...base, qr: jwt.sign({ sub: student.id, purpose: 'meal-qr', jti: 'e' }, 'test-secret', { expiresIn: -5 }) }) // expired: ordinary, not logged
  t.db.prepare("UPDATE students SET status = 'inactive' WHERE id = ?").run(student.id)
  await checkin({ ...base, qr: await getQr() })
  t.db.prepare("UPDATE students SET status = 'active' WHERE id = ?").run(student.id)

  const alerts = await t.api(`/attendance/alerts?messId=${messId}`, { token: manager })
  assert.equal(alerts.status, 200)
  const text = alerts.body.map((a) => a.summary).join('\n')
  assert.match(text, /unrecognised QR.*QR_INVALID/)
  assert.ok(text.includes(`${student.name} (${student.id}): MESS_INACTIVE`))
  assert.doesNotMatch(text, /QR_EXPIRED/)
  assert.ok(alerts.body.every((a) => a.action === 'checkin_refused'))
  assert.equal((await t.api(`/attendance/alerts?messId=${messId}`, { token: kitchen })).status, 403, 'counter staff cannot read the alerts about themselves')
  const other = await t.staffToken('MESS_MANAGER', student.hostel_id === 'BH5' ? 'BH4' : 'BH5')
  assert.equal((await t.api(`/attendance/alerts?messId=${messId}`, { token: other })).status, 403)
  assert.equal((await t.api('/attendance/alerts', { token: manager })).status, 400)
})

test('unusual volume from one counter raises ONE alert: a burst of scans, or a run of typed UIDs', async () => {
  const ids = t.db.prepare('SELECT id FROM students WHERE hostel_id = ? ORDER BY id LIMIT 8').all(student.hostel_id).map((r) => r.id)
  const day = mw.localParts().date
  const reset = () => { clear(); t.db.prepare("DELETE FROM audit_log WHERE action = 'checkin_spike'").run() }

  // (a) plain volume: 4 check-ins in 2 minutes against a limit of 3 (typed-UID limit set out of the way)
  reset()
  process.env.SCAN_SPIKE_PER_2MIN = '3'; process.env.SCAN_SPIKE_MANUAL_PER_5MIN = '999'
  try {
    for (const id of ids.slice(0, 5)) assert.equal((await checkin({ uid: id, messId, meal: 'lunch', date: day })).status, 201)
    const spikes = audits('checkin_spike')
    assert.equal(spikes.length, 1, 'one alert, not one per scan')
    assert.match(spikes[0].summary, /4 check-ins in 2 minutes/)
    assert.equal(spikes[0].mess_id, messId)
    assert.ok((await t.api(`/attendance/alerts?messId=${messId}`, { token: manager })).body.some((a) => a.action === 'checkin_spike'))
  } finally { delete process.env.SCAN_SPIKE_PER_2MIN; delete process.env.SCAN_SPIKE_MANUAL_PER_5MIN }

  // (b) typed UIDs are the weaker path, so they have a lower limit of their own
  reset()
  process.env.SCAN_SPIKE_PER_2MIN = '999'; process.env.SCAN_SPIKE_MANUAL_PER_5MIN = '2'
  try {
    for (const id of ids.slice(0, 4)) await checkin({ uid: id, messId, meal: 'lunch', date: day })
    const spikes = audits('checkin_spike')
    assert.equal(spikes.length, 1)
    assert.match(spikes[0].summary, /3 typed-UID check-ins in 5 minutes/)
  } finally { delete process.env.SCAN_SPIKE_PER_2MIN; delete process.env.SCAN_SPIKE_MANUAL_PER_5MIN }

  // (c) the same volume by QR does not trip the typed-UID limit
  reset()
  process.env.SCAN_SPIKE_PER_2MIN = '999'; process.env.SCAN_SPIKE_MANUAL_PER_5MIN = '2'
  try {
    for (let i = 0; i < 4; i++) { clear(); await checkin({ ...lunch(), qr: await getQr() }) }
    assert.equal(audits('checkin_spike').length, 0)
  } finally { delete process.env.SCAN_SPIKE_PER_2MIN; delete process.env.SCAN_SPIKE_MANUAL_PER_5MIN }
})

test('offline-synced scans (old timestamps) never trigger a volume alert', async () => {
  clear()
  process.env.SCAN_SPIKE_PER_2MIN = '1'
  t.db.prepare("DELETE FROM audit_log WHERE action = 'checkin_spike'").run()
  try {
    const ids = t.db.prepare('SELECT id FROM students WHERE hostel_id = ? ORDER BY id LIMIT 4').all(student.hostel_id).map((r) => r.id)
    const a = at('13:00')
    for (const id of ids) assert.equal((await checkin({ uid: id, messId, meal: 'lunch', date: a.local.date, scannedAt: a.scannedAt })).status, 201)
    assert.equal(audits('checkin_spike').length, 0)
  } finally { delete process.env.SCAN_SPIKE_PER_2MIN }
})

test('a student on approved leave is still checked in, but the counter is told to look at who is standing there', async () => {
  clear()
  const base = lunch()
  const until = new Date(Date.parse(base.date) + 5 * 86_400_000).toISOString().slice(0, 10)
  t.db.prepare('UPDATE students SET leave_until = ? WHERE id = ?').run(until, student.id)
  const r = await checkin({ ...base, qr: await getQr() })
  t.db.prepare('UPDATE students SET leave_until = NULL WHERE id = ?').run(student.id)
  assert.equal(r.status, 201)
  assert.equal(r.body.onLeave, true)
  assert.equal(r.body.leaveUntil, until)
  assert.match(t.db.prepare("SELECT summary FROM audit_log WHERE action = 'meal_checked_in' ORDER BY rowid DESC LIMIT 1").get().summary, /while on approved leave/)
  clear()
  assert.equal((await checkin({ ...base, qr: await getQr() })).body.onLeave, false)
})

test('check-in emails are opt-in: off by default, and when on the student is told what happened', async () => {
  clear()
  const sent = () => emailLib.getSentEmails().filter((e) => /check-in recorded/i.test(e.subject) && e.to === student.email)
  const before = sent().length
  assert.equal((await t.api('/attendance/my-notifications', { token: studentToken })).body.checkinEmail, false)
  assert.equal((await checkin({ ...lunch(), qr: await getQr() })).status, 201)
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(sent().length, before, 'no email unless the student asked for one')

  clear()
  assert.equal((await t.api('/attendance/my-notifications', { token: studentToken, method: 'PUT', body: { checkinEmail: true } })).body.checkinEmail, true)
  assert.equal((await checkin({ uid: student.id, ...lunch() })).status, 201)
  await new Promise((r) => setTimeout(r, 80))
  const mail = sent().slice(before)
  assert.equal(mail.length, 1)
  assert.match(mail[0].text, /checked in for lunch/i)
  assert.match(mail[0].text, /counter staff typed in your UID/i)
  assert.match(mail[0].text, /wasn't you/i)
  assert.equal((await t.api('/attendance/my-notifications', { token: studentToken, method: 'PUT', body: { checkinEmail: 'yes' } })).status, 400)
  assert.equal((await t.api('/attendance/my-notifications', { token: kitchen })).status, 403)
})

test('printed ID card: staff issue it, it checks the student in without a phone, and reissuing kills the old one at once', async () => {
  clear()
  const a = await t.api('/students', { token: warden, body: { name: 'Card Holder', email: 'cardholder@example.com', hostelId: student.hostel_id, noUid: true, noUidReason: 'new admission' } })
  assert.equal(a.status, 201)
  const tmp = a.body.id
  assert.match(tmp, /^TMP-/)
  assert.equal((await t.api(`/students/${tmp}/id-card`, { token: studentToken, body: {} })).status, 403)
  assert.equal((await t.api(`/students/${tmp}/id-card`, { token: kitchen, body: {} })).status, 403)
  const card = await t.api(`/students/${tmp}/id-card`, { token: warden, body: {} })
  assert.equal(card.status, 200)
  assert.equal(card.body.provisional, true)
  assert.ok(card.body.token.split('.').length === 3 && !card.body.token.includes(tmp))

  const b = lunch()
  const scan = await checkin({ ...b, qr: card.body.token })
  assert.equal(scan.status, 201)
  assert.equal(scan.body.method, 'card')
  assert.equal(scan.body.studentId, tmp)
  // a printed card is reusable (unlike a live QR): next meal, same card
  const dn = at('20:00')
  assert.equal((await checkin({ qr: card.body.token, messId, meal: 'dinner', scannedAt: dn.scannedAt, date: dn.local.date })).status, 201)
  // asking again returns the same card; reissue replaces it
  const again = await t.api(`/students/${tmp}/id-card`, { token: warden, body: {} })
  assert.equal(again.body.reissued, false)
  const fresh = await t.api(`/students/${tmp}/id-card`, { token: warden, body: { reissue: true } })
  assert.equal(fresh.body.reissued, true)
  clear()
  const old = await checkin({ ...b, qr: card.body.token })
  assert.equal(old.status, 404)
  assert.equal(old.body.code, 'CARD_REVOKED')
  assert.ok(audits('checkin_refused').some((x) => /CARD_REVOKED/.test(x.summary)))
  assert.equal((await checkin({ ...b, qr: fresh.body.token })).status, 201)

  // when the real UID arrives the same printed card keeps working (it names a card id, not the TMP id)
  assert.equal((await t.api(`/students/${tmp}/assign-uid`, { token: warden, body: { uid: '88888801' } })).status, 200)
  clear()
  const after = await checkin({ ...b, qr: fresh.body.token })
  assert.equal(after.status, 201)
  assert.equal(after.body.studentId, '88888801')
  assert.ok(audits('id_card_issued').length >= 1 && audits('id_card_reissued').length === 1)
  // the other mess's warden cannot issue cards for this student
  const otherWarden = await t.staffToken('HOSTEL_WARDEN', student.hostel_id === 'BH5' ? 'BH4' : 'BH5')
  assert.equal((await t.api('/students/88888801/id-card', { token: otherWarden, body: {} })).status, 403)
})

test('live counts for the counter: checked in, who said they would eat, and who has not answered', async () => {
  clear()
  const day = lunch().date
  const ids = t.db.prepare('SELECT id FROM students WHERE hostel_id = ? ORDER BY id LIMIT 6').all(student.hostel_id).map((r) => r.id)
  ids.slice(0, 4).forEach((id) => t.setIntentionDirect(id, day, 'lunch', 'will_eat'))
  t.setIntentionDirect(ids[4], day, 'lunch', 'will_not')
  await checkin({ ...lunch(), qr: await getQr() })
  await checkin({ uid: ids[1], ...lunch() })
  const r = await t.api(`/attendance/summary?messId=${messId}&date=${day}&meal=lunch`, { token: kitchen })
  assert.equal(r.status, 200)
  assert.equal(r.body.checkedIn, 2)
  assert.equal(r.body.manual, 1)
  assert.equal(r.body.willEat, 4)
  assert.equal(r.body.willNot, 1)
  assert.equal(r.body.noResponse, r.body.eligible - 5)
  assert.ok(r.body.eligible >= 6)
  assert.equal((await t.api(`/attendance/summary?messId=${messId}&date=${day}`, { token: kitchen })).status, 400)
  assert.equal((await t.api(`/attendance/summary?messId=${messId}&date=${day}&meal=lunch`, { token: studentToken })).status, 403)
})

test('a meal that runs past midnight: open before AND after 00:00, and a post-midnight scan belongs to the previous day', async () => {
  process.env.ENFORCE_MEAL_WINDOWS = '1'
  try {
    const set = await t.api('/attendance/meal-windows', { token: manager, method: 'PUT', body: { messId, windows: [{ meal: 'dinner', start: '22:00', end: '01:00' }, { meal: 'snacks', start: '16:30', end: '18:00' }] } })
    assert.equal(set.status, 200)
    const dinner = set.body.windows.find((w) => w.meal === 'dinner')
    assert.equal(dinner.crossesMidnight, true)

    clear()
    const late = at('23:30')
    const lateOk = await checkin({ qr: await getQr(), messId, meal: 'dinner', scannedAt: late.scannedAt, date: late.local.date })
    assert.equal(lateOk.status, 201, 'before midnight: same calendar date')

    clear()
    const post = at('00:30')
    const prevDay = mw.addDays(post.local.date, -1)
    const wrong = await checkin({ qr: await getQr(), messId, meal: 'dinner', scannedAt: post.scannedAt, date: post.local.date })
    assert.equal(wrong.status, 400)
    assert.equal(wrong.body.code, 'DATE_MISMATCH')
    assert.match(wrong.body.error, new RegExp(prevDay))
    const right = await checkin({ qr: await getQr(), messId, meal: 'dinner', scannedAt: post.scannedAt, date: prevDay })
    assert.equal(right.status, 201, 'after midnight it is still last evening\'s dinner')
    assert.equal(t.db.prepare("SELECT date FROM attendance WHERE meal = 'dinner'").get().date, prevDay)

    clear()
    const closed = at('02:00')
    const no = await checkin({ qr: await getQr(), messId, meal: 'dinner', scannedAt: closed.scannedAt, date: closed.local.date })
    assert.equal(no.status, 409)
    assert.equal(no.body.code, 'OUTSIDE_MEAL_WINDOW')

    // the snapshot tells the console which date to send
    const snap = await t.api(`/attendance/meal-windows?messId=${messId}`, { token: kitchen })
    assert.match(snap.body.windows.find((w) => w.meal === 'dinner').date, /^\d{4}-\d{2}-\d{2}$/)
  } finally {
    process.env.ENFORCE_MEAL_WINDOWS = '0'
    await t.api('/attendance/meal-windows', { token: manager, method: 'PUT', body: { messId, reset: true } })
  }
})

test('overlap detection understands wrap-around, and rejects zero-length windows', async () => {
  const ok = { breakfast: { start: 420, end: 570 }, lunch: { start: 720, end: 870 }, snacks: { start: 990, end: 1080 }, dinner: { start: 1320, end: 60 } }
  assert.equal(mw.findOverlap(ok), null)
  assert.deepEqual(mw.findOverlap({ ...ok, breakfast: { start: 30, end: 570 } }), ['breakfast', 'dinner'] , 'dinner runs to 01:00, so a 00:30 breakfast clashes')
  const bad = await t.api('/attendance/meal-windows', { token: manager, method: 'PUT', body: { messId, windows: [{ meal: 'lunch', start: '13:00', end: '13:00' }] } })
  assert.equal(bad.status, 400)
  assert.equal(bad.body.code, 'BAD_WINDOW')
})
