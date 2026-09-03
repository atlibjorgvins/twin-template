// Clockify, reached through a Directus Flow proxy.
//
// NOT a direct browser call, and not a PUBLIC_ env var. twin is a static SPA,
// so anything in the bundle is readable by anyone who loads the page. The
// Directus token already lives there and that is an accepted risk because
// Directus is tailnet-only — but api.clockify.me is the public internet, and a
// leaked key is full read/write on the whole KLAK workspace from anywhere.
//
// So the key lives in the Flow's configuration on the NAS and nowhere else:
// not in this repo, not in .env, not in the bundle. Same shape as
// src/lib/asana.ts and src/lib/wordpress.ts.
//
// The Flow is "Clockify API proxy" in Directus: a webhook trigger, then a
// condition on the method, then one of two Web Request steps against
// https://api.clockify.me/api/v1/{{$trigger.body.path}}.
//
// TWO request steps, not one, and the reason is worth knowing before anyone
// "simplifies" it back: a single step has to declare a body, and for a GET that
// body renders empty. Clockify sits behind CloudFront, which rejects a GET
// carrying a body at the edge — a 403 HTML page that never reaches the API and
// looks exactly like a bad key. So GETs take a body-less step and writes take
// one with `{{$trigger.body.body}}`.
//
// The key lives in those steps' X-Api-Key header and nowhere else.
import { PUBLIC_DIRECTUS_URL } from '$env/static/public';

/** The "Clockify API proxy" Flow. Empty would mean "not connected", which the
 *  UI reports rather than failing with a confusing network error. */
export const CLOCKIFY_FLOW_ID = '';

export function clockifyConfigured(): boolean {
  return CLOCKIFY_FLOW_ID.length > 0;
}

export type ClockifyProject = { id: string; name: string; clientName?: string | null; archived?: boolean };
export type ClockifyUser = { id: string; name: string; email: string; activeWorkspace: string };
export type ClockifyEntry = {
  id: string;
  description?: string | null;
  projectId?: string | null;
  timeInterval?: { start?: string; end?: string; duration?: string };
};

class ClockifyNotConnected extends Error {
  constructor() {
    super('Clockify isn’t connected yet — see Settings → Clockify.');
    this.name = 'ClockifyNotConnected';
  }
}

async function call<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  if (!clockifyConfigured()) throw new ClockifyNotConnected();

  const res = await fetch(`${PUBLIC_DIRECTUS_URL}/flows/trigger/${CLOCKIFY_FLOW_ID}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, path: path.replace(/^\/+/, ''), body })
  });

  const wrapper = (await res.json().catch(() => null)) as
    | ({ status?: number; data?: unknown } & Record<string, unknown>)
    | null;

  // The Flow answers 200 even when Clockify did not, so the real status is
  // inside the payload. Trusting the outer status would make every failure
  // look like a success with odd data.
  const status = Number(wrapper?.status ?? res.status);
  if (!res.ok || status >= 400) {
    throw new Error(`Clockify ${method} ${path} failed (${status}): ${JSON.stringify(wrapper?.data ?? wrapper).slice(0, 300)}`);
  }
  return (wrapper?.data ?? wrapper) as T;
}

export async function clockifyMe(): Promise<ClockifyUser> {
  return call<ClockifyUser>('GET', 'user');
}

export async function clockifyProjects(workspaceId: string): Promise<ClockifyProject[]> {
  return call<ClockifyProject[]>('GET', `workspaces/${workspaceId}/projects?page-size=200&archived=false`);
}

/**
 * Write one completed time entry.
 *
 * Both ends are explicit, so this records the stretch that actually happened
 * rather than starting a clock here and hoping something stops it. Sending an
 * end matters: an entry created without one is a RUNNING timer, which Clockify
 * later stops at whatever moment something else starts — the stretch then bears
 * no relation to the work.
 *
 * `projectId` is omitted when nothing is mapped at or above the task's project.
 * That is not always accepted: a workspace with `forceProjects` on — as KLAK's
 * is — rejects the entry outright. The session stays in the retry queue with an
 * explanation rather than being silently lost; see explainPushFailure.
 */
export async function clockifyCreateEntry(
  workspaceId: string,
  entry: { start: string; end: string; description: string; projectId?: string | null }
): Promise<ClockifyEntry> {
  const body: Record<string, unknown> = {
    start: entry.start,
    end: entry.end,
    description: entry.description
  };
  if (entry.projectId) body.projectId = entry.projectId;
  return call<ClockifyEntry>('POST', `workspaces/${workspaceId}/time-entries`, body);
}
