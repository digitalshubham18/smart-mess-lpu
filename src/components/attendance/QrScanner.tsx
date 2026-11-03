import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { QrCode } from 'lucide-react'

interface Props {
  /** Camera runs only while true — the console switches it on when the chosen meal is being served. */
  active: boolean
  /** Called with the text of each QR code read. The same code is not repeated within `repeatGuardMs`. */
  onScan: (value: string) => void
  repeatGuardMs?: number
}

type Detector = { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> }

/**
 * A real camera QR scanner for the device in your hand. Uses the browser's built-in BarcodeDetector where it exists
 * (Chrome/Edge on Android and desktop) and falls back to a JavaScript decoder (jsQR) everywhere else — iPhone Safari,
 * Firefox — so it works on any phone. Browsers only allow the camera on https:// pages (or localhost).
 */
export function QrScanner({ active, onScan, repeatGuardMs = 3000 }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const onScanRef = useRef(onScan)
  useEffect(() => { onScanRef.current = onScan })
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)

  useEffect(() => {
    if (!active) return
    let stopped = false
    let stream: MediaStream | null = null
    let raf = 0
    let last = { value: '', at: 0 }
    const video = videoRef.current

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(window.isSecureContext === false
          ? 'The camera only works on a secure (https) page — open this site over https, or use manual entry below.'
          : 'This device or browser has no camera access — use manual entry below instead.')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return }
        if (!video) return
        video.srcObject = stream
        await video.play()
        setRunning(true)

        const Native = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector
        const detector = Native ? new Native({ formats: ['qr_code'] }) : null
        const canvas = canvasRef.current
        const ctx = canvas?.getContext('2d', { willReadFrequently: true })

        const tick = async () => {
          if (stopped) return
          let value = ''
          try {
            if (detector) {
              value = (await detector.detect(video))[0]?.rawValue ?? ''
            } else if (canvas && ctx && video.videoWidth > 0) {
              const scale = Math.min(1, 640 / video.videoWidth)
              canvas.width = Math.round(video.videoWidth * scale)
              canvas.height = Math.round(video.videoHeight * scale)
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
              value = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? ''
            }
          } catch {
            // a frame that can't be decoded is normal — try the next one
          }
          const now = Date.now()
          if (value && !(value === last.value && now - last.at < repeatGuardMs)) {
            last = { value, at: now }
            onScanRef.current(value)
          }
          if (!stopped) raf = window.setTimeout(() => requestAnimationFrame(tick), 120)
        }
        tick()
      } catch {
        setError('Camera access was denied or unavailable — use manual entry below instead.')
      }
    }
    void start()

    return () => {
      stopped = true
      clearTimeout(raf)
      stream?.getTracks().forEach((t) => t.stop())
      if (video) video.srcObject = null
      setRunning(false)
      setError('')
    }
  }, [active, repeatGuardMs])

  return (
    <div className="space-y-2">
      <div className="rounded-xl overflow-hidden bg-black aspect-video relative">
        <video ref={videoRef} className="w-full h-full object-cover" muted playsInline aria-label="Camera view" />
        <canvas ref={canvasRef} className="hidden" />
        {!running && <div className="absolute inset-0 flex items-center justify-center"><QrCode size={40} className="text-slate-500" /></div>}
        {running && <div className="absolute inset-8 rounded-2xl border-2 border-white/70 pointer-events-none" />}
      </div>
      {error && <p role="alert" className="text-xs text-rose-500">{error}</p>}
    </div>
  )
}
