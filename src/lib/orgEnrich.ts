// Helpers for the "Enrich org" feature.
//
// The browser can't scrape arbitrary websites because of CORS, so this module
// sticks to two reliable, infra-free strategies:
//
//   1. Derive a likely domain from the org's email/website/name and surface
//      one-click search links (Google, LinkedIn, ja.is, kennitala.is, …) the
//      user can open in a new tab.
//
//   2. Grab the brand logo from server-side icon endpoints by delegating the
//      fetch to Directus's `/files/import` endpoint via `uploadFromUrl()`.
//      That sidesteps CORS entirely.
//
// Clearbit's Logo API used to be the first-choice source here; it was
// discontinued, so we no longer try it.

import type { Organization } from './directus';
import { authHeader } from '$lib/data/client';

/** Extract a domain from email or website, or guess from `${name}.is`. */
export function domainFromOrg(org: Organization): string | null {
  const fromEmail = (org.email ?? '').split('@')[1]?.trim().toLowerCase();
  if (fromEmail && /\./.test(fromEmail)) return cleanDomain(fromEmail);

  const fromWebsite = org.website ?? '';
  if (fromWebsite) {
    try {
      const url = new URL(/^https?:\/\//i.test(fromWebsite) ? fromWebsite : `https://${fromWebsite}`);
      return cleanDomain(url.hostname);
    } catch {
      /* ignore */
    }
  }
  return null;
}

function cleanDomain(d: string): string {
  return d.replace(/^www\./, '').toLowerCase();
}

export function googleFaviconUrl(domain: string, size = 128): string {
  // Reliable fallback that almost always returns *something*.
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`;
}

export function duckduckgoIconUrl(domain: string): string {
  return `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`;
}

/**
 * icon.horse parses each site's `apple-touch-icon` and web-app manifest,
 * so it usually returns a real 256×256 (or higher) brand mark — far better
 * than the favicon-bitmap services for non-Clearbit-indexed sites.
 */
export function iconHorseUrl(domain: string): string {
  return `https://icon.horse/icon/${encodeURIComponent(domain)}`;
}

/**
 * Apple-touch-icon directly off the site itself — when it exists, it's the
 * highest-resolution brand mark a static fetch can get (180×180 typical,
 * sometimes 512×512). May 404; that's fine, the caller falls through.
 */
export function appleTouchIconUrl(domain: string): string {
  return `https://${domain}/apple-touch-icon.png`;
}

/**
 * Ordered candidates to try when grabbing a logo for a domain, highest
 * expected resolution first. Caller stops at the first that imports.
 */
export function logoCandidates(domain: string, _size = 512): string[] {
  return [
    appleTouchIconUrl(domain),     // straight off the site, ~180–512px
    iconHorseUrl(domain),          // parses apple-touch-icon + manifest server-side
    duckduckgoIconUrl(domain),     // 32×32 fallback
    googleFaviconUrl(domain, 256)  // last resort, low-res
  ];
}

export type SearchLink = { label: string; url: string; icon: string };

/** Build a set of "open in new tab" lookup links. Iceland-aware. */
export function searchLinks(org: Organization): SearchLink[] {
  const name = (org.name ?? '').trim();
  const domain = domainFromOrg(org);
  const q = encodeURIComponent([name, domain].filter(Boolean).join(' '));

  const links: SearchLink[] = [];
  if (q) {
    links.push({ label: 'Google', url: `https://www.google.com/search?q=${q}`, icon: 'globe' });
    links.push({
      label: 'LinkedIn',
      url: `https://www.linkedin.com/search/results/companies/?keywords=${q}`,
      icon: 'building'
    });
    links.push({
      label: 'Google News',
      url: `https://news.google.com/search?q=${q}`,
      icon: 'globe'
    });
  }
  if (name) {
    const nq = encodeURIComponent(name);
    links.push({ label: 'ja.is', url: `https://ja.is/?q=${nq}`, icon: 'phone' });
    links.push({ label: 'kennitala.is', url: `https://kennitala.is/leit/?q=${nq}`, icon: 'tag' });
    links.push({ label: 'finna.is', url: `https://finna.is/Search/Results?lookfor=${nq}`, icon: 'building' });
  }
  if (domain) {
    links.push({ label: 'Open homepage', url: `https://${domain}`, icon: 'globe' });
  }
  return links;
}

/**
 * Result of the server-side enrichment endpoint.
 * `suggestions` only contains fields whose value differs from the org's
 * current value, so the UI can show them as opt-in apply checkboxes.
 */
export type EnrichResult = {
  orgId: number;
  query: string;
  suggestions: Record<string, string | number | null>;
  sources: Record<string, string>;
  fetched: Record<string, boolean>;
  details?: Record<string, unknown>;
};

import { PUBLIC_DIRECTUS_URL } from '$env/static/public';

/** Call the Directus extension at POST /enrich-org/:id. */
export async function enrichOrgFromWeb(orgId: number, query?: string): Promise<EnrichResult> {
  const res = await fetch(`${PUBLIC_DIRECTUS_URL}/enrich-org/${orgId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeader()
    },
    body: JSON.stringify(query ? { query } : {})
  });
  if (!res.ok) {
    let msg = `Enrichment failed: ${res.status}`;
    try {
      const body = await res.json();
      msg = body?.error || body?.errors?.[0]?.message || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as EnrichResult;
}
