import { app } from './app.js'
import { hashingImplementation, verifyPassword } from './password.js'
import { db } from './db.js'
import { startScheduler } from './scheduler.js'
import { recordError } from './errorLog.js'

const PORT = process.env.PORT || 4000

app.listen(PORT, '0.0.0.0', () => {
  startScheduler()
  console.log(`[server] LPU Smart Mess real API listening on port ${PORT}`)
  console.log(`[server] password hashing: ${hashingImplementation === 'native' ? 'native bcrypt (thread pool)' : 'bcryptjs (pure JS — blocks the event loop under login bursts; install the optional "bcrypt" package)'}`)
})

// The demo seed publishes `demo1234` for the Super Admin (it's in the README). Fine locally; on a real deployment it
// is a standing invitation. Say so on every start until it has been changed — loudly, but without refusing to boot
// (the Docker first-run needs the seeded data to exist so someone can sign in and change it).
if (process.env.NODE_ENV === 'production') {
  const admin = db.prepare("SELECT password_hash FROM staff WHERE id = '10001' AND role = 'SUPER_ADMIN'").get()
  if (admin?.password_hash && (await verifyPassword('demo1234', admin.password_hash))) {
    console.warn('\n[SECURITY WARNING] The Super Admin (UID 10001) still has the default demo password published in the README.')
    console.warn('[SECURITY WARNING] Anyone can sign in as Super Admin. Sign in now and change it (Profile → Change password),')
    console.warn('[SECURITY WARNING] then reset or remove the other seeded demo staff accounts.\n')
  }
}

if (!db.prepare("SELECT 1 FROM staff WHERE role = 'SUPER_ADMIN'").get()) {
  console.warn('\n[SETUP] There is no Super Admin yet, so nobody can sign in. Create one from the console:')
  console.warn('[SETUP]   echo "a long passphrase" | node scripts/create-super-admin.js "Your Name" you@example.edu\n')
}

// A crash is written to the error log first. An uncaught exception leaves the process in an unknown state, so it still
// exits (Docker / systemd restart it); an unhandled promise rejection is logged and recorded but the server carries on.
process.on('uncaughtException', (e) => { console.error(e); recordError({ kind: 'server', message: `Uncaught: ${e?.message ?? e}`, stack: e?.stack }); setTimeout(() => process.exit(1), 200) })
process.on('unhandledRejection', (e) => { console.error(e); recordError({ kind: 'server', message: `Unhandled rejection: ${e?.message ?? e}`, stack: e?.stack }) })
