import { z } from 'zod'

/**
 * Run Zod without `eval`. By default Zod 4 probes `Function("")` and, if allowed, compiles each schema into a
 * specialised parser with `new Function` (a speed-up for huge payloads). Under the Content-Security-Policy this app
 * ships with (`script-src 'self'`, no 'unsafe-eval' — see deploy/security-headers.inc.template) that probe is
 * blocked: harmless to behaviour (Zod falls back), but it raises a CSP violation on every page load, and the only
 * "fix" on the CSP side would be to allow eval, which defeats much of the point of the policy.
 * Our schemas validate small forms, so the interpreter path costs nothing measurable.
 *
 * Import this module FIRST (before anything that builds a schema).
 */
z.config({ jitless: true })
