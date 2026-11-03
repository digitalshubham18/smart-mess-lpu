# Deploying LPU Smart Mess

This is the path from "works on my laptop" to "students can rely on it". It covers HTTPS, the reverse proxy, scheduled
backups (including a copy that survives losing the machine), and monitoring. It assumes **one server** — that is how the
app is built (see *Limits* at the end).

> **Status:** the pieces below were written against the app's own behaviour and the app side is covered by automated
> tests (health endpoint, backup freshness, console scripts). The Docker/Caddy/systemd files and the off-site script
> could **not** be run in the environment this was written in (no Docker, no `age`/`rclone`). Do a dry run on a spare
> machine first, and tick every line of the checklist in §9 before real students depend on it.

## 1. What you need

| | |
|---|---|
| A Linux server | 2 vCPU / 2 GB RAM is plenty (SQLite; ~2,000 students). Docker + the Compose plugin. |
| A hostname | e.g. `mess.example.edu`, with a DNS **A/AAAA record pointing at the server** *before* you start. |
| Open ports | **80 and 443** to the internet (80 is only for certificate issuing and redirecting). **Nothing else** — not 4000, not 8080. SSH from your own addresses only. |
| Somewhere else to keep backups | Another machine or cloud storage. A backup on the same disk is not a backup. |

Why HTTPS is not optional: browsers refuse the **camera** (QR scanning), **service workers** (the offline app and push) and
secure cookies on plain `http://` (except `localhost`).

## 2. The shape of it

```
internet ─443─▶ Caddy  (HTTPS, certificates renew themselves)
                  ├─ /api/*  ▶ api:4000  (Node + SQLite)      ← not published to the host
                  └─ /*      ▶ web:8080  (the built website)  ← not published to the host
backup container ── every 24 h writes a consistent copy of the database into the same data volume
```

One hostname for both the site and the API means no CORS, first-party cookies, and one certificate. `docker-compose.prod.yml`
sets all of this up; `deploy/Caddyfile` is the proxy config.

