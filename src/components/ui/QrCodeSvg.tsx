import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

export function QrCodeSvg({ value, size = 180 }: { value: string; size?: number }) {
  const [svg, setSvg] = useState('')

  useEffect(() => {
    let cancelled = false
    QRCode.toString(value, { type: 'svg', width: size, margin: 1, color: { dark: '#0F172A', light: '#00000000' } }).then((s) => {
      if (!cancelled) setSvg(s)
    })
    return () => {
      cancelled = true
    }
  }, [value, size])

  if (!svg) return <div style={{ width: size, height: size }} className="animate-pulse bg-surface-dim dark:bg-ink-800 rounded-lg" />
  // eslint-disable-next-line react/no-danger
  return <div style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />
}
