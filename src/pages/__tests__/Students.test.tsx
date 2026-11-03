import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithRouter, signInAs, signOut, makeUser } from '@/test/utils'
import type { Student } from '@/types'

// The network edge is mocked at the service boundary; the page, CSV parser, FileReader,
// react-hook-form + zod, and DataTable are all real.
vi.mock('@/services/studentService', async (orig) => {
  const actual = await orig<typeof import('@/services/studentService')>()
  return {
    ...actual,
    listStudents: vi.fn(),
    importStudents: vi.fn(),
    addStudent: vi.fn(),
    updateStudent: vi.fn(),
    updateStudentOrThrow: vi.fn(),
    transferStudent: vi.fn(),
    deleteStudent: vi.fn(),
    lookupDirectory: vi.fn(),
    assignUid: vi.fn(),
    uploadStudentPhoto: vi.fn(),
    removeStudentPhoto: vi.fn(),
    getIdCard: vi.fn(),
    getPhotoNotice: vi.fn().mockResolvedValue({ version: 'v1', title: 'Your photo at the mess counter', points: [{ heading: 'How long', text: 'Until you leave the mess or withdraw your consent.' }] }),
  }
})
vi.mock('@/services/userService', () => ({ grantParentAccess: vi.fn(), resetStaffPassword: vi.fn() }))
vi.mock('@/components/ui/StudentAvatar', () => ({ StudentAvatar: () => null }))

import * as studentService from '@/services/studentService'
vi.mock('@/components/ui/QrCodeSvg', () => ({ QrCodeSvg: ({ value }: { value: string }) => <div data-testid="card-qr">{value}</div> }))
vi.mock('@/utils/imageResize', () => ({ fileToResizedDataUrl: vi.fn().mockResolvedValue('data:image/jpeg;base64,QUJD') }))
import Students from '../Students'

const svc = vi.mocked(studentService)

const roster: Student[] = [
  { id: '21000001', name: 'Aarav Sharma', email: 'aarav@x.edu', phone: '9000000001', hostelId: 'BH2', room: 'A-101', year: 2, branch: 'Civil', mealPreference: 'veg', status: 'active', points: 10, badges: [], missedCutoffCount: 0 },
]

function csvFile(text: string, name = 'students.csv') {
  return new File([text], name, { type: 'text/csv' })
}
function fileInput(container: HTMLElement) {
  return container.querySelector('input[type="file"]') as HTMLInputElement
}

beforeEach(() => {
  vi.clearAllMocks()
  svc.listStudents.mockResolvedValue(roster)
  signInAs(makeUser({ role: 'ADMIN', hostelId: 'BH2', name: 'BH2 Admin' }))
})

