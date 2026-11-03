import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2, CheckCircle2, IdCard, Camera, QrCode, Plus, Trash2, Pencil, Upload, Award, Power, ArrowRightLeft, UserPlus, PlaneTakeoff } from 'lucide-react'
import type { Student } from '@/types'
import * as studentService from '@/services/studentService'
import * as userService from '@/services/userService'
import { fileToResizedDataUrl } from '@/utils/imageResize'
import { IdCardModalBody } from '@/components/students/IdCardModal'
import { studentSchema, uidStudentSchema, type StudentForm } from '@/utils/validators'
import { csvToObjects } from '@/utils/csv'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Modal, ConfirmDialog } from '@/components/ui/Modal'
import { FilterBar } from '@/components/ui/FilterBar'
import { PhotoNoticeBody } from '@/components/students/PhotoNoticeBody'
import { StudentAvatar } from '@/components/ui/StudentAvatar'
import { HOSTELS } from '@/data/mockHostels'
import { useAuth } from '@/hooks/useAuth'

export default function Students() {
  const { user } = useAuth()
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  const scopedHostelId = user && !isSuperAdmin ? user.hostelId : undefined
  const visibleHostels = scopedHostelId ? HOSTELS.filter((h) => h.id === scopedHostelId) : HOSTELS
  const [students, setStudents] = useState<Student[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<Student | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [transferItem, setTransferItem] = useState<Student | null>(null)
  const [assignItem, setAssignItem] = useState<Student | null>(null)
  const [photoItem, setPhotoItem] = useState<Student | null>(null)
  const [cardItem, setCardItem] = useState<Student | null>(null)
  const [parentInfo, setParentInfo] = useState<{ uid: string; name: string; password?: string; emailFailed?: boolean } | null>(null)
  const [resettingParent, setResettingParent] = useState(false)
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ kind: 'success' | 'warning' | 'error'; message: string; failed: studentService.BulkImportResult['failed'] } | null>(null)
  const [actionError, setActionError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  function refresh() {
    setLoading(true)
    studentService.listStudents().then((s) => {
      setStudents(scopedHostelId ? s.filter((x) => x.hostelId === scopedHostelId) : s)
      setLoading(false)
    })
  }
  useEffect(refresh, [scopedHostelId])

  const [onlyTemp, setOnlyTemp] = useState(false)
  const tempCount = students.filter((s) => s.provisional).length
  const filtered = students.filter((s) => (!filters.hostelId || s.hostelId === filters.hostelId) && (!filters.status || s.status === filters.status) && (!onlyTemp || s.provisional))

  const columns: Column<Student>[] = [
    { key: 'photo', header: '', accessor: (s) => <StudentAvatar studentId={s.id} name={s.name} size={32} /> },
    { key: 'name', header: 'Name', accessor: (s) => s.name, sortValue: (s) => s.name },
    {
      key: 'id', header: 'Student ID', sortValue: (s) => s.id, accessor: (s) => (
        <span className="flex items-center gap-1.5">
          <span className="font-mono">{s.id}</span>
          {s.provisional && <StatusBadge tone="warning">Temp ID — no UID yet</StatusBadge>}
        </span>
      ),
    },
    { key: 'email', header: 'Email', accessor: (s) => s.email, hideByDefault: true },
    { key: 'hostel', header: 'Hostel', accessor: (s) => HOSTELS.find((h) => h.id === s.hostelId)?.name ?? s.hostelId },
    { key: 'room', header: 'Room', accessor: (s) => s.room },
    { key: 'year', header: 'Year', accessor: (s) => s.year, sortValue: (s) => s.year },
    { key: 'branch', header: 'Branch', accessor: (s) => s.branch },
    { key: 'points', header: 'Points', accessor: (s) => <span className="flex items-center gap-1"><Award size={12} className="text-amber-500" /> {s.points}</span>, sortValue: (s) => s.points },
    {
      key: 'status', header: 'Status', accessor: (s) => (
        <div className="flex items-center gap-1.5">
          <StatusBadge tone={s.status === 'active' ? 'success' : 'neutral'}>{s.status}</StatusBadge>
          {s.leaveUntil && s.leaveUntil >= new Date().toISOString().slice(0, 10) && (
            <StatusBadge tone="warning"><PlaneTakeoff size={10} /> Away till {s.leaveUntil}</StatusBadge>
          )}
        </div>
      ), sortValue: (s) => s.status,
    },
    {
      key: 'actions', header: '', accessor: (s) => (
        <div className="flex gap-2">
          <button
            onClick={() => studentService.updateStudent(s.id, { status: s.status === 'active' ? 'inactive' : 'active' }).then(refresh)}
            title={s.status === 'active' ? 'Deactivate student' : 'Activate student'}
            className={s.status === 'active' ? 'text-eco-600 hover:text-rose-500' : 'text-slate-400 hover:text-eco-600'}
          >
            <Power size={14} />
          </button>
          <button
            onClick={async () => {
              try {
                const created = await userService.grantParentAccess(s.id)
                setActionError('')
                setParentInfo({ uid: created.id, name: s.name, password: created.tempPassword, emailFailed: created.emailSent === false })
              } catch (e) {
                setActionError(e instanceof Error ? e.message : 'Could not generate parent access.')
              }
            }}
            title="Generate parent/guardian access"
            className="text-slate-400 hover:text-tech-600"
          >
            <UserPlus size={14} />
          </button>
          <button onClick={() => setCardItem(s)} title="Print meal ID card" aria-label={`ID card for ${s.name}`} className="text-slate-400 hover:text-tech-600">
            <QrCode size={14} />
          </button>
          <button onClick={() => setPhotoItem(s)} title={s.hasPhoto ? 'Replace the official photo' : 'No official photo yet — upload one'} aria-label={`${s.hasPhoto ? 'Replace' : 'Add'} photo for ${s.name}`} className={s.hasPhoto ? 'text-slate-400 hover:text-tech-600' : 'text-amber-500 hover:text-amber-600'}>
            <Camera size={14} />
          </button>
          {s.provisional && (
            <button onClick={() => setAssignItem(s)} title="Assign the real UID" aria-label={`Assign UID to ${s.name}`} className="text-amber-500 hover:text-amber-600">
              <IdCard size={14} />
            </button>
          )}
          {isSuperAdmin && (
            <button onClick={() => setTransferItem(s)} title="Transfer to another hostel" className="text-slate-400 hover:text-tech-600">
              <ArrowRightLeft size={14} />
            </button>
          )}
          <button onClick={() => setEditItem(s)} className="text-slate-400 hover:text-tech-600"><Pencil size={14} /></button>
          <button onClick={() => setDeleteId(s.id)} className="text-slate-400 hover:text-rose-500"><Trash2 size={14} /></button>
        </div>
      ),
    },
  ]

  function exportSelected() {
    import('@/services/reportService').then(({ downloadCSV }) =>
      downloadCSV('students.csv', filtered.map((s) => ({ Name: s.name, ID: s.id, Email: s.email, Hostel: s.hostelId, Room: s.room, Year: s.year, Branch: s.branch })))
    )
  }

  // Real import. CSV needs a header row; recognised columns (any order, case-insensitive):
  // uid, name, email, phone, hostelId (or "hostel"), room, year, branch, mealPreference, status, noUid.
  // Every row needs a UID (name/email/phone/branch/year then come from the university record). A student with no UID yet
  // is a row with name, email and noUid = yes — they get a temporary ID. A scoped admin's rows default to their own hostel.
  // The server validates every row (role, mess scope, bed capacity, duplicate email) and
  // reports back which lines failed and why; nothing here is simulated.
  const CSV_COLUMNS: Record<string, string> = {
    uid: 'uid', studentid: 'uid', nouid: 'noUid', name: 'name', fullname: 'name', email: 'email', phone: 'phone', mobile: 'phone',
    hostelid: 'hostelId', hostel: 'hostelId', room: 'room', year: 'year', branch: 'branch',
    mealpreference: 'mealPreference', meal: 'mealPreference', status: 'status',
  }
  function importCSV(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const reset = () => { if (fileRef.current) fileRef.current.value = '' }
    if (!file) return
    setImportResult(null)
    const reader = new FileReader()
    reader.onload = async () => {
      const { rows, hasHeader, unknownColumns } = csvToObjects(reader.result as string, CSV_COLUMNS)
      if (!hasHeader) {
        setImportResult({ kind: 'error', message: 'No header row found. The first line must name the columns, e.g. uid,room,hostelId (or name,email,noUid for a student with no UID yet).', failed: [] })
        reset()
        return
      }
      if (rows.length === 0) {
        setImportResult({ kind: 'error', message: 'The file has a header but no student rows.', failed: [] })
        reset()
        return
      }
      // year is the one numeric field — convert here so "2" isn't rejected as a string.
      const payload = rows.map(({ line, data }) => {
        const { noUid, uid, ...rest } = data
        return {
          line,
          data: {
            ...rest,
            ...(uid?.trim() ? { uid: uid.trim() } : {}), // an empty cell means "no UID given", not a UID of ""
            ...(/^(yes|y|true|1)$/i.test((noUid ?? '').trim()) ? { noUid: true } : {}),
            ...(data.year !== undefined && data.year.trim() !== '' && Number.isFinite(Number(data.year)) ? { year: Number(data.year) } : {}),
          },
        }
      })
      setImporting(true)
      try {
        const result = await studentService.importStudents(payload)
        const parts = [`Imported ${result.created} student${result.created === 1 ? '' : 's'}`]
        if (result.failed.length) parts.push(`${result.failed.length} row${result.failed.length === 1 ? '' : 's'} rejected`)
        if (unknownColumns.length) parts.push(`ignored unknown column${unknownColumns.length === 1 ? '' : 's'}: ${unknownColumns.join(', ')}`)
        setImportResult({
          kind: result.failed.length === 0 ? 'success' : result.created > 0 ? 'warning' : 'error',
          message: parts.join(' · ') + '.',
          failed: result.failed,
        })
        refresh()
      } catch (err) {
        setImportResult({ kind: 'error', message: err instanceof Error ? err.message : 'Import failed.', failed: [] })
      } finally {
        setImporting(false)
        reset()
      }
    }
    reader.readAsText(file)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100">Student Management</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {students.length} students {scopedHostelId ? <>enrolled in <strong className="text-slate-600 dark:text-slate-300">{HOSTELS.find((h) => h.id === scopedHostelId)?.name}</strong></> : 'enrolled across all hostels.'}
          </p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={importCSV} />
          <button onClick={() => fileRef.current?.click()} disabled={importing} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2.5 rounded-lg border border-line dark:border-ink-700 disabled:opacity-60">
            <Upload size={13} /> {importing ? 'Importing…' : 'Import CSV'}
          </button>
          <button onClick={() => setShowForm(true)} className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2.5 rounded-lg bg-tech-500 text-white">
            <Plus size={14} /> Add student
          </button>
        </div>
      </div>

      {importResult && (
        <div
          role="status"
          data-testid="import-result"
          className={`rounded-lg px-3 py-2 text-xs ${importResult.kind === 'success' ? 'text-eco-600 bg-eco-50 dark:bg-eco-500/10' : importResult.kind === 'warning' ? 'text-amber-700 bg-amber-50 dark:bg-amber-500/10' : 'text-rose-600 bg-rose-50 dark:bg-rose-500/10'}`}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="font-medium">{importResult.message}</p>
            <button onClick={() => setImportResult(null)} className="shrink-0 underline">Dismiss</button>
          </div>
          {importResult.failed.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 max-h-40 overflow-y-auto">
              {importResult.failed.slice(0, 50).map((f) => <li key={`${f.line}-${f.error}`}>Line {f.line}: {f.error}</li>)}
              {importResult.failed.length > 50 && <li>…and {importResult.failed.length - 50} more.</li>}
            </ul>
          )}
        </div>
      )}
      {actionError && (
        <div role="alert" className="rounded-lg px-3 py-2 text-xs text-rose-600 bg-rose-50 dark:bg-rose-500/10 flex items-start justify-between gap-3">
          <span>{actionError}</span>
          <button onClick={() => setActionError('')} className="shrink-0 underline">Dismiss</button>
        </div>
      )}

      {(tempCount > 0 || onlyTemp) && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 text-sm px-4 py-2.5">
          <span>{tempCount} student{tempCount === 1 ? ' is' : 's are'} on a temporary ID (no UID yet). Assign their real UIDs as soon as they have them — they can't create an app login until then.</span>
          <button onClick={() => setOnlyTemp((v) => !v)} className="text-xs font-semibold underline">{onlyTemp ? 'Show everyone' : 'Show only these'}</button>
        </div>
      )}

      <FilterBar
        filters={[
          { key: 'hostelId', label: 'Hostel', options: visibleHostels.map((h) => ({ value: h.id, label: h.name })) },
          { key: 'status', label: 'Status', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
        ]}
        values={filters}
        onChange={(k, v) => setFilters((prev) => ({ ...prev, [k]: v }))}
      />

      <DataTable data={filtered} columns={columns} loading={loading} rowKey={(s) => s.id} searchableText={(s) => `${s.name} ${s.email} ${s.id}`} filename="students.csv" />

      <Modal open={showForm || !!editItem} onClose={() => { setShowForm(false); setEditItem(null) }} title={editItem ? 'Edit Student' : 'Add Student'}>
        <StudentFormFields
          initial={editItem}
          lockedHostelId={scopedHostelId}
          onSubmit={async (data) => {
            // Throws the server's reason (e.g. "BH1 is at full capacity (112/112 beds)") — the form shows it
            // and stays open, so nothing the person typed is lost.
            if (editItem) await studentService.updateStudentOrThrow(editItem.id, data)
            else await studentService.addStudent(data)  // data.uid (when given) makes the server fill name/email from the university record
            setShowForm(false)
            setEditItem(null)
            refresh()
          }}
        />
      </Modal>

      <Modal open={!!cardItem} onClose={() => setCardItem(null)} title={cardItem ? `Meal ID card — ${cardItem.name}` : 'Meal ID card'}>
        {cardItem && <IdCardModalBody student={cardItem} />}
      </Modal>

      <Modal open={!!photoItem} onClose={() => setPhotoItem(null)} title={photoItem ? `Official photo — ${photoItem.name}` : 'Official photo'}>
        {photoItem && (
          <PhotoForm
            student={photoItem}
            onDone={() => { setPhotoItem(null); refresh() }}
          />
        )}
      </Modal>

      <Modal open={!!assignItem} onClose={() => setAssignItem(null)} title={assignItem ? `Assign UID to ${assignItem.name}` : 'Assign UID'}>
        {assignItem && (
          <AssignUidForm
            student={assignItem}
            onSubmit={async (uid) => {
              await studentService.assignUid(assignItem.id, uid) // throws the server's reason; the form shows it and stays open
              setAssignItem(null)
              refresh()
            }}
          />
        )}
      </Modal>

      {isSuperAdmin && (
        <Modal open={!!transferItem} onClose={() => setTransferItem(null)} title={transferItem ? `Transfer ${transferItem.name}` : 'Transfer student'}>
          {transferItem && (
            <TransferFormFields
              student={transferItem}
              onSubmit={async (hostelId, reason, room) => {
                try {
                  await studentService.transferStudent(transferItem.id, hostelId, reason, user, room)
                  setTransferItem(null)
                  setActionError('')
                  refresh()
                } catch (e) {
                  setTransferItem(null)
                  setActionError(e instanceof Error ? e.message : 'Could not transfer the student.')
                }
              }}
            />
          )}
        </Modal>
      )}

      <Modal open={!!parentInfo} onClose={() => setParentInfo(null)} title="Parent/guardian access">
        {parentInfo && (
          <div className="space-y-3">
            {parentInfo.password ? (
              <>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  A read-only account for <strong>{parentInfo.name}</strong>'s parent/guardian was created. Share these sign-in details with them:
                </p>
                <div className="rounded-lg bg-surface-dim dark:bg-ink-800 p-3 text-sm font-mono" data-testid="parent-credentials">
                  UID: <strong>{parentInfo.uid}</strong><br />
                  Password: <strong>{parentInfo.password}</strong>
                </div>
                {parentInfo.emailFailed && <p role="alert" className="text-xs text-amber-700 bg-amber-50 dark:bg-amber-500/10 rounded-lg px-3 py-2">The email with these details could not be sent — pass them on yourself.</p>}
                <p className="text-[11px] text-slate-400">Shown once — only a hash is stored. They can see this student's meal plan status and points, nothing else.</p>
              </>
            ) : (
              <>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  <strong>{parentInfo.name}</strong>'s parent/guardian already has an account (UID <strong className="font-mono">{parentInfo.uid}</strong>). Its password can't be shown again.
                  If they've lost it, issue a new one — the old password stops working immediately.
                </p>
                <button
                  disabled={resettingParent}
                  onClick={async () => {
                    setResettingParent(true)
                    try {
                      const r = await userService.resetStaffPassword(parentInfo.uid)
                      setParentInfo({ ...parentInfo, password: r.tempPassword, emailFailed: r.emailSent === false })
                    } catch (e) {
                      setParentInfo(null)
                      setActionError(e instanceof Error ? e.message : 'Could not reset that password.')
                    } finally {
                      setResettingParent(false)
                    }
                  }}
                  className="w-full rounded-lg border border-line dark:border-ink-700 text-sm font-semibold py-2.5 disabled:opacity-60"
                >
                  {resettingParent ? 'Issuing…' : 'Issue a new password'}
                </button>
              </>
            )}
            <button onClick={() => setParentInfo(null)} className="w-full rounded-lg bg-tech-500 text-white text-sm font-semibold py-2.5">Done</button>
          </div>
        )}
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={() => deleteId && studentService.deleteStudent(deleteId).then(refresh)} title="Remove student?" danger confirmLabel="Remove" />
    </div>
  )
}

