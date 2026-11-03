// What the counter hears and feels after each scan, so nobody has to read a small card in a fast-moving line:
// a rising double beep + short buzz for a good scan, a low tone + long buzz for a refusal, a mid tone for "look at this person".
const KEY = 'smartmess.scanSound'

export function isSoundOn(): boolean {
  try { return localStorage.getItem(KEY) !== 'off' } catch { return true }
}
export function setSoundOn(on: boolean) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off') } catch { /* private mode: the setting just won't persist */ }
}

type Kind = 'success' | 'error' | 'warn'
const TONES: Record<Kind, { freqs: number[]; ms: number; vibrate: number[] }> = {
  success: { freqs: [880, 1175], ms: 110, vibrate: [60] },
  warn: { freqs: [660, 660], ms: 160, vibrate: [90, 60, 90] },
  error: { freqs: [220, 180], ms: 260, vibrate: [300] },
}

let ctx: AudioContext | null = null

export function playScanFeedback(kind: Kind) {
  if (!isSoundOn()) return
  const t = TONES[kind]
  try { navigator.vibrate?.(t.vibrate) } catch { /* not supported — fine */ }
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    ctx ??= new AC()
    if (ctx.state === 'suspended') void ctx.resume()
    let at = ctx.currentTime
    for (const f of t.freqs) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = kind === 'error' ? 'sawtooth' : 'sine'
      osc.frequency.value = f
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.25, at + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + t.ms / 1000)
      osc.connect(gain).connect(ctx.destination)
      osc.start(at)
      osc.stop(at + t.ms / 1000 + 0.02)
      at += t.ms / 1000 + 0.04
    }
  } catch { /* audio blocked or unavailable — the on-screen flash still happens */ }
}
