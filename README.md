# LPU Smart Mess — Mess Demand Forecasting & Food-Waste Management System

A production-shaped React + TypeScript application built for **Lovely Professional University**: 10 boys'
hostels + 10 girls' hostels, each with its own dedicated mess and its own team (Admin, Mess Manager,
Kitchen Staff, Finance Manager, Hostel Warden), plus one university-wide Super Admin. Covers student meal
intentions, AI-assisted demand forecasting, food-waste tracking, inventory, procurement, finance, and
sustainability — with seven role-based experiences.

**Student identity is real, not a demo.** `/server` is an actual Express + SQLite backend — real bcrypt
password hashing, real JWTs, a real database that survives a restart. Student registration, login, the full
student roster (add/edit/transfer/delete), and QR check-in/no-show warnings/fines all run through genuine
HTTP requests to it (`src/services/authService.ts`, `studentService.ts`, `attendanceService.ts`). Everything
else — staff/admin accounts, hostel/mess topology, demand forecasting, food waste, inventory, finance,
menus — still runs on the frontend's seeded mock data, exactly as before. See § 6c for exactly where that
line sits and why.

---

## 1. Folder Structure

```
smart-mess/
├── src/
│   ├── components/
│   │   ├── layout/        Sidebar, Navbar, AppLayout, ProtectedRoute
│   │   └── ui/             DataTable, Modal, StatCard, ChartCard, AIInsight, SustainabilityScore, …
│   ├── pages/
│   │   ├── auth/            Login, Register, ForgotPassword, ResetPassword, OtpVerify
│   │   └── *.tsx             Dashboard, Forecast, ForecastAccuracy, MealIntention, Attendance, Meals,
│   │                         MenuPlanner, FoodWaste, WasteAnalytics, Inventory, InventoryForecast,
│   │                         Suppliers, Procurement, Students, Hostels, Feedback, Notifications,
│   │                         Kitchen, Reports, Sustainability, Simulator, Scenarios, Calendar,
│   │                         Finance, Settings, Profile, NotFound
│   ├── services/            authService, forecastService, mealService, wasteService, inventoryService,
│   │                         analyticsService, reportService, studentService, hostelService,
│   │                         procurementService, feedbackService, financeService, weatherService,
│   │                         searchService, api.ts (Axios client), menuItemService
│   ├── hooks/                useAuth, useForecast, useMeals, useWaste, useInventory, useNotifications, useDebounce
│   ├── store/                 useAuthStore, useUIStore (Zustand)
│   ├── data/                  mockStudents, mockHostels, mockMenus, mockOperations (91-day forecast/attendance/
│   │                          waste engine), mockWasteDetail, mockAttendance, mockInventory, mockSuppliers,
│   │                          mockPurchaseOrders, mockNotifications, mockFeedback, mockEvents, mockExpenses, mockUsers
│   ├── utils/                 calculations.ts, dateUtils.ts, formatters.ts, validators.ts (Zod schemas)
│   ├── types/                 index.ts — all domain models (mirrors schema.sql)
│   ├── lib/                   rng.ts — seeded PRNG so mock data is stable across reloads
│   ├── App.tsx                Route table (React Router, role-gated)
│   └── main.tsx
├── schema.sql                 Suggested PostgreSQL schema for the future backend
├── .env.example
└── package.json
```

---

## 2. Installation

```bash
cd smart-mess
npm install
```

## 3. Environment Variables

Copy `.env.example` to `.env` (already done in this deliverable):

```
VITE_API_URL=http://localhost:4000/api
VITE_ML_API_URL=http://localhost:8000/api
```

`VITE_API_URL` points at the real backend in `/server` (§ 3a) — required for registration, student login,
the Students page, and Attendance/QR check-in to work. `VITE_ML_API_URL` is for a future forecasting
service and isn't built yet; the app falls back to its built-in demo forecasting when it's unreachable.

## 3a. Real Backend (`/server`)

A genuine Express + SQLite API — not mock data. First run:

```bash
cd server
npm install
npm start           # seeds the DB on first run, then listens on http://localhost:4000
```

It creates `server/data/smartmess.sqlite` (git-ignored) the first time it starts, seeded with the same 20
hostels/messes, 2,000 students, and 101 staff accounts the frontend expects, so the transition is seamless.
Every seeded staff account and one student (`21000001`) are pre-claimed with password `demo1234` (the full
list is in § 6 — the Login page itself shows no credentials). Stop and restart the server — the data is still there; it's a real
file, not memory that resets on refresh. Set `CORS_ORIGIN`/`JWT_SECRET`/`PORT` via `.env` (see `.env.example`).

