// Asana write-back (app.asana.com/api/1.0).
//
// The Monday scheduled task mirrors Asana INTO twin and never writes back, so
// completing a task here left it open in Asana until you closed it there too.
// This module is the return path — and it is deliberately narrow: complete a
// task, reopen a task, and check the token. Nothing else. Asana stays the
// place where task content is edited; twin only reports progress.
//
// Why a Directus Flow instead of calling Asana directly:
//
//   1. A personal access token is a real credential. twin is a static SPA —
//      anything it can read, a bundle reader can read. The token therefore
//      lives only in the Flow operation's config, exactly as the WordPress,
//      Meta, Buffer and Krónan proxies do.
//   2. app.asana.com sends no CORS headers for API requests, so the browser
//      cannot reach it anyway.
//
// The token is NOT in this repo and must never be. Rotation is pasting a new
// one into the Flow operation; Settings → Asana explains it.
import { PUBLIC_DIRECTUS_URL } from '$env/static/public';

/** Directus Flow id for "Asana API proxy". Empty ⇒ every call throws a clear
 *  "not connected" error rather than a confusing network failure — the same
 *  convention as WP_FLOW_ID and KRONAN_FLOW_ID. */
const ASANA_FLOW_ID = '';

export function asanaConfigured(): boolean {
  return ASANA_FLOW_ID.length > 0;
}

/** The flow id this module actually calls, so Settings can show whether it
 *  matches the registered service_key row instead of assuming they agree. */
export function asanaFlowId(): string {
  return ASANA_FLOW_ID;
}

export type AsanaMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** Thrown when Asana rate-limits us. Carries the server's own Retry-After so
 *  the UI can say when, not just "later". */
export class AsanaRateLimited extends Error {
  readonly retryAt: Date;
  constructor(retryAfterSeconds: number) {
    const at = new Date(Date.now() + Math.max(1, retryAfterSeconds) * 1000);
    super(`Asana is rate-limiting — try again after ${at.toLocaleTimeString()}.`);
    this.name = 'AsanaRateLimited';
    this.retryAt = at;
  }
}

/**
 * Forward one request through the Asana proxy Flow and return the `data`
 * envelope Asana wraps everything in.
 *
 * `path` is relative to /api/1.0/ (e.g. `tasks/1217066305736940`). The Flow is
 * a dumb passthrough: it substitutes the path, forwards the method and body,
 * and attaches the Authorization header it holds.
 */
