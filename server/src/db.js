import Database from 'better-sqlite3'
import { hashPasswordSync } from './password.js'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '../data')
fs.mkdirSync(DATA_DIR, { recursive: true })
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'smartmess.sqlite')

export const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
// Deleted rows (a withdrawn photo!) are overwritten with zeros in the database file instead of lingering in free pages.
db.pragma('secure_delete = ON')

// --- Schema ------------------------------------------------------------
// Hostel/mess IDs deliberately match the frontend's static topology (BH1..BH10,
// GH1..GH10, MESS-BH1..) so the two layers stay addressable by the same keys.
db.exec(`
CREATE TABLE IF NOT EXISTS hostels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  capacity INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hostel_id TEXT NOT NULL REFERENCES hostels(id)
);

CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,               -- 8-digit UID, e.g. "21000001"
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  hostel_id TEXT NOT NULL REFERENCES hostels(id),
  room TEXT NOT NULL DEFAULT 'Unassigned',
  year INTEGER NOT NULL DEFAULT 1,
  branch TEXT NOT NULL DEFAULT 'Not specified',
  meal_preference TEXT NOT NULL DEFAULT 'either',
  status TEXT NOT NULL DEFAULT 'active',
  points INTEGER NOT NULL DEFAULT 0,
  badges TEXT NOT NULL DEFAULT '[]', -- JSON array
  missed_cutoff_count INTEGER NOT NULL DEFAULT 0,
  leave_until TEXT,
  password_hash TEXT,                -- NULL until the student registers (claims their UID)
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,                 -- ISO timestamp; login refused while in the future
  token_version INTEGER NOT NULL DEFAULT 1, -- bumped on logout/reset to revoke all outstanding JWTs
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attendance (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id),
  mess_id TEXT NOT NULL REFERENCES messes(id),
  date TEXT NOT NULL,
  meal TEXT NOT NULL,
  scanned_at TEXT NOT NULL,
  scanned_by TEXT,
  UNIQUE(student_id, date, meal)
);

CREATE TABLE IF NOT EXISTS warnings (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id),
  mess_id TEXT NOT NULL,
  date TEXT NOT NULL,
  meal TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  UNIQUE(student_id, date, meal)
);

CREATE TABLE IF NOT EXISTS fines (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id),
  mess_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  month TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  warning_ids TEXT NOT NULL DEFAULT '[]',
  paid INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY,                -- 5-digit UID, e.g. "10001"
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  role TEXT NOT NULL,                 -- SUPER_ADMIN | ADMIN | MESS_MANAGER | KITCHEN_STAFF | FINANCE_MANAGER | HOSTEL_WARDEN | PARENT
  hostel_id TEXT REFERENCES hostels(id),  -- NULL for the Super Admin
  student_id TEXT REFERENCES students(id), -- set only for PARENT accounts
  photo_data TEXT,                    -- base64 data URL if the staff member uploaded their own photo; NULL = generated initials
  password_hash TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  token_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  mess_id TEXT,
  summary TEXT NOT NULL
);

-- Registration email verification: the code is stored hashed, expires, and is attempt-limited.
-- A row with verified_at set is what POST /auth/register requires (and consumes).
CREATE TABLE IF NOT EXISTS email_otps (
  email TEXT PRIMARY KEY,            -- lower-cased
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  verified_at TEXT
);

-- Who intends to eat which meal. This is what no-show processing is computed from — the
-- server's own record, never a list the browser supplies.
CREATE TABLE IF NOT EXISTS meal_intentions (
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  meal TEXT NOT NULL,
  status TEXT NOT NULL,              -- will_eat | will_not | unconfirmed
  submitted_at TEXT NOT NULL,
  submitted_by TEXT,
  PRIMARY KEY (student_id, date, meal)
);

-- The university's own record of every student, keyed by UID. It is what lets staff type a UID and have the
-- name / email / phone / branch / year filled in for them, and it is separate from the students table on purpose:
-- students is the MESS roster (a row there means "this student has taken mess"), the directory is everyone.
CREATE TABLE IF NOT EXISTS university_directory (
  uid TEXT PRIMARY KEY,              -- 8-digit UID
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  branch TEXT NOT NULL DEFAULT 'Not specified',
  year INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash TEXT PRIMARY KEY,   -- the OTP/token is never stored in plaintext, only its hash
  account_type TEXT NOT NULL,    -- 'student' | 'staff'
  account_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
`)


