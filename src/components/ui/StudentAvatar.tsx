import { useState } from 'react'
import { API_BASE_URL } from '@/services/api'
import { initials } from '@/utils/formatters'

interface StudentAvatarProps {
  studentId: string
  name: string
  size?: number
  className?: string
}

/**
 * Renders the student's official enrollment photo, served directly by the real backend
 * (`GET /students/:id/photo`) — deterministically generated from their UID, so it always
 * matches the university's record. There is deliberately no upload/edit control anywhere
 * near this component: a student can never change their own official photo.
 */
export function StudentAvatar({ studentId, name, size = 40, className = '' }: StudentAvatarProps) {
  const [failed, setFailed] = useState(false)
  const src = `${API_BASE_URL}/students/${studentId}/photo`

  if (failed) {
    return (
      <div
        className={`rounded-xl flex items-center justify-center text-white font-bold shrink-0 ${className}`}
        style={{ width: size, height: size, fontSize: size * 0.36, background: '#3554D1' }}
        title="Official photo unavailable — is the real API server running?"
      >
        {initials(name)}
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={`${name}'s official enrollment photo`}
      width={size}
      height={size}
      className={`rounded-xl object-cover shrink-0 ${className}`}
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  )
}
