// Backend choice resolution — pure, node-testable (choice.test.ts).
//
// The build's `PUBLIC_DATA_BACKEND` is the DEFAULT; a device-local override
// (written by the /welcome storage step, held in localStorage) wins when it is
// valid. This is what lets one shipped bundle — the .dmg especially — serve
// "this device", "my Supabase", and "my Directus server" without rebuilding.
// The factory (index.ts) feeds this function and instantiates the winner;
// nothing else in the app decides a backend.

export type BackendId = 'directus' | 'supabase' | 'local';

export interface StoredChoice {
  backend?: string | null;
  supabaseUrl?: string | null;
  supabaseKey?: string | null;
  /** Device-level Directus URL (directusConfig.ts), '' when unset. */
  directusUrl?: string | null;
}

export interface ResolvedBackend {
  backend: BackendId;
  /** Set only when backend === 'supabase'. */
  supabaseUrl?: string;
  supabaseKey?: string;
  /** Non-null when the requested backend was invalid and we fell back —
   *  surfaced as a console error so misconfiguration is loud, never silent. */
  fallbackReason: string | null;
}

const VALID: readonly BackendId[] = ['directus', 'supabase', 'local'];

function norm(v: string | null | undefined): string {
  return (v ?? '').trim();
}

/**
 * `envBackend`/`envUrl`/`envKey` come from the build ($env/dynamic/public);
 * `stored` from the device (localStorage). Precedence per field: a stored
 * backend choice wins over the build default; Supabase credentials fall back
 * from stored to build so a build shipped WITH credentials still works when
 * the user only picked the backend.
 *
 * When NOTHING chose a backend, the default depends on whether the build was
 * given a Directus URL (`envDirectusUrl`): with one, Directus — every
 * existing .env deployment (NAS, KLAK) keeps exactly today's behaviour;
 * without one, LOCAL — a bare clone or a shipped bundle is a working twin
 * out of the box instead of an app pointed at a server that isn't there.
 * Directus is one external-database option, not the thing twin rests on.
 */
export function resolveBackend(
  envBackend: string | null | undefined,
  envUrl: string | null | undefined,
  envKey: string | null | undefined,
  stored: StoredChoice,
  envDirectusUrl?: string | null
): ResolvedBackend {
  const fallbackDefault = norm(envDirectusUrl) ? 'directus' : 'local';
  const requested = (norm(stored.backend) || norm(envBackend) || fallbackDefault).toLowerCase();
  const valid = (VALID as readonly string[]).includes(requested);
  const backend = valid ? (requested as BackendId) : fallbackDefault;

  if (backend === 'supabase') {
    const supabaseUrl = norm(stored.supabaseUrl) || norm(envUrl);
    const supabaseKey = norm(stored.supabaseKey) || norm(envKey);
    if (supabaseUrl && supabaseKey) {
      return { backend, supabaseUrl, supabaseKey, fallbackReason: null };
    }
    return {
      backend: fallbackDefault,
      fallbackReason: `supabase selected but its URL / anon key are missing — falling back to ${fallbackDefault}.`
    };
  }

  // Directus explicitly chosen but no URL exists anywhere (neither the build
  // nor the device) — nothing to connect to, and the SDK would throw parsing
  // an empty base. Local, loudly.
  if (backend === 'directus' && !norm(envDirectusUrl) && !norm(stored.directusUrl)) {
    return {
      backend: 'local',
      fallbackReason: 'directus selected but no server URL is configured — falling back to local.'
    };
  }

  return {
    backend,
    fallbackReason: valid ? null : `unknown backend '${requested}' — falling back to ${fallbackDefault}.`
  };
}