// must_change_password: set on any account that was handed a TEMPORARY password (new staff, parent access, an Admin's
// reset). While set, the API refuses everything except changing the password (and signing out) — see requireAuth.
for (const table of ['staff', 'students']) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === 'must_change_password')) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0`)
  }
}

// password_changed_at: when the password was last chosen. Backfilled to "now" for existing accounts, so turning on password
// expiry never locks everyone out on the first boot — their clock starts then. See PASSWORD_MAX_AGE_DAYS in routes/auth.js.
for (const table of ['staff', 'students']) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === 'password_changed_at')) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN password_changed_at TEXT`)
    db.exec(`UPDATE ${table} SET password_changed_at = datetime('now')`)
  }
}

// Two-factor login (TOTP). totp_secret is stored ENCRYPTED (see totp.js); totp_enabled stays 0 until the person proves
// their authenticator works. totp_last_step is the newest 30-second step already accepted (blocks code replay).
for (const table of ['staff', 'students']) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)
  if (!cols.includes('totp_secret')) db.exec(`ALTER TABLE ${table} ADD COLUMN totp_secret TEXT`)
  if (!cols.includes('totp_enabled')) db.exec(`ALTER TABLE ${table} ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0`)
  if (!cols.includes('totp_last_step')) db.exec(`ALTER TABLE ${table} ADD COLUMN totp_last_step INTEGER NOT NULL DEFAULT 0`)
}
db.exec(`CREATE TABLE IF NOT EXISTS totp_recovery_codes (
  account_type TEXT NOT NULL,        -- 'student' | 'staff'
  account_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  PRIMARY KEY (account_type, account_id, code_hash)
)`)

// provisional = 1 → the student has no university UID yet and holds a temporary "TMP-00001" ID until staff assign the
// real one (POST /students/:id/assign-uid). The temporary namespace can never collide with a real 8-digit UID.
if (!db.prepare('PRAGMA table_info(students)').all().some((c) => c.name === 'provisional')) {
  db.exec('ALTER TABLE students ADD COLUMN provisional INTEGER NOT NULL DEFAULT 0')
}

// Official student photo (a base64 data URL, like staff photos). Uploaded by the warden/admin who enrols the student; a
// student can never change their own. NULL = nothing on file yet (the counter is then told to check the ID card).
if (!db.prepare('PRAGMA table_info(students)').all().some((c) => c.name === 'photo_data')) {
  db.exec('ALTER TABLE students ADD COLUMN photo_data TEXT')
}
// How a check-in was identified: 'qr' (the student's signed, rotating code) or 'manual' (UID typed by counter staff).
if (!db.prepare('PRAGMA table_info(attendance)').all().some((c) => c.name === 'method')) {
  db.exec("ALTER TABLE attendance ADD COLUMN method TEXT NOT NULL DEFAULT 'manual'")
}
// Per-mess meal serving times (minutes after midnight, mess-local time). No row = the built-in default for that meal.
db.exec(`CREATE TABLE IF NOT EXISTS mess_meal_windows (
  mess_id TEXT NOT NULL,
  meal TEXT NOT NULL,
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  PRIMARY KEY (mess_id, meal)
)`)

// The university record can carry the student's photo too, so adding a student by UID brings the photo along with the name.
if (!db.prepare('PRAGMA table_info(university_directory)').all().some((c) => c.name === 'photo_data')) {
  db.exec('ALTER TABLE university_directory ADD COLUMN photo_data TEXT')
}

// Each meal QR carries a one-time id (jti). Once a check-in has used it, it is recorded here and can never be used again,
// even inside its 60 seconds. Old rows are pruned as new ones arrive.
db.exec(`CREATE TABLE IF NOT EXISTS used_qr (jti TEXT PRIMARY KEY, used_at TEXT NOT NULL)`)
// A permanent, revocable ID-card QR for students who have no phone login (e.g. on a temporary TMP- ID) or a lost phone.
// The token carries card_id, not the student id, so it survives a TMP- → real-UID change; reissuing replaces card_id.
if (!db.prepare('PRAGMA table_info(students)').all().some((c) => c.name === 'card_id')) {
  db.exec('ALTER TABLE students ADD COLUMN card_id TEXT')
}
db.exec('CREATE INDEX IF NOT EXISTS idx_students_card ON students(card_id)')
// Opt-in: email the student each time they are checked in, so a scan they didn't make gets noticed.
if (!db.prepare('PRAGMA table_info(students)').all().some((c) => c.name === 'notify_checkin')) {
  db.exec('ALTER TABLE students ADD COLUMN notify_checkin INTEGER NOT NULL DEFAULT 0')
}

