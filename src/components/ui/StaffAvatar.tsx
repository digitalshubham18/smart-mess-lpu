import { useRef, useState } from 'react'
import { Camera, X, Loader2 } from 'lucide-react'
import { API_BASE_URL } from '@/services/api'
import * as userService from '@/services/userService'
import { initials } from '@/utils/formatters'

const MAX_BYTES = 1_500_000

export function StaffAvatar({ staffId, name, size = 56, editable = false }: { staffId: string; name: string; size?: number; editable?: boolean }) {
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [version, setVersion] = useState(0)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const src = `${API_BASE_URL}/staff/${staffId}/photo?v=${version}`

  function pickFile() {
    fileRef.current?.click()
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    if (file.size > MAX_BYTES) {
      setError('That image is too large — pick one under 1.5 MB.')
      return
    }
    const reader = new FileReader()
    reader.onload = async () => {
      setBusy(true)
      try {
        await userService.uploadStaffPhoto(staffId, reader.result as string)
        setFailed(false)
        setVersion((v) => v + 1)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed.')
      } finally {
        setBusy(false)
      }
    }
    reader.readAsDataURL(file)
  }

  async function removePhoto() {
    setBusy(true)
    try {
      await userService.removeStaffPhoto(staffId)
      setVersion((v) => v + 1)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="inline-flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        {failed ? (
          <div className="rounded-xl flex items-center justify-center text-white font-bold w-full h-full" style={{ fontSize: size * 0.36, background: '#3554D1' }}>
            {initials(name)}
          </div>
        ) : (
          <img src={src} alt={`${name}'s photo`} width={size} height={size} className="rounded-xl object-cover w-full h-full" onError={() => setFailed(true)} />
        )}
        {busy && (
          <div className="absolute inset-0 bg-black/40 rounded-xl flex items-center justify-center">
            <Loader2 size={18} className="text-white animate-spin" />
          </div>
        )}
      </div>
      {editable && (
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFileChange} />
          <button type="button" onClick={pickFile} className="text-xs font-semibold text-tech-600 dark:text-tech-500 hover:underline flex items-center gap-1">
            <Camera size={12} /> Change photo
          </button>
          <button type="button" onClick={removePhoto} className="text-xs text-slate-400 hover:underline flex items-center gap-1">
            <X size={12} /> Remove
          </button>
        </div>
      )}
      {error && <p className="text-[11px] text-rose-500 max-w-[160px] text-center">{error}</p>}
    </div>
  )
}
