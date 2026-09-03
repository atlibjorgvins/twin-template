// AI brains — the AI vault
//
// Feature key `ai-vault`. One type dependency (Note), no runtime ones.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module, so every existing
// `from '$lib/directus'` import keeps working.

import { repo } from '$lib/data/repo';
import type { Filter } from '$lib/data/repo';
import { authHeader } from '$lib/data/client';
import { PUBLIC_DIRECTUS_URL } from '$env/static/public';
// Type-only: erased at compile time, so no runtime cycle back into
// the module this was split out of.
import type { Note } from '$lib/data/types';

// ─── AI brains ─────────────────────────────────────────────────────────────
// Stored provider keys + per-task key/model bindings + a usage log. No
// active AI calls yet; `resolveTaskModel` and `recordAiUsage` are the hooks
// a real call will use once wired.

export type AiProvider = 'anthropic' | 'openai' | 'google' | 'custom';
export const AI_PROVIDERS: { value: AiProvider; label: string }[] = [
  { value: 'anthropic', label: 'Anthropic (Claude)' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'google', label: 'Google (Gemini)' },
  { value: 'custom', label: 'Custom' }
];

/** Suggested models per provider — a datalist, free entry still allowed. */
export const AI_MODELS: Record<AiProvider, string[]> = {
  anthropic: ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
  google: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  custom: []
};

/** Known AI tasks. Bindings (ai_task_binding.task) reference these slugs.
 *  Add a row here to expose a new task in Settings → AI. */
export type AiTask = { slug: string; label: string; description: string };
export const AI_TASKS: AiTask[] = [
  { slug: 'receipt-ocr',    label: 'Receipt OCR',       description: 'Read amount / merchant / date off captured receipts → finances.' },
  { slug: 'note-summarize', label: 'Note summarize',    description: 'Summarize or tidy up notes.' },
  { slug: 'org-enrich',     label: 'Org enrichment',    description: 'Enrich organization records from public signals.' },
  { slug: 'photo-caption',  label: 'Photo caption',     description: 'Describe / caption library photos.' },
  { slug: 'general',        label: 'General / fallback', description: 'Default brain used when a task has no specific binding.' }
];

/** Rough USD per 1M tokens — display-only cost estimates for the dashboard.
 *  Edit as pricing moves; unknown models fall back to zero cost. */
export const AI_PRICES: Record<string, { in: number; out: number }> = {
  'claude-opus-4-8': { in: 15, out: 75 },
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-haiku-4-5-20251001': { in: 0.8, out: 4 },
  'gpt-4o': { in: 2.5, out: 10 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'o3-mini': { in: 1.1, out: 4.4 },
  'gemini-2.5-pro': { in: 1.25, out: 10 },
  'gemini-2.5-flash': { in: 0.3, out: 2.5 }
};
export function estimateAiCost(model: string | null | undefined, tokensIn: number, tokensOut: number): number {
  const p = model ? AI_PRICES[model] : undefined;
  if (!p) return 0;
  return (tokensIn / 1e6) * p.in + (tokensOut / 1e6) * p.out;
}

export type AiKey = {
  id: number;
  label?: string | null;
  provider?: AiProvider | string | null;
  api_key?: string | null;
  base_url?: string | null;
  last4?: string | null;
  status?: 'active' | 'disabled' | string | null;
  date_created?: string | null;
};
export type AiTaskBinding = {
  id: number;
  task?: string | null;
  key_id?: number | null;
  model?: string | null;
  enabled?: boolean | null;
  date_updated?: string | null;
};
export type AiUsage = {
  id: number;
  provider?: string | null;
  task?: string | null;
  model?: string | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
  cost_usd?: number | null;
  ok?: boolean | null;
  detail?: string | null;
  date_created?: string | null;
};

/** Keys for the settings list — WITHOUT the secret (only last4 for display). */
export async function listAiKeys(): Promise<AiKey[]> {
  return await repo.list<AiKey>('ai_key', {
    fields: ['id', 'label', 'provider', 'base_url', 'last4', 'status', 'date_created'],
    sort: ['-date_created'],
    limit: 100
  });
}
/** `api_key` is stored as-given — an encrypted `enc:v1:…` payload from the
 *  vault (see $lib/aiVault). `last4` is the plaintext tail, passed explicitly
 *  since the stored value is ciphertext. */
export async function createAiKey(input: { label: string; provider: AiProvider; api_key: string; last4: string; base_url?: string | null }): Promise<AiKey> {
  return await repo.create<AiKey>('ai_key', {
    label: input.label,
    provider: input.provider,
    api_key: input.api_key,
    base_url: input.base_url || null,
    last4: input.last4,
    status: 'active'
  } as Record<string, unknown>);
}
export async function updateAiKey(id: number, patch: Partial<AiKey>): Promise<AiKey> {
  const p: Record<string, unknown> = { ...patch };
  if (!(typeof patch.api_key === 'string' && patch.api_key)) {
    delete p.api_key; // never blank out the secret on a metadata edit
    delete p.last4;
  }
  return await repo.update<AiKey>('ai_key', id, p as Record<string, unknown>);
}
export async function deleteAiKey(id: number): Promise<void> {
  await repo.remove('ai_key', id);
}

/** Vault metadata (shared PBKDF2 salt + passphrase verifier). Singleton. */
export async function getAiVaultMeta(): Promise<{ salt: string; verifier: string } | null> {
  const res = await fetch(`${PUBLIC_DIRECTUS_URL}/items/ai_vault?fields=salt,verifier`, {
    headers: authHeader()
  }).then((r) => r.json()).catch(() => null);
  const d = res?.data;
  if (!d || !d.salt || !d.verifier) return null;
  return { salt: d.salt, verifier: d.verifier };
}
export async function saveAiVaultMeta(salt: string, verifier: string): Promise<void> {
  // Singleton collection — PATCH creates/updates the single row.
  const r = await fetch(`${PUBLIC_DIRECTUS_URL}/items/ai_vault`, {
    method: 'PATCH',
    headers: { ...authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ salt, verifier })
  });
  if (!r.ok) throw new Error(`Vault save failed: ${r.status}`);
}