**Prefer nginx + certbot?** Keep the same routing (`/api/` → `127.0.0.1:4000`, everything else → the web container),
terminate TLS with certbot, and send `X-Forwarded-For`. Whatever proxy you use, the API must be told how many proxies sit in
front of it (`TRUST_PROXY=1`), otherwise every student shares **one** rate-limit bucket (the proxy's address) and the device
list shows the proxy's IP instead of the phone's.

## 3. First deployment — in this order

A fresh production database is started with `SEED_DEMO=0` (already set in `docker-compose.prod.yml`). It creates the 20
hostels and messes the app needs but **no people at all** — no demo students, and none of the staff accounts that carry the
published password `demo1234`. So at first start **nobody can sign in**; you create the first Super Admin from the console
before anything is exposed:

```bash
git clone <your repo> /srv/smart-mess && cd /srv/smart-mess
cp .env.prod.example .env
nano .env        # SITE_ADDRESS, PRIVACY_CONTACT_EMAIL, and JWT_SECRET=$(openssl rand -hex 32)

# 1. Start everything EXCEPT the public proxy. Nothing can reach it from outside yet.
docker compose -f docker-compose.prod.yml up -d --build api web backup

# 2. Create the first Super Admin (UID 10001). The password comes from stdin, 12+ characters:
printf '%s' 'a long passphrase you will store in a password manager' \
  | docker compose -f docker-compose.prod.yml exec -T api node scripts/create-super-admin.js "Dr. Your Name" you@example.edu

# 3. Now open it to the world (this also obtains the HTTPS certificate):
docker compose -f docker-compose.prod.yml up -d caddy
```

(Creating the account *before* the proxy is up matters because Admin and Super Admin accounts must set up two-factor at
first sign-in: whoever signs in first picks the authenticator.)

Then, in a browser at `https://<your hostname>`:

1. Sign in as `10001` with the new password. You are taken straight to **Set up two-factor sign-in** — scan the QR with an
   authenticator app and **save the recovery codes somewhere that is not this server**.
2. **Staff** page: create the real Admins, Mess Managers, wardens and kitchen staff for each hostel (each gets a one-time
   temporary password and must change it; Admins must also set up two-factor).
3. Enrol the real roster (Students page, or the CSV import).

*Trying it locally with demo data?* Leave `SEED_DEMO` unset: `npm start` seeds the demo people as before. The server prints a
loud warning at every start while the Super Admin still has the default password.

**Lost authenticator?** Another Super Admin can reset it (Staff page → *Reset two-factor*), or on the server:
`docker compose -f docker-compose.prod.yml exec api node scripts/reset-2fa.js <UID>`.

## 4. Settings that matter

Set these in `.env` (the compose file passes them on). Full list of knobs: `server/.env.example`.

| Variable | What it does | Default |
|---|---|---|
| `SITE_ADDRESS` | Public hostname (certificate + CORS origin) | *required* |
| `JWT_SECRET` | Signs logins. Changing it signs everyone out. | *required*, 32+ chars |
| `PRIVACY_CONTACT_EMAIL` | Shown to students in the photo privacy notice | *required* |
| `REQUIRE_2FA_ROLES` | Roles that must use two-factor. **Leave the line out** for the default. Empty turns it off. | `SUPER_ADMIN,ADMIN` |
| `SEED_DEMO` | `0` = hostels/messes only, **no demo people** (set in the prod compose). Unset = demo data (local only). | unset |
| `SUMMARY_TIME` | When each mess's manager/admin gets the end-of-day summary (`DAILY_SUMMARY=0` = off) | `22:30` |
| `ERROR_WEBHOOK_URL` | Optional https chat webhook told about each NEW kind of error (max 10/hour) | off |
| `REMINDER_TIME` | When the "mark tomorrow's meals" push goes out (mess time) | `21:00` |
| `NO_SHOW_FINE_AMOUNT` | Default fine for a mess that hasn't set its own | `100` |
| `MESS_TIMEZONE` | The mess clock | `Asia/Kolkata` |
| `VAPID_*` | Needed for real push notifications: `cd server && npx web-push generate-vapid-keys` | off |
| `SMTP_*` | Needed for real email (otherwise it is only written to files) | off |
| `BACKUP_EVERY_HOURS` / `BACKUP_KEEP` | Backup cadence / how many to keep | `24` / `14` |

What runs by itself (in the API process, once a minute): the 9 PM meal reminder, automatic no-show processing after each
meal window closes, the 10:30 PM manager summary, and a daily clean-up that also deletes the photo of any student who is no longer active. Turn pieces off
with `REMINDERS=0`, `AUTO_NO_SHOWS=0` (off for messes that haven't chosen; each mess can switch it on the Attendance page), or `SCHEDULER=0` (everything).

## 5. Backups

**What the backup container does:** every `BACKUP_EVERY_HOURS` it takes a consistent copy with SQLite's online backup (safe
while the app runs), checks its integrity, and keeps the newest `BACKUP_KEEP`. The first one runs at start-up. Files are
`/data/backups/smartmess-<time>.sqlite` inside the `smartmess-data` volume.

*Not using Docker?* Install the units in `deploy/systemd/` (`smartmess-backup.timer` runs it at 02:00 and catches up if the
machine was off) and `systemctl enable --now smartmess-backup.timer`.

### 5.1 Copy it off the machine, encrypted

Backups contain **student records and password hashes**, so encrypt before they leave. `deploy/offsite-backup.sh` does
`age` encryption → `rclone` upload → checksum verification → removal of copies older than 60 days:

```bash
age-keygen -o ~/smartmess-backup.key     # store this file OFF the server (password manager / safe). Lose it = backups are unreadable.
rclone config                             # create a remote, e.g. "offsite"
# daily, from the host's cron (after the backup has run):
0 3 * * *  AGE_RECIPIENT=age1xxxxxxxx RCLONE_REMOTE=offsite:smartmess-backups \
           BACKUP_SRC=$(docker volume inspect smartmess_smartmess-data -f '{{.Mountpoint}}')/backups \
           /srv/smart-mess/deploy/offsite-backup.sh >> /var/log/smartmess-offsite.log 2>&1
```

Photos you have already deleted can remain in older backups until they rotate out (14 daily copies by default; up to 60 days
off-site). The student privacy notice says so; keep the retention numbers and the notice in step.

### 5.2 Practise the restore — once now, then every few months

A backup you've never restored is a hope, not a backup.

```bash
age -d -i ~/smartmess-backup.key smartmess-20261005-020000-000.sqlite.age > /tmp/check.sqlite
docker compose -f docker-compose.prod.yml exec api node scripts/restore.js /data/backups/<file> --db /tmp/check.sqlite --yes
sqlite3 /tmp/check.sqlite 'select count(*) from students; select max(scanned_at) from attendance;'
```

A real restore (`npm run restore -- <file> --yes`) first verifies the file, and keeps the database it replaces as a
side-copy, so it is reversible. Stop the `api` container while you do it.

## 6. Monitoring

Three layers, cheapest first:

1. **Docker restarts it.** `restart: unless-stopped` plus the API's built-in health check bring back a crashed container.
2. **An outside check every 5 minutes.** Run `deploy/monitor.sh https://your.hostname` from a **different machine**
   (a monitor on the server can't report that the server is down), or point any uptime service (UptimeRobot, Better Stack,
   your IT department's monitoring) at **`https://your.hostname/api/health/ready`** and alert on anything but `200`.
   * `/api/health` — "the process is up" (liveness).
   * `/api/health/ready` — **503 with the reason** if the database doesn't answer *or the newest backup is older than 36 h*
     (`BACKUP_MAX_AGE_HOURS`). So a silently failing backup turns your alert red instead of surprising you on the day you need it.
     It exposes no personal data.
   `monitor.sh` also warns if the certificate has under 14 days left (Caddy renews at 30, so that means renewal is broken).
3. **Things to watch by hand / with your usual tooling:** free disk space on the volume (the database and the 14 backups
   grow), `docker compose logs api --since 24h` for `[scheduler]` lines, the **System errors** page (Super Admin: crashes
   reported by browsers and the server, grouped, with counts — set `ERROR_WEBHOOK_URL` to also get new ones in chat), and the **Audit Log** page — automatic no-show runs
   that were *skipped* (nobody had been scanned in, so the counter probably wasn't in use) are recorded there and pushed to the
   mess manager.

Log growth: add to `/etc/docker/daemon.json` `{"log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"5"}}` and
restart Docker, or the container logs will slowly fill the disk.

## 7. Upgrading

```bash
cd /srv/smart-mess
docker compose -f docker-compose.prod.yml exec backup node scripts/backup.js    # a fresh backup first
git pull
docker compose -f docker-compose.prod.yml up -d --build
curl -fsS https://your.hostname/api/health/ready
```

Database changes are additive and applied automatically at start-up. Students' phones pick up a new version the next time
they open the app online (the service worker revalidates `index.html` on every visit).

## 8. What students and staff will notice

* **Admins/Super Admins** are asked to set up two-factor at first sign-in and cannot switch it off.
* **Students** can open the app with **no data** at the counter *if the phone has been opened once with internet since
  signing in*: it shows an offline code (amber "Offline code" badge) that the server verifies and treats like the live QR.
  Signing the device out, or **Profile → Devices → Sign out everywhere**, kills that device's offline codes too.
* Student photos need consent and are deleted when the student leaves the mess — see `docs/PRIVACY.md`.

## 9. Go-live checklist

- [ ] DNS resolves; `https://<host>` loads with a valid certificate; `http://` redirects to it.
- [ ] From outside the server, `:4000` and `:8080` are **closed**.
- [ ] First Super Admin created via `create-super-admin.js`; two-factor set up; recovery codes stored off-server.
- [ ] No demo accounts exist (`SEED_DEMO=0`); real staff created and roster enrolled.
- [ ] `https://<host>/api/health/ready` is `200`; the monitor alerts you when you stop the `api` container.
- [ ] One backup restored into a scratch file and queried (§5.2); the off-site copy arrives and decrypts.
- [ ] On a real phone: install/open the site, **open the Attendance page online once**, switch to airplane mode, and confirm the
      offline code appears; scan it at the counter. (`docs/DEVICE_TEST.md` has the camera and push device tests.)
- [ ] Push: turn notifications on from a real phone and confirm one arrives (`VAPID_*` set).
- [ ] The privacy notice names a real contact (`PRIVACY_CONTACT_EMAIL`) and your counsel has read `docs/PRIVACY.md`.

## Limits — read before scaling

* **One API process only.** SQLite is single-writer. If a second copy is started by mistake, only the one holding the
  scheduler lease runs the jobs (reminders, no-shows), so nothing is sent twice. But rate-limit counters are still per
  process, so don't load-balance. More than one server needs a shared database and rate-limit store first.
* The server's **clock is the mess's clock** (`MESS_TIMEZONE`). Keep NTP on.
* Offline codes tolerate a phone clock that is off by about a minute once it has talked to the server; a phone that has been
  offline for days with a badly wrong clock may be refused (the counter then uses the ID card).
