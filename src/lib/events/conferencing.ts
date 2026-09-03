// Conferencing details, pulled out of a calendar description.
//
// Google and Microsoft bury genuinely useful data in the block they append:
// the join URL, a dial-in number, a PIN, a meeting ID, a passcode. Measured
// on the Dates collection, 585 of 1,490 rows carry a conferencing link in
// their description while only 7 have the virtual_link field set — so
// deleting the block as boilerplate threw away the one action most of these
// events needed, and reading it meant squinting at a wall of tildes.
//
// Pure — no $lib imports — so it can be unit tested with
// `node --test --experimental-strip-types`.

export type ConferenceProvider = 'google_meet' | 'teams' | 'zoom' | 'other';

export type Conferencing = {
  provider: ConferenceProvider;
  /** Human label for the join control, e.g. "Join Google Meet". */
  label: string;
  joinUrl: string;
  /** E.164-ish dial-in number, digits and + only, safe for a tel: href. */
  phone?: string;
  /** Number as printed, for display. */
  phoneDisplay?: string;
  /** ISO-ish country hint Google prints, e.g. "IS". */
  phoneCountry?: string;
  pin?: string;
  meetingId?: string;
  passcode?: string;
  /** Google's "more phone numbers" page. */
  morePhonesUrl?: string;
};

const LABELS: Record<ConferenceProvider, string> = {
  google_meet: 'Join Google Meet',
  teams: 'Join Teams meeting',
  zoom: 'Join Zoom meeting',
  other: 'Join meeting'
};

function providerOf(url: string): ConferenceProvider {
  if (/meet\.google\.com/i.test(url)) return 'google_meet';
  if (/teams\.microsoft\.com|teams\.live\.com/i.test(url)) return 'teams';
  if (/zoom\.us/i.test(url)) return 'zoom';
  return 'other';
}

// Outlook wraps URLs in angle brackets and Google sometimes trails a period,
// so trim the punctuation a URL can't legitimately end with.
function tidyUrl(raw: string): string {
  return raw.replace(/^<+/, '').replace(/[>).,;'"\]]+$/, '');
}

const JOIN_URL =
  /https?:\/\/(?:[a-z0-9-]+\.)*(?:meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|[a-z0-9-]*zoom\.us)\/[^\s<>"']+/i;

/**
 * Pull the conferencing details out of a description. `virtualLink` wins when
 * present — it's the curated field — but it is set on well under 1% of rows.
 * Returns null when there's nothing joinable.
 */
export function parseConferencing(
  description?: string | null,
  virtualLink?: string | null
): Conferencing | null {
  const text = description ?? '';
  const explicit = (virtualLink ?? '').trim();
  const found = JOIN_URL.exec(text);
  const url = explicit || (found ? tidyUrl(found[0]) : '');
  if (!url) return null;

  const provider = providerOf(url);
  const out: Conferencing = { provider, label: LABELS[provider], joinUrl: url };

  // Google: "Or dial: (IS) +354 539 0680 PIN: 7723645902601#"
  const gDial = /Or dial:\s*(?:\(([A-Z]{2})\)\s*)?([+\d][\d\s-]{5,})\s*PIN:\s*(\d+)/i.exec(text);
  if (gDial) {
    out.phoneCountry = gDial[1] || undefined;
    out.phoneDisplay = gDial[2].trim();
    out.phone = gDial[2].replace(/[^\d+]/g, '');
    out.pin = gDial[3];
  }
  const more = /https?:\/\/tel\.meet\/\S+/i.exec(text);
  if (more) out.morePhonesUrl = tidyUrl(more[0]);

  // Teams: "Meeting ID: 380 238 149 439" / "Passcode: PuA4o8"
  const mid = /Meeting ID:\s*([\d][\d\s]{6,})/i.exec(text);
  if (mid) out.meetingId = mid[1].trim().replace(/\s+/g, ' ');
  const pass = /Passcode:\s*([^\s<]{3,})/i.exec(text);
  if (pass) out.passcode = pass[1];

  // Teams also prints a dial-in as "or call in (audio only) +354 …,,123456789#"
  if (!out.phone) {
    const tDial = /call in \(audio only\)\s*([+\d][\d\s-]{5,})(?:,+(\d+)#)?/i.exec(text);
    if (tDial) {
      out.phoneDisplay = tDial[1].trim();
      out.phone = tDial[1].replace(/[^\d+]/g, '');
      if (tDial[2]) out.pin = tDial[2];
    }
  }
  return out;
}

/**
 * twin's own provenance notes — "Added from email invitation (…)" and
 * "[Updated from email …: rescheduled …]". 66 rows carry one. They're
 * metadata about how the row got here, not a description of the event, so
 * the caller shows them as a footnote instead of body copy.
 */
export function extractProvenance(description?: string | null): {
  notes: string[];
  rest: string;
} {
  const text = description ?? '';
  if (!text) return { notes: [], rest: '' };
  const notes: string[] = [];
  const rest = text
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      if (/^\[?(Added|Updated) from email\b/i.test(t)) {
        notes.push(t.replace(/^\[|\]$/g, ''));
        return false;
      }
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { notes, rest };
}

// ── Description linkification ──────────────────────────────────────────
//
// Whatever survives the boilerplate strip still arrives as plain text, so a
// URL in it is dead. Outlook makes that worse by emitting its own
// "Label<https://…>" form — 86 rows carry one — which reads as a typo.

export type DescPart =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; href: string };

// Angle-bracketed first (Outlook), then bare URLs.
const LINKABLE = /<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s<>"']+)/g;

/** Split a description into text and link runs for rendering. */
export function describeParts(text?: string | null): DescPart[] {
  const src = text ?? '';
  if (!src) return [];
  const parts: DescPart[] = [];
  let last = 0;
  for (const m of src.matchAll(LINKABLE)) {
    const raw = m[1] ?? m[2];
    const bracketed = m[1] !== undefined;
    const at = m.index ?? 0;
    if (at > last) {
      let lead = src.slice(last, at);
      // Outlook writes "Label<https://…>" with no space, so stripping the
      // brackets would run the label straight into the link text —
      // "Senta úr Outlook fyrir Androidaka.ms/AAb9ysg".
      if (bracketed && lead && !/\s$/.test(lead)) lead += ' ';
      parts.push({ kind: 'text', text: lead });
    }
    // Trailing punctuation belongs to the sentence, not the href.
    const href = raw.replace(/[).,;'"\]]+$/, '');
    const dropped = raw.slice(href.length);
    // Show a hostname rather than 200 characters of query string.
    let label = href;
    try {
      const u = new URL(href);
      label = u.host.replace(/^www\./, '') + (u.pathname !== '/' ? u.pathname : '');
      if (label.length > 42) label = label.slice(0, 41) + '…';
    } catch {
      /* keep the raw string if it won't parse */
    }
    parts.push({ kind: 'link', text: label, href });
    if (dropped) parts.push({ kind: 'text', text: dropped });
    last = at + m[0].length;
  }
  if (last < src.length) parts.push({ kind: 'text', text: src.slice(last) });
  return parts;
}