function PhotoForm({ student, onDone }: { student: Student; onDone: () => void }) {
  const [preview, setPreview] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  // A photo is personal data: unless consent is already on record, the person saving it confirms the student has seen the notice and agreed.
  const [agreed, setAgreed] = useState(false)
  const needsConsent = !student.photoConsent

  async function pick(file: File | undefined) {
    if (!file) return
    setError('')
    try { setPreview(await fileToResizedDataUrl(file)) } catch (e) { setPreview(''); setError(e instanceof Error ? e.message : 'Could not read that image.') }
  }
  async function save() {
    setSaving(true); setError('')
    try { await studentService.uploadStudentPhoto(student.id, preview, needsConsent && agreed); onDone() } catch (e) { setError(e instanceof Error ? e.message : 'Could not save the photo.') } finally { setSaving(false) }
  }
  async function remove() {
    setSaving(true); setError('')
    try { await studentService.removeStudentPhoto(student.id); onDone() } catch (e) { setError(e instanceof Error ? e.message : 'Could not remove the photo.') } finally { setSaving(false) }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        This is the photo the counter sees when <strong>{student.name}</strong> is scanned in, so use a clear, recent face photo. Only mess and hostel staff can set it — the student can't change it. It is deleted automatically when the student leaves the mess.
      </p>
      {needsConsent && (
        <div className="space-y-2">
          <PhotoNoticeBody />
          <label className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-200 cursor-pointer">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 h-4 w-4 rounded accent-tech-500" aria-label="The student agrees to the photo notice" />
            <span>I have shown {student.name} this notice (their parent or guardian, if under 18) and they <strong>agree</strong> to the mess holding their photo.</span>
          </label>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-rose-600 bg-rose-50 dark:bg-rose-500/10 rounded-lg px-3 py-2">{error}</p>}
      <div className="flex items-center gap-4">
        {preview ? <img src={preview} alt="New official photo preview" className="w-24 h-24 rounded-xl object-cover" /> : <StudentAvatar studentId={student.id} name={student.name} size={96} />}
        <label className="text-xs font-semibold rounded-lg border border-line dark:border-ink-700 px-3 py-2 cursor-pointer">
          Choose or take a photo
          <input type="file" accept="image/*" capture="user" aria-label="Photo file" className="sr-only" onChange={(e) => void pick(e.target.files?.[0])} />
        </label>
      </div>
      <div className="flex gap-2">
        <button onClick={() => void save()} disabled={!preview || saving || (needsConsent && !agreed)} className="flex-1 rounded-lg bg-tech-500 text-white text-sm font-semibold py-2.5 disabled:opacity-60">{saving ? 'Saving…' : 'Save photo'}</button>
        {student.hasPhoto && <button onClick={() => void remove()} disabled={saving} className="rounded-lg border border-line dark:border-ink-700 text-sm font-semibold px-4 disabled:opacity-60">Remove</button>}
      </div>
    </div>
  )
}

function AssignUidForm({ student, onSubmit }: { student: Student; onSubmit: (uid: string) => Promise<void> }) {
  const [uid, setUid] = useState('')
  const [dir, setDir] = useState<studentService.DirectoryLookup | 'checking' | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!/^\d{8}$/.test(uid)) { setDir(null); return }
    setDir('checking')
    let current = true
    const handle = setTimeout(() => { studentService.lookupDirectory(uid).then((r) => { if (current) setDir(r) }) }, 300)
    return () => { current = false; clearTimeout(handle) }
  }, [uid])

  const blocked = !!dir && dir !== 'checking' && dir.kind === 'onMess'
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault()
        setError(''); setSaving(true)
        try { await onSubmit(uid) } catch (err) { setError(err instanceof Error ? err.message : 'Could not assign the UID.') } finally { setSaving(false) }
      }}
    >
      <p className="text-sm text-slate-600 dark:text-slate-300">
        <strong>{student.name}</strong> is on a temporary ID (<span className="font-mono">{student.id}</span>). Enter their real UID — their check-ins, fines and history move over to it.
      </p>
      {error && <p role="alert" className="text-xs text-rose-600 bg-rose-50 dark:bg-rose-500/10 rounded-lg px-3 py-2">{error}</p>}
      <input
        value={uid} onChange={(e) => setUid(e.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric" aria-label="Real UID" placeholder="8-digit UID"
        className="w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm font-mono"
      />
      {dir === 'checking' && <p className="text-xs text-slate-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Looking up the university record…</p>}
      {dir && dir !== 'checking' && dir.kind === 'found' && <p className="text-xs text-eco-700 dark:text-eco-400 font-medium flex items-center gap-1.5"><CheckCircle2 size={13} /> University record: {dir.name}. Their name, email, branch and year will be taken from it.</p>}
      {dir && dir !== 'checking' && dir.kind === 'unknown' && <p className="text-xs text-amber-700 bg-amber-50 dark:bg-amber-500/10 rounded-lg px-3 py-2">Not in the university records — the UID will still be assigned and the details you entered stay as they are.</p>}
      {blocked && <p role="alert" className="text-xs text-amber-700 bg-amber-50 dark:bg-amber-500/10 rounded-lg px-3 py-2">That UID is already on a roster.</p>}
      <button type="submit" disabled={saving || uid.length !== 8 || blocked} className="w-full rounded-lg bg-tech-500 text-white text-sm font-semibold py-2.5 disabled:opacity-60">{saving ? 'Assigning…' : 'Assign UID'}</button>
    </form>
  )
}

function TransferFormFields({ student, onSubmit }: { student: Student; onSubmit: (hostelId: string, reason: string, room: string) => void }) {
  const [hostelId, setHostelId] = useState('')
  const [reason, setReason] = useState('')
  const [room, setRoom] = useState('')
  const options = HOSTELS.filter((h) => h.id !== student.hostelId)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!hostelId) return
        onSubmit(hostelId, reason, room)
      }}
      className="space-y-3"
    >
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Currently in <strong className="text-slate-700 dark:text-slate-200">{HOSTELS.find((h) => h.id === student.hostelId)?.name}</strong>, room {student.room}.
      </p>
      <div>
        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">New hostel</label>
        <select value={hostelId} onChange={(e) => setHostelId(e.target.value)} className="mt-1 w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm">
          <option value="" disabled>Select a hostel…</option>
          {options.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
      </div>
      <div>
        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">New room (optional)</label>
        <input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="e.g. B-204" className="mt-1 w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm" />
      </div>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" className="w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm" />
      <p className="text-[11px] text-slate-400">Leave the room blank to mark it "Unassigned" and set it later from the edit form.</p>
      <button type="submit" disabled={!hostelId} className="w-full rounded-lg bg-tech-500 text-white text-sm font-semibold py-2.5 disabled:opacity-50">Transfer student</button>
    </form>
  )
}