describe('Students — CSV import is real (no more alert() simulation)', () => {
  it('parses the file, sends header-mapped rows with line numbers to the real import, and reports the count', async () => {
    svc.importStudents.mockResolvedValueOnce({ created: 2, failed: [] })
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    const { container } = renderWithRouter(<Students />)
    await screen.findByText('Aarav Sharma')

    await userEvent.setup().upload(fileInput(container), csvFile('Name,Email,Room,Year,Meal Preference\nRiya Rao,riya@x.edu,B-2,3,veg\n"Kumar, Dev",dev@x.edu,B-3,2,non-veg\n'))

    const banner = await screen.findByTestId('import-result')
    expect(banner).toHaveTextContent('Imported 2 students.')
    expect(alertSpy).not.toHaveBeenCalled()
    expect(svc.importStudents).toHaveBeenCalledTimes(1)
    expect(svc.importStudents).toHaveBeenCalledWith([
      { line: 2, data: { name: 'Riya Rao', email: 'riya@x.edu', room: 'B-2', year: 3, mealPreference: 'veg' } },
      { line: 3, data: { name: 'Kumar, Dev', email: 'dev@x.edu', room: 'B-3', year: 2, mealPreference: 'non-veg' } }, // quoted comma stays in one cell
    ])
  })

  it('refreshes the roster after a successful import', async () => {
    svc.importStudents.mockResolvedValueOnce({ created: 1, failed: [] })
    const { container } = renderWithRouter(<Students />)
    await screen.findByText('Aarav Sharma')
    expect(svc.listStudents).toHaveBeenCalledTimes(1)
    await userEvent.setup().upload(fileInput(container), csvFile('name,email\nRiya Rao,riya@x.edu'))
    await waitFor(() => expect(svc.listStudents).toHaveBeenCalledTimes(2))
  })

  it('lists each rejected row with its line number and the server\'s reason (including a full hostel)', async () => {
    svc.importStudents.mockResolvedValueOnce({
      created: 1,
      failed: [
        { line: 3, error: 'email: Invalid email address' },
        { line: 5, error: 'BH2 is at full capacity (112/112 beds) — it can\'t take another student.', code: 'HOSTEL_FULL' },
        { line: 6, error: 'You can only import students into your own hostel (BH2).', code: 'OUT_OF_SCOPE' },
      ],
    })
    const { container } = renderWithRouter(<Students />)
    await screen.findByText('Aarav Sharma')
    await userEvent.setup().upload(fileInput(container), csvFile('name,email\nA B,a@x.edu\nC D,bad\nE F,e@x.edu\nG H,g@x.edu\nI J,i@x.edu'))

    const banner = await screen.findByTestId('import-result')
    expect(banner).toHaveTextContent('Imported 1 student · 3 rows rejected.')
    expect(within(banner).getByText(/Line 3: email: Invalid email address/)).toBeInTheDocument()
    expect(within(banner).getByText(/Line 5: BH2 is at full capacity \(112\/112 beds\)/)).toBeInTheDocument()
    expect(within(banner).getByText(/Line 6: You can only import students into your own hostel/)).toBeInTheDocument()
  })

  it('reports an all-rejected file as an error, not a success', async () => {
    svc.importStudents.mockResolvedValueOnce({ created: 0, failed: [{ line: 2, error: 'BH2 is at full capacity (112/112 beds) — it can\'t take another student.' }] })
    const { container } = renderWithRouter(<Students />)
    await screen.findByText('Aarav Sharma')
    await userEvent.setup().upload(fileInput(container), csvFile('name,email\nA B,a@x.edu'))
    const banner = await screen.findByTestId('import-result')
    expect(banner).toHaveTextContent('Imported 0 students · 1 row rejected.')
    expect(banner.className).toMatch(/rose/)
  })

  it('rejects a file with no header row up front, without calling the server', async () => {
    const { container } = renderWithRouter(<Students />)
    await screen.findByText('Aarav Sharma')
    await userEvent.setup().upload(fileInput(container), csvFile('Riya Rao,riya@x.edu\nDev Kumar,dev@x.edu'))
    expect(await screen.findByTestId('import-result')).toHaveTextContent(/no header row found/i)
    expect(svc.importStudents).not.toHaveBeenCalled()
  })

  it('rejects a header-only file, and notes unknown columns it ignored', async () => {
    svc.importStudents.mockResolvedValueOnce({ created: 1, failed: [] })
    const { container } = renderWithRouter(<Students />)
    await screen.findByText('Aarav Sharma')
    const user = userEvent.setup()
    await user.upload(fileInput(container), csvFile('name,email\n'))
    expect(await screen.findByTestId('import-result')).toHaveTextContent(/header but no student rows/i)

    await user.upload(fileInput(container), csvFile('name,email,shoe size\nA B,a@x.edu,9'))
    await waitFor(() => expect(screen.getByTestId('import-result')).toHaveTextContent(/ignored unknown column: shoe size/i))
  })

  it('shows the server\'s message if the import request itself fails (e.g. server down)', async () => {
    svc.importStudents.mockRejectedValueOnce(new Error('Import failed — is the real API server running?'))
    const { container } = renderWithRouter(<Students />)
    await screen.findByText('Aarav Sharma')
    await userEvent.setup().upload(fileInput(container), csvFile('name,email\nA B,a@x.edu'))
    expect(await screen.findByTestId('import-result')).toHaveTextContent(/is the real api server running/i)
  })

  it('shows "Importing…" and disables the button while the request is in flight', async () => {
    let finish!: (v: { created: number; failed: [] }) => void
    svc.importStudents.mockReturnValueOnce(new Promise((r) => { finish = r }))
    const { container } = renderWithRouter(<Students />)
    await screen.findByText('Aarav Sharma')
    await userEvent.setup().upload(fileInput(container), csvFile('name,email\nA B,a@x.edu'))
    const btn = await screen.findByRole('button', { name: /importing/i })
    expect(btn).toBeDisabled()
    finish({ created: 1, failed: [] })
    await waitFor(() => expect(screen.getByRole('button', { name: /import csv/i })).toBeEnabled())
  })
})

