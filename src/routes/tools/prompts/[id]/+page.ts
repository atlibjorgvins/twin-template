import { error } from '@sveltejs/kit';
import { getPrompt, listPromptSystems, searchTags, type Prompt, type Tag } from '$lib/directus';

export const ssr = false;

export async function load({ params }): Promise<{ prompt: Prompt; systems: string[]; allTags: Tag[] }> {
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw error(404, 'Not found');
  const [prompt, systems, allTags] = await Promise.all([
    getPrompt(id),
    listPromptSystems().catch(() => [] as string[]),
    searchTags('', 200).catch(() => [] as Tag[])
  ]);
  return { prompt, systems, allTags };
}
