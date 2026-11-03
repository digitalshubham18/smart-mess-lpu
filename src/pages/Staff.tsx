import { useEffect, useRef, useState } from 'react'
import { Plus, Trash2, UserCog, ShieldCheck, ShieldOff, Upload, KeyRound } from 'lucide-react'
import type { User } from '@/types'
import type { StaffRole } from '@/data/mockUsers'
import * as userService from '@/services/userService'
import { hostelsForMess, messName } from '@/data/mockMesses'
import { hostelName } from '@/data/mockHostels'
import { ROLE_LABELS } from '@/data/mockUsers'
import { useMessStore } from '@/store/useMessStore'
import { useAuth } from '@/hooks/useAuth'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Modal, ConfirmDialog } from '@/components/ui/Modal'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { StaffAvatar } from '@/components/ui/StaffAvatar'
import { CredentialsModal, type Credential } from '@/components/ui/CredentialsModal'
import { csvToObjects } from '@/utils/csv'

const STAFF_ROLES: { value: StaffRole; label: string }[] = [
  { value: 'MESS_MANAGER', label: 'Mess Manager' },
  { value: 'KITCHEN_STAFF', label: 'Kitchen Staff' },
  { value: 'FINANCE_MANAGER', label: 'Finance Manager' },
  { value: 'HOSTEL_WARDEN', label: 'Hostel Warden' },
]
const STAFF_ROLE_VALUES = new Set(STAFF_ROLES.map((r) => r.value))

