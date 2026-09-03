import { listAiUsage, type AiUsage } from '$lib/directus';

export const ssr = false;

export async function load(): Promise<{ usage: AiUsage[] }> {
  return { usage: await listAiUsage({ limit: 2000 }).catch(() => [] as AiUsage[]) };
}