describe('Students — hostel-capacity errors reach the person', () => {
  async function openAddForm() {
    const user = userEvent.setup()
    renderWithRouter(<Students />)
    await screen.findByText('Aarav Sharma')
    await user.click(screen.getByRole('button', { name: /add student/i }))
    await screen.findByRole('dialog', { name: /add student/i })
    await user.click(screen.getByRole('checkbox', { name: /no uid yet/i })) // a UID is required unless staff explicitly say there isn't one
    await user.type(screen.getByLabelText(/reason there is no uid/i), 'new admission, UID pending')
    await user.type(screen.getByPlaceholderText('Full name'), 'Overflow Student')
    await user.type(screen.getByPlaceholderText('Email'), 'overflow@x.edu')
    await user.type(screen.getByPlaceholderText('Phone'), '9000000099')
    await user.type(screen.getByPlaceholderText('Room'), 'Z-9')
    await user.type(screen.getByPlaceholderText('Branch'), 'Civil')
    return user
  }

  it('adding student #113 shows the full-hostel message in the form and keeps the form (and the typed data) open', async () => {
    svc.addStudent.mockRejectedValueOnce(new Error("BH2 is at full capacity (112/112 beds) — it can't take another student."))
    const user = await openAddForm()
    const dialog = screen.getByRole('dialog', { name: /add student/i })
    await user.click(within(dialog).getByRole('button', { name: /^add student$/i }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/BH2 is at full capacity \(112\/112 beds\)/)
    expect(screen.getByPlaceholderText('Full name')).toHaveValue('Overflow Student')
    expect(within(dialog).getByRole('button', { name: /^add student$/i })).toBeEnabled() // can fix and retry
  })

  it('closes the form and refreshes when the add succeeds', async () => {
    svc.addStudent.mockResolvedValueOnce(roster[0])
    const user = await openAddForm()
    await user.click(within(screen.getByRole('dialog', { name: /add student/i })).getByRole('button', { name: /^add student$/i }))
    await waitFor(() => expect(screen.queryByPlaceholderText('Full name')).not.toBeInTheDocument())
    expect(svc.listStudents).toHaveBeenCalledTimes(2)
  })

  it('a Super Admin\'s transfer into a full hostel surfaces the reason on the page', async () => {
    signInAs(makeUser({ id: '10001', role: 'SUPER_ADMIN', hostelId: undefined }))
    svc.transferStudent.mockRejectedValueOnce(new Error("BH1 is at full capacity (112/112 beds) — it can't take another student."))
    renderWithRouter(<Students />)
    await screen.findByText('Aarav Sharma')
    const user = userEvent.setup()
    await user.click(screen.getByTitle(/transfer to another hostel/i))
    const dialog = await screen.findByRole('dialog', { name: /transfer/i })
    await user.selectOptions(within(dialog).getByRole('combobox'), 'BH1')
    await user.click(within(dialog).getByRole('button', { name: /transfer student/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/BH1 is at full capacity/)
  })
})

describe('Students — scope shown to a hostel-level admin', () => {
  it('locks the hostel field to the admin\'s own hostel and hides the transfer action', async () => {
    const user = userEvent.setup()
    renderWithRouter(<Students />)
    await screen.findByText('Aarav Sharma')
    expect(screen.queryByTitle(/transfer to another hostel/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /add student/i }))
    await user.click(await screen.findByRole('checkbox', { name: /no uid yet/i })) // placement fields appear once a UID is found or "No UID yet" is ticked
    const hostelSelect = within(await screen.findByRole('dialog', { name: /add student/i })).getAllByRole('combobox')[0]
    expect(hostelSelect).toBeDisabled()
    expect(within(hostelSelect).getAllByRole('option')).toHaveLength(1)
  })
})

describe('Students — parent/guardian access shows the real password', () => {
  it('a new parent account shows the server-generated one-time password, never "demo1234"', async () => {
    const userService = await import('@/services/userService')
    vi.mocked(userService.grantParentAccess).mockResolvedValueOnce({ id: 'P21000001', name: "Aarav's Parent", email: 'p@x', role: 'PARENT', avatarColor: '#000', createdAt: '', tempPassword: 'Gx4-pL8z' } as never)
    renderWithRouter(<Students />)
    await screen.findByText('Aarav Sharma')
    await userEvent.setup().click(screen.getByTitle(/generate parent\/guardian access/i))
    const box = await screen.findByTestId('parent-credentials')
    expect(box).toHaveTextContent('P21000001')
    expect(box).toHaveTextContent('Gx4-pL8z')
    expect(screen.queryByText(/demo1234/)).not.toBeInTheDocument()
  })

  it('an EXISTING parent account says the password can\'t be shown, and offers to issue a new one', async () => {
    const userService = await import('@/services/userService')
    vi.mocked(userService.grantParentAccess).mockResolvedValueOnce({ id: 'P21000001', name: "Aarav's Parent", email: 'p@x', role: 'PARENT', avatarColor: '#000', createdAt: '' } as never)
    vi.mocked(userService.resetStaffPassword).mockResolvedValueOnce({ id: 'P21000001', tempPassword: 'Nw-77-abc' })
    renderWithRouter(<Students />)
    await screen.findByText('Aarav Sharma')
    const user = userEvent.setup()
    await user.click(screen.getByTitle(/generate parent\/guardian access/i))
    expect(await screen.findByText(/already has an account/i)).toBeInTheDocument()
    expect(screen.queryByTestId('parent-credentials')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /issue a new password/i }))
    expect(await screen.findByTestId('parent-credentials')).toHaveTextContent('Nw-77-abc')
  })

  it('shows the server\'s refusal (e.g. another mess\'s student) instead of failing silently', async () => {
    const userService = await import('@/services/userService')
    vi.mocked(userService.grantParentAccess).mockRejectedValueOnce(new Error("That's outside your mess — you can only do this for your own hostel's mess."))
    renderWithRouter(<Students />)
    await screen.findByText('Aarav Sharma')
    await userEvent.setup().click(screen.getByTitle(/generate parent\/guardian access/i))
    expect(await screen.findByRole('alert')).toHaveTextContent(/outside your mess/i)
  })
})