export default function Staff() {
  const { user } = useAuth()
  const messId = useMessStore((s) => s.currentMessId)
  const hostelId = hostelsForMess(messId)[0]?.id
  const [staff, setStaff] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [importMsg, setImportMsg] = useState('')
  const [importFailures, setImportFailures] = useState<{ line: number; error: string }[]>([])
  const [resetId, setResetId] = useState<string | null>(null)
  const [reset2faId, setReset2faId] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [issued, setIssued] = useState<{ title: string; intro: string; credentials: Credential[]; emailFailed?: boolean } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function refresh() {
    if (!hostelId) return
    setLoading(true)
    userService.listStaffForHostel(hostelId).then((s) => {
      setStaff(s)
      setLoading(false)
    })
  }
  useEffect(refresh, [hostelId])

  const admin = staff.find((s) => s.role === 'ADMIN')
  const team = staff.filter((s) => s.role !== 'ADMIN')

  const columns: Column<User>[] = [
    { key: 'photo', header: '', accessor: (s) => <StaffAvatar staffId={s.id} name={s.name} size={32} /> },
    { key: 'name', header: 'Name', accessor: (s) => s.name, sortValue: (s) => s.name },
    { key: 'role', header: 'Role', accessor: (s) => <StatusBadge tone="info">{ROLE_LABELS[s.role]}</StatusBadge>, sortValue: (s) => s.role },
    { key: 'id', header: 'Staff UID', accessor: (s) => s.id },
    { key: 'email', header: 'Email', accessor: (s) => s.email, hideByDefault: true },
    { key: 'phone', header: 'Phone', accessor: (s) => s.phone ?? '—' },
    {
      key: 'actions', header: '', accessor: (s) => (
        <div className="flex items-center gap-2">
          <button onClick={() => setResetId(s.id)} className="text-slate-400 hover:text-tech-600" title="Issue a new temporary password" aria-label={`Reset password for ${s.name}`}>
            <KeyRound size={14} />
          </button>
          {s.twoFactorEnabled && (
            <button onClick={() => setReset2faId(s.id)} className="text-slate-400 hover:text-amber-600" title="Reset two-factor (lost authenticator)" aria-label={`Reset two-factor for ${s.name}`}>
              <ShieldOff size={14} />
            </button>
          )}
          <button onClick={() => setDeleteId(s.id)} className="text-slate-400 hover:text-rose-500" title="Remove from team">
            <Trash2 size={14} />
          </button>
        </div>
      ),
    },
  ]

  // CSV needs a header row; columns (any order): role, name, email, phone. Role is one of the 4
  // buildable roles. Every row is attempted on its own — a bad row (or one the server refuses,
  // e.g. a duplicate email) is reported with its line number and the rest still import. The
  // temporary passwords the server generates are collected so they can be shown once / downloaded.
  const CSV_COLUMNS = { role: 'role', name: 'name', fullname: 'name', email: 'email', phone: 'phone', mobile: 'phone' }
  function importCSV(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !hostelId) return
    const reset = () => { if (fileRef.current) fileRef.current.value = '' }
    setImportFailures([])
    const reader = new FileReader()
    reader.onload = async () => {
      const { rows, hasHeader } = csvToObjects(reader.result as string, CSV_COLUMNS)
      if (!hasHeader) { setImportMsg('No header row found — the first line must name the columns, e.g. role,name,email,phone.'); reset(); return }
      const created: Credential[] = []
      const failures: { line: number; error: string }[] = []
      for (const { line, data } of rows) {
        const role = data.role?.toUpperCase().replace(/\s+/g, '_') as StaffRole
        if (!role || !STAFF_ROLE_VALUES.has(role)) { failures.push({ line, error: `role must be one of ${[...STAFF_ROLE_VALUES].join(', ')}.` }); continue }
        if (!data.name) { failures.push({ line, error: 'name is required.' }); continue }
        try {
          const made = await userService.createStaffMember({ hostelId, role, name: data.name, email: data.email, phone: data.phone })
          if (made.tempPassword) created.push({ name: made.name, uid: made.id, password: made.tempPassword, role: ROLE_LABELS[made.role] })
        } catch (err) {
          failures.push({ line, error: err instanceof Error ? err.message : 'Could not add this person.' })
        }
      }
      setImportMsg(`Imported ${created.length} staff member${created.length === 1 ? '' : 's'}${failures.length ? `, ${failures.length} row${failures.length === 1 ? '' : 's'} rejected` : ''}.`)
      setImportFailures(failures)
      if (created.length > 0) setIssued({ title: 'New team sign-in details', intro: `${created.length} account${created.length === 1 ? ' was' : 's were'} created. Share each person's UID and temporary password with them:`, credentials: created })
      refresh()
      reset()
    }
    reader.readAsText(file)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100">Staff</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {hostelId ? <>Building the team for <strong className="text-slate-700 dark:text-slate-200">{messName(messId)}</strong> ({hostelName(hostelId)}).</> : 'Select a mess to manage its staff.'}
          </p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={importCSV} />
          <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2.5 rounded-lg border border-line dark:border-ink-700">
            <Upload size={13} /> Import CSV
          </button>
          <button onClick={() => setShowForm(true)} className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2.5 rounded-lg bg-tech-500 text-white">
            <Plus size={14} /> Add staff member
          </button>
        </div>
      </div>

      {importMsg && (
        <div data-testid="staff-import-result" className={`text-xs rounded-lg px-3 py-2 ${importFailures.length ? 'text-amber-700 bg-amber-50 dark:bg-amber-500/10' : 'text-eco-600 bg-eco-50 dark:bg-eco-500/10'}`}>
          <p className="font-medium">{importMsg}</p>
          {importFailures.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 max-h-40 overflow-y-auto">
              {importFailures.slice(0, 50).map((f) => <li key={`${f.line}-${f.error}`}>Line {f.line}: {f.error}</li>)}
            </ul>
          )}
        </div>
      )}
      {actionError && <p role="alert" className="text-xs text-rose-600 bg-rose-50 dark:bg-rose-500/10 rounded-lg px-3 py-2">{actionError}</p>}

      <div className="rounded-xl border border-line dark:border-ink-700 bg-white dark:bg-ink-900 p-4 flex items-center gap-3">
        {admin ? <StaffAvatar staffId={admin.id} name={admin.name} size={36} /> : (
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0 bg-tech-500">?</div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{admin?.name ?? 'No admin assigned'}</div>
          <div className="text-xs text-slate-400">Mess Admin · UID {admin?.id ?? '—'} {user?.id === admin?.id && '(you)'}</div>
        </div>
        {admin?.twoFactorEnabled && user?.role === 'SUPER_ADMIN' && (
          <button onClick={() => setReset2faId(admin.id)} className="text-xs font-semibold text-amber-700 hover:underline shrink-0" aria-label={`Reset two-factor for ${admin.name}`}>Reset two-factor</button>
        )}
        <ShieldCheck size={16} className="text-tech-500 shrink-0" />
      </div>

      <div className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400 rounded-lg bg-surface-dim dark:bg-ink-800 p-3">
        <UserCog size={14} className="shrink-0 mt-0.5 text-tech-500" />
        It's the Mess Admin's responsibility to build out this mess's team — add staff one at a time, or import a CSV with
        columns <code>role,name,email,phone</code> (role is one of Mess Manager, Kitchen Staff, Finance Manager, Hostel
        Warden). Only the Super Admin can create a new mess's Admin account.
      </div>

      <DataTable data={team} columns={columns} loading={loading} rowKey={(s) => s.id} searchableText={(s) => `${s.name} ${s.email} ${s.id}`} filename="staff.csv" />

      <Modal open={showForm} onClose={() => setShowForm(false)} title="Add staff member">
        <StaffFormFields
          onSubmit={async (data) => {
            if (!hostelId) return
            const made = await userService.createStaffMember({ ...data, hostelId })
            setShowForm(false)
            if (made.tempPassword) setIssued({ title: 'Staff account created', intro: `Share these sign-in details with ${made.name}:`, credentials: [{ name: made.name, uid: made.id, password: made.tempPassword }], emailFailed: made.emailSent === false })
            refresh()
          }}
        />
      </Modal>

      <CredentialsModal open={!!issued} onClose={() => setIssued(null)} title={issued?.title ?? ''} intro={issued?.intro ?? ''} credentials={issued?.credentials ?? []} emailFailed={issued?.emailFailed} />

      <ConfirmDialog
        open={!!resetId}
        onClose={() => setResetId(null)}
        onConfirm={async () => {
          const target = staff.find((m) => m.id === resetId)
          setResetId(null)
          if (!target) return
          try {
            const r = await userService.resetStaffPassword(target.id)
            setActionError('')
            setIssued({ title: 'New temporary password', intro: `${target.name}'s old password no longer works and their sessions were signed out:`, credentials: [{ name: target.name, uid: r.id, password: r.tempPassword }], emailFailed: r.emailSent === false })
          } catch (e) {
            setActionError(e instanceof Error ? e.message : 'Could not reset that password.')
          }
        }}
        title="Issue a new temporary password?"
        confirmLabel="Reset password"
      />

      <ConfirmDialog
        open={!!reset2faId}
        onClose={() => setReset2faId(null)}
        onConfirm={async () => {
          const target = staff.find((m) => m.id === reset2faId)
          setReset2faId(null)
          if (!target) return
          try {
            await userService.resetStaffTwoFactor(target.id)
            setActionError('')
            setImportMsg(`Two-factor was reset for ${target.name}. They are signed out everywhere and must set it up again at their next sign-in.`)
            setImportFailures([])
            refresh()
          } catch (e) {
            setActionError(e instanceof Error ? e.message : 'Could not reset two-factor.')
          }
        }}
        title="Reset two-factor for this person?"
        confirmLabel="Reset two-factor"
      />

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && userService.deleteStaffMember(deleteId).then(refresh)}
        title="Remove this staff member?"
        danger
        confirmLabel="Remove"
      />
    </div>
  )
}

function StaffFormFields({ onSubmit }: { onSubmit: (data: { role: StaffRole; name: string; email?: string; phone?: string }) => void }) {
  const [role, setRole] = useState<StaffRole>('MESS_MANAGER')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim()) {
          setError('Enter a name.')
          return
        }
        onSubmit({ role, name, email: email || undefined, phone: phone || undefined })
      }}
      className="space-y-3"
    >
      {error && <p className="text-xs text-rose-500">{error}</p>}
      <div>
        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Role</label>
        <select value={role} onChange={(e) => setRole(e.target.value as StaffRole)} className="mt-1 w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm">
          {STAFF_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className="w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm" />
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (optional — auto-generated if left blank)" className="w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm" />
      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" className="w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm" />
      <p className="text-[11px] text-slate-400">A staff UID and a one-time temporary password are generated — you'll see them once after saving, and they're also emailed to the address above.</p>
      <button type="submit" className="w-full rounded-lg bg-tech-500 text-white text-sm font-semibold py-2.5">Add to team</button>
    </form>
  )
}
