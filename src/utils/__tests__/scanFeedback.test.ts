import { describe, it, expect, vi, beforeEach } from 'vitest'
import { playScanFeedback, isSoundOn, setSoundOn } from '../scanFeedback'

const oscillators: { frequency: { value: number }; type: string }[] = []
class FakeAudioContext {
  currentTime = 0
  state = 'running'
  destination = {}
  resume = vi.fn()
  createOscillator() {
    const o = { frequency: { value: 0 }, type: '', connect: () => ({ connect: () => undefined }), start: vi.fn(), stop: vi.fn() }
    oscillators.push(o)
    return o
  }
  createGain() { return { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: () => ({ connect: () => undefined }) } }
}

beforeEach(() => {
  oscillators.length = 0
  localStorage.clear()
  ;(window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext
  navigator.vibrate = vi.fn().mockReturnValue(true)
})

describe('scan feedback — what the counter hears and feels', () => {
  it('plays a rising double beep and a short buzz for a good scan', () => {
    playScanFeedback('success')
    expect(oscillators.map((o) => o.frequency.value)).toEqual([880, 1175])
    expect(navigator.vibrate).toHaveBeenCalledWith([60])
  })

  it('plays a low harsh tone and a long buzz for a refusal — clearly different from success', () => {
    playScanFeedback('error')
    expect(oscillators.map((o) => o.frequency.value)).toEqual([220, 180])
    expect(oscillators.every((o) => o.type === 'sawtooth')).toBe(true)
    expect(navigator.vibrate).toHaveBeenCalledWith([300])
  })

  it('has a third, distinct tone for "look at this person"', () => {
    playScanFeedback('warn')
    expect(oscillators.map((o) => o.frequency.value)).toEqual([660, 660])
    expect(navigator.vibrate).toHaveBeenCalledWith([90, 60, 90])
  })

  it('makes no sound and no vibration when switched off, and the setting is remembered', () => {
    expect(isSoundOn()).toBe(true)
    setSoundOn(false)
    expect(isSoundOn()).toBe(false)
    playScanFeedback('success')
    expect(oscillators).toHaveLength(0)
    expect(navigator.vibrate).not.toHaveBeenCalled()
    setSoundOn(true)
    expect(isSoundOn()).toBe(true)
  })

  it('never throws on a device with no audio or vibration support (the screen flash still carries the message)', () => {
    delete (window as unknown as { AudioContext?: unknown }).AudioContext
    ;(navigator as unknown as { vibrate?: unknown }).vibrate = undefined
    expect(() => playScanFeedback('success')).not.toThrow()
  })
})
