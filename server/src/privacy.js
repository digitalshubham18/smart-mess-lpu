import { db, logAudit, messIdForHostel } from './db.js'

// Student photos are personal data (India's Digital Personal Data Protection Act, 2023). The rules this file enforces:
//   * a photo is only held with a recorded consent (who / when / how / which notice version);
//   * leaving the mess, or withdrawing consent, ERASES the photo and the consent record;
//   * a daily sweep catches anything the live paths missed (bulk status changes, edits made straight in the database).
// This is a technical mechanism, not legal advice: have your counsel confirm the lawful basis and the wording below.

export const PHOTO_NOTICE_VERSION = '2026-10-v1'

export function photoNotice() {
  const contact = process.env.PRIVACY_CONTACT_EMAIL || 'the warden office'
  return {
    version: PHOTO_NOTICE_VERSION,
    title: 'Your photo at the mess counter',
    points: [
      { heading: 'What we keep', text: 'One photo of you, and a record that you agreed to us keeping it.' },
      { heading: 'Why', text: 'Only so counter staff can see that the person in front of them is the student the QR code belongs to. It is not used for anything else, not shared outside the mess and hostel staff, and not used for face recognition.' },
      { heading: 'Who can see it', text: 'Mess staff and the warden of your own hostel, when you are checked in. Nobody else — not other messes, not other students.' },
      { heading: 'How long', text: 'Until you leave the mess or withdraw your consent, whichever comes first. Then it is deleted automatically. (Encrypted backups that already contain it are overwritten on the normal backup cycle.)' },
      { heading: 'Your choice', text: `Saying no does not affect your meals — you will simply be checked against your ID card instead. You can withdraw at any time under Profile → Privacy, or by asking ${contact}. You may also ask to see, correct or erase your data, or raise a complaint, via ${contact}.` },
      { heading: 'If you are under 18', text: 'A parent or guardian must agree on your behalf.' },
    ],
  }
}

/** Records that consent exists for the photo now held (or about to be). Never overwrites an existing record. */
export function recordPhotoConsent(studentId, { method, by }) {
  db.prepare('UPDATE students SET photo_consent_at = ?, photo_consent_method = ?, photo_consent_by = ?, photo_notice_version = ? WHERE id = ? AND photo_consent_at IS NULL')
    .run(new Date().toISOString(), method, by, PHOTO_NOTICE_VERSION, studentId)
}

/**
 * Deletes the photo AND the consent record. Returns true if there was a photo or a consent to remove. `reason` is
 * written to the audit log so there is evidence the erasure happened (the log records that, never the photo itself).
 */
export function erasePhoto(studentId, { reason, actor } = {}) {
  const row = db.prepare('SELECT id, name, hostel_id, photo_data, photo_consent_at FROM students WHERE id = ?').get(studentId)
  if (!row || (!row.photo_data && !row.photo_consent_at)) return false
  db.prepare('UPDATE students SET photo_data = NULL, photo_consent_at = NULL, photo_consent_method = NULL, photo_consent_by = NULL, photo_notice_version = NULL WHERE id = ?').run(studentId)
  logAudit({
    actorId: actor?.sub ?? 'system', actorName: actor?.name ?? 'Privacy retention', actorRole: actor?.role ?? 'SYSTEM',
    action: 'student_photo_erased', messId: row.hostel_id ? messIdForHostel(row.hostel_id) : undefined,
    summary: `Erased the photo of ${row.name} (${row.id}) — ${reason}`,
  })
  return true
}

/** Safety net: any student who is no longer active must not still have a photo on file. */
export function sweepPhotosOfLeavers() {
  const rows = db.prepare("SELECT id FROM students WHERE status != 'active' AND (photo_data IS NOT NULL OR photo_consent_at IS NOT NULL)").all()
  let erased = 0
  for (const r of rows) if (erasePhoto(r.id, { reason: 'no longer on the mess (retention sweep)' })) erased++
  return erased
}
