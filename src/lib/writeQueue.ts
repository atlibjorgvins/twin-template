// ─────────────────────────────────────────────────────────────────────
// Offline write queue (full scope: edits + creates + notes)
//
// When the backend is unreachable, mutations are recorded here instead of
// failing. Each entry is one create/update against a known collection.
// On reconnect, flushQueue() replays them in order, remapping the
// negative "temp" ids assigned to offline-created records to the real
// ids the backend returns — so a note logged against an offline-created
// person still links correctly once both are flushed.
//
// Conflict rule: last-write-wins. You're the only writer, so an update
// simply PATCHes whatever is on the server at replay time. A replay that
// fails for a real reason (validation/permission) is kept and surfaced
// in the review UI for retry or discard — never silently dropped.
// ─────────────────────────────────────────────────────────────────────
import { writable, derived } from 'svelte/store';
import { repo } from '$lib/data/repo';
import {
  queuePut,
  queueGetAll,
  queueDelete,
  remapMirrorId,
  isNetworkError,
  isAuthError,
  markOffline,
  markNeedsAuth
} from './offline';
import { authEnabled } from '$lib/instance';

export type QueueCollection = 'Person' | 'organization' | 'notes' | 'notes_related_to';

export type WriteOp = {
  id: string; // queue-entry uuid
  seq: number; // global order
  collection: QueueCollection;
  action: 'create' | 'update';
  /** Temp (negative) id for creates; existing id for updates. */
  recordId: number;
  data: Record<string, unknown>;
  /** Numeric fields in `data` that may hold a temp id needing remap. */
  refFields: string[];
  /** A field holding a STRINGified id (notes_related_to.item), remapped too. */
  itemRefField?: string;
  /** Whether this op's record lives in the people/orgs mirror (for id remap). */
  mirror?: 'people' | 'orgs';
  label: string;
  createdAt: string;
  status: 'pending' | 'failed';
  error?: string;
};

// ── Stores ───────────────────────────────────────────────────────────
export const pendingOps = writable<WriteOp[]>([]);
export const flushing = writable(false);
export const pendingCount = derived(pendingOps, ($o) => $o.length);

let seqCounter = 0;

function uuid(): string {
  // crypto.randomUUID is available in all target browsers; fall back just in case.
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `op-${seqCounter}-${Math.floor(performance.now())}`;
}

/** Reload the in-memory store from IndexedDB (call on app start). */
export async function refreshPending(): Promise<void> {
  try {
    const ops = await queueGetAll<WriteOp>();
    ops.sort((a, b) => a.seq - b.seq);
    if (ops.length) seqCounter = Math.max(seqCounter, ...ops.map((o) => o.seq));
    pendingOps.set(ops);
  } catch {
    /* IDB unavailable */
  }
}

/** Record a mutation to replay later. Returns the persisted op. */
export async function enqueueWrite(
  op: Omit<WriteOp, 'id' | 'seq' | 'createdAt' | 'status'>
): Promise<WriteOp> {
  const entry: WriteOp = {
    ...op,
    id: uuid(),
    seq: ++seqCounter,
    createdAt: new Date().toISOString(),
    status: 'pending'
  };
  await queuePut(entry as unknown as Record<string, unknown>);
  pendingOps.update((o) => [...o, entry]);
  return entry;
}

export async function discardOp(id: string): Promise<void> {
  await queueDelete(id);
  pendingOps.update((o) => o.filter((x) => x.id !== id));
}

/** Reset a failed op back to pending (e.g. before a manual flush). */
export async function retryOp(id: string): Promise<void> {
  let updated: WriteOp | null = null;
  pendingOps.update((o) =>
    o.map((x) => (x.id === id ? ((updated = { ...x, status: 'pending', error: undefined }), updated) : x))
  );
  if (updated) await queuePut(updated as unknown as Record<string, unknown>);
}

export function applyRemap(op: WriteOp, idMap: Map<number, number>): { recordId: number; data: Record<string, unknown> } {
  const recordId = idMap.get(op.recordId) ?? op.recordId;
  const data: Record<string, unknown> = { ...op.data };
  for (const f of op.refFields) {
    const v = data[f];
    if (typeof v === 'number' && idMap.has(v)) data[f] = idMap.get(v);
  }
  if (op.itemRefField) {
    const raw = data[op.itemRefField];
    const n = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN;
    if (Number.isFinite(n) && idMap.has(n)) data[op.itemRefField] = String(idMap.get(n));
  }
  return { recordId, data };
}

/**
 * Replay all pending ops in order. Stops early (leaving the rest pending)
 * if the server goes unreachable again. Real API errors mark the offending
 * op `failed` and replay continues. Returns a summary.
 */
export async function flushQueue(): Promise<{ done: number; failed: number; remaining: number }> {
  let ops = await queueGetAll<WriteOp>();
  ops = ops.filter((o) => o.status === 'pending').sort((a, b) => a.seq - b.seq);
  if (ops.length === 0) return { done: 0, failed: 0, remaining: 0 };

  flushing.set(true);
  const idMap = new Map<number, number>();
  let done = 0;
  let failed = 0;
  try {
    for (const op of ops) {
      const { recordId, data } = applyRemap(op, idMap);
      try {
        if (op.action === 'create') {
          const created = await repo.create<{ id: number }>(op.collection, data);
          idMap.set(op.recordId, created.id); // temp → real
          if (op.mirror) await remapMirrorId(op.mirror, op.recordId, created.id);
        } else {
          await repo.update(op.collection, recordId, data);
        }
        await queueDelete(op.id);
        done++;
      } catch (e) {
        // Session expired mid-flush (session mode only). A 401 is NOT a failed
        // write — the op is fine, the credential is stale. Pause exactly like
        // offline: stop, leave every remaining op `pending`, and flag needsAuth
        // so the guard sends the user to /login. Marking these `failed` would
        // strand a whole offline session's edits behind a re-login the user
        // could not trigger. In static-token mode authEnabled() is false, so a
        // 401 is a real permission error and falls through to `failed` below.
        if (authEnabled() && isAuthError(e)) {
          markNeedsAuth();
          break;
        }
        if (isNetworkError(e)) {
          // Lost the server mid-flush — stop, keep the rest pending.
          markOffline();
          break;
        }
        // Real failure — keep it, surface for review, keep going.
        const msg = e instanceof Error ? e.message : String(e);
        const updated = { ...op, status: 'failed' as const, error: msg };
        await queuePut(updated as unknown as Record<string, unknown>);
        failed++;
      }
    }
  } finally {
    await refreshPending();
    flushing.set(false);
  }
  const remaining = (await queueGetAll<WriteOp>()).length;
  return { done, failed, remaining };
}