function StudentFormFields({ initial, onSubmit, lockedHostelId }: { initial: Student | null; onSubmit: (data: StudentForm & { uid?: string; noUid?: boolean; noUidReason?: string }) => Promise<void>; lockedHostelId?: string }) {
  const [submitError, setSubmitError] = useState('')
  // UID auto-fill (Add mode only): type a UID and the university's record supplies name, email, phone, branch and year.
  const [uid, setUid] = useState('')
  const [dir, setDir] = useState<studentService.DirectoryLookup | 'checking' | null>(null)
  // "No UID yet": the student has no university UID (e.g. a new admission), so they get a clearly-marked temporary ID.
  const [noUid, setNoUid] = useState(false)
  const [noUidReason, setNoUidReason] = useState('')
  const found = dir && dir !== 'checking' && dir.kind === 'found' ? dir : null
  const foundRef = useRef(false)
  foundRef.current = !!found
  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<StudentForm>({
    // With a record found the person comes from the university, so only placement is validated.
    resolver: (values, ctx, opts) => zodResolver(foundRef.current ? (uidStudentSchema as unknown as typeof studentSchema) : studentSchema)(values, ctx, opts),
    defaultValues: initial ?? { mealPreference: 'veg', year: 1, status: 'active', hostelId: lockedHostelId },
  })

  const ready = !!initial || !!found || noUid
  function toggleNoUid(on: boolean) {
    setNoUid(on); setUid(''); setDir(null); setSubmitError('')
    for (const f of ['name', 'email', 'phone', 'branch'] as const) setValue(f, '')
  }

  useEffect(() => {
    const trimmed = uid.trim()
    if (initial || !/^\d{8}$/.test(trimmed)) { setDir(null); return }
    setDir('checking')
    let current = true
    const handle = setTimeout(() => {
      studentService.lookupDirectory(trimmed).then((r) => {
        if (!current) return
        setDir(r)
        if (r.kind === 'found') {
          setValue('name', r.name); setValue('email', r.email); setValue('phone', r.phone)
          setValue('branch', r.branch); setValue('year', r.year)
        }
      })
    }, 300)
    return () => { current = false; clearTimeout(handle) }
  }, [uid, initial, setValue])
  return (
    <form
      onSubmit={handleSubmit(async (data) => {
        setSubmitError('')
        try {
          if (!initial && !found && !noUid) { setSubmitError('Enter the student\'s UID, or tick "No UID yet" if they don\'t have one.'); return }
          if (noUid && !noUidReason.trim()) { setSubmitError('Say why there is no UID yet (e.g. "new admission, UID pending").'); return }
          await onSubmit(found ? { ...data, uid: found.uid } : noUid ? { ...data, noUid: true, noUidReason: noUidReason.trim() } : data)
        } catch (e) {
          setSubmitError(e instanceof Error ? e.message : 'Could not save the student.')
        }
      })}
      className="space-y-3"
    >
      {submitError && <p role="alert" className="text-xs text-rose-600 bg-rose-50 dark:bg-rose-500/10 rounded-lg px-3 py-2">{submitError}</p>}
      {!initial && !noUid && (
        <div>
          <input
            value={uid}
            onChange={(e) => setUid(e.target.value.replace(/\D/g, '').slice(0, 8))}
            placeholder="Student UID — type it to auto-fill the details"
            inputMode="numeric"
            aria-label="Student UID"
            className="w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm font-mono"
          />
          {dir === 'checking' && <p className="text-xs text-slate-400 mt-1.5 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Looking up the university record…</p>}
          {found && <p className="text-xs text-eco-700 dark:text-eco-400 mt-1.5 flex items-center gap-1.5 font-medium"><CheckCircle2 size={13} /> Found {found.name} — details filled in from the university record. Just pick the hostel and room.</p>}
          {dir && dir !== 'checking' && dir.kind === 'onMess' && (
            <p role="alert" className="text-xs text-amber-700 bg-amber-50 dark:bg-amber-500/10 rounded-lg px-3 py-2 mt-1.5">
              {dir.name ? `${dir.name} (${dir.uid}) has already taken mess` : `UID ${dir.uid} has already taken mess`}{dir.hostelId ? ` in ${dir.hostelId}` : ' in another hostel'} — there is nothing to add.
            </p>
          )}
          {dir && dir !== 'checking' && dir.kind === 'unknown' && <p role="alert" className="text-xs text-amber-700 bg-amber-50 dark:bg-amber-500/10 rounded-lg px-3 py-2 mt-1.5">That UID isn't in the university records. Check the number — or tick "No UID yet" below if the student doesn't have one.</p>}
          {dir && dir !== 'checking' && dir.kind === 'error' && <p role="alert" className="text-xs text-rose-600 bg-rose-50 dark:bg-rose-500/10 rounded-lg px-3 py-2 mt-1.5">{dir.message}</p>}
        </div>
      )}
      {!initial && (
        <label className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer select-none">
          <input type="checkbox" checked={noUid} onChange={(e) => toggleNoUid(e.target.checked)} className="mt-0.5 h-4 w-4 rounded accent-tech-500" />
          <span><strong>No UID yet</strong> — the student doesn't have a university UID (e.g. a new admission). They'll get a temporary ID (TMP-…) and you can assign the real UID later.</span>
        </label>
      )}
      {noUid && (
        <input value={noUidReason} onChange={(e) => setNoUidReason(e.target.value)} maxLength={200} aria-label="Reason there is no UID" placeholder="Why no UID yet? e.g. new admission, UID pending" className="w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm" />
      )}
      {!ready && <p className="text-xs text-slate-400">Type the student's UID above — their details fill in automatically.</p>}
      {ready && (<>
      <input {...register('name')} readOnly={!!found} placeholder="Full name" className="w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm read-only:opacity-70" />
      {errors.name && <p className="text-xs text-rose-500">{errors.name.message}</p>}
      <input {...register('email')} readOnly={!!found} placeholder="Email" className="w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm read-only:opacity-70" />
      <input {...register('phone')} placeholder="Phone" className="w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm" />
      <div className="grid grid-cols-2 gap-3">
        <select {...register('hostelId')} disabled={!!lockedHostelId} className="rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm disabled:opacity-60">
          {(lockedHostelId ? HOSTELS.filter((h) => h.id === lockedHostelId) : HOSTELS).map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
        <input {...register('room')} placeholder="Room" className="rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <input type="number" {...register('year', { valueAsNumber: true })} placeholder="Year" className="rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm" />
        <input {...register('branch')} placeholder="Branch" className="rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm" />
      </div>
      <select {...register('mealPreference')} className="w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm">
        <option value="veg">Vegetarian</option>
        <option value="non-veg">Non-vegetarian</option>
        <option value="either">Either</option>
      </select>
      <div>
        <label className="text-xs font-medium text-slate-500">Status</label>
        <select {...register('status')} className="mt-1 w-full rounded-lg border border-line dark:border-ink-700 bg-surface dark:bg-ink-800 px-3 py-2 text-sm">
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>
      </>)}
      <button type="submit" disabled={isSubmitting || !ready || (!!dir && dir !== 'checking' && dir.kind === 'onMess')} className="w-full rounded-lg bg-tech-500 text-white text-sm font-semibold py-2.5 disabled:opacity-60">{initial ? 'Save Changes' : 'Add Student'}</button>
    </form>
  )
}
