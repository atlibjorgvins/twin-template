// Browser → NAS OCR service. The SPA has no backend, so the screenshot goes
// straight from the file input to the RapidOCR container over the tailnet;
// the service is unauthenticated there and answers CORS preflight for the twin
// origins (see ocr-service/app.py). Nothing about the image touches Directus
// until the user confirms the parse.
import { PUBLIC_OCR_URL } from '$env/static/public';
import type { OcrLine } from './parseFoodOrder';

const BASE = (PUBLIC_OCR_URL || '').replace(/\/+$/, '');

export type OcrResponse = {
  lines: OcrLine[];
  line_count: number;
  mean_score: number;
  seconds: number;
  width: number;
  height: number;
};

export type OcrHealth = {
  status: string;
  engine: string;
  det_model: string;
  rec_model: string;
  model_loaded: boolean;
};

export function ocrConfigured(): boolean {
  return BASE.length > 0;
}

/** Why the service can't be used, when it can't.
 *
 *  'cors' and 'down' are worth separating because the fix is completely
 *  different — one is a container redeploy, the other is your network — and a
 *  browser cannot tell them apart from the failed request alone: a CORS block
 *  and a dead host both surface as the same opaque TypeError. Probing again
 *  with `mode: 'no-cors'` is what distinguishes them: that request is exempt
 *  from the CORS check, so if it resolves the host is up and CORS was the
 *  problem; if it also throws, the host really is unreachable. */
export type OcrStatus =
  | { state: 'ok'; health: OcrHealth }
  | { state: 'unset' }
  | { state: 'cors'; origin: string }
  | { state: 'down' };

/** Cheap reachability probe, so the tool can say what is wrong up front
 *  rather than after the user has picked a file. */
export async function ocrHealth(timeoutMs = 5000): Promise<OcrStatus> {
  if (!BASE) return { state: 'unset' };
  const withTimeout = async (init: RequestInit) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      return await fetch(`${BASE}/health`, { ...init, signal: ctl.signal });
    } finally {
      clearTimeout(t);
    }
  };

  try {
    const res = await withTimeout({});
    if (res.ok) return { state: 'ok', health: (await res.json()) as OcrHealth };
  } catch {
    // fall through to the no-cors probe
  }

  try {
    // An opaque response still means the request reached the server.
    await withTimeout({ mode: 'no-cors' });
    return { state: 'cors', origin: location.origin };
  } catch {
    return { state: 'down' };
  }
}

/**
 * Run one image through the recogniser. Measured at ~12s for a 1000px-wide
 * screenshot on the NAS, and the first call after a container restart also
 * pays the model load, so the timeout is generous by default.
 */
export async function ocrImage(file: File | Blob, timeoutMs = 120_000): Promise<OcrResponse> {
  if (!BASE) throw new Error('PUBLIC_OCR_URL is not set — cannot reach the OCR service.');
  const body = new FormData();
  body.append('file', file, file instanceof File ? file.name : 'screenshot.png');

  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/ocr`, { method: 'POST', body, signal: ctl.signal });
    if (!res.ok) throw new Error(`OCR failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as OcrResponse;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error(`OCR timed out after ${Math.round(timeoutMs / 1000)}s.`);
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}
