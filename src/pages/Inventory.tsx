import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Loader2, Plus } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useMessStore } from '@/store/useMessStore'
import * as svc from '@/services/inventoryStockService'
import type { StockItem, StockMove, MoveKind } from '@/services/inventoryStockService'
import { DashboardCard } from '@/components/ui/DashboardCard'

const FIELD = 'rounded-lg border border-line dark:border-ink-700 bg-white dark:bg-ink-900 px-3 py-2 text-sm'
const LABEL = 'text-xs font-medium text-slate-500 dark:text-slate-400'
const KIND_TEXT: Record<MoveKind, string> = { receive: 'Received', use: 'Used', waste: 'Wasted / spoiled', adjust: 'Stock-take' }
const num = (n: number) => String(Math.round(n * 1000) / 1000)

/** Real stock: add items, record what comes in and goes out, and a stock-take to correct the count. Nothing here is sample data. */
export default function Inventory() {
  useDocumentTitle('Inventory')
  const { user } = useAuth()
  const messId = useMessStore((s) => s.currentMessId)
  const canWrite = ['SUPER_ADMIN', 'ADMIN', 'MESS_MANAGER', 'KITCHEN_STAFF'].includes(user?.role ?? '')
  const [items, setItems] = useState<StockItem[] | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const load = useCallback(() => { svc.listStock(messId).then((r) => { setItems(r.items); setError('') }).catch((e) => setError(e instanceof Error ? e.message : 'Could not load stock.')) }, [messId])
  useEffect(() => { load() }, [load])
  const low = (items ?? []).filter((i) => i.low)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">Inventory
          <span className="text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 bg-eco-50 text-eco-700 dark:bg-eco-500/10 dark:text-eco-400">Recorded by the server</span></h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">The count is the total of everything recorded below — every change has a name, a time and a reason. Set a reorder level and the manager is notified when stock reaches it.</p>
      </div>
      {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
      {low.length > 0 && (
        <div role="status" data-testid="low-stock" className="rounded-xl border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200 flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /><span><strong>{low.length} item{low.length === 1 ? '' : 's'} at or below the reorder level:</strong> {low.map((i) => `${i.name} (${num(i.quantity)} ${i.unit})`).join(', ')}</span>
        </div>
      )}
      {canWrite && <AddItem messId={messId} onAdded={load} />}
      <DashboardCard title={`Stock${items ? ` (${items.length})` : ''}`}>
        {items === null && !error && <p className="text-xs text-slate-400">Loading…</p>}
        {items?.length === 0 && <p className="text-xs text-slate-400">No items yet. {canWrite ? 'Add the first one above.' : ''}</p>}
        <ul className="divide-y divide-line dark:divide-ink-700" data-testid="stock-list">
          {items?.map((it) => (
            <li key={it.id} className="py-3">
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={() => setOpen(open === it.id ? null : it.id)} className="text-left flex-1 min-w-[10rem]" aria-expanded={open === it.id} aria-label={`${it.name} details`}>
                  <span className="font-medium text-slate-800 dark:text-slate-100">{it.name}</span> <span className="text-xs text-slate-400">{it.category}</span>
                </button>
                <span className={`font-display font-bold ${it.low ? 'text-amber-600' : 'text-slate-800 dark:text-slate-100'}`} data-testid={`qty-${it.name}`}>{num(it.quantity)} {it.unit}</span>
                {it.low && <span className="text-[10px] font-bold uppercase rounded px-1.5 py-0.5 bg-amber-100 text-amber-700">Low</span>}
              </div>
              {open === it.id && <ItemPanel item={it} canWrite={canWrite} onChanged={load} />}
            </li>
          ))}
        </ul>
      </DashboardCard>
    </div>
  )
}

