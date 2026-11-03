import { z } from 'zod'

// Two ways to create a login:
//  * UID only (what the app does): { uid, password }. The student's name and email come from the roster record, and the
//    verification code goes to the email ON FILE — so knowing a UID is not enough to claim an account.
//  * Older, explicit: { uid, name, email, password } — name must match the record and the typed email is verified.
export const registerSchema = z.object({
  uid: z.string().min(1, 'UID is required'),
  name: z.string().min(2, 'Name is too short').optional(),
  email: z.string().email('Enter a valid email address').optional(),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})

export const loginSchema = z.object({
  identifier: z.string().min(1, 'Enter your registration number (or email)'),
  password: z.string().min(1, 'Enter your password'),
})

/** An email address, or a student UID (the code then goes to the email on file) — but not neither. */
export const otpEmailSchema = z
  .object({
    email: z.string().email('Enter a valid email address').optional(),
    uid: z.string().min(1).optional(),
  })
  .refine((v) => v.email || v.uid, { message: 'Enter a valid email address', path: ['email'] })

export const otpVerifySchema = z
  .object({
    email: z.string().email('Enter a valid email address').optional(),
    uid: z.string().min(1).optional(),
    code: z.string().length(6, 'Enter the 6-digit code'),
  })
  .refine((v) => v.email || v.uid, { message: 'Enter a valid email address', path: ['email'] })

export const passwordResetRequestSchema = z.object({
  identifier: z.string().min(1, 'Enter your UID or email'),
})

export const passwordResetConfirmSchema = z.object({
  identifier: z.string().min(1),
  code: z.string().length(6, 'Enter the 6-digit code'),
  newPassword: z.string().min(6, 'Password must be at least 6 characters'),
})

const studentFields = {
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional(),
  hostelId: z.string().min(1),
  room: z.string().optional(),
  year: z.number().int().min(1).max(6).optional(),
  branch: z.string().optional(),
  mealPreference: z.enum(['veg', 'non-veg', 'either']).optional(),
  status: z.enum(['active', 'inactive']).optional(),
}
export const createStudentSchema = z.object(studentFields)

/**
 * Enrolling a student onto the mess roster. Give a `uid` and the university's record supplies name, email (and phone,
 * branch, year unless you override them), so only hostel/room/meal preference are needed. Without a `uid` it is the
 * older manual entry — name and email are then required and a UID is assigned.
 */
const uidField = z.string().regex(/^\d{8}$/, 'UID must be 8 digits')
const UID_REQUIRED = 'A UID is required. If the student has no UID yet, choose "No UID yet" to issue a temporary ID.'
// A roster row is one of two things: a student WITH a UID (the university record supplies the details), or — only when
// staff say so explicitly — a student with no UID yet, who gets a clearly-marked temporary ID. Never a silent guess.
const needsUidOrExplicitNoUid = (requireReason) => (v, ctx) => {
  if (v.uid && v.noUid) return ctx.addIssue({ code: 'custom', path: ['uid'], message: 'Give a UID, or choose "No UID yet" — not both.' })
  if (v.uid) return
  if (!v.noUid) return ctx.addIssue({ code: 'custom', path: ['uid'], message: UID_REQUIRED })
  if (!v.name) ctx.addIssue({ code: 'custom', path: ['name'], message: 'Name is required for a student with no UID yet' })
  if (!v.email) ctx.addIssue({ code: 'custom', path: ['email'], message: 'Email is required for a student with no UID yet' })
  if (requireReason && !(v.noUidReason ?? '').trim()) ctx.addIssue({ code: 'custom', path: ['noUidReason'], message: 'Say why there is no UID yet (e.g. "new admission, UID pending")' })
}
// photoConsent: carry the photo from the university record onto the roster ONLY if staff confirm the student agreed to it
// (the privacy notice). Accepts true/false or, for CSV rows, the words true/yes/false/no.
const consentFlag = z.union([z.boolean(), z.enum(['true', 'yes', 'false', 'no']).transform((v) => v === 'true' || v === 'yes')]).optional()
const noUidFields = { noUid: z.boolean().optional(), noUidReason: z.string().trim().max(200).optional(), photoConsent: consentFlag }
export const enrollStudentSchema = z
  .object({ ...studentFields, ...noUidFields, name: studentFields.name.optional(), email: studentFields.email.optional(), uid: uidField.optional() })
  .superRefine(needsUidOrExplicitNoUid(true))

export const assignUidSchema = z.object({ uid: uidField })

export const patchStudentSchema = createStudentSchema.partial().extend({
  leaveUntil: z.string().nullable().optional(),
})

export const transferStudentSchema = z.object({
  hostelId: z.string().min(1),
  room: z.string().optional(),
})

