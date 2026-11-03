import { describe, it, expect, vi } from 'vitest'

describe('zod runs without eval (so the strict production CSP is never tripped)', () => {
  it('after zodConfig is loaded, building and parsing schemas never touches the Function constructor', async () => {
    // Emulate the browser under `script-src 'self'`: any attempt to use the Function constructor throws and is recorded.
    const attempts: unknown[] = []
    const RealFunction = globalThis.Function
    const blocked = new Proxy(RealFunction, {
      apply: (_t, _this, args) => { attempts.push(args); throw new EvalError('Refused to evaluate a string as JavaScript (CSP)') },
      construct: (_t, args) => { attempts.push(args); throw new EvalError('Refused to evaluate a string as JavaScript (CSP)') },
    })
    vi.stubGlobal('Function', blocked)
    try {
      vi.resetModules()
      await import('../zodConfig')
      const { z } = await import('zod')
      const schema = z.object({ name: z.string().min(2), email: z.string().email(), year: z.number().int().optional() })
      expect(schema.safeParse({ name: 'Riya Mehta', email: 'riya@example.com', year: 2 }).success).toBe(true)
      const bad = schema.safeParse({ name: 'R', email: 'nope' })
      expect(bad.success).toBe(false)
      expect(bad.success === false && bad.error.issues.length).toBe(2)
      expect(attempts).toEqual([])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('and WITHOUT the config the probe does fire (so this test would catch the config being removed)', async () => {
    const attempts: unknown[] = []
    const RealFunction = globalThis.Function
    const blocked = new Proxy(RealFunction, {
      apply: (_t, _this, args) => { attempts.push(args); throw new EvalError('blocked') },
      construct: (_t, args) => { attempts.push(args); throw new EvalError('blocked') },
    })
    vi.stubGlobal('Function', blocked)
    try {
      vi.resetModules()
      const { z } = await import('zod')
      z.config({ jitless: false })
      const schema = z.object({ a: z.string() })
      expect(schema.safeParse({ a: 'x' }).success).toBe(true) // still works: Zod falls back…
      expect(attempts.length).toBeGreaterThan(0) // …but only after probing eval, which is the CSP violation
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
