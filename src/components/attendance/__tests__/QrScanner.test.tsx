import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('jsqr', () => ({ default: vi.fn() }))
import jsQR from 'jsqr'
import { QrScanner } from '../QrScanner'

type W = Window & { BarcodeDetector?: unknown }
const win = window as W
const stop = vi.fn()
const getUserMedia = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  stop.mockClear()
  getUserMedia.mockResolvedValue({ getTracks: () => [{ stop }] })
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 640 })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 480 })
})
afterEach(() => { delete win.BarcodeDetector })

describe('QrScanner — the device camera', () => {
  it('does not touch the camera while inactive (e.g. outside the meal time)', () => {
    render(<QrScanner active={false} onScan={vi.fn()} />)
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('asks for the rear camera when active, and releases it when switched off', async () => {
    const { rerender } = render(<QrScanner active onScan={vi.fn()} />)
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1))
    expect(getUserMedia.mock.calls[0][0]).toMatchObject({ video: { facingMode: { ideal: 'environment' } }, audio: false })
    rerender(<QrScanner active={false} onScan={vi.fn()} />)
    await waitFor(() => expect(stop).toHaveBeenCalled())
  })

  it('reads a code with the browser\'s BarcodeDetector where it exists, and does not repeat the same code in quick succession', async () => {
    win.BarcodeDetector = class { detect = vi.fn().mockResolvedValue([{ rawValue: 'NATIVE-QR' }]) }
    const onScan = vi.fn()
    render(<QrScanner active onScan={onScan} />)
    await waitFor(() => expect(onScan).toHaveBeenCalledWith('NATIVE-QR'))
    await new Promise((r) => setTimeout(r, 600)) // several more frames see the same code
    expect(onScan).toHaveBeenCalledTimes(1)
  })

  it('falls back to a JavaScript decoder where there is no BarcodeDetector (iPhone Safari, Firefox)', async () => {
    delete win.BarcodeDetector
    const getImageData = vi.fn().mockReturnValue({ data: new Uint8ClampedArray(4), width: 1, height: 1 })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(), getImageData } as unknown as CanvasRenderingContext2D)
    vi.mocked(jsQR).mockReturnValue({ data: 'FALLBACK-QR' } as never)
    const onScan = vi.fn()
    render(<QrScanner active onScan={onScan} />)
    await waitFor(() => expect(onScan).toHaveBeenCalledWith('FALLBACK-QR'))
    expect(jsQR).toHaveBeenCalled()
  })

  it('says so, and points to manual entry, when camera permission is refused', async () => {
    getUserMedia.mockRejectedValueOnce(new Error('NotAllowedError'))
    render(<QrScanner active onScan={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/camera access was denied or unavailable — use manual entry/i)
  })

  it('explains when the page is not secure (browsers only allow cameras on https)', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
    const original = Object.getOwnPropertyDescriptor(window, 'isSecureContext')
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })
    render(<QrScanner active onScan={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/secure \(https\) page/i)
    if (original) Object.defineProperty(window, 'isSecureContext', original)
  })
})