describe('Students — typing a UID auto-fills the Add Student form', () => {
  async function openForm() {
    const user = userEvent.setup()
    renderWithRouter(<Students />)
    await screen.findByText('Aarav Sharma')
    await user.click(screen.getByRole('button', { name: /add student/i }))
    return { user, uid: await screen.findByLabelText(/student uid/i) }
  }

  it('fills name, email, phone, branch and year from the university record, locks name/email, and submits the UID', async () => {
    svc.lookupDirectory.mockResolvedValue({ kind: 'found', uid: '22000001', name: 'Riya Mehta', email: 'riya@lpu.edu', phone: '9876543210', branch: 'Civil', year: 3 })
    svc.addStudent.mockResolvedValue({ ...roster[0], id: '22000001', name: 'Riya Mehta' })
    const { user, uid } = await openForm()
    await user.type(uid, '22000001')
    expect(await screen.findByText(/found riya mehta/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Full name')).toHaveValue('Riya Mehta')
    expect(screen.getByPlaceholderText('Full name')).toHaveAttribute('readonly')
    expect(screen.getByPlaceholderText('Email')).toHaveValue('riya@lpu.edu')
    expect(screen.getByPlaceholderText('Branch')).toHaveValue('Civil')
    await user.type(screen.getByPlaceholderText('Room'), 'B-12')
    await user.click(screen.getAllByRole('button', { name: /^add student$/i }).at(-1)!)
    await waitFor(() => expect(svc.addStudent).toHaveBeenCalledTimes(1))
    expect(svc.addStudent.mock.calls[0][0]).toMatchObject({ uid: '22000001', name: 'Riya Mehta', email: 'riya@lpu.edu', room: 'B-12', hostelId: 'BH2' })
  })

  it('a UID that has already taken mess is flagged and cannot be added again', async () => {
    svc.lookupDirectory.mockResolvedValue({ kind: 'onMess', uid: '21000001', name: 'Aarav Sharma', hostelId: 'BH2' })
    const { user, uid } = await openForm()
    await user.type(uid, '21000001')
    expect(await screen.findByRole('alert')).toHaveTextContent(/already taken mess/i)
    expect(screen.getAllByRole('button', { name: /^add student$/i }).at(-1)).toBeDisabled()
  })

  it('a UID missing from the university records says so and leaves manual entry available', async () => {
    svc.lookupDirectory.mockResolvedValue({ kind: 'unknown' })
    const { user, uid } = await openForm()
    await user.type(uid, '99999999')
    expect(await screen.findByRole('alert')).toHaveTextContent(/isn't in the university records/i)
    expect(screen.queryByPlaceholderText('Full name')).not.toBeInTheDocument() // still no way to type details in without a UID…
    await user.click(screen.getByRole('checkbox', { name: /no uid yet/i })) // …except by explicitly choosing "No UID yet"
    expect(screen.getByPlaceholderText('Full name')).not.toHaveAttribute('readonly')
  })
})

describe('Students — a UID is required; "No UID yet" issues a temporary ID', () => {
  async function openForm() {
    const user = userEvent.setup()
    renderWithRouter(<Students />)
    await screen.findByText('Aarav Sharma')
    await user.click(screen.getByRole('button', { name: /add student/i }))
    await screen.findByRole('dialog', { name: /add student/i })
    return user
  }

  it('shows only the UID box until a UID is found or "No UID yet" is chosen, and cannot be submitted before', async () => {
    await openForm()
    expect(screen.queryByPlaceholderText('Full name')).not.toBeInTheDocument()
    expect(screen.getByText(/type the student's uid above/i)).toBeInTheDocument()
    expect(within(screen.getByRole('dialog', { name: /add student/i })).getByRole('button', { name: /^add student$/i })).toBeDisabled()
  })

  it('"No UID yet" needs a reason, then sends noUid + the reason (never a UID) to the server', async () => {
    svc.addStudent.mockResolvedValue({ ...roster[0], id: 'TMP-00001', provisional: true })
    const user = await openForm()
    await user.click(screen.getByRole('checkbox', { name: /no uid yet/i }))
    expect(screen.queryByLabelText('Student UID')).not.toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('Full name'), 'Newcomer Person')
    await user.type(screen.getByPlaceholderText('Email'), 'newcomer@x.edu')
    await user.type(screen.getByPlaceholderText('Phone'), '9000000011')
    await user.type(screen.getByPlaceholderText('Room'), 'C-1')
    await user.type(screen.getByPlaceholderText('Branch'), 'Law')
    const submit = () => within(screen.getByRole('dialog', { name: /add student/i })).getByRole('button', { name: /^add student$/i })
    await user.click(submit())
    expect(await screen.findByText(/say why there is no uid yet/i)).toBeInTheDocument()
    expect(svc.addStudent).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText(/reason there is no uid/i), 'new admission, UID pending')
    await user.click(submit())
    await waitFor(() => expect(svc.addStudent).toHaveBeenCalledTimes(1))
    const sent = svc.addStudent.mock.calls[0][0]
    expect(sent).toMatchObject({ noUid: true, noUidReason: 'new admission, UID pending', name: 'Newcomer Person' })
    expect(sent.uid).toBeUndefined()
  })

  it('a student on a temporary ID is badged, and "Assign UID" swaps in the real one', async () => {
    svc.listStudents.mockResolvedValue([{ ...roster[0], id: 'TMP-00007', name: 'Temp Student', provisional: true }])
    svc.lookupDirectory.mockResolvedValue({ kind: 'found', uid: '22000009', name: 'Temp Student', email: 't@lpu.edu', phone: '', branch: 'Civil', year: 1 })
    svc.assignUid.mockResolvedValue({ ...roster[0], id: '22000009', provisional: false })
    renderWithRouter(<Students />)
    expect(await screen.findByText('TMP-00007')).toBeInTheDocument()
    expect(screen.getByText(/temp id — no uid yet/i)).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /assign uid to temp student/i }))
    const dialog = await screen.findByRole('dialog', { name: /assign uid/i })
    await user.type(within(dialog).getByLabelText('Real UID'), '22000009')
    expect(await within(dialog).findByText(/university record: temp student/i)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /^assign uid$/i }))
    await waitFor(() => expect(svc.assignUid).toHaveBeenCalledWith('TMP-00007', '22000009'))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /assign uid/i })).not.toBeInTheDocument())
  })

  it('a server refusal (e.g. UID already taken) is shown and the dialog stays open', async () => {
    svc.listStudents.mockResolvedValue([{ ...roster[0], id: 'TMP-00007', name: 'Temp Student', provisional: true }])
    svc.lookupDirectory.mockResolvedValue({ kind: 'unknown' })
    svc.assignUid.mockRejectedValue(new Error('UID 21000001 already belongs to Aarav Sharma on the roster.'))
    renderWithRouter(<Students />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /assign uid to temp student/i }))
    const dialog = await screen.findByRole('dialog', { name: /assign uid/i })
    await user.type(within(dialog).getByLabelText('Real UID'), '21000001')
    await user.click(within(dialog).getByRole('button', { name: /^assign uid$/i }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/already belongs to Aarav Sharma/)
  })
})

