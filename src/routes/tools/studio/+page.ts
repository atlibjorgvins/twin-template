import { listImageTemplates } from '$lib/studio/data';

export const ssr = false;

export const load = async () => {
  try {
    return { templates: await listImageTemplates(), error: null as string | null };
  } catch (e) {
    return { templates: [], error: e instanceof Error ? e.message : String(e) };
  }
};
