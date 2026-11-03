import bcryptjs from 'bcryptjs'

/**
 * Password hashing, off the main thread when possible.
 *
 * bcrypt is deliberately slow (~70 ms of CPU per hash). `bcryptjs` is pure JavaScript, so that CPU time runs ON the
 * event loop: measured, 30 simultaneous logins froze the whole server (even /health) for ~2.8 s, and logins topped
 * out near 11/s while every other request queued behind them. The native `bcrypt` package does the work on libuv's
 * thread pool instead, so other requests keep flowing. It's an *optional* dependency: if it can't be installed on
 * some platform the server still runs on the pure-JS version — slower under load, identical results. Both read and
 * write the same `$2a$/$2b$` hashes, so existing accounts keep working either way.
 *
 * Set BCRYPT_IMPL=js to force the pure-JS version (used by tests and for comparison).
 */
let native = null
if (process.env.BCRYPT_IMPL !== 'js') {
  try { native = (await import('bcrypt')).default } catch { /* not installed / no prebuilt binary — fall back */ }
}

export const hashingImplementation = native ? 'native' : 'js'
export const hashPassword = (plain, rounds = 10) => (native ?? bcryptjs).hash(plain, rounds)
export const verifyPassword = (plain, hash) => (native ?? bcryptjs).compare(plain, hash)
/** Synchronous, for the one-off demo-data seed at first boot only — never call this from a request handler. */
export const hashPasswordSync = (plain, rounds = 10) => bcryptjs.hashSync(plain, rounds)