// Web Push: one row per browser/device that agreed to notifications. `endpoint` is the push service's address for that
// device (it IS the identity — unguessable). A device belongs to whoever subscribed last, so a shared phone never keeps
// delivering the previous person's notifications.
db.exec(`CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  account_type TEXT NOT NULL,          -- 'student' | 'staff'
  account_id TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL
)`)
db.exec('CREATE INDEX IF NOT EXISTS idx_push_account ON push_subscriptions(account_type, account_id)')
// Small key/value store for secrets generated at first boot (the VAPID signing key pair for Web Push).
db.exec('CREATE TABLE IF NOT EXISTS app_secrets (key TEXT PRIMARY KEY, value TEXT NOT NULL)')

// --- Migrations (for databases created before a column existed) ----------------------
// room_capacity: max students per room in a hostel; NULL = no per-room limit (the default).
if (!db.prepare("PRAGMA table_info(hostels)").all().some((c) => c.name === 'room_capacity')) {
  db.exec('ALTER TABLE hostels ADD COLUMN room_capacity INTEGER')
}

// --- Sessions (one row per signed-in device) -------------------------------------------------------------------------
// Every login creates a row; the JWT carries its id (`sid`). That is what makes a per-device list and a per-device
// "sign out" possible: revoking a row kills that one token without touching the account's other sessions. Bumping the
// account's token_version (revokeAllTokens) still kills every token at once, including pre-upgrade ones with no sid.
db.exec(`CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  account_type TEXT NOT NULL,         -- 'student' | 'staff'
  account_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  user_agent TEXT,
  ip TEXT,
  revoked_at TEXT
)`)
db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_type, account_id)')

// --- Student photo privacy (India's DPDP Act) ---------------------------------------------------------------------------
// A photo is personal data, so the system records WHO agreed to holding it, WHEN, HOW and against WHICH version of the
// notice. No consent row = no photo is held. Leaving the mess (or withdrawing consent) erases the photo and the consent.
for (const [col, ddl] of [
  ['photo_consent_at', 'TEXT'], ['photo_consent_method', 'TEXT'], ['photo_consent_by', 'TEXT'], ['photo_notice_version', 'TEXT'],
  // "mark tomorrow's meals" push reminder: on by default (it only reaches devices that turned push on), switchable per student
  ['notify_reminder', 'INTEGER NOT NULL DEFAULT 1'],
]) {
  if (!db.prepare('PRAGMA table_info(students)').all().some((c) => c.name === col)) db.exec(`ALTER TABLE students ADD COLUMN ${col} ${ddl}`)
}