function AddItem({ messId, onAdded }: { messId: string; onAdded: () => void }) {
  const [name, setName] = useState(''); const [unit, setUnit] = useState<string>('kg'); const [category, setCategory] = useState<string>('Grains')
  const [qty, setQty] = useState(''); const [reorder, setReorder] = useState('')
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('')
    try { await svc.addItem({ messId, name: name.trim(), unit, category, quantity: Number(qty) || 0, reorderLevel: Number(reorder) || 0 }); setName(''); setQty(''); setReorder(''); onAdded() }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not add that item.') } finally { setBusy(false) }
  }
  return (
    <DashboardCard title="Add an item">
      <form onSubmit={submit} className="grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
        <label className="flex flex-col gap-1 col-span-2"><span className={LABEL}>Name</span><input aria-label="Item name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className={FIELD} /></label>
        <label className="flex flex-col gap-1"><span className={LABEL}>Unit</span><select aria-label="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} className={FIELD}>{svc.UNITS.map((u) => <option key={u}>{u}</option>)}</select></label>
        <label className="flex flex-col gap-1"><span className={LABEL}>Category</span><select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className={FIELD}>{svc.CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="flex flex-col gap-1"><span className={LABEL}>Opening stock</span><input aria-label="Opening stock" type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} className={FIELD} /></label>
        <label className="flex flex-col gap-1"><span className={LABEL}>Reorder at</span><input aria-label="Reorder level" type="number" min="0" step="any" value={reorder} onChange={(e) => setReorder(e.target.value)} className={FIELD} /></label>
        <button type="submit" disabled={!name.trim() || busy} className="col-span-2 md:col-span-6 md:w-40 rounded-lg bg-tech-500 hover:bg-tech-600 text-white text-sm font-semibold py-2.5 disabled:opacity-60 flex items-center justify-center gap-2">{busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}Add item</button>
      </form>
      {error && <p role="alert" className="mt-2 text-xs text-rose-600">{error}</p>}
    </DashboardCard>
  )
}

function ItemPanel({ item, canWrite, onChanged }: { item: StockItem; canWrite: boolean; onChanged: () => void }) {
  const [kind, setKind] = useState<MoveKind>('use'); const [qty, setQty] = useState(''); const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [done, setDone] = useState('')
  const [moves, setMoves] = useState<StockMove[]>([])
  const loadMoves = useCallback(() => { svc.listMoves(item.id).then(setMoves).catch(() => {}) }, [item.id])
  useEffect(() => { loadMoves() }, [loadMoves])
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setDone('')
    try { const r = await svc.moveStock(item.id, kind, Number(qty), note.trim() || undefined); setDone(`Now ${num(r.quantity)} ${r.unit}.`); setQty(''); setNote(''); onChanged(); loadMoves() }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not record that.') } finally { setBusy(false) }
  }
  return (
    <div className="mt-3 rounded-xl bg-surface-dim dark:bg-ink-800 p-3.5 space-y-3">
      {canWrite && (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1"><span className={LABEL}>What happened</span><select aria-label="Movement" value={kind} onChange={(e) => setKind(e.target.value as MoveKind)} className={FIELD}>{(Object.keys(KIND_TEXT) as MoveKind[]).map((k) => <option key={k} value={k}>{KIND_TEXT[k]}</option>)}</select></label>
          <label className="flex flex-col gap-1"><span className={LABEL}>{kind === 'adjust' ? `Counted now (${item.unit})` : `Amount (${item.unit})`}</span><input aria-label="Amount" type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} className={`${FIELD} w-32`} /></label>
          <label className="flex flex-col gap-1 flex-1 min-w-[10rem]"><span className={LABEL}>{kind === 'adjust' ? 'Why (required)' : 'Note (optional)'}</span><input aria-label="Note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} className={FIELD} /></label>
          <button type="submit" disabled={busy || qty === ''} className="rounded-lg bg-tech-500 hover:bg-tech-600 text-white text-sm font-semibold py-2 px-4 disabled:opacity-60">{busy ? 'Saving…' : 'Record'}</button>
        </form>
      )}
      {done && <p role="status" className="text-xs text-eco-600">{done}</p>}
      {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
      <div>
        <p className="text-xs font-semibold text-slate-500 mb-1">History</p>
        <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-0.5" data-testid="move-history">
          {moves.map((m) => <li key={m.id}>{new Date(m.at).toLocaleString()} · {KIND_TEXT[m.kind]} {m.delta > 0 ? '+' : ''}{num(m.delta)} → {num(m.balance)} {item.unit} · {m.byName}{m.note ? ` · ${m.note}` : ''}</li>)}
        </ul>
      </div>
    </div>
  )
}
