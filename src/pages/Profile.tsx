import { ChangePasswordForm } from '@/components/auth/ChangePasswordForm'
// import { TwoFactorSettings } from '@/components/auth/TwoFactorSettings'
import { useT } from '@/i18n/useLanguage'
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher'
import { DevicesCard } from '@/components/auth/DevicesCard'
import { PhotoPrivacyCard } from '@/components/students/PhotoPrivacyCard'
import { useEffect, useState } from 'react'
import { Lock } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { DashboardCard } from '@/components/ui/DashboardCard'
import { StudentAvatar } from '@/components/ui/StudentAvatar'
import { StaffAvatar } from '@/components/ui/StaffAvatar'
import { ROLE_LABELS } from '@/data/mockUsers'
import { HOSTELS } from '@/data/mockHostels'
import * as studentService from '@/services/studentService'
import type { Student } from '@/types'

export default function Profile() {
  const t = useT()
  const { user } = useAuth()
  const [showChangePw, setShowChangePw] = useState(false)
  const [pwDone, setPwDone] = useState(false)
  const [student, setStudent] = useState<Student | null>(null)
  const isStudent = user?.role === 'STUDENT'

  useEffect(() => {
    if (user?.studentId && isStudent) studentService.getStudent(user.studentId).then(setStudent)
  }, [user?.studentId, isStudent])

  if (!user) return null

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100">Profile</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Your account details.</p>
      </div>

      <DashboardCard>
        <div className="flex items-center gap-4">
          {isStudent && user.studentId ? (
            <StudentAvatar studentId={user.studentId} name={user.name} size={56} />
          ) : (
            <StaffAvatar staffId={user.id} name={user.name} size={56} editable />
          )}
          <div>
            <div className="font-display font-semibold text-slate-800 dark:text-slate-100">{user.name}</div>
            <div className="text-sm text-slate-400">{ROLE_LABELS[user.role]}</div>
          </div>
        </div>

        {isStudent ? (
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-400">
            <Lock size={11} /> Official enrollment photo, held only with your consent — you can't change it here, but you can withdraw consent below.
          </p>
        ) : (
          <p className="mt-3 text-[11px] text-slate-400">Unlike a student's official enrollment photo, your photo isn't tied to a university record — set your own above.</p>
        )}

        <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
          <Row label="UID" value={user.studentId ?? user.id} />
          <Row label="Email" value={user.email} />
          {student && <Row label="Hostel" value={HOSTELS.find((h) => h.id === student.hostelId)?.name ?? student.hostelId} />}
          {student && <Row label="Room" value={student.room} />}
          {student && <Row label="Branch" value={student.branch} />}
          {student && <Row label="Points" value={String(student.points)} />}
        </div>
        <button onClick={() => { setShowChangePw((v) => !v); setPwDone(false) }} className="mt-5 text-sm font-semibold text-tech-600 dark:text-tech-500 hover:underline">
          Change password
        </button>
        {showChangePw && (
          <div className="mt-4 max-w-sm">
            {pwDone && <p role="status" className="mb-3 text-sm rounded-xl bg-eco-50 dark:bg-eco-500/10 text-eco-700 dark:text-eco-400 px-3.5 py-2.5">Password updated. Your other devices were signed out.</p>}
            {!pwDone && <ChangePasswordForm onDone={() => setPwDone(true)} />}
          </div>
        )}
        {/* <TwoFactorSettings /> */}
        <DevicesCard />
        <section aria-labelledby="lang-h" className="mt-6 pt-5 border-t border-line dark:border-ink-700">
          <h2 id="lang-h" className="font-display font-semibold text-slate-800 dark:text-slate-100">{t('profile.language')}</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-2">{t('profile.languageHelp')}</p>
          <LanguageSwitcher />
        </section>
        {isStudent && <PhotoPrivacyCard />}
      </DashboardCard>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-line dark:border-ink-700 py-2">
      <span className="text-slate-400">{label}</span>
      <span className="font-medium text-slate-700 dark:text-slate-200">{value}</span>
    </div>
  )
}