export async function asanaRequest<T = unknown>(
  method: AsanaMethod,
  path: string,
  body?: unknown
): Promise<T> {
  if (!ASANA_FLOW_ID) {
    throw new Error(
      'Asana isn’t connected yet — create the "Asana API proxy" Flow (see Settings → Asana) and set ASANA_FLOW_ID in src/lib/asana.ts.'
    );
  }

  const res = await fetch(`${PUBLIC_DIRECTUS_URL}/flows/trigger/${ASANA_FLOW_ID}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, path: path.replace(/^\/+/, ''), body })
  });

  const wrapper = (await res.json().catch(() => null)) as
    | ({ status?: number; headers?: Record<string, string>; data?: unknown } & Record<string, unknown>)
    | null;

  // A Flow whose request operation fails answers 500 with no useful body, so
  // an unreadable body means "the proxy is down", not "Asana said no".
  if (!wrapper) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        'Directus rejected the proxy call — check the "Asana API proxy" Flow is active and its trigger is public.'
      );
    }
    throw new Error(`Asana proxy returned an unreadable response (HTTP ${res.status}).`);
  }

  const status = (wrapper.status as number | undefined) ?? res.status;
  const payload = (wrapper.data ?? wrapper) as {
    data?: unknown;
    errors?: { message?: string }[];
  };

  if (status === 429) {
    const retry = Number(wrapper.headers?.['retry-after'] ?? wrapper.headers?.['Retry-After'] ?? 30);
    throw new AsanaRateLimited(Number.isFinite(retry) ? retry : 30);
  }
  // Asana answers a bad credential with EITHER 401 or 403 depending on the
  // endpoint and on how the token is malformed — the placeholder token gets a
  // 403 from `users/me`, not the 401 you would expect. So both map to the same
  // "the credential is the problem" message, and neither mentions a task:
  // this transport also serves the connection check, where "that task" is
  // nonsense. The scheme word is called out because it is the thing that
  // actually goes missing — selecting the field to paste replaces "Bearer "
  // along with the placeholder.
  if (status === 401 || status === 403) {
    const detail = payload?.errors?.[0]?.message;
    throw new Error(
      `Asana rejected the request (${status})${detail ? `: ${detail}` : ''}. Check the Flow’s Authorization header still reads "Bearer <token>" — pasting over the placeholder usually eats the word Bearer — and that the token’s user can reach the task.`
    );
  }
  if (status === 404) {
    throw new Error('Asana has no such task (404) — it may have been deleted or moved out of reach.');
  }
  if (status < 200 || status >= 300) {
    const first = payload?.errors?.[0]?.message;
    throw new Error(`Asana: ${first ?? `HTTP ${status}`}`);
  }
  return (payload?.data ?? payload) as T;
}

// ── Typed responses ──────────────────────────────────────────────────────

/** GET users/me — the token health check. Proves the whole chain in one call:
 *  Directus reachable, Flow active, token accepted by Asana. */
export type AsanaMe = {
  gid: string;
  name?: string;
  email?: string;
  workspaces?: { gid: string; name?: string }[];
};

export async function asanaMe(): Promise<AsanaMe> {
  return asanaRequest<AsanaMe>('GET', 'users/me');
}

export type AsanaTask = {
  gid: string;
  name?: string;
  completed?: boolean;
  completed_at?: string | null;
  due_on?: string | null;
};

/** One task's live state — used to confirm a write landed rather than
 *  trusting the response we just got. */
export async function getAsanaTask(gid: string): Promise<AsanaTask> {
  return asanaRequest<AsanaTask>('GET', `tasks/${encodeURIComponent(gid)}?opt_fields=name,completed,completed_at,due_on`);
}

/**
 * Mark an Asana task complete.
 *
 * Idempotent on Asana's side — completing an already-complete task returns
 * 200 with the same body, so a retry after a failed-looking call is safe.
 */
export async function completeAsanaTask(gid: string): Promise<AsanaTask> {
  return asanaRequest<AsanaTask>('PUT', `tasks/${encodeURIComponent(gid)}`, {
    data: { completed: true }
  });
}

/** Reopen a task — the counterpart, so twin's Reopen is not a one-way door. */
export async function reopenAsanaTask(gid: string): Promise<AsanaTask> {
  return asanaRequest<AsanaTask>('PUT', `tasks/${encodeURIComponent(gid)}`, {
    data: { completed: false }
  });
}

/** Web URL for a task gid. Mirrors asanaTaskUrl in directus.ts, kept here so
 *  this module stands alone. */
export function asanaWebUrl(gid: string): string {
  return `https://app.asana.com/0/0/${encodeURIComponent(gid)}`;
}

// ── Projects ─────────────────────────────────────────────────────────────
// Needed to learn which twin project a task belongs to. Ingestion happens
// outside twin and records only the task gid, so the project has to be
// asked for — once per task, then cached on the focus_task row.

export type AsanaProject = { gid: string; name?: string };

/**
 * Which Asana projects a task sits in.
 *
 * A task can be in several projects; the first is used as "its" project
 * because the mapping is one Asana project ⇒ one twin project and a task
 * in two mapped projects has no better answer. Returns [] when Asana has
 * none rather than throwing — a task in no project is normal.
 */
export async function getAsanaTaskProjects(gid: string): Promise<AsanaProject[]> {
  const t = await asanaRequest<{ projects?: AsanaProject[] }>(
    'GET',
    `tasks/${encodeURIComponent(gid)}?opt_fields=projects.gid,projects.name`
  );
  return (t?.projects ?? []).filter((p) => !!p?.gid);
}

/**
 * Every project the token's user can see, for the connect picker.
 *
 * Asana requires a workspace for this endpoint, so the caller passes one
 * from `asanaMe().workspaces`. limit=100 is Asana's page ceiling; this is a
 * picker, not a sync, so one page is deliberate — the search box narrows it.
 */
export async function listAsanaProjects(workspaceGid: string): Promise<AsanaProject[]> {
  const rows = await asanaRequest<AsanaProject[]>(
    'GET',
    `projects?workspace=${encodeURIComponent(workspaceGid)}&archived=false&opt_fields=gid,name&limit=100`
  );
  return Array.isArray(rows) ? rows.filter((p) => !!p?.gid) : [];
}
