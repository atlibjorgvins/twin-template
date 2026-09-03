import type { PageLoad } from './$types';

export const ssr = false;

/**
 * Web Share Target API endpoint. iOS / Android route incoming "share with…"
 * payloads to /share?title=&text=&url=. We just unpack the query and let the
 * page render a prefilled form so the user can edit before saving — auto-save
 * is too aggressive when shared text is often messy or includes a URL the
 * user wants to relocate.
 */
export const load: PageLoad = ({ url }) => {
  return {
    sharedTitle: url.searchParams.get('title') ?? '',
    sharedText: url.searchParams.get('text') ?? '',
    sharedUrl: url.searchParams.get('url') ?? '',
  };
};
