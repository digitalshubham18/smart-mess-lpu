# Student photos and personal data

*This describes what the software does so you can explain it accurately. It is not legal advice. India's Digital Personal
Data Protection Act, 2023 applies to this data; have your counsel confirm the lawful basis, the notice wording, the
parental-consent arrangement for under-18s, and the retention periods before going live.*

## What is held

For each student, the mess holds a **photo** (so counter staff can match the person to the QR code) and, with it, a
**consent record**: who agreed (the student in the app, or staff who confirm the student/guardian agreed), when, how
(`student_app` / `staff_attested`), and which version of the notice they saw. No consent record means no photo is held.

## The rules the system enforces

| Rule | Where |
|---|---|
| A photo can't be saved unless consent is on record or the person saving it confirms the student (or guardian, if under 18) has seen the notice and agrees. | Students page → photo dialog shows the notice + a confirmation box; the API refuses with `CONSENT_REQUIRED` otherwise. |
| A photo on the **university directory** record is **not** copied onto the roster unless the enrolment request confirms consent (`photoConsent`; bulk CSV rows may carry `photoConsent` = yes/true). The Students page's add-by-UID form does not send it, so there staff add the photo afterwards with the consent box. | Enrolment / bulk import |
| The student can read the notice, give consent, or **withdraw it** — withdrawing **deletes the photo immediately**. | Profile → *Privacy — your photo* |
| **Leaving the mess** (status set to inactive) **deletes the photo and the consent record at once.** Removing a student from the roster deletes it with the record. | Students page / API |
| A **daily sweep** deletes the photo of anyone who is no longer active (catches bulk or direct database changes). | Scheduler |
| Every erasure is written to the **Audit Log** (that it happened and why — never the photo). | `student_photo_erased` |
| Refusing consent never affects meals: the student is checked against the printed ID card. | — |

The notice text lives in `server/src/privacy.js` (one place, versioned: `PHOTO_NOTICE_VERSION`). If you change the wording,
bump the version.

## What the rules do **not** cover — be aware

* **Backups.** A deleted photo remains in older database backups until they rotate out (14 daily copies by default, up to
  60 days off-site per `deploy/offsite-backup.sh`). The notice says so. If your legal position needs faster, shorten the
  retention (`BACKUP_KEEP`, `KEEP_REMOTE_DAYS`).
* **The university directory** (`university_directory`) is the university's own enrolment record and is **not** touched when a
  student leaves the *mess*. Its photos come from whoever loaded the directory; their basis is the university's, not this app's.
* **The ID-card photo** is rendered on demand from the held photo, so it disappears with it.
* Other personal data (names, rooms, attendance, fines) is outside this document; attendance exports are audited
  (`attendance_exported`) and limited to managers and finance.
* Access/correction requests and grievance handling are processes for your office; the contact shown to students is
  `PRIVACY_CONTACT_EMAIL`.