// --- Scheduled work: reminders and automatic no-shows ---------------------------------------------------------------------
// reminder_log makes "one reminder per student per day" true even across restarts. no_show_runs does the same for the
// automatic no-show pass, and records WHY a meal was skipped (so a manager can see it was not forgotten).
db.exec(`
CREATE TABLE IF NOT EXISTS reminder_log (
  student_id TEXT NOT NULL, date TEXT NOT NULL, kind TEXT NOT NULL, sent_at TEXT NOT NULL,
  PRIMARY KEY (student_id, date, kind)
);
CREATE TABLE IF NOT EXISTS mess_auto_settings (
  mess_id TEXT PRIMARY KEY, auto_no_shows INTEGER NOT NULL DEFAULT 1, fine_amount INTEGER NOT NULL DEFAULT 100, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS no_show_runs (
  mess_id TEXT NOT NULL, date TEXT NOT NULL, meal TEXT NOT NULL, ran_at TEXT NOT NULL,
  status TEXT NOT NULL,              -- processed | skipped_no_scans | manual
  checked INTEGER NOT NULL DEFAULT 0, warnings INTEGER NOT NULL DEFAULT 0, fines INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (mess_id, date, meal)
);
-- Only ONE process may run the scheduled jobs. The holder renews this row every tick; a second copy sees a live lease and stays idle.
CREATE TABLE IF NOT EXISTS scheduler_lease (id INTEGER PRIMARY KEY CHECK (id = 1), holder TEXT NOT NULL, expires_at INTEGER NOT NULL);
-- Real food-waste log: what the kitchen actually recorded after a meal (the first non-demo waste figures in the app).
CREATE TABLE IF NOT EXISTS waste_log (
  id TEXT PRIMARY KEY,
  mess_id TEXT NOT NULL REFERENCES messes(id),
  date TEXT NOT NULL, meal TEXT NOT NULL,
  prepared_kg REAL NOT NULL, consumed_kg REAL NOT NULL, waste_kg REAL NOT NULL,
  reason TEXT NOT NULL, note TEXT,
  recorded_by TEXT NOT NULL, recorded_by_name TEXT NOT NULL, recorded_at TEXT NOT NULL,
  UNIQUE (mess_id, date, meal)
);
CREATE INDEX IF NOT EXISTS idx_waste_mess_date ON waste_log(mess_id, date);

-- Student feedback (a 1-5 rating per meal, anonymous to staff) and complaints (named, so a manager can answer them).
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  mess_id TEXT NOT NULL REFERENCES messes(id),
  student_id TEXT NOT NULL REFERENCES students(id),
  kind TEXT NOT NULL DEFAULT 'feedback',        -- feedback | complaint
  date TEXT NOT NULL, meal TEXT NOT NULL,
  rating INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  category TEXT NOT NULL, comment TEXT,
  status TEXT NOT NULL DEFAULT 'open',          -- complaints: open | in_progress | resolved
  response TEXT, responded_by TEXT, responded_at TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_meal ON feedback(student_id, date, meal) WHERE kind = 'feedback';
CREATE INDEX IF NOT EXISTS idx_feedback_mess_date ON feedback(mess_id, date);
CREATE INDEX IF NOT EXISTS idx_feedback_student ON feedback(student_id, created_at);

-- Real stock: what is on the shelf now, and every change to it (who, when, why).
CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY,
  mess_id TEXT NOT NULL REFERENCES messes(id),
  name TEXT NOT NULL, unit TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'Other',
  quantity REAL NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  reorder_level REAL NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
  UNIQUE (mess_id, name)
);
CREATE TABLE IF NOT EXISTS inventory_moves (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES inventory_items(id),
  mess_id TEXT NOT NULL,
  kind TEXT NOT NULL,                            -- receive | use | waste | adjust
  delta REAL NOT NULL, balance REAL NOT NULL, note TEXT,
  by_id TEXT NOT NULL, by_name TEXT NOT NULL, at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invmoves_item ON inventory_moves(item_id, at);

-- Errors seen by the browser or the server, grouped by fingerprint so one bug is one row with a count.
CREATE TABLE IF NOT EXISTS error_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,   -- client | server
  message TEXT NOT NULL, stack TEXT, url TEXT,
  count INTEGER NOT NULL DEFAULT 1, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, dismissed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS daily_summary_log (mess_id TEXT NOT NULL, date TEXT NOT NULL, sent_at TEXT NOT NULL, PRIMARY KEY (mess_id, date));
`)

// --- Indices -------------------------------------------------------------
// All IF NOT EXISTS, so an existing smartmess.sqlite picks these up on its next boot —
// no manual migration. Each one backs a query the app actually runs:
//
//  * students(hostel_id, lower(room))  roster/scoping filter, hostel occupancy COUNT, capacity checks AND room occupancy
//                                (hostel_id is its leftmost column, so it also serves every hostel-only query)
//  * lower(email) / lower(id)    login + password-reset lookups (findAccount() in routes/auth.js
//                                compares lower(...) — a plain index on email/id can't serve that,
//                                so without these every login is a full scan of both tables)
//  * attendance(mess_id,date,meal)   "who's checked in for this meal" (the UNIQUE(student_id,…)
//                                constraint already covers per-student lookups)
//  * fines(mess_id,paid)         the outstanding-fines list; fines(student_id) for a student's own
//  * staff(hostel_id)            a mess's team list; staff(student_id) for parent-account lookup (partial —
//                                only PARENT rows have one, so the index stays tiny and selective)
//  * messes(hostel_id)           messIdForHostel() runs once per student in no-show processing
//  * meal_intentions(date,meal,status)  no-show processing; students(hostel_id,lower(room))  room occupancy
//  * audit_log(at / mess_id / actor_id / action, at)   every audit filter sorts by `at`
db.exec(`
DROP INDEX IF EXISTS idx_students_hostel; -- superseded by idx_students_room, whose leftmost column is hostel_id
CREATE INDEX IF NOT EXISTS idx_students_lower_email   ON students(lower(email));
CREATE INDEX IF NOT EXISTS idx_students_lower_id      ON students(lower(id));
CREATE INDEX IF NOT EXISTS idx_staff_hostel           ON staff(hostel_id);
CREATE INDEX IF NOT EXISTS idx_staff_student          ON staff(student_id) WHERE student_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_staff_lower_email      ON staff(lower(email));
CREATE INDEX IF NOT EXISTS idx_staff_lower_id         ON staff(lower(id));
CREATE INDEX IF NOT EXISTS idx_messes_hostel          ON messes(hostel_id);
CREATE INDEX IF NOT EXISTS idx_attendance_mess_meal   ON attendance(mess_id, date, meal);
CREATE INDEX IF NOT EXISTS idx_fines_student          ON fines(student_id);
CREATE INDEX IF NOT EXISTS idx_fines_mess_paid        ON fines(mess_id, paid);
CREATE INDEX IF NOT EXISTS idx_intentions_day_meal    ON meal_intentions(date, meal, status);
CREATE INDEX IF NOT EXISTS idx_students_room          ON students(hostel_id, lower(room));
CREATE INDEX IF NOT EXISTS idx_audit_at               ON audit_log(at);
CREATE INDEX IF NOT EXISTS idx_audit_mess_at          ON audit_log(mess_id, at);
CREATE INDEX IF NOT EXISTS idx_audit_actor_at         ON audit_log(actor_id, at);
CREATE INDEX IF NOT EXISTS idx_audit_action_at        ON audit_log(action, at);
`)

