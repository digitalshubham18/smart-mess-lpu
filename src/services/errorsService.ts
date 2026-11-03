import { api } from './api'
export interface ReportedError { id: number; kind: 'client' | 'server'; message: string; stack: string | null; url: string | null; count: number; firstSeen: string; lastSeen: string }
export async function listErrors(): Promise<ReportedError[]> {
  try { return (await api.get<{ errors: ReportedError[] }>('/errors')).data.errors } catch { throw new Error('Could not load the error list.') }
}
export async function dismissError(id: number): Promise<void> {
  try { await api.delete(`/errors/${id}`) } catch { throw new Error('Could not dismiss that error.') }
}
