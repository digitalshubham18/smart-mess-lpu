import type { MealType } from '@/types'
import { api } from './api'

/** REAL feedback and complaints (server/src/routes/feedback.js). Ratings are anonymous to staff; complaints are named. */
export const FEEDBACK_CATEGORIES = ['Taste', 'Quantity', 'Hygiene', 'Service', 'Variety', 'Other'] as const
export type FeedbackCategory = typeof FEEDBACK_CATEGORIES[number]
export type ComplaintState = 'open' | 'in_progress' | 'resolved'

export interface FeedbackItem {
  id: string; kind: 'feedback' | 'complaint'; date: string; meal: MealType; rating: number | null; category: FeedbackCategory
  comment: string | null; status: ComplaintState; response: string | null; respondedAt: string | null; createdAt: string
  studentName?: string | null; studentRoom?: string | null
}
export interface FeedbackSummary {
  count: number; avgRating: number | null; openComplaints: number
  byMeal: { meal: MealType; count: number; avgRating: number | null }[]
  byCategory: { category: string; count: number }[]
}

function reason(e: unknown, fallback: string): string {
  const d = (e as { response?: { data?: { error?: string; details?: { message?: string }[] } } })?.response?.data
  return d?.details?.[0]?.message ?? d?.error ?? fallback
}

export interface SubmitInput { kind: 'feedback' | 'complaint'; date: string; meal: MealType; rating?: number; category: FeedbackCategory; comment?: string }
export async function submitFeedback(input: SubmitInput): Promise<void> {
  try { await api.post('/feedback', input) } catch (e) { throw new Error(reason(e, 'Could not send that.')) }
}
export async function listMine(): Promise<FeedbackItem[]> {
  try { return (await api.get<FeedbackItem[]>('/feedback/mine')).data } catch (e) { throw new Error(reason(e, 'Could not load your feedback.')) }
}
export async function listForMess(messId: string): Promise<{ items: FeedbackItem[]; summary: FeedbackSummary }> {
  try { return (await api.get<{ items: FeedbackItem[]; summary: FeedbackSummary }>('/feedback', { params: { messId } })).data } catch (e) { throw new Error(reason(e, 'Could not load feedback.')) }
}
export async function respond(id: string, patch: { status?: ComplaintState; response?: string }): Promise<void> {
  try { await api.patch(`/feedback/${encodeURIComponent(id)}`, patch) } catch (e) { throw new Error(reason(e, 'Could not update that complaint.')) }
}