// --- Seed (idempotent) --------------------------------------------------
const hostelCount = db.prepare('SELECT COUNT(*) AS n FROM hostels').get().n
if (hostelCount === 0) {
  const insertHostel = db.prepare('INSERT INTO hostels (id, name, category, capacity) VALUES (?, ?, ?, ?)')
  const insertMess = db.prepare('INSERT INTO messes (id, name, hostel_id) VALUES (?, ?, ?)')
  const insertStudent = db.prepare(`
    INSERT INTO students (id, name, email, phone, hostel_id, room, year, branch, meal_preference, status, points, badges, missed_cutoff_count)
    VALUES (@id, @name, @email, @phone, @hostelId, @room, @year, @branch, @mealPreference, @status, @points, @badges, @missedCutoffCount)
  `)

  const FIRST = ['Aarav', 'Vihaan', 'Ishaan', 'Reyansh', 'Kabir', 'Arjun', 'Ananya', 'Diya', 'Isha', 'Kavya', 'Meera', 'Riya', 'Tanvi', 'Sneha', 'Pooja']
  const LAST = ['Sharma', 'Verma', 'Patel', 'Reddy', 'Nair', 'Gupta', 'Singh', 'Kumar', 'Iyer', 'Chauhan', 'Mehta', 'Joshi']
  const BRANCHES = ['Computer Science', 'Electronics', 'Mechanical', 'Civil', 'Electrical', 'Chemical', 'Biotechnology', 'Information Technology']
  let seq = 21000000
  const seedTx = db.transaction(() => {
    for (let i = 1; i <= 10; i++) {
      const id = `BH${i}`
      insertHostel.run(id, `Boys Hostel ${i} (BH-${i})`, 'boys', 112)
      insertMess.run(`MESS-${id}`, `${id} Mess`, id)
    }
    for (let i = 1; i <= 10; i++) {
      const id = `GH${i}`
      insertHostel.run(id, `Girls Hostel ${i} (GH-${i})`, 'girls', 112)
      insertMess.run(`MESS-${id}`, `${id} Mess`, id)
    }
    const allHostelIds = [...Array(10)].map((_, i) => `BH${i + 1}`).concat([...Array(10)].map((_, i) => `GH${i + 1}`))
    for (const hostelId of allHostelIds) {
      for (let n = 0; n < 100; n++) {
        seq += 1
        const first = FIRST[Math.floor(Math.random() * FIRST.length)]
        const last = LAST[Math.floor(Math.random() * LAST.length)]
        insertStudent.run({
          id: String(seq),
          name: `${first} ${last}`,
          email: `${first}.${last}${String(seq).slice(-4)}@lpu.smartmess.edu`.toLowerCase(),
          phone: `9${Math.floor(100000000 + Math.random() * 899999999)}`,
          hostelId,
          room: `${['A', 'B', 'C', 'D'][Math.floor(Math.random() * 4)]}-${100 + Math.floor(Math.random() * 299)}`,
          year: 1 + Math.floor(Math.random() * 4),
          branch: BRANCHES[Math.floor(Math.random() * BRANCHES.length)],
          mealPreference: ['veg', 'non-veg', 'either'][Math.floor(Math.random() * 3)],
          status: 'active',
          points: Math.floor(Math.random() * 480),
          badges: '[]',
          missedCutoffCount: Math.floor(Math.random() * 6),
        })
      }
    }
    // One pre-claimed demo login, exactly like the frontend's featured demo account,
    // so there's an immediate way to prove the real login round-trip end to end.
    const demo = db.prepare('SELECT id FROM students WHERE hostel_id = ? ORDER BY id LIMIT 1').get('BH1')
    if (demo) {
      const hash = hashPasswordSync('demo1234')
      db.prepare('UPDATE students SET password_hash = ?, name = ?, email = ? WHERE id = ?').run(hash, 'Ananya Iyer (Real API Demo)', 'ananya.iyer.realapi@lpu.smartmess.edu', demo.id)
    }

    // Real staff accounts — same UID scheme (5-digit, sequential) and the same demo
    // password as the frontend's old in-memory staff system, but now with an actual
    // bcrypt hash and a JWT issued on login, exactly like students.
    const STAFF_FIRST = ['Ritu', 'Arvind', 'Suresh', 'Meera', 'Naresh', 'Deepak', 'Kavita', 'Manoj', 'Sunita', 'Rajesh']
    const STAFF_LAST = ['Chawla', 'Malhotra', 'Yadav', 'Krishnan', 'Kapoor', 'Bhatia', 'Saxena', 'Mishra', 'Rana', 'Sethi']
    const STAFF_ROLES = ['ADMIN', 'MESS_MANAGER', 'KITCHEN_STAFF', 'FINANCE_MANAGER', 'HOSTEL_WARDEN']
    const staffHash = hashPasswordSync('demo1234')
    const insertStaff = db.prepare(`
      INSERT INTO staff (id, name, email, phone, role, hostel_id, student_id, password_hash)
      VALUES (@id, @name, @email, @phone, @role, @hostelId, NULL, @passwordHash)
    `)
    let staffSeq = 10000
    staffSeq += 1
    insertStaff.run({ id: String(staffSeq), name: 'Dr. Ashok Mittal', email: 'superadmin@lpu.smartmess.edu', phone: null, role: 'SUPER_ADMIN', hostelId: null, passwordHash: staffHash })
    allHostelIds.forEach((hostelId, hIdx) => {
      STAFF_ROLES.forEach((role, rIdx) => {
        staffSeq += 1
        const seedIndex = hIdx * 5 + rIdx
        const first = STAFF_FIRST[seedIndex % STAFF_FIRST.length]
        const last = STAFF_LAST[(seedIndex * 3 + 7) % STAFF_LAST.length]
        insertStaff.run({
          id: String(staffSeq),
          name: `${first} ${last}`,
          email: `${role.toLowerCase()}.${hostelId.toLowerCase()}@lpu.smartmess.edu`,
          phone: null,
          role,
          hostelId,
          passwordHash: staffHash,
        })
      })
    })

    // Students who are in the university's records but have NOT taken mess. They exist so the whole flow can be tried
    // on a fresh database: a warden types one of these UIDs and the details fill in; the same UID on the student
    // sign-up page says "you haven't taken mess" until a warden enrolls it. Replace with your real records
    // (scripts/import-directory.js).
    db.exec(`INSERT OR IGNORE INTO university_directory (uid, name, email, phone, branch, year)
             SELECT id, name, email, phone, branch, year FROM students`)
    const insertDir = db.prepare('INSERT OR IGNORE INTO university_directory (uid, name, email, phone, branch, year) VALUES (?, ?, ?, ?, ?, ?)')
    // The email carries the full UID: seeded students' emails end in a 4-digit suffix and get random names, so a 4-digit
    // suffix here would occasionally collide with one of them (and enrolling that UID would fail with "email taken").
    for (let i = 1; i <= 50; i++) {
      const first = FIRST[(i * 7) % FIRST.length]
      const last = LAST[(i * 5 + 3) % LAST.length]
      const uid = String(22000000 + i)
      insertDir.run(uid, `${first} ${last}`, `${first}.${last}.${uid}@lpu.smartmess.edu`.toLowerCase(), `9${String(100000000 + i * 7919).slice(0, 9)}`, BRANCHES[i % BRANCHES.length], 1 + (i % 4))
    }
  })
  seedTx()
  if (process.env.SEED_DEMO === '0') {
    // Production: keep the 20 hostels/messes (the topology the app needs) but NO demo people. The published demo password
    // must never exist on a real deployment; the first Super Admin is created from the console (scripts/create-super-admin.js).
    db.transaction(() => {
      db.exec('DELETE FROM staff; DELETE FROM university_directory; DELETE FROM students;')
    })()
    console.log(`[db] Seeded 20 hostels and 20 messes (no demo people: SEED_DEMO=0) into ${DB_PATH}. Create the first Super Admin: node scripts/create-super-admin.js`)
  } else {
    console.log(`[db] Seeded 20 hostels, 20 messes, 2000 students, 101 staff accounts into ${DB_PATH}`)
  }
}