export const checkinSchema = z.object({
  // WHO is being checked in is given by exactly one of: `qr` (the signed code scanned from the student's own phone — the
  // normal route) or `uid` (typed by counter staff when a phone is flat or broken — recorded as "manual").
  qr: z.string().min(10).max(2000).optional(),
  uid: z.string().min(1).max(40).optional(),
  // Set only by the offline queue: when the scan really happened. The server bounds it
  // (not in the future, not older than 48h) rather than trusting it blindly.
  scannedAt: z.string().datetime().optional(),
  messId: z.string().min(1),
  meal: z.enum(['breakfast', 'lunch', 'snacks', 'dinner']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
}).superRefine((v, ctx) => {
  if (!v.qr && !v.uid) ctx.addIssue({ code: 'custom', path: ['qr'], message: 'Scan the student\'s QR code or enter their UID' })
  if (v.qr && v.uid) ctx.addIssue({ code: 'custom', path: ['qr'], message: 'Send either a QR code or a UID, not both' })
})

const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM')
export const mealWindowsSchema = z.object({
  messId: z.string().min(1),
  reset: z.boolean().optional(),
  windows: z.array(z.object({ meal: z.enum(['breakfast', 'lunch', 'snacks', 'dinner']), start: hm, end: hm })).max(4).optional(),
}).superRefine((v, ctx) => {
  if (!v.reset && !(v.windows && v.windows.length)) ctx.addIssue({ code: 'custom', path: ['windows'], message: 'Give at least one meal window, or reset: true' })
})

export const processNoShowsSchema = z.object({
  messId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  meal: z.enum(['breakfast', 'lunch', 'snacks', 'dinner']),
  // Who "intended to eat" is no longer accepted from the client — it's read from the server's
  // own meal_intentions table. fineAmount is optional: left out, the mess's own setting (automatic no-show settings) is
  // used. When given it is capped, so a crafted request can't fine anyone an absurd sum.
  fineAmount: z.number().min(0).max(2000, 'Fine amount is capped at ₹2000').optional(),
})

export const createStaffSchema = z.object({
  name: z.string().min(2),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  role: z.enum(['MESS_MANAGER', 'KITCHEN_STAFF', 'FINANCE_MANAGER', 'HOSTEL_WARDEN']),
  hostelId: z.string().min(1),
})

export const createHostelMirrorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(['boys', 'girls', 'general']),
  capacity: z.number().int().min(1),
  roomCapacity: z.number().int().min(1).max(20).nullable().optional(),
})

export const patchHostelSchema = z.object({
  capacity: z.number().int().min(1).optional(),
  roomCapacity: z.number().int().min(1).max(20).nullable().optional(),
})

export const setIntentionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  meal: z.enum(['breakfast', 'lunch', 'snacks', 'dinner']),
  status: z.enum(['will_eat', 'will_not', 'unconfirmed']),
})

// Raster formats only. An uploaded image/svg+xml is a document that can carry <script>,
// and this server would serve it back from its own origin — so SVG is refused outright
// rather than trusting that every client/proxy in front of it sandboxes it.
export const uploadPhotoSchema = z.object({
  dataUrl: z
    .string()
    .regex(/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/, 'Photo must be a PNG, JPEG, WebP or GIF image')
    .max(2_000_000, 'Image is too large'),
  // Student photos only: the person uploading confirms the student (or their guardian) has been shown the privacy notice
  // and agreed. Not needed again once consent is on record.
  consent: z.boolean().optional(),
})

// Bulk student import. Each row is validated on its own by the route (so one bad row
// doesn't sink the other 499) — this schema only checks the envelope. `line` is the
// row's line number in the uploaded CSV, echoed back on failures so the person can find it.
export const bulkStudentsSchema = z.object({
  rows: z
    .array(z.object({ line: z.number().int().min(1), data: z.record(z.string(), z.unknown()) }))
    .min(1, 'No rows to import')
    .max(1000, 'At most 1000 rows per request'),
})

// A bulk row is a normal new-student record, except hostelId may be omitted (it then
// defaults to the importing Admin's own hostel).
export const bulkStudentRowSchema = z
  .object({ ...studentFields, ...noUidFields, name: studentFields.name.optional(), email: studentFields.email.optional(), uid: uidField.optional(), hostelId: z.string().min(1).optional() })
  .superRefine(needsUidOrExplicitNoUid(false))

/** Express middleware factory: parses req.body against `schema`, 400s with a clear message on failure. */
export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      const first = result.error.issues[0]
      return res.status(400).json({ error: first ? `${first.path.join('.')}: ${first.message}` : 'Invalid request.' })
    }
    req.body = result.data
    next()
  }
}