describe('Students — temporary-ID reminder', () => {
  it('counts students still on a temporary ID and can filter to just them', async () => {
    svc.listStudents.mockResolvedValue([
      { ...roster[0], id: 'TMP-00001', name: 'Temp One', provisional: true },
      { ...roster[0], id: '21000002', name: 'Real Two', email: 'two@x', provisional: false },
    ])
    renderWithRouter(<Students />)
    expect(await screen.findByText(/1 student is on a temporary id/i)).toBeInTheDocument()
    expect(screen.getByText('Real Two')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: /show only these/i }))
    expect(screen.queryByText('Real Two')).not.toBeInTheDocument()
    expect(screen.getByText('Temp One')).toBeInTheDocument()
  })

  it('shows no banner when everyone has a real UID', async () => {
    renderWithRouter(<Students />)
    await screen.findByText('Aarav Sharma')
    expect(screen.queryByText(/temporary id \(no uid yet\)/i)).not.toBeInTheDocument()
  })
})

describe('Students — the official photo the counter sees', () => {
  it('a student with no photo gets an "Add photo" action; choosing a file previews it and Save uploads it', async () => {
    svc.listStudents.mockResolvedValue([{ ...roster[0], hasPhoto: false }])
    svc.uploadStudentPhoto.mockResolvedValue(undefined)
    renderWithRouter(<Students />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /add photo for aarav sharma/i }))
    const dialog = await screen.findByRole('dialog', { name: /official photo/i })
    expect(within(dialog).getByRole('button', { name: /save photo/i })).toBeDisabled()
    await user.upload(within(dialog).getByLabelText('Photo file'), new File(['x'], 'me.jpg', { type: 'image/jpeg' }))
    expect(await within(dialog).findByAltText(/new official photo preview/i)).toBeInTheDocument()
    // Personal data: with no consent on record, the notice is shown and Save stays disabled until staff confirm the student agreed.
    expect(await within(dialog).findByTestId('photo-notice')).toHaveTextContent(/until you leave the mess/i)
    expect(within(dialog).getByRole('button', { name: /save photo/i })).toBeDisabled()
    await user.click(within(dialog).getByLabelText(/student agrees to the photo notice/i))
    await user.click(within(dialog).getByRole('button', { name: /save photo/i }))
    await waitFor(() => expect(svc.uploadStudentPhoto).toHaveBeenCalledWith(roster[0].id, 'data:image/jpeg;base64,QUJD', true))
  })

  it('when consent is already on record the notice is not shown again and no confirmation is needed', async () => {
    svc.listStudents.mockResolvedValue([{ ...roster[0], hasPhoto: true, photoConsent: true }])
    svc.uploadStudentPhoto.mockResolvedValue(undefined)
    renderWithRouter(<Students />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /replace photo for aarav sharma/i }))
    const dialog = await screen.findByRole('dialog', { name: /official photo/i })
    expect(within(dialog).queryByTestId('photo-notice')).not.toBeInTheDocument()
    await user.upload(within(dialog).getByLabelText('Photo file'), new File(['x'], 'me.jpg', { type: 'image/jpeg' }))
    await user.click(await within(dialog).findByRole('button', { name: /save photo/i }))
    await waitFor(() => expect(svc.uploadStudentPhoto).toHaveBeenCalledWith(roster[0].id, 'data:image/jpeg;base64,QUJD', false))
  })

  it('a student who has a photo offers Replace and Remove', async () => {
    svc.listStudents.mockResolvedValue([{ ...roster[0], hasPhoto: true }])
    svc.removeStudentPhoto.mockResolvedValue(undefined)
    renderWithRouter(<Students />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /replace photo for aarav sharma/i }))
    await user.click(within(await screen.findByRole('dialog', { name: /official photo/i })).getByRole('button', { name: /remove/i }))
    await waitFor(() => expect(svc.removeStudentPhoto).toHaveBeenCalledWith(roster[0].id))
  })

  it('shows the server\'s reason if the upload is refused, and keeps the dialog open', async () => {
    svc.listStudents.mockResolvedValue([{ ...roster[0], hasPhoto: false }])
    svc.uploadStudentPhoto.mockRejectedValue(new Error('Photo must be a PNG, JPEG, WebP or GIF image'))
    renderWithRouter(<Students />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /add photo for aarav sharma/i }))
    const dialog = await screen.findByRole('dialog', { name: /official photo/i })
    await user.upload(within(dialog).getByLabelText('Photo file'), new File(['x'], 'me.jpg', { type: 'image/jpeg' }))
    await user.click(await within(dialog).findByLabelText(/student agrees to the photo notice/i))
    await user.click(await within(dialog).findByRole('button', { name: /save photo/i }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/png, jpeg, webp/i)
  })
})