// Databases created before the directory existed: seed it from the current roster once, so every enrolled student can
// still be found by UID. (Only when it is completely empty — after that the directory is managed on its own.)
if (db.prepare('SELECT COUNT(*) AS n FROM university_directory').get().n === 0) {
  db.exec(`INSERT OR IGNORE INTO university_directory (uid, name, email, phone, branch, year)
           SELECT id, name, email, phone, branch, year FROM students`)
}

// Give the query planner real statistics. Without them SQLite guesses, and (verified with
// EXPLAIN QUERY PLAN) it will sometimes ignore a perfectly good index and scan the table.
// First boot: one bounded ANALYZE (analysis_limit keeps it fast even on a large file).
// Every boot after: PRAGMA optimize re-analyzes only the tables that have changed a lot.
db.pragma('analysis_limit = 1000')
if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'sqlite_stat1'").get()) db.exec('ANALYZE')
db.pragma('optimize')

export const NOT_ON_MESS_MESSAGE = "You haven't taken mess. For any query, visit the warden office."

/** The university's record for a UID, or null. */
export function directoryRecord(uid) {
  return db.prepare('SELECT * FROM university_directory WHERE uid = ?').get(String(uid).trim()) ?? null
}

/** True if this UID is on the mess roster, i.e. the student has taken mess. */
export function isOnMess(uid) {
  return !!db.prepare('SELECT 1 FROM students WHERE id = ?').get(String(uid).trim())
}

