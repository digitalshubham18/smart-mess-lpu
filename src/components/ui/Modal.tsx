import { useEffect } from 'react'
import { X } from 'lucide-react'
import { createPortal } from 'react-dom'

export function Modal({
  open,
  onClose,
  title,
  children,
  widthClass = 'max-w-lg',
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  widthClass?: string
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (open) document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-ink-950/50" onClick={onClose} />
      <div className={`relative w-full ${widthClass} rounded-xl bg-white dark:bg-ink-900 border border-line dark:border-ink-700 shadow-xl max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-line dark:border-ink-700 sticky top-0 bg-white dark:bg-ink-900">
          <h3 className="font-display font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
          <button onClick={onClose} aria-label="Close dialog" className="p-1 rounded-md hover:bg-surface-dim dark:hover:bg-ink-800 text-slate-500">
            <X size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>,
    document.body
  )
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  danger = false,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  description?: string
  confirmLabel?: string
  danger?: boolean
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} widthClass="max-w-sm">
      {description && <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">{description}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-3.5 py-2 rounded-lg text-sm font-medium border border-line dark:border-ink-700 text-slate-700 dark:text-slate-200">
          Cancel
        </button>
        <button
          onClick={() => {
            onConfirm()
            onClose()
          }}
          className={`px-3.5 py-2 rounded-lg text-sm font-semibold text-white ${danger ? 'bg-rose-500 hover:bg-rose-600' : 'bg-tech-500 hover:bg-tech-600'}`}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
