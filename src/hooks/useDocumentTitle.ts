import { useEffect } from 'react'

const BASE_TITLE = 'LPU Smart Mess'

/** Sets document.title to "`title` · LPU Smart Mess" (or just the base title if omitted), restoring the previous title on unmount. */
export function useDocumentTitle(title?: string) {
  useEffect(() => {
    const previous = document.title
    document.title = title ? `${title} · ${BASE_TITLE}` : BASE_TITLE
    return () => {
      document.title = previous
    }
  }, [title])
}