/**
 * The next UID to hand to a student who has none in the university records. It skips anything already used by the
 * roster OR reserved by the directory, so an auto-assigned ID can never collide with a real student's UID.
 */
export function nextFreeStudentId(floor = 21000000) {
  const max = db.prepare('SELECT MAX(CAST(id AS INTEGER)) AS maxId FROM students').get().maxId ?? 21000000
  let n = Math.max(max, floor) + 1
  const taken = db.prepare('SELECT 1 FROM university_directory WHERE uid = ?')
  while (taken.get(String(n))) n++
  return String(n)
}

/** Next temporary ID for a student who has no UID yet: TMP-00001, TMP-00002… (never an 8-digit, UID-looking number). */
export function nextProvisionalId() {
  const row = db.prepare("SELECT MAX(CAST(substr(id, 5) AS INTEGER)) AS n FROM students WHERE id LIKE 'TMP-%'").get()
  return `TMP-${String((row.n ?? 0) + 1).padStart(5, '0')}`
}

export function hostelExists(hostelId) {
  return !!db.prepare('SELECT 1 FROM hostels WHERE id = ?').get(hostelId)
}

export function messIdForHostel(hostelId) {
  const row = db.prepare('SELECT id FROM messes WHERE hostel_id = ?').get(hostelId)
  return row?.id ?? null
}

/** The hostel a mess serves (1:1 in this system), or null if the mess doesn't exist. */
export function hostelIdForMess(messId) {
  const row = db.prepare('SELECT hostel_id FROM messes WHERE id = ?').get(messId)
  return row?.hostel_id ?? null
}

/**
 * Bed capacity vs. current enrollment for a hostel. "Occupied" is every enrolled student
 * regardless of status — an inactive or on-leave student still has a bed — and it's the
 * same number GET /hostels reports as `students`, so what the UI shows and what's
 * enforced can never disagree. Returns null for an unknown hostel.
 */
export function hostelOccupancy(hostelId) {
  const row = db.prepare(`
    SELECT h.id, h.capacity, (SELECT COUNT(*) FROM students s WHERE s.hostel_id = h.id) AS occupied
    FROM hostels h WHERE h.id = ?
  `).get(hostelId)
  if (!row) return null
  return { hostelId: row.id, capacity: row.capacity, occupied: row.occupied, available: Math.max(0, row.capacity - row.occupied) }
}

/**
 * Room-level occupancy. Only meaningful when the hostel has a room_capacity set and the room
 * is a real assignment (not the 'Unassigned' placeholder). `exceptStudentId` excludes the
 * student being edited so re-saving their own room never counts against them.
 * Returns null when no room limit applies.
 */