Endpoints: `POST /api/auth/register|login|send-otp|verify-otp`, `GET /api/students(?page=&pageSize=&search=)`,
`GET /api/students/lookup/:uid`, `POST/PATCH/DELETE /api/students(/:id)`, `POST /api/students/:id/transfer`,
`GET /api/students/:id/photo` (locked official photo — see § 6d), `GET/POST/DELETE /api/staff(/:id)`,
`POST /api/staff/parent-access/:studentId`, `GET/POST/DELETE /api/staff/:id/photo` (editable, unlike a
student's), `POST /api/attendance/checkin`, `GET /api/attendance`, `POST /api/attendance/process-no-shows`,
`GET /api/attendance/warnings/:studentId`, `GET /api/attendance/fines(?messId=&paid=)` and `/fines/:studentId`,
`POST /api/attendance/fines/:id/pay` (staff only), `GET/POST /api/hostels`, `GET /api/audit-log`. Every
route except lookup/photo-GET/health requires a JWT bearer token; auth and check-in routes are rate-limited.

## 4. Run

```bash
npm install
npm run dev          # frontend only — http://localhost:5173 (real-API features need the server too)
npm run dev:full      # frontend + backend together (needs `npm run server:install` once first)
npm run build         # type-check (tsc -b) + production build to dist/
npm run preview       # preview the production build locally
```

## 5. NPM Dependencies

**Runtime:** react, react-dom, react-router-dom, recharts, axios, zustand, react-hook-form, @hookform/resolvers,
zod, lucide-react, date-fns, clsx
**Dev:** typescript, vite, @vitejs/plugin-react, tailwindcss, @tailwindcss/vite, eslint (+ plugins), @types/*

## 6. Demo Credentials

> **The Login page deliberately shows no accounts and no passwords.** Sign-in details live here only, so a
> screenshot of the login screen (or a stranger opening it) never reveals a working login.

**Every account's password is real** — checked with bcrypt against the actual database in `/server`, for staff
and students alike (one unified `/auth/login`, see § 6c). Everyone signs in with a UID — an 8-digit registration
number for students, a 5-digit staff UID for everyone else. Email also works as a fallback.

**Password for every seeded demo account: `demo1234`**

| Role | Scope | UID |
|---|---|---|
| Super Admin | Entire university — every hostel, mess, and staff account | `10001` (Dr. Ashok Mittal) |
| Admin | One mess only | BH1: `10002` · BH2: `10007` · … |
| Mess Manager | One mess only | BH1: `10003` · BH2: `10008` · … |
| Kitchen Staff | One mess only | BH1: `10004` · BH2: `10009` · … |
| Finance Manager | One mess only | BH1: `10005` · BH2: `10010` · … |
| Hostel Warden | One hostel only | BH1: `10006` · BH2: `10011` · … |
| Student (the one pre-claimed demo login) | Their own hostel (BH1) | `21000001` (Ananya Iyer) |
| Parent / guardian | Read-only, their own child | none seeded — an Admin/Warden generates one from the **Students** page (the one-time password is shown on screen) |

Each hostel has its own five-person team, numbered in sequence: hostel *n* (1-based) has Admin `10002 + 5(n−1)`,
then Mess Manager, Kitchen Staff, Finance Manager and Hostel Warden in the next four UIDs. The Super Admin can
also see every team on the **Hostels** and **Staff** pages.

Only student `21000001` already has a login. Every other one of the 2,000 enrolled students is a **real,
unclaimed enrollment record** — they show up on the Students/Hostels pages and count toward their mess's
numbers, but nobody can sign in as them until they go through **Create a student account** with their real UID
and the exact name on their record, then verify their email (see section 6a below). This is intentional: it
demonstrates the real "enroll first, then self-register" flow rather than a shortcut.

> ### ⚠️ These are demo accounts — never ship them
> On its **first start with an empty database** the server seeds 101 staff accounts (including the **Super
> Admin**) and one student, all with the published password `demo1234`. That is fine for a demo and
> catastrophic on a real deployment, because this README is public. Before real use: sign in as the Super Admin
> and **change that password** (Profile → *Change password*), reset or delete every seeded staff account you don't need
> (**Staff** page → *Reset password* / remove), and remove demo students. When `NODE_ENV=production`, the server
> prints a loud warning at every start for as long as the Super Admin still has the default password.

### Multi-tenancy model

- **One hostel = one mess**, named after the hostel (`BH1 Mess`, `BH2 Mess`, … `GH1 Mess`, … — a `general`-
  category hostel gets `Central Mess N` instead). LPU has 10 boys' hostels (`BH1`–`BH10`) and 10 girls'
  hostels (`GH1`–`GH10`), each seeded with 100 real-format student accounts (2,000 total) — more can
  always be added from the Students page, and new students self-register with their real UID (see § 6a) —
  their hostel/mess is fetched automatically, never picked.
- **Super Admin** is the only role that can switch between messes, create new hostels, or see
  university-wide analytics (`College Overview`, cross-mess `Messes` management).
- **Admin** (and every other staff role) is permanently scoped to their own mess — no mess switcher, and
  every page only shows that mess's data.
- **Staffing a new mess is that mess's Admin's job.** When the Super Admin adds a hostel, only its Admin
  account is created automatically (with an empty student roster). That Admin then signs in and builds out
  their own team — Mess Manager, Kitchen Staff, Finance Manager, Hostel Warden — from the **Staff** page,
  and adds real students from the **Students** page.

## 6a. Mess Enrollment, UID Auto-Fill & Student Sign-up

**"Taken mess" = being on the mess roster** (the `students` table). The university's own records of every student
live separately in `university_directory` (UID → name, email, phone, branch, year). Load yours with
`npm --prefix server run import:directory -- <file.csv>`; a fresh demo database ships with some students who are in
the directory but have *not* taken mess.

**Warden / Admin adds a student (Students page → Add student).** Type the **UID**: name, email, phone, branch and
year fill in from the university record (name and email are locked — staff can't type over the record). Pick the
hostel and room, save. A UID that is already on a roster is flagged (and only staff of that mess are told who it
is); a UID not in the records says so and offers "No UID yet" instead. **A UID is required** — the form shows nothing else
until one is found or "No UID yet" is ticked. CSV import columns: `uid` (details come from the university record), or `name,email,noUid=yes`.

**Student signs up (`/register`) with just their UID:**

1. UID **on the roster** → the page shows their hostel and mess (name masked) and the masked email on file.
   UID **not on the roster** → *"You haven't taken mess. For any query, visit the warden office."* and nothing
   further is possible. (Signing in with such a UID gives the same message.)
2. A 6-digit code is emailed to the **address on file, never one typed in the browser**. This is deliberate: UIDs are
   sequential, so if the student could type their own email, knowing someone's UID would be enough to take over
   their account. Codes are rate-limited per student so the inbox can't be flooded.
3. Once the code is verified the student's name appears, and the only thing left to choose is a password.
4. `POST /api/auth/register` attaches the login to the existing roster row. The older explicit form
   (`uid + name + email + password`, with the fuzzy name check) still works for API clients.

Removing a student from the roster puts their UID back to "hasn't taken mess".

### Students who have no UID yet

A new admission may be living in a hostel before the university has issued a UID. Rather than inventing a number that
*looks* like a real UID (and could later collide with one), staff choose **No UID yet**, enter name/email and a **reason**
(recorded in the audit log), and the student gets a **temporary ID: `TMP-00001`, `TMP-00002`…** — a separate namespace that
can never clash with an 8-digit UID.

- They're on the roster and count toward the mess and its beds, and can be checked in with the temporary ID.
- They show a **Temp ID** badge, and the Students page keeps a running count of them with a "show only these" filter.
- They **can't create an app login yet** (sign-up says "visit the warden office"), because the account belongs to the real UID.
- When the real UID arrives, **Assign UID** (the card icon on their row, or `POST /api/students/:id/assign-uid`) swaps the
  temporary ID for it in one transaction — check-ins, intentions, fines, warnings and parent links all follow. If the
  university record for that UID exists, its name/email/branch/year become the source of truth. Refused if the UID is already
  on a roster, the student already has a real UID, or the actor is outside that hostel.

The Calendar shows students and parents campus events only; stock expiries and supplier deliveries are visible to staff.

## 6a-i. Password expiry (staff)

Staff passwords expire after `PASSWORD_MAX_AGE_DAYS` (default **90**, `0` = never). On the first sign-in after that,
the account lands in the same forced "choose a new password" state as a temporary password: the API refuses
everything except changing it. Accounts with no recorded change date start their clock at their next sign-in, so
turning this on never locks anyone out. Students are not forced to rotate.

## 6a-ii. Two-factor sign-in (authenticator app)

Anyone — staff, parents, students — can turn on a second sign-in step from **Profile → Two-factor sign-in**.

- **Setup:** the server generates a secret, the page shows it as a QR code (and as text for manual entry). Two-factor is
  *not* on until the person types a live 6-digit code, which proves the app is set up. They are then shown **8
  one-time recovery codes**, once.
- **Sign-in:** a correct password returns *no session*, only a 5-minute challenge. `POST /auth/login/2fa` exchanges the
  challenge plus a code (or a recovery code) for the real session. The challenge cannot be used as a session.
- **Protections:** a code can't be replayed (each 30-second step is accepted once); wrong codes count toward the same
  5-strikes account lockout as wrong passwords; turning it off needs the password **and** a code, so a borrowed signed-in
  session can't strip it. The secret is stored AES-256-GCM-encrypted (key derived from `JWT_SECRET`); recovery codes only as hashes.
- Standard RFC 6238 TOTP (SHA-1, 6 digits, 30 s), implemented in `server/src/totp.js` on `node:crypto` — no new dependency;
  verified against the RFC 4226 test vectors. It is optional per account; nothing forces anyone to enrol.
- **Locked out with no phone and no recovery codes?** There is deliberately no self-service bypass. An administrator with
  database access clears `totp_enabled`/`totp_secret` on that account.

## 6a-iii. Real demand forecasting

`/forecast` and `/forecast-accuracy` no longer read the frontend's demo data. `GET /api/forecast` (server/src/forecasting.js)
computes demand from the server's own records:

- **History:** actual check-ins per day per meal for that mess (only days the mess scanned anyone count — a day with no
  scans is "not recorded", not "0 ate").
- **Intentions:** the real `will_eat` / `will_not` submissions for the target day, blended in in proportion to how many of
  the eligible (active, not on leave) students answered.
- **Methods that really run:** same-weekday average (default — mess demand is weekly), weighted/plain moving average,
  exponential smoothing, linear trend, 28-day average. The Random Forest / XGBoost / LSTM options are gone: there is no ML
  service, and the UI no longer pretends there is.
- **Confidence is measured, not asserted:** 100 − the method's own walk-forward error on this mess's history (each past day
  predicted using only earlier days), shown only once ≥ 5 days can be backtested.
- **No data → no number.** With no history and no intentions the page says so. With intentions only, the figure is labelled
  as a floor (students who said they'll eat), not an estimate of the total.
- Staff only, own mess only (Super Admin: all). Kitchen quantities are still worked out in the browser from the mess's
  serving size, safety buffer and cost-per-kg settings. The old "expected leftover/waste" tiles were removed: they were
  fixed percentages with nothing behind them.
- **Still demo data:** the other analytics screens (dashboards, waste analytics, inventory forecast, sustainability) —
  waste, inventory and finance aren't recorded on the server yet, so there is nothing real to compute them from.
- **Try it on a fresh install:** it starts empty (honestly). `npm --prefix server run seed:demo-history` writes *simulated*
  past check-ins (tagged `scanned_by = 'demo-history'`; remove with `-- --remove`) so the pages have something to show. Don't run it in production.

## 6b. Meal Check-in: Signed QR, Meal Timings, Official Photo, No-Show Warnings & Fines

The Attendance page (`/attendance`) is a real, working feature — not a UI mockup.

**The student's QR is not their UID.** It is a token the server signs (`GET /api/attendance/my-qr`) that expires after 60
seconds; the page asks for a fresh one before the old one runs out and shows a countdown. A screenshot, a photo of someone
else's screen, or a QR someone generates from a UID is worthless a minute later — the server rejects it with *"That QR code
has expired — screenshots don't work"* or *"not a valid Smart Mess QR"*. The token also can't be used as a login session.
Only the student gets one (parents follow attendance but aren't given a code to present).

**At the counter** (Kitchen Staff / Mess Manager / Admin / Super Admin):

1. **Pick the meal** (Breakfast / Lunch / Snacks / Dinner). Nothing is pre-selected.
2. If that meal **is being served right now** (mess-local time, from the *server's* clock, not the phone's), the device camera
   opens and scans continuously. If it isn't, the camera stays off and the screen says why — *"This is not Dinner time —
   Dinner is served 19:30–22:00 (it's 13:05 now). Lunch is being served now."* — with a one-tap switch to the meal that is on.
   The server enforces the same rule, so it can't be bypassed from the browser.
3. A good scan is verified **against the database**: signature and expiry, the student exists and is **on this mess**, their
   membership is **active**, and they haven't already had this meal. Then the screen shows their **official photo**, name, UID,
   hostel · room, branch · year, the meal, and the **date and exact time** (in the mess's timezone), plus whether it was a QR
   scan or a typed UID. Every refusal says why (expired QR, not on this mess, "send them to the warden office", already
   checked in at 12:41…).
4. **Scanner works on any phone:** the browser's built-in `BarcodeDetector` where it exists, otherwise a bundled JavaScript
   decoder (`jsqr`) — so iPhone Safari and Firefox work too. Browsers only allow cameras on **https** pages (or `localhost`);
   on plain http the page says so and manual entry still works.
5. **Phone dead or camera broken?** Type the UID instead. It's recorded as a *manual* check-in (`attendance.method`), shown as
   such on the result card and in the audit log. Manual entries can use the offline queue (below); QR scans cannot, because only
   the server holds the signing key — offline, the console tells you to type the UID.

**Meal timings.** Defaults: Breakfast 07:00–09:30, Lunch 12:00–14:30, Snacks 16:30–18:00, Dinner 19:30–22:00, in
`MESS_TIMEZONE` (default `Asia/Kolkata`). A Mess Manager / Admin / Super Admin edits them per mess (*Edit meal timings*;
validated: end after start, no overlaps; audited) or resets to the defaults. A window includes its start minute and excludes
its end minute. Set `ENFORCE_MEAL_WINDOWS=0` to turn the rule off entirely (the tests do; the e2e run does).

**Official photo.** Stored in the database (`students.photo_data`), set by the staff who run the roster — the camera icon on a
student's row (take or choose a photo; it is resized in the browser) — never by the student. It is **personal data, so it is
served only behind login**: the student themself, their linked parent, or staff of that student's own mess. Load photos in
bulk with `npm --prefix server run import:photos -- ./photos` (files named `21000001.jpg`; real image bytes are checked, not
extensions). A photo on the university record comes along automatically when a student is added by UID. If a student has no
photo yet, the result card says *"No official photo on file — check their ID card"* rather than showing a placeholder as if it
were them.

- **No-show warnings**: mess staff can manually "Process no-shows" for a meal once its service window has closed. Any student
  who marked "will eat" but was never scanned in gets a warning — idempotent, so re-running it never double-warns.
- **Fines**: 3 warnings within the same calendar month automatically trigger a flat fine (amount configurable per mess in
  Settings, `MessSettings.noShowFineAmount`). Students (and their linked Parent/Guardian account) see their current warning
  count and any unpaid fines on their own Attendance page.

### Counter hardening and conveniences

- **A live QR works once.** Each QR carries a one-time id, burned by the check-in that used it (in the same transaction, so two
  counters scanning it at the same instant can't both succeed). A replay is refused with *"already been used"*. A scan that is
  *refused* for another reason (wrong meal time, etc.) does not burn it.
- **Printed ID cards** (Students page → the QR icon on a row → *Print card*) for students with no phone login — a temporary
  `TMP-` ID, a new admission, a lost phone. The card's QR is permanent but **revocable**: it names a card id, not the UID, so it
  keeps working when `TMP-…` becomes the real UID, and *Reissue* makes a new one and kills the old printout immediately. A
  printed card can be photocopied — which is exactly why the result card shows the official photo and says "compare the photo".
- **A trail for suspicious scans.** Forged/unknown QR, a replayed QR, a wrong-mess student, an inactive membership, a revoked
  card and an unknown UID are all written to the audit log; managers see them in **Scan alerts** on the Attendance page.
  (A merely *expired* QR is ordinary and is not logged.)
- **Unusual-volume alerts.** One counter account checking in more than 45 students in 2 minutes, or more than 12 *typed* UIDs in
  5 minutes (the weaker path, so it has its own lower limit), raises one alert per 10 minutes. Tune with
  `SCAN_SPIKE_PER_2MIN` and `SCAN_SPIKE_MANUAL_PER_5MIN`. Scans replayed from the offline queue never trigger it.
- **Approved leave** doesn't block a meal (they may be back early) but the result card shows an amber warning, and the
  warning tone plays, so the counter looks at the person.
- **Check-in notifications — email and real push.** A student can turn on *Email me when I'm checked in*, and/or
  *Notify this device* (push). Each meal check-in then reaches them — the push even arrives with the site closed — and says
  when the counter *typed* the UID, the clue that reveals a check-in they didn't make. See "Push notifications" below.
- **Live count** at the top of the console: *312 checked in for Lunch · 480 said they'd eat · 520 on this mess · 38 haven't answered*,
  refreshed after every scan and every 20 s.
- **Sound, vibration and a full-screen flash** after each scan: rising beep + green for a good scan, a different tone + amber
  when a human should look (on leave, or no photo on file), a low buzz + red for a refusal. The *Sound* button turns the
  audio/vibration off (the flash stays) and is remembered on that device.
- **Meals that run past midnight.** Set a window whose end is earlier than its start (e.g. Dinner 22:00–01:00). A scan at
  00:30 is still that evening's dinner, so it is recorded under the **previous** calendar date. Overlaps are checked across
  midnight too.
- **Check this device.** On the console, *Check this device* tests secure-page, camera, permission and the decoder in use, then
  lets you try a real read — without recording anything. A written checklist for the first real-phone test is in
  [`docs/DEVICE_TEST.md`](docs/DEVICE_TEST.md).

### Push notifications (Web Push)

Real push, no paid provider: the server sends an encrypted message to the push service the *browser* chose (Google, Mozilla,
Apple or Microsoft — all free), which wakes the app's service worker (`public/sw.js`) even when the site is closed.

- **Who gets what.** Students: a notification after each meal check-in (*"Lunch check-in recorded — Checked in at 13:05. Not
  you? Tell the warden office."*). Mess Managers and the hostel Admin: *Suspicious meal scan* (forged/unrecognised QR, a replayed
  QR, a revoked ID card) and *Unusual check-in volume* — at most **one per kind per mess per 10 minutes**, so 50 bad scans is one
  buzz. Routine refusals (inactive member, wrong mess) don't push. Lock-screen text never contains a UID.
- **Turning it on.** A student: Attendance page → *Notify this device*. A manager: the *Scan alerts* card → *Alert this device*.
  The permission prompt appears only when the button is tapped. *Send a test* confirms the device really receives it. Up to 5
  devices per account.
- **iPhone / iPad:** Apple only allows push for web apps added to the Home Screen (Share → Add to Home Screen, open it from
  there, then turn notifications on). The page says exactly that if it's not set up. Android and desktop browsers work directly.
- **HTTPS is required** (browsers refuse service workers/push on plain http, except `localhost`).
- **Shared phones:** a device belongs to whoever turned notifications on last, and signing out detaches it, so the previous
  person's notifications stop arriving. You can only remove your own devices.
- **Keys.** VAPID keys are generated at first boot and stored in the database (`app_secrets`) so subscriptions survive restarts.
  For production set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (`mailto:you@university.edu`) in the
  environment — generate a pair with `npx web-push generate-vapid-keys`. **Changing the keys later orphans every existing
  subscription** (people would have to turn notifications on again).
- **Safety.** The server posts only to the real browser push services (`fcm.googleapis.com`, `*.push.services.mozilla.com`,
  `*.push.apple.com`, `*.notify.windows.com`: https, no credentials, no custom port). Without that, registering a device would let
  anyone make the server call any URL (SSRF). Dead devices (push service answers 404/410) are removed automatically; a push
  outage never blocks a check-in.
- **Not covered:** the browser can silently rotate a subscription (`pushsubscriptionchange`); the app re-checks on each page load and
  a device that has gone stale simply shows as off until turned on again.

## 6c. What's Real vs. What's Still Mock Data

Given how much of this build now talks to a real backend, here's the exact line, so nothing is ambiguous:

**Real (backed by `/server`, an actual Express + SQLite database):**
- **Everyone's login** — students and staff alike (Super Admin, Admin, Mess Manager, Kitchen Staff, Finance
  Manager, Hostel Warden, Parent) — bcrypt password hashes, JWT tokens, one unified `/auth/login`
- The student roster: list, add, edit, delete, transfer between hostels, UID lookup (`studentService.ts`)
- Staff accounts: list, add, remove per mess, Parent-access generation (`userService.ts`)
- QR check-in, no-show warnings, and fines — including mess-wide fine review and "mark paid" (`attendanceService.ts`)
- Every student's official photo (locked, § 6d) and every staff member's own uploadable photo (§ 6d)
- A real, persisted audit log for every action above (`GET /api/audit-log`) — survives a restart, unlike the
  old frontend-only log, which still covers the handful of actions that remain frontend-mock (§ 6e)
- Hostel/mess *counts* shown on the Hostels page (real headcounts from the database)
- Input validation (zod schemas, `server/src/schemas.js`), rate limiting on auth/check-in endpoints
  (`server/src/rateLimit.js`), and CORS restricted to the configured frontend origin

**Also real now:** food-waste entries (`/api/waste`, § 6g), the meal-intention reminder preferences, device sessions,
photo consent, automatic no-show settings/runs, and the attendance CSV export. **Meal intentions** and **demand
forecasting** are real as well (§ 6a-iii) — the paragraph below predates that.

**Still frontend mock data (`src/data/*`, unchanged from before this backend existed) — every one of these screens now
carries a "Demo data" banner and a "demo" tag in the sidebar, so nobody mistakes it for a record:**
- Hostel/mess *topology* — which hostels exist, their names — though creating a hostel now also mirrors it
  into the real database (`POST /api/hostels`) so real students/staff can be enrolled against it
- Waste *analytics* charts, inventory, procurement, suppliers, finance, menus, notifications, feedback, calendar, sustainability, reports, leaderboard, scenarios/simulator, kitchen prep and the university overview
- Meal *intentions* ("will eat"/"will not eat") — `mealService.ts` — which is why `processNoShows` has the
  frontend hand it the list of students who intended to eat, rather than looking that up itself

This split is deliberate, not a shortcut: the identity-and-attendance layer is the part that most needed to
stop resetting on every page refresh and stop accepting any password, so that's what's real. Hostel/mess
topology and the forecasting/waste/finance engine are the natural next step if this goes further.

## 6d. Real Photos — Locked for Students, Editable for Staff

Every **student** has an official enrollment photo at `GET /students/:id/photo` — deterministically generated
from their UID, so it always matches the university's record. `StudentAvatar` (`src/components/ui/StudentAvatar.tsx`)
just points an `<img>` at that URL; there is deliberately **no upload/edit endpoint for it** — a student can
never change their own official photo, like a real ID card on file with the registrar.

Every **staff member** has a photo too (`GET /staff/:id/photo`), but — unlike a student's — it's a
deliberate, real contrast: `StaffAvatar` (`src/components/ui/StaffAvatar.tsx`) lets a staff member upload,
replace, or remove their own (`POST`/`DELETE /staff/:id/photo`, capped at ~1.5 MB, stored as a base64 data
URL in the database). A Super Admin can also set/clear anyone's photo on their behalf. Falls back to the
same deterministic initials image when nothing's been uploaded. This shows up on the Profile page and the
Staff table.

## 6e. Backend Hardening

- **Real, persisted audit log** (`audit_log` table, `GET /api/audit-log`) — every real-backend action
  (registration, staff added/removed, check-ins, no-show warnings/fines, fine payments, transfers) is logged
  with the actual actor's real name (resolved server-side from their token, `resolveActorName` in
  `server/src/db.js`), not just their UID. `src/services/auditService.ts` merges this with the handful of
  still-frontend-only actions (calendar edits, hostel topology creation) into one list.
- **Fine payment is a real, staff-only action** — `POST /api/attendance/fines/:id/pay` explicitly rejects
  `STUDENT`/`PARENT` tokens; a student can see their own fines (Attendance page) but can't self-clear them.
  Staff see a mess-wide "Outstanding Fines" panel with a real "Mark paid" button.
- **Token expiry is handled, not silent** — JWTs expire after 7 days. Any request rejected with a stale
  token fires a `smartmess:auth-expired` event (`src/services/api.ts`); `useAuthStore` catches it, logs the
  person out, and shows a real reason on the Login page instead of leaving them stuck making requests that
  silently keep failing.
- **Rate limiting** on login/register/OTP/check-in (in-memory sliding window, `server/src/rateLimit.js`) —
  20 attempts per 5 minutes on auth endpoints, 60/minute on check-in. Resets on server restart; a real
  multi-instance deployment needs a shared store (Redis) instead — noted with a `TODO(production)`.
- **Request validation** — every mutating route validates its body against a zod schema
  (`server/src/schemas.js`) before touching the database, with clear `field: message` errors on failure.
- **CORS is restricted** to `CORS_ORIGIN` (default `http://localhost:5173`, `server/.env.example`) instead
  of wide open.
- **Pagination** — `GET /api/students?page=&pageSize=` (capped at 500/page) returns `{ data, total, page,
  pageSize }` instead of the full roster; omitting both still returns a plain array for backward
  compatibility with existing callers.
- **Real password reset** — `POST /api/auth/request-password-reset` generates a real 6-digit code, hashes
  it (never stored in plaintext), gives it a 15-minute expiry (`password_reset_tokens` table), and emails it
  (§ 6f). `POST /api/auth/reset-password` checks that hash + expiry, actually updates the bcrypt password
  hash, and revokes every existing session for the account. The same `{ sent: true }` response comes back
  whether or not the account exists, so the endpoint can't be used to find out which UIDs are registered.
- **Account lockout** — 5 wrong passwords in a row locks the account for 15 minutes (`failed_attempts`/
  `locked_until` columns, `server/src/db.js`'s `recordFailedLogin`/`lockoutStatus`), on top of (not instead
  of) the per-IP rate limiter. A correct password before the threshold clears the counter.
- **Real token revocation** — every account has a `token_version`; each JWT carries the version it was
  issued under (`tv` claim), and `requireAuth` checks it still matches the database on every request. Logout
  (`POST /api/auth/logout`) and password reset both bump it, which instantly invalidates every outstanding
  token for that account — not just the one in the browser that called logout.
- **New staff get a real generated temporary password** (`server/src/routes/staff.js`'s
  `generateTempPassword()`), not a fixed default — returned once in the API response for the creating Admin
  to relay, and emailed to the new account (§ 6f). Same for Parent-access accounts.
- **Audit log has real filters** — `GET /api/audit-log?action=&actorId=&from=&to=&messId=`, with a matching
  filter bar on the Audit Log page (action dropdown, actor UID, date range).

## 6e-i. Mess-Scoped Authorization (who may act on which mess)

Authentication says *who you are*; this says *what you may do, and to which mess*. It is enforced on the
**server** — the frontend hiding a button is never the control. A hand-crafted request must fail the same way.
All policy lives in one file, `server/src/authz.js`.

- **Scope rule:** `SUPER_ADMIN` may act on any mess. Every other staff role may act only on the mess whose
  hostel matches *their own account's* `hostel_id`. That value is read from the **database on every request**
  (`requireAuth`, `server/src/auth.js`), never trusted from the JWT — so a forged `hostelId` claim does
  nothing, and reassigning someone to another hostel takes effect on their very next request.
- **Role gates** (mirroring what the UI already offered each role): team management (`POST/DELETE /staff`,
  `GET /staff`) → Admin / Super Admin; counter actions (`POST /attendance/checkin`,
  `/attendance/process-no-shows`) → Super Admin / Admin / Mess Manager / Kitchen Staff; roster edits
  (`/students` create/patch/delete/bulk, parent access) → Super Admin / Admin / Mess Manager / Hostel Warden;
  student **transfer**, **hostel creation** and the **audit log** → Super Admin only.
- **Scope is checked before existence**, so someone outside the mess can't use error differences to probe
  which hostels or UIDs exist (the 403 for a real and a made-up student UID is byte-identical).
- **Reads are scoped too:** a student sees only themselves, a parent only their linked child, staff only their
  own mess's students/attendance/fines. `GET /students` and `GET /staff` return only the caller's own mess
  unless they're Super Admin.
- **Fixed along the way:** several of these endpoints previously accepted *any* valid token — including a
  student's. `PATCH /students/:id` can no longer be used to move someone to another hostel (that's a
  Super-Admin transfer), and the avatar upload accepts raster images only (SVG can carry script).
- **Blocked attempts are audited:** every refused cross-mess request writes a `cross_mess_attempt_blocked`
  entry (actor, their hostel, target), visible to the Super Admin on the Audit Log page.

Tests: `server/test/authz.test.js` — 32 cases that craft the cross-mess requests directly (BH2 staff → BH5)
and assert both the `403` and that **nothing was written**, with a positive control for each action. Run
against the pre-fix code, 27 of them fail.

## 6e-ii. Capacity, Bulk Import, Indices, Headers, Backups

- **Hostel capacity is enforced, not just displayed.** Adding student #113 to a 112-bed hostel returns
  `409 HOSTEL_FULL` (`"BH1 is at full capacity (112/112 beds)…"`). The same check guards single add, bulk
  import (row-by-row, so an over-full file admits up to the last free bed), **transfer**, and `PATCH`. Occupancy
  is "every enrolled student, any status" — the same number `GET /hostels` reports (now with an `available`
  field). SQLite access is synchronous, so check-and-insert can't race. The Students page shows the reason
  inline and keeps the form open.
- **Students CSV import is real.** `POST /api/students/bulk` validates every row independently (same rules as
  adding one: role, mess scope, capacity, case-insensitive duplicate email) in a single transaction and
  returns `{ created, failed: [{ line, error }] }`. The Students page parses the file with a real CSV parser
  (`src/utils/csv.ts` — quoted commas, `""`, CRLF, Excel's BOM) and lists each rejected line with its reason.
  **Format:** header row required; columns (any order, case-insensitive): `name`, `email` (required), `phone`,
  `hostelId`, `room`, `year`, `branch`, `mealPreference`, `status`. A hostel-level admin may omit `hostelId`
  (defaults to their own); the Super Admin must give one per row. Max 1000 rows per request (the UI batches).
- **Database indices** are created with `IF NOT EXISTS` in `server/src/db.js`, so an existing database picks
  them up on next start — no migration. They cover hostel scoping/occupancy, login and reset lookups (on
  `lower(email)`/`lower(id)`, matching how the queries actually compare), attendance by mess/date/meal, fines,
  staff teams, and every audit-log filter. A one-time `ANALYZE` (then `PRAGMA optimize` each boot) gives the
  planner real statistics — without it SQLite was observed ignoring an index. Measured at 20,000 students /
  300,000 check-ins: login lookup **77×** faster, a mess's check-in list **311×**, occupancy count **17×**. A
  test asserts every hot query's `EXPLAIN QUERY PLAN` uses an index, so a future edit that regresses to a
  table scan fails CI.
- **Security headers** via `helmet` (`server/src/app.js`): this process serves only JSON and avatar images,
  so CSP is `default-src 'none'; frame-ancestors 'none'`, plus `X-Frame-Options: DENY`, `nosniff`, HSTS,
  `Referrer-Policy`, COOP, and no `X-Powered-By`. Error responses carry them too. Avatars get a relaxed
  `Cross-Origin-Resource-Policy` (so the frontend's `<img>` works) but a sandboxed, script-less CSP.
  **Not covered:** the *frontend's* HTML is served by whatever hosts `dist/` (nginx, Vercel, …) — set its CSP
  and headers there (§ 11); this server can't do it.
- **Backups** — see § 6e-iii below.

## 6e-iii. Backing Up and Restoring the Database

The SQLite file (`server/data/smartmess.sqlite`) now holds real students, password hashes, attendance, fines
and the audit trail — treat it accordingly.

```bash
cd server
npm run backup                          # → server/backups/smartmess-<UTC timestamp>.sqlite, keeps the newest 14
npm run backup -- --out /mnt/safe --keep 30
npm run restore -- --latest --yes       # STOP THE SERVER FIRST
npm run restore -- backups/smartmess-20261005-020000-000.sqlite --yes
```

- **Safe while the server is running.** It uses SQLite's online backup API — *not* `cp`. The database is in WAL
  mode, so recent commits can live in `smartmess.sqlite-wal`; copying just the main file can miss them or
  capture a torn state.
- **Verified before it counts.** The snapshot is written to a `.partial` file, checked
  (`integrity_check`, `foreign_key_check`, expected tables present) and only then renamed into place; retention
  pruning runs only after a good backup, and only touches this tool's own `smartmess-*.sqlite` files.
- **Restore is reversible.** The backup is verified first (a corrupt or wrong file is refused and the live
  database is left byte-for-byte untouched), the current database is saved as `<db>.before-restore-<time>`, and
  the old `-wal`/`-shm` files are deleted so stale history can't leak into the restored file. It refuses to run
  without `--yes`.
- **Schedule it.** The app doesn't schedule backups itself, but the deployment kit does: `docker-compose.prod.yml` runs a backup container every 24 h, `deploy/systemd/` has a timer for non-Docker installs, and `GET /api/health/ready` turns red if the newest backup is older than 36 h. See `docs/DEPLOYMENT.md`. Plain cron also works: `0 2 * * * cd /srv/smart-mess/server && npm run backup >> backup.log 2>&1`.
- **Off-machine copies are your job** (`deploy/offsite-backup.sh` encrypts and uploads one). A backup next to the database doesn't survive losing the disk — sync
  `server/backups/` somewhere else (object storage, another host). Backup files contain password hashes and
  personal data; they're created owner-read-only (`0600`) where the OS supports it, and `server/backups` is
  git-ignored. Env: `DB_PATH`, `BACKUP_DIR`, `BACKUP_KEEP`.
- **Test it once for real:** restore a backup into a scratch location (`--db /tmp/check.sqlite`) before you
  need it. `server/test/backup.test.js` does this against a live WAL-mode database on every run.

## 6e-iv. Sessions, Email Verification and Other Security Changes

- **Sessions are httpOnly cookies, not `localStorage` tokens.** The browser app never sees the JWT: login
  sets `smartmess_session` (`HttpOnly; SameSite=Lax; Path=/api`, plus `Secure` in production or when
  `COOKIE_SAMESITE=None`), so an XSS bug can't steal it. Only the (non-secret) profile is cached for the UI.
  Non-browser clients (scripts, tests) can still use `Authorization: Bearer` and get the token in the login
  response; browsers (which send `X-SmartMess-Client`) do not.
- **CSRF defense:** a cookie-authenticated `POST/PATCH/PUT/DELETE` must carry `X-SmartMess-Client`. A cross-site
  form or image can't add a custom header, and a cross-site `fetch` that does is stopped at the CORS preflight,
  which only the configured `CORS_ORIGIN` passes (`credentials: true`, exact origin, never `*`). Bearer
  requests aren't affected (nothing is sent automatically). **If the web app and API are on different
  registrable domains**, set `COOKIE_SAMESITE=None` (requires HTTPS).
- **Production refuses to boot insecurely.** With `NODE_ENV=production` the server exits unless `JWT_SECRET`
  is set to something that isn't the repo's dev default and is 32+ characters, and `CORS_ORIGIN` is set.
- **Registration email verification is real.** `POST /auth/send-otp` emails a 6-digit code (stored only as a
  SHA-256 hash, 10-minute expiry); `verify-otp` takes **email + code** (5 wrong tries kills the code);
  `/auth/register` refuses (`403 EMAIL_NOT_VERIFIED`) unless that email was verified in the last 30 minutes and
  **consumes** the verification. Before this, any 6 digits were accepted and the UI quietly fell back to "verified"
  if the server was down. In dev the code is in `server/data/outbox/` (or the server log).
- **`GET /students/lookup/:uid` no longer leaks the student.** It returns only hostel/mess names, an
  already-registered flag, and a masked name (`R•••• S••••`) — no name, email, phone or room — and is rate-limited
  (the limiter used to key on the full path, so a sweep across UIDs was never throttled; fixed with a `scope`
  option). The old response handed attackers the very name that `/register` checks. **What remains:** identity
  proof at registration is "knows the UID **and** the exact enrolled name **and** controls the email" — it does
  not verify that the email belongs to that student. For stronger assurance, send the code to the university
  email on record instead of a typed one.
- **The registration name check is strict now (it was nearly open).** It used to accept any substring or ≥72%
  similarity — measured over all 2000 seeded students that let a bare **first name** in for 100%, a masked
  `R•••• M•••••` for ~8% and *another student's* name for ~3% — and its refusal message even printed the enrolled
  name (`on file: "…"`). Now every word must match (any order, case/punctuation ignored), a single typo is
  forgiven only in words of 6+ letters, the error reveals nothing, and a UID locks for 15 minutes after 5 wrong
  names (in memory — resets on a server restart; the per-IP limiter still applies). Students must type their
  name exactly as enrolled.
- **Meal intentions live on the server and no-shows are computed from them.** `PUT /intentions/:studentId`
  (a student for themselves until the 2:00 AM IST cutoff; counter staff in their own mess any time — how an
  approved change request is applied). `process-no-shows` no longer accepts a list of UIDs: it reads
  `meal_intentions`, skips "will not eat", on-leave and already-checked-in students, and caps `fineAmount` at
  ₹2000. Previously any counter account could name arbitrary students to be warned and fined.
  **Still mock:** the forecasting/analytics screens that *read* intentions use the frontend's demo data.
- **Students are emailed** when they get a no-show warning or a fine (sent after the response, failures are
  logged and never break the request).
- **Offline check-in.** If a scan never reaches the server, the console saves it on the device with its real
  time, shows it as *waiting* (never as confirmed), and replays it oldest-first when the browser is back online
  (or via **Sync now**, or every 30 s). A server answer is final and never queued; "already checked in" on
  replay counts as done; any other refusal is listed with its reason; the server rejects scan times in the
  future or older than 48 h. **Limits:** the queue is per browser (`localStorage`), and a student is only
  recorded as present once it syncs.
- **Room-level occupancy.** Each hostel has an optional *beds per room* limit (Hostels page → Admin/Super Admin;
  `PATCH /hostels/:id`). Enforced (case-insensitively, ignoring "Unassigned") on add, bulk import, move,
  transfer; refused if existing rooms already exceed a new limit. Total bed capacity is Super-Admin-only and
  can't be set below current occupancy. Default is *no limit*, so existing data is untouched.
- **Credentials are actually shown.** Adding staff, importing staff and generating parent access display the
  server-generated one-time password (the UI used to print a fake `demo1234`); bulk imports offer a CSV download.
  `POST /staff/:id/reset-password` issues a new one (and revokes sessions) — the recovery path for an existing
  parent account. The Staff CSV import now reports each rejected row instead of stopping at the first failure.

## 6e-v-a. Robustness Found by Adversarial Testing

Found by attacking a running server (175 role×action probes, token forgery, injection strings, 20–40-way
concurrent bursts), then fixed and pinned with regression tests (`server/test/concurrency.test.js`, `hardening.test.js`):

- **Async route errors no longer hang requests or crash the process.** Express 4 doesn't catch a rejected promise
  from an `async` handler: the request hung forever and, on current Node, the unhandled rejection kills the server.
  A double-click on "generate parent access" produced exactly that. `express-async-errors` now routes them to the
  error handler; database constraint violations become `409 CONFLICT`; parent access is idempotent under a race.
- **Atomic claims across `await bcrypt`.** Registration and password-reset checked their preconditions *before*
  awaiting the hash, so simultaneous requests could all pass. Registering one UID three ways at once created three
  "successful" accounts; one reset code could set five passwords. Each is now one transaction that re-checks
  (`password_hash IS NULL`, `used = 0`, verification consumed) and rolls back on loss.
- **Malformed JSON → 400 and an oversized body → 413** (both were 500s, with stack traces in the log).
- **Rate limiting behind a proxy.** Without `trust proxy` every user behind nginx / a load balancer shares the
  proxy's IP — one bucket for the whole campus. Set **`TRUST_PROXY=1`** (number of proxy hops) when deployed behind
  one. It is off by default **on purpose**: trusting `X-Forwarded-For` with no proxy lets any client pick their own IP.
- **Login limiter sized for a campus.** Was 20 per 5 min per IP (shared by every route) — one hostel's Wi-Fi at
  breakfast would lock itself out. Login now has its own limit, default **150 / 5 min**, tunable with
  **`LOGIN_RATE_MAX`**; per-account lockout (5 wrong → 15 min) remains the brute-force defense.
- Verified unchanged: forged / `alg:none` / expired / revoked tokens and claim-based role escalation are all
  rejected; injection strings in 11 query/path parameters return no 5xx and change nothing; no password hashes or
  `token_version` appear in any response; a legacy database built by the original code upgrades on boot with its
  data intact.

## 6e-v. Moving to PostgreSQL

`npm run export:postgres` (in `server/`) writes `postgres-export.sql` — schema, data and indices — generated by
introspecting the live SQLite schema, so a new column or table is included automatically. Load it with
`psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f postgres-export.sql`.

- **Verified against real PostgreSQL**: a **PostgreSQL 16.15 server** (`psql -v ON_ERROR_STOP=1` load of a seeded +
  active database — counts match per table, awkward strings are **byte-identical** (newline, tab, quotes, backslash,
  Devanagari, emoji, SQL-looking text), constraints/cascade enforced, `lower(email)` index used), and on every test
  run via PGlite (Postgres 18 in WASM) in `server/test/postgres-export.test.js`:
  row counts match; hostile strings (quotes, backslashes, unicode, newlines, SQL-looking text) round-trip; PK /
  composite PK / UNIQUE / FK / `ON DELETE CASCADE` are enforced by Postgres; the `lower(email)` expression
  indices and the partial staff index exist and the planner uses them.
- `fines.paid` and `password_reset_tokens.used` become `BOOLEAN`. **Dates/timestamps stay `TEXT`** (ISO-8601) because
  that is what the app reads and writes; moving to `TIMESTAMPTZ` is a follow-up that changes application code.
- **This is a data/schema migration path, not a switch.** The server's routes still use `better-sqlite3`
  (synchronous, SQLite SQL). Porting them to `pg` is real work — start with `src/db.js`, then each route's
  queries (`?` → `$1`, sync → async, and the capacity checks that currently rely on synchronous check-and-insert
  would need transactions/row locks).

## 6e-viii. Changing Passwords (and the forced first-sign-in change)

Until this was added, the Profile page's "Update Password" button was a fake (`alert('Password updated (simulated)')`)
and nothing could change a password except the email-code reset — which can't reach staff whose email was
auto-generated. It is now real:

- **`POST /api/auth/change-password`** (Profile → *Change password*): needs the **current** password (wrong guesses count
  toward the same 5-strikes lockout as sign-in, so a borrowed or stolen session can't be used to brute-force it);
  the new one must be 8–128 characters, differ from the current one, and not be on a short list of the passwords
  everyone tries first (including `demo1234`). On success **every other device is signed out**, this session is
  re-issued, and an audit entry is written (it never contains either password).
- **Temporary passwords must be replaced.** Any account handed a temporary password — new staff, parent access, or an
  Admin's *Reset password* — is flagged `must_change_password`. While flagged, the API answers **everything** except
  "change password" and "sign out" with `403 PASSWORD_CHANGE_REQUIRED` (so it can't be sidestepped with another tool,
  query-string, case or trailing-slash tricks), and the app sends the person to a **"Choose your own password"** page
  from every route. The temporary password stops working the moment they do. Choosing a password through the email-code
  *Forgot password* flow also clears the flag.
- **Not flagged on purpose:** the seeded demo accounts (flagging them would break every demo and test — see the
  production warning in § 6) and students, who choose their own password when they register.
- Browsers get the re-issued session as the httpOnly cookie, never in the response body (same as sign-in).

## 6e-vii. Email, Hashing and Load — measured, not assumed

**Email (real SMTP).** `server/test/email.test.js` runs real SMTP servers against a real API process: delivery and
headers, AUTH (good/bad credentials), header-injection attempts, a dead server, and a black-holed one. It found and
fixed: creating staff/parent access while mail was down returned **500 after creating the account** (the one-time
password was lost — it now returns the password with `emailSent:false`, and the UI says to pass it on yourself);
**password-reset request was an account-enumeration oracle** (existing account → 500 when mail failed; slower when it
worked) — it now answers identically and sends in the background; nodemailer's defaults let a black-holed server hold a
request for 30 s–10 min — now **8 s** (`SMTP_TIMEOUT_MS`); a failed verification email is a clear `503` and leaves no
dead code behind. `SMTP_REQUIRE_TLS=true` refuses to send over an unencrypted connection (set it in production).
**Not verified:** a real provider (Gmail/SES/…) or a real TLS handshake — send yourself a password reset before launch.
Credential emails contain the temporary password in plain text; that is the design (it is also shown once on screen),
so treat that mailbox accordingly.

**Password hashing is off the main thread.** Measured on the pure-JS `bcryptjs`: a 30-login burst froze the whole
server for **2.8 s** (even `/health`), and reads took 382 ms (median) while people logged in. With the optional native
`bcrypt` package: the same burst leaves `/health` at **69 ms max**, reads at **19 ms** median. `server/src/password.js`
uses native when installed and falls back to `bcryptjs` (identical `$2a/$2b` hashes, so no account is affected);
`BCRYPT_IMPL=js` forces the fallback. The server logs which one is active at startup.

**Throughput** (single-core sandbox, 40 connections, 8 s each — your hardware will differ; bcrypt scales with cores):

| Endpoint | req/s | p50 | p99 |
|---|---:|---:|---:|
| `GET /health` (floor) | 4,800 | 6 ms | 32 ms |
| `GET /students?hostelId=BH1` (100 rows, auth) | 650 | 58 ms | 106 ms |
| `GET /hostels` (public, live occupancy) | 910 | 42 ms | 67 ms |
| `GET /attendance?messId=…` | 1,690 | 21 ms | 44 ms |
| `POST /attendance/checkin` (duplicate path) | 1,540 | 23 ms | 59 ms |
| `POST /auth/login` (bcrypt cost 10) | **~14 per core** | — | — |

Login is *deliberately* slow (~70 ms of CPU each); 14/s/core is a ceiling for a flood, not a typical load — 2,000
students signing in over a half-hour breakfast is about 1 per second. A login flood no longer starves other requests.

**Still not tested:** Docker builds, a real SMTP provider, sustained multi-hour load, more than one core / more than
one server process (SQLite is single-writer; see § 6e-v before scaling out).

## 6e-vi. Running It in Production (Docker, CI, e2e)

- **CI** (`.github/workflows/ci.yml`): frontend (lint, typecheck+build, component tests), server (all API tests),
  then end-to-end in a real browser.
- **End-to-end** (`npm run test:e2e`, Playwright): drives the real frontend against the real API on a throwaway
  database — httpOnly cookie, reload/logout revocation, CSRF refusal, check-in (including duplicate and
  other-mess refusals), **offline queue → auto-sync**, CSV import, staff credentials that really sign in, and
  registration with a real emailed code. One-time: `npx playwright install chromium`. No download? Use any
  Chrome: `CHROME_PATH=/usr/bin/chromium npm run test:e2e`.
- **Docker:** `cp .env.docker.example .env` (set `JWT_SECRET`), then `docker compose up --build` → web on
  `:8080`, API on `:4000`, database/outbox/backups on the `smartmess-data` volume. The web image serves the build
  through nginx (non-root) with a CSP (`default-src 'self'`, no inline script, `frame-ancestors 'none'`),
  `X-Frame-Options`, `nosniff`, HSTS, `Permissions-Policy` — the headers the API can't set for the frontend's HTML.
  **What has and hasn't been verified:** the rendered nginx config was run under a **real nginx 1.24** — all six
  security headers are present on *every* response type (index, hashed assets, SPA routes, 404s), dotfiles are
  denied, and the built site was loaded through it in real Chrome as four roles across 124 page loads with **zero CSP
  violations** (`deploy/csp-smoke.mjs` repeats this). That check caught a real bug: nginx drops inherited
  `add_header`s inside any `location` that sets its own, so `index.html` originally shipped with *no* security headers.
  **Still never built or run:** the `Dockerfile`s and `docker-compose.yml` themselves (no Docker daemon was available),
  and the nginx *image's* entrypoint that renders `*.template` files — I emulated it with `envsubst`. Expect to adjust on
  your first `docker compose up --build`.

## 6f. Real Email (Pluggable, Not Faked)

`server/src/email.js` is a genuinely real mailer, not a stub — it's just pluggable about *where* the email
goes:

- **By default** (no `SMTP_*` env vars set, including in every test run and the out-of-the-box demo): each
  email is written as a real `.txt` file under `server/data/outbox/` and logged to the console. This is the
  standard "dev-mode mailer" pattern — the same idea as Django's console backend or Rails' `letter_opener` —
  nothing about it is fake; it's just not routed over the network, so you can open the file and read exactly
  what would have been sent. The backend test suite reads real codes back out of these files rather than
  reaching into the server's internals, to prove the flow end to end.
- **Set `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`** (`server/.env.example`) and it sends for real via
  `nodemailer`. This path is implemented but — since no real SMTP credentials are available in this
  environment — not exercised by the test suite; verify it against your actual provider before relying on it.
- Used for: password reset codes, new staff accounts' temporary passwords, new Parent-access accounts'
  temporary passwords.

## 6g. What this version adds (privacy, 2FA, offline, automation, exports, deployment)

| Area | What it does | Where |
|---|---|---|
| **Demo labelling** | Every screen not backed by the server says so (banner + sidebar tag). The one exception built for real is **food waste**: kitchen staff record prepared/eaten kg per meal on the server (audited, correctable). Inventory, finance and sustainability are **not** built — they remain labelled demos. | `DemoBanner`, `pages/FoodWaste.tsx`, `server/src/routes/waste.js` |
| **Photo privacy (DPDP)** | A photo needs recorded consent (student in the app, or staff attesting at upload). A university-record photo is only copied onto the roster with consent. Leaving the mess, withdrawing consent, or removal deletes the photo + consent at once; a daily sweep catches the rest; every erasure is audited. | `server/src/privacy.js`, `docs/PRIVACY.md` |
| **Mandatory 2FA** | Admin and Super Admin must have two-factor. Until it is set up, the API allows only setting it up or signing out; it can't be turned off. A Super Admin (Staff page) or the console (`npm run reset-2fa -- <UID>`) resets a lost authenticator. `REQUIRE_2FA_ROLES` changes the list. | `server/src/policy.js`, `auth.js`, `/setup-two-factor` |
| **Student QR offline** | While online the phone stores a per-device **non-extractable** WebCrypto key; with no data it computes a code every minute that the server verifies (single-use, ±1 min, tied to the device's session). The app itself opens offline (service worker app shell). A counter that is also offline can queue the code and sync later. | `src/services/offlineQr.ts`, `public/sw.js`, `server/src/auth.js` |
| **9 PM reminder** | Push "mark tomorrow's meals" once a day to students with push on, unanswered meals, not on leave, and reminders not switched off. | `server/src/scheduler.js` |
| **Automatic no-shows** | After each meal window closes (+30 min grace) the server processes no-shows itself, per mess (on/off + fine on the Attendance page). If **nobody** was scanned at a meal it does **not** warn anyone (counter probably wasn't in use) and tells the manager. A late-synced offline scan withdraws a wrongly issued warning (and its unpaid fine). | `scheduler.js`, `noShows.js` |
| **Devices & sign out everywhere** | Each sign-in is a listed device; end one, end all others, or sign out everywhere (also stops push to lost phones). Logout now ends **this device only**. Max 10 live devices per account. | Profile → *Devices signed in* |
| **Attendance CSV** | Managers and finance: one row per check-in or one per student with meal counts, date range ≤ 366 days, formula-injection-safe, audited. | Attendance page, `GET /api/attendance/export` |
| **Real inventory** | Items with a unit and reorder level; every receive / use / waste / stock-take is a recorded movement (who, when, why); the shelf can't go below zero even with two people at the store; the manager is pushed when an item reaches its reorder level. | `/inventory`, `server/src/routes/inventory.js` |
| **Real feedback** | Students rate meals 1–5 (anonymous to staff) or file named complaints; managers see averages, reply and resolve; the student is notified. Max 5 open complaints per student. | `/feedback`, `routes/feedback.js` |
| **Waste analytics + advice** | Charts of the real waste log (by day, meal, reason); "cook ~X% less" advice only after 3+ entries per meal in 14 days, capped at 25%, and only where cooking less is the actual fix. | Waste Analytics, Food Waste |
| **Daily manager summary** | End-of-day push (and email if SMTP is set) with check-ins, response rate, no-shows, waste, rating, complaints, low stock; also on the Attendance page. Sent once a day, and not at all for a mess that did nothing. | `scheduler.js`, `summary.js` |
| **Error reporting** | Browser crashes and server errors land in **System errors** (Super Admin), grouped with counts, no personal data; optional chat webhook. A React error boundary replaces the blank screen. | `errorLog.js`, `ErrorBoundary` |
| **Hindi / Punjabi** | Language picker on sign-in and Profile; covers navigation, sign-in, the student's QR card and meal-intention page. **Partial, and AI-written — needs native-speaker review.** | `src/i18n/` |
| **`SEED_DEMO=0`** | A production database has the hostels/messes but no demo people; the first Super Admin is created from the console. | `scripts/create-super-admin.js` |
| **Deployment kit** | HTTPS reverse proxy, production compose, scheduled + encrypted off-site backups, readiness endpoint, monitor script, go-live checklist. | `docs/DEPLOYMENT.md`, `deploy/`, `docker-compose.prod.yml` |

New server settings: `REQUIRE_2FA_ROLES`, `REMINDER_TIME`, `REMINDERS`, `AUTO_NO_SHOWS`, `AUTO_NOSHOW_GRACE_MIN`,
`NO_SHOW_FINE_AMOUNT`, `PRIVACY_CONTACT_EMAIL`, `SCHEDULER`, `BACKUP_MAX_AGE_HOURS` (see `server/.env.example`).
New console scripts: `npm run create-super-admin -- "Name" email` (first Super Admin on a `SEED_DEMO=0` deployment; password on stdin — do this *before* exposing it), `npm run set-password -- <UID>` (password from stdin) and
`npm run reset-2fa -- <UID>`.

### Still not verified (be honest with yourself before go-live)

- **A physical camera** scanning a real phone screen, **real push delivery** to a real device, and the **Playwright
  browser tests** have not been run against this version (no browser or device was available). The Playwright
  config was updated for the new 2FA rule but not executed. `docs/DEVICE_TEST.md` is the checklist for the first two;
  add "airplane-mode offline code" from `docs/DEPLOYMENT.md` §9.
- **Offline codes need one online visit per sign-in** on that phone (it fetches the key then). A phone that has never
  opened the app online since signing in shows instructions instead.
- The Docker/Caddy/systemd files and the off-site backup script were written but **not run** (no Docker, `age` or `rclone`
  in the build environment).
- The automatic no-show pass skips a meal when nobody was scanned **or** fewer than 30% of the "will eat" students were
  (`AUTO_NOSHOW_MIN_SCAN_RATIO`), and tells the manager. A counter used for most of the meal but not all can still
  mis-warn a few students; managers can switch it off per mess.
- **Finance and sustainability are still demo only** (labelled): nothing records real spend or impact yet. Inventory is real but standalone — it does not yet feed procurement, suppliers or the forecast, which remain demos.
- Hindi/Punjabi cover only the screens listed above and have not been reviewed by a native speaker.
- Waste advice is a rule of thumb on the kitchen's own entries, not a statistical forecast; give it a few weeks of data.

## 7. Major Modules

- **Multi-mess operations, one hostel = one mess** (`src/data/mockMesses.ts`) — 10 boys' + 10 girls' hostel messes
  at LPU by default, each independently tracked for forecasts, food waste, inventory, expenses, and purchase
  orders (`src/data/mockOperations.ts`, `mockInventory.ts`, `mockExpenses.ts`, `mockPurchaseOrders.ts`). Only the
  **Super Admin** can switch between messes (top navbar) — every other role is permanently scoped to their own
  mess and sees a read-only "your mess" badge instead. The **Hostels** page's "Add hostel" action (Super Admin
  only) onboards a brand-new hostel + its dedicated mess + one Admin account, backfilled with 90 days of forecast
  history, a full inventory stock room, and 30 days of expenses (`src/services/hostelService.ts`) — the hostel
  starts with **no students and no other staff**: the new Admin adds real students (Students page) and builds
  their own team (Staff page) after signing in. The **College Overview** and **Leaderboard** pages (Super Admin
  only) compare every mess side by side. Per-mess **safety buffer %**, **food costs**, and **monthly budget cap**
  are configurable from Settings (`src/services/messSettingsService.ts`) and are used live by the Forecast page's
  recommendation math, waste-cost calculations, and the Finance page's budget-cap alert.
- **Staff & permissions** — every mess has its own Admin, Mess Manager, Kitchen Staff, Finance Manager, and
  Hostel Warden (`src/data/mockUsers.ts`, `src/pages/Staff.tsx`), buildable one at a time or via CSV import (the Students page's CSV import is real too — § 6e-ii)
  (`role,name,email,phone`). Staffing a new mess is that mess's own Admin's responsibility — the Super Admin only
  ever creates the Admin account. A university-wide **Audit Log** (Super Admin only) records staff changes,
  hostel onboarding, student transfers, calendar edits, and meal-request decisions (`src/services/auditService.ts`).
- **Student self-service** — registration requires a real, already-enrolled UID (`src/pages/auth/Register.tsx`,
  see section 6a) — students can
  mark themselves **on leave** ("away until [date]") to auto-skip meals and drop out of live headcounts without
  manually marking every day (`Student.leaveUntil`, `src/services/studentService.ts`); a **Transfer** action
  (Super Admin, Students page) moves a student between hostels/messes; a **"Generate parent access"** action
  creates a read-only Parent/Guardian login scoped to one student's meal-plan status and points, with no editing
  rights anywhere (`ParentDashboard` in `src/pages/Dashboard.tsx`).
- **Editable operational calendar** (`/calendar`, `src/services/eventService.ts`) — Super Admin/Admin/Mess
  Manager can click any day to add a holiday/exam/festival/event/sports/vacation entry (with an expected demand
  impact %), and click an existing entry to edit or delete it. Purchase-order deliveries and inventory expiries
  still show on the calendar for reference but aren't editable there — they're managed from Procurement/Inventory.
- **Forecasting (`services/forecastService.ts`)** — real implementations of Historical Average, Moving Average,
  Weighted Moving Average, Exponential Smoothing, and Linear Regression, run against 90 days of seeded
  attendance history. Random Forest / XGBoost / LSTM are present as selectable methods that currently fall
  back to the weighted-moving-average result with a visible "not yet connected" note — swap the body of
  `computeForecast()` to call `mlApi` once the Python service exists.
- **Meal intentions & attendance** — student confirmation UI with configurable per-meal cutoffs, an
  aggregate summary for managers, and a simulated QR-scan check-in flow with duplicate-scan protection.
- **Food waste & analytics** — entry form, automatic waste %/cost calculation, and daily/meal-wise/
  food-wise/reason-wise/hostel-wise breakdowns plus a "top contributors" ranking.
- **Inventory** — full CRUD, low-stock/expiring/expired/overstocked alerts, and a consumption-based
  purchase/stockout forecast.
- **Procurement** — suppliers directory and purchase orders with a Pending → Approved → Ordered →
  Delivered workflow.
- **AI Insights / Recommendation Engine / Anomaly Detection (`services/analyticsService.ts`)** — generates
  plain-language insights and recommendation cards from the seeded data (e.g. day-of-week patterns,
  waste-trend changes, menu popularity). Deliberately modular so it can be replaced by an LLM call later.
- **Sustainability** — a weighted score (waste reduction, forecast accuracy, food utilization, participation),
  badges, and hostel/student leaderboards.
- **What-If Simulator & Scenario Planner** — interactive sliders and scenario comparisons that recompute
  demand/cost/waste live.
- **Reports & Finance** — daily/weekly/monthly/yearly report generation with CSV/JSON export and print,
  plus a cost/savings dashboard.

## 8. API Integration Instructions

Every file in `src/services/` currently reads/writes in-memory arrays seeded from `src/data/`. To connect
a real backend:

1. Set `VITE_API_URL` to your Express server.
2. In each service file, replace the direct data access with `api.get/post/put/delete(...)` calls
   (the configured Axios instance in `src/services/api.ts` already attaches the JWT bearer token from
   `localStorage` and clears it on 401).
3. Hooks (`src/hooks/*`) and pages consume services only through their exported functions — no other
   code needs to change.
4. Suggested REST endpoints map 1:1 onto the service function names, e.g. `authService.login` →
   `POST /auth/login`, `inventoryService.listInventory` → `GET /inventory`.

## 9. PostgreSQL Database Schema

See `schema.sql` in the project root. It mirrors `src/types/index.ts` exactly, with enums for role, meal
type, intention status, PO status, complaint status, and event type, plus indexes on the columns every
dashboard query filters by (date, meal, hostel).

## 10. ML Integration Instructions

1. Stand up a Python FastAPI service (see `VITE_ML_API_URL`) exposing a `/forecast` endpoint that accepts
   `{ date, meal, history[] }` and returns `{ predictedStudents, confidence }`.
2. In `src/services/forecastService.ts`, replace the `random_forest` / `xgboost` / `lstm` branch of
   `computeForecast()` with a call to `mlApi.post('/forecast', input)`.
3. Keep the statistical methods (historical average, moving average, etc.) as a client-side fallback if
   the ML service is unreachable — the UI already has a `note` field wired up for exactly this kind of
   messaging.

## 11. Deployment

- **Static hosting (Vercel/Netlify/S3+CloudFront):** `npm run build`, deploy the `dist/` folder. Set
  `VITE_API_URL` / `VITE_ML_API_URL` as build-time environment variables pointing at your production
  backend.
- **Docker:** build `dist/` in a Node build stage, serve it from `nginx:alpine` (SPA fallback to
  `index.html` for React Router).
- Because this is a client-side SPA with mock data, no server-side rendering or database is required for
  the demo build itself — only the future backend/ML integrations described above need real infrastructure.

## 11a. SEO

This is a client-rendered SPA where almost every route sits behind login — there's no server-side
rendering, so a crawler only ever meaningfully sees `index.html` (React Router serves every URL from the
same file). SEO here is scoped to what that actually makes possible:

- **`index.html`**: full meta tags — description, keywords, canonical, `robots`, Open Graph + Twitter Card
  (with a real generated `og-image.png`, 1200×630, `public/og-image.png`), and `SoftwareApplication`
  JSON-LD structured data.
- **`public/robots.txt`** / **`public/sitemap.xml`**: list only the genuinely public routes (login,
  register, forgot-password) — everything else requires auth and isn't reachable by a crawler regardless of
  what robots.txt says, so there's no point disallowing those paths explicitly.
- **`public/manifest.webmanifest`**: installability/share-card metadata (name, icons, theme color).
- **Per-route `<title>`**: React Router doesn't update `document.title` on navigation by itself —
  `useDocumentTitle` (`src/hooks/useDocumentTitle.ts`) is wired into `AppLayout.tsx` (derives the title from
  `Sidebar.tsx`'s `NAV_ITEMS`, so every authenticated page gets a correct tab/history title automatically)
  and individually into the public auth pages (Login, Register, Forgot/Reset Password).
- **Before deploying**: replace the placeholder domain (`https://smartmess.lpu.in`) in `index.html`,
  `robots.txt`, and `sitemap.xml` with your real one — it's used consistently across all three so it's a
  find-and-replace.

## 12a. Testing

**Frontend** (`npm test`, Vitest + React Testing Library, jsdom) — 317 tests. Utilities (`fuzzyMatch`, the CSV
parser) plus real **component tests** that render the actual pages, with only the network edge faked:
- `Login` — the account-lockout message renders (and keeps rendering on a correct-password retry), the
  attempts-left warning, API-unreachable message, errors clear on retry, client-side validation never hits
  the network, the session-expired banner, and a successful sign-in storing the session.
- `Attendance` check-in console — QR scanner **fallback** when `BarcodeDetector` is missing, the scan button
  when it's present, camera-permission-denied recovery, success / cross-mess / not-enrolled / duplicate
  rendering, in-flight double-scan guard, no-show summary, fine-payment refusal, and which view each role gets.
- `Students` — the real CSV import (header mapping, quoted commas, per-line rejection list, "no header",
  server-down, in-flight state), capacity errors reaching the form and the transfer flow, and the
  hostel-admin scope lock.
- `ProtectedRoute` — signed-out, allowed and disallowed roles.
- Also: `Register` (masked lookup, real OTP order, no simulated fallback), `Staff` (credentials, per-row import, reset), the parent-access modal, the room-limit control, `CredentialsModal`, the offline queue (unit + in the console), the cookie transport (`api.ts`), and intention write-through.
- **End-to-end:** 8 Playwright tests in a real browser (see § 6e-vi).
Shared helpers in `src/test/`. These tests were mutation-checked: re-introducing the old `alert()` import,
inverting the scanner check, or swallowing a form error each makes them fail.

**Backend** (`cd server && npm test`, Node's built-in runner) — 370 integration tests against the real Express
app and a throwaway SQLite file (`server/test-support/harness.js`), real HTTP, no mocks: the original auth /
attendance / audit suite, plus `authz.test.js` (mess-scope matrix), `capacity-import.test.js` (bed limits and
bulk import), `backup.test.js` (backup/restore/retention/CLI), and `hardening.test.js` (security headers,
SVG-upload refusal, index usage, upgrade of a legacy database), and — new — `sessions`, `mandatory-2fa`, `photo-privacy`, `scheduler` (reminders, automatic no-shows, late-sync retraction, housekeeping, with an injected clock), `offline-qr` and `export-waste-health`. Also `v12-features` (feedback, inventory, waste summary/advice, daily summary, error reporting, `SEED_DEMO=0`). Frontend additions: the offline-code module (checked byte-for-byte against the server's HMAC), offline mode on the QR card, devices, photo privacy, mandatory-2FA routing, service-worker app shell, auto no-show/export cards, the waste log and the demo labels.

## 12. Production Readiness

**Staff and student auth are both real now** (bcrypt + JWT, one unified `/auth/login`, `/server`) — the
remaining gaps are narrower than they used to be:

- **The registration OTP flow is simulated** (`sendVerificationOtp`/`verifyOtp` in both `authService.ts` and
  `server/src/routes/auth.js`) — it demonstrates the correct "verify email ownership before activating an
  account" flow, but accepts any 6-digit code today. Each function has its own `TODO(production)` comment
  at the point it needs a real email/SMS provider.
- **Password reset is still fully simulated** — `src/pages/auth/ForgotPassword.tsx` and
  `authService.requestPasswordReset/resetPassword` don't touch the real database yet. The pattern to follow
  is the same one `register()`/`login()` already use.
- **Newly created staff get a fixed `demo1234` password** (`server/src/routes/staff.js`, marked
  `TODO(production)`) instead of a real one-time password delivered out of band.
- **The JWT secret has a hardcoded dev fallback** (`server/src/auth.js`) — set a real `JWT_SECRET`
  environment variable before deploying anywhere real, and rotate it.
- **Rate limiting resets on restart and isn't shared across instances** (`server/src/rateLimit.js`) — fine
  for a single process, needs a shared store (Redis) behind a load balancer.
- Re-check every `roles={[...]}` gate in `App.tsx`/`Sidebar.tsx` server-side too, and add the same
  `requireAuth`-style checks to any new backend route — the frontend role check is a UX convenience, not a
  security boundary.

---

### Notes on this build

- All 91 days of forecast/attendance/waste data are generated by a seeded PRNG (`src/lib/rng.ts`), so the
  numbers are stable across reloads but not literally "real" — they're realistic Indian-college-mess
  figures (₹ INR, kg/litres/pieces) as requested.
- Dark mode, sidebar collapse, and theme preference persist via `localStorage` through `useUIStore`.
- The flagship demo scenario from the spec (confirmed → historical → predicted → recommended → actual →
  waste %) is pinned onto **tomorrow's lunch** in `src/data/mockOperations.ts` so the Forecast, Food Waste,
  and Dashboard pages tell one consistent story end-to-end.