describe('Students — printable meal ID card', () => {
  const card = (over = {}) => ({ token: 'card.signed.token', studentId: 'TMP-00007', name: 'Temp Student', hostelName: 'Boys Hostel 2', room: 'C-1', provisional: true, hasPhoto: true, reissued: false, ...over })

  async function open() {
    svc.listStudents.mockResolvedValue([{ ...roster[0], id: 'TMP-00007', name: 'Temp Student', provisional: true, hasPhoto: true }])
    renderWithRouter(<Students />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /id card for temp student/i }))
    return { user, dialog: await screen.findByRole('dialog', { name: /meal id card/i }) }
  }

  it('shows the card with the photo area, name, ID, hostel and a QR that carries the signed token — not the ID', async () => {
    svc.getIdCard.mockResolvedValue(card())
    const { dialog } = await open()
    const c = await within(dialog).findByTestId('id-card')
    expect(c).toHaveTextContent('Temp Student')
    expect(c).toHaveTextContent('TMP-00007')
    expect(c).toHaveTextContent('Boys Hostel 2 · Room C-1')
    expect(within(c).getByTestId('card-qr')).toHaveTextContent('card.signed.token')
    expect(within(dialog).getByText(/keeps working after their real uid is assigned/i)).toBeInTheDocument()
    expect(svc.getIdCard).toHaveBeenCalledWith('TMP-00007')
  })

  it('warns when there is no official photo to compare against', async () => {
    svc.getIdCard.mockResolvedValue(card({ hasPhoto: false }))
    const { dialog } = await open()
    expect(await within(dialog).findByText(/no official photo yet — add one first/i)).toBeInTheDocument()
  })

  it('Print opens the browser print dialog for just the card', async () => {
    svc.getIdCard.mockResolvedValue(card())
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    const { user, dialog } = await open()
    await user.click(await within(dialog).findByRole('button', { name: /print card/i }))
    expect(print).toHaveBeenCalledTimes(1)
    print.mockRestore()
  })

  it('reissue needs a confirmation, warns the old card dies at once, then shows the new one', async () => {
    svc.getIdCard.mockResolvedValueOnce(card()).mockResolvedValueOnce(card({ token: 'brand.new.token', reissued: true }))
    const { user, dialog } = await open()
    await user.click(await within(dialog).findByRole('button', { name: /reissue/i }))
    expect(within(dialog).getByText(/old printed card will stop working immediately/i)).toBeInTheDocument()
    expect(svc.getIdCard).toHaveBeenCalledTimes(1) // nothing happens until confirmed
    await user.click(within(dialog).getByRole('button', { name: /yes, reissue/i }))
    await waitFor(() => expect(svc.getIdCard).toHaveBeenLastCalledWith('TMP-00007', true))
    expect(await within(dialog).findByText(/new card created\. any older printed card no longer works/i)).toBeInTheDocument()
    expect(within(dialog).getByTestId('card-qr')).toHaveTextContent('brand.new.token')
  })

  it('shows the server\'s reason when a card cannot be made', async () => {
    svc.getIdCard.mockRejectedValue(new Error("You don't have access to that student."))
    const { dialog } = await open()
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/don't have access/i)
  })
})