export function roomOccupancy(hostelId, room, exceptStudentId) {
  const h = db.prepare('SELECT room_capacity FROM hostels WHERE id = ?').get(hostelId)
  const name = String(room ?? '').trim()
  if (!h || !h.room_capacity || !name || name.toLowerCase() === 'unassigned') return null
  const occupied = db.prepare('SELECT COUNT(*) AS n FROM students WHERE hostel_id = ? AND lower(room) = lower(?) AND id != ?').get(hostelId, name, exceptStudentId ?? '').n
  return { hostelId, room: name, capacity: h.room_capacity, occupied, available: Math.max(0, h.room_capacity - occupied) }
}

export function roomFullMessage(occ) {
  return `Room ${occ.room} in ${occ.hostelId} is full (${occ.occupied}/${occ.capacity} beds) — pick another room.`
}

/** Human-readable refusal for a full hostel — shared so every entry point words it identically. */
export function hostelFullMessage(occ, requested = 1) {
  if (occ.available === 0) return `${occ.hostelId} is at full capacity (${occ.occupied}/${occ.capacity} beds) — it can't take another student.`
  return `${occ.hostelId} only has ${occ.available} bed${occ.available === 1 ? '' : 's'} free (${occ.occupied}/${occ.capacity}) — can't add ${requested}.`
}

let auditSeq = 1
export function logAudit({ actorId, actorName, actorRole, action, messId, summary }) {
  db.prepare('INSERT INTO audit_log (id, at, actor_id, actor_name, actor_role, action, mess_id, summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    `AUD-${Date.now()}-${auditSeq++}`,
    new Date().toISOString(),
    actorId ?? 'system',
    actorName ?? 'System',
    actorRole ?? 'SUPER_ADMIN',
    action,
    messId ?? null,
    summary
  )
}

export function nextStaffId() {
  const row = db.prepare('SELECT MAX(CAST(id AS INTEGER)) AS maxId FROM staff').get()
  return String((row.maxId ?? 10000) + 1)
}

/** Looks up a real display name for an authenticated actor, for accurate audit entries. */
export function resolveActorName(sub, role) {
  if (role === 'STUDENT') return db.prepare('SELECT name FROM students WHERE id = ?').get(sub)?.name ?? sub
  return db.prepare('SELECT name FROM staff WHERE id = ?').get(sub)?.name ?? sub
}

const LOCKOUT_THRESHOLD = 5
const LOCKOUT_MINUTES = 15

/** Returns { locked: boolean, retryAfterMinutes } for an account row (student or staff). */
export function lockoutStatus(row) {
  if (!row.locked_until) return { locked: false }
  const until = new Date(row.locked_until).getTime()
  if (until > Date.now()) return { locked: true, retryAfterMinutes: Math.ceil((until - Date.now()) / 60000) }
  return { locked: false }
}

/** Records a failed login attempt; locks the account once the threshold is hit. */
export function recordFailedLogin(table, id) {
  const row = db.prepare(`SELECT failed_attempts FROM ${table} WHERE id = ?`).get(id)
  const attempts = (row?.failed_attempts ?? 0) + 1
  if (attempts >= LOCKOUT_THRESHOLD) {
    const lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString()
    db.prepare(`UPDATE ${table} SET failed_attempts = ?, locked_until = ? WHERE id = ?`).run(attempts, lockedUntil, id)
    return { locked: true, retryAfterMinutes: LOCKOUT_MINUTES }
  }
  db.prepare(`UPDATE ${table} SET failed_attempts = ? WHERE id = ?`).run(attempts, id)
  return { locked: false, attemptsLeft: LOCKOUT_THRESHOLD - attempts }
}

/** Clears failed-attempt tracking after a successful login. */
export function clearFailedLogins(table, id) {
  db.prepare(`UPDATE ${table} SET failed_attempts = 0, locked_until = NULL WHERE id = ?`).run(id)
}

/** Bumps an account's token_version, which invalidates every previously issued JWT for it. */
export function revokeAllTokens(table, id, { keepSid } = {}) {
  db.prepare(`UPDATE ${table} SET token_version = token_version + 1 WHERE id = ?`).run(id)
  // Every device row goes too (except the one the caller is re-issuing a token for), so the device list matches reality.
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE account_type = ? AND account_id = ? AND revoked_at IS NULL AND id != ?')
    .run(new Date().toISOString(), table === 'students' ? 'student' : 'staff', id, keepSid ?? '')
}