// Passwords people choose for themselves. The login form still accepts 4+ characters (so older accounts can sign in);
// a NEW password has to clear a real bar: 8+ characters, not on a short list of the passwords everyone tries first
// (including the published demo one), and — checked in the route — different from the current one.
const COMMON_PASSWORDS = new Set(['password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwertyui', 'qwerty123', 'iloveyou', 'admin123', 'letmein1', 'welcome1', 'demo1234', 'abcd1234', 'lpu12345', 'lpu@1234'])
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: z
    .string()
    .min(8, 'Use at least 8 characters')
    .max(128, 'Use at most 128 characters')
    .refine((v) => !COMMON_PASSWORDS.has(v.toLowerCase()), 'That password is too common — choose something less guessable'),
})

// Two-factor login. `code` is a 6-digit authenticator code OR a recovery code (xxxxx-xxxxx), so it is just a non-empty string here.
export const twoFactorLoginSchema = z.object({
  challenge: z.string().min(1),
  code: z.string().min(6, 'Enter the 6-digit code from your authenticator app').max(20),
})
export const twoFactorEnableSchema = z.object({ code: z.string().length(6, 'Enter the 6-digit code from your authenticator app') })
export const twoFactorDisableSchema = z.object({
  password: z.string().min(1, 'Enter your password'),
  code: z.string().min(6, 'Enter a code from your authenticator app, or a recovery code').max(20),
})

export const autoNoShowSettingsSchema = z.object({
  messId: z.string().min(1),
  enabled: z.boolean(),
  fineAmount: z.number().int().min(0).max(2000, 'Fine amount is capped at ₹2000'),
})

export const wasteEntrySchema = z.object({
  messId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  meal: z.enum(['breakfast', 'lunch', 'snacks', 'dinner']),
  preparedKg: z.number().min(0).max(5000),
  consumedKg: z.number().min(0).max(5000),
  reason: z.enum(['Overproduction', 'Plate waste', 'Spoilage', 'Quality issue', 'Low attendance', 'Other']),
  note: z.string().trim().max(300).optional(),
}).superRefine((v, ctx) => {
  if (v.consumedKg > v.preparedKg) ctx.addIssue({ code: 'custom', path: ['consumedKg'], message: 'Consumed cannot be more than prepared.' })
})

export const FEEDBACK_CATEGORIES = ['Taste', 'Quantity', 'Hygiene', 'Service', 'Variety', 'Other']
export const feedbackSchema = z.object({
  kind: z.enum(['feedback', 'complaint']).default('feedback'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  meal: z.enum(['breakfast', 'lunch', 'snacks', 'dinner']),
  rating: z.number().int().min(1).max(5).optional(),
  category: z.enum(FEEDBACK_CATEGORIES),
  comment: z.string().trim().max(1000).optional(),
}).superRefine((v, ctx) => {
  if (v.kind === 'feedback' && v.rating === undefined) ctx.addIssue({ code: 'custom', path: ['rating'], message: 'Pick a rating from 1 to 5.' })
  if (v.kind === 'complaint' && !(v.comment && v.comment.length >= 5)) ctx.addIssue({ code: 'custom', path: ['comment'], message: 'Tell us what went wrong (at least a few words).' })
})
export const feedbackRespondSchema = z.object({
  status: z.enum(['open', 'in_progress', 'resolved']).optional(),
  response: z.string().trim().min(1).max(1000).optional(),
}).refine((v) => v.status !== undefined || v.response !== undefined, 'Nothing to update.')

export const INVENTORY_UNITS = ['kg', 'g', 'l', 'ml', 'pcs', 'packs']
export const INVENTORY_CATEGORIES = ['Grains', 'Pulses', 'Vegetables', 'Dairy', 'Spices', 'Oil & fats', 'Fuel', 'Other']
export const inventoryItemSchema = z.object({
  messId: z.string().min(1),
  name: z.string().trim().min(1, 'Name is required').max(80),
  unit: z.enum(INVENTORY_UNITS),
  category: z.enum(INVENTORY_CATEGORIES).default('Other'),
  quantity: z.number().min(0).max(1_000_000).default(0),
  reorderLevel: z.number().min(0).max(1_000_000).default(0),
})
export const inventoryPatchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  reorderLevel: z.number().min(0).max(1_000_000).optional(),
  archived: z.boolean().optional(),
}).refine((v) => Object.keys(v).length > 0, 'Nothing to update.')
export const inventoryMoveSchema = z.object({
  kind: z.enum(['receive', 'use', 'waste', 'adjust']),
  // receive/use/waste: how much moved (> 0). adjust: the counted quantity now on the shelf (>= 0) after a stock-take.
  qty: z.number().min(0).max(1_000_000),
  note: z.string().trim().max(200).optional(),
}).superRefine((v, ctx) => {
  if (v.kind !== 'adjust' && !(v.qty > 0)) ctx.addIssue({ code: 'custom', path: ['qty'], message: 'Quantity must be more than 0.' })
  if (v.kind === 'adjust' && !(v.note && v.note.length >= 3)) ctx.addIssue({ code: 'custom', path: ['note'], message: 'Say why the count changed (a stock-take, a correction…).' })
})