export async function listAiTaskBindings(): Promise<AiTaskBinding[]> {
  return await repo.list<AiTaskBinding>('ai_task_binding', {
    fields: ['id', 'task', 'key_id', 'model', 'enabled', 'date_updated'],
    limit: 200
  });
}
/** Upsert the binding for a task slug. */
export async function setAiTaskBinding(task: string, patch: { key_id?: number | null; model?: string | null; enabled?: boolean }): Promise<AiTaskBinding> {
  const existing = await repo.list<{ id: number }>('ai_task_binding', {
    where: { field: 'task', op: 'eq', value: task }, fields: ['id'], limit: 1
  });
  if (existing[0]) {
    return await repo.update<AiTaskBinding>('ai_task_binding', existing[0].id, patch as Record<string, unknown>);
  }
  return await repo.create<AiTaskBinding>('ai_task_binding', { task, enabled: true, ...patch } as Record<string, unknown>);
}

/** Resolve which key + model a task should use (falls back to the 'general'
 *  binding). The returned key's `api_key` is the ENCRYPTED vault payload —
 *  decrypt with `aiVault.decryptSecret()` (vault must be unlocked) before
 *  using it in a call. Returns null when nothing is bound yet. */
export async function resolveTaskModel(task: string): Promise<{ key: AiKey; model: string | null; provider: string | null } | null> {
  const bindings = await listAiTaskBindings();
  const pick = bindings.find((b) => b.task === task && b.enabled !== false)
    ?? bindings.find((b) => b.task === 'general' && b.enabled !== false);
  if (!pick?.key_id) return null;
  const key = await repo.get<AiKey>('ai_key', pick.key_id, {
    fields: ['id', 'label', 'provider', 'api_key', 'base_url', 'last4', 'status']
  });
  if (!key || key.status === 'disabled') return null;
  return { key, model: pick.model ?? null, provider: (key.provider as string) ?? null };
}

/** Log one AI call. Cost is computed from AI_PRICES when not supplied. The
 *  hook a real invocation calls after it finishes. */
export async function recordAiUsage(u: {
  provider: string; task: string; model?: string | null;
  tokens_in?: number; tokens_out?: number; cost_usd?: number; ok?: boolean; detail?: string | null;
}): Promise<void> {
  const tin = u.tokens_in ?? 0, tout = u.tokens_out ?? 0;
  await repo.create('ai_usage', {
    provider: u.provider, task: u.task, model: u.model ?? null,
    tokens_in: tin, tokens_out: tout,
    cost_usd: u.cost_usd ?? estimateAiCost(u.model, tin, tout),
    ok: u.ok ?? true, detail: u.detail ?? null
  });
}

export async function listAiUsage(opts: { from?: string; to?: string; limit?: number } = {}): Promise<AiUsage[]> {
  const filters: Filter[] = [];
  if (opts.from) filters.push({ field: 'date_created', op: 'gte', value: opts.from });
  if (opts.to) filters.push({ field: 'date_created', op: 'lte', value: opts.to });
  const where = filters.length === 0 ? undefined : filters.length === 1 ? filters[0] : { and: filters };
  return await repo.list<AiUsage>('ai_usage', {
    fields: ['id', 'provider', 'task', 'model', 'tokens_in', 'tokens_out', 'cost_usd', 'ok', 'detail', 'date_created'],
    sort: ['-date_created'],
    where,
    limit: opts.limit ?? 1000
  });
}

/** Pure aggregation for the usage dashboard. */
export function aiUsageSummary(rows: AiUsage[]): {
  totals: { calls: number; tokensIn: number; tokensOut: number; cost: number; errors: number };
  byProvider: { key: string; calls: number; tokensIn: number; tokensOut: number; cost: number }[];
  byTask: { key: string; calls: number; tokensIn: number; tokensOut: number; cost: number }[];
} {
  const t = { calls: 0, tokensIn: 0, tokensOut: 0, cost: 0, errors: 0 };
  const prov = new Map<string, { calls: number; tokensIn: number; tokensOut: number; cost: number }>();
  const task = new Map<string, { calls: number; tokensIn: number; tokensOut: number; cost: number }>();
  const bump = (m: Map<string, { calls: number; tokensIn: number; tokensOut: number; cost: number }>, k: string, r: AiUsage) => {
    const e = m.get(k) ?? { calls: 0, tokensIn: 0, tokensOut: 0, cost: 0 };
    e.calls += 1; e.tokensIn += r.tokens_in ?? 0; e.tokensOut += r.tokens_out ?? 0; e.cost += r.cost_usd ?? 0;
    m.set(k, e);
  };
  for (const r of rows) {
    t.calls += 1; t.tokensIn += r.tokens_in ?? 0; t.tokensOut += r.tokens_out ?? 0; t.cost += r.cost_usd ?? 0;
    if (r.ok === false) t.errors += 1;
    bump(prov, (r.provider as string) || 'unknown', r);
    bump(task, (r.task as string) || 'unknown', r);
  }
  const list = (m: Map<string, { calls: number; tokensIn: number; tokensOut: number; cost: number }>) =>
    [...m.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.cost - a.cost || b.calls - a.calls);
  return { totals: t, byProvider: list(prov), byTask: list(task) };
}
