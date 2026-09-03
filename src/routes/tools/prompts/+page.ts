import { listPrompts, listTags, listPromptSystems, searchProjects, type Prompt, type Tag } from '$lib/directus';

export const ssr = false;

export type PromptsData = {
  prompts: Prompt[];
  tags: Tag[];
  systems: string[];
  projects: Array<{ id: number; name?: string | null }>;
};

export async function load(): Promise<PromptsData> {
  const [prompts, tags, systems, projects] = await Promise.all([
    listPrompts({ sort: 'recent' }).catch(() => [] as Prompt[]),
    listTags().catch(() => [] as Tag[]),
    listPromptSystems().catch(() => [] as string[]),
    searchProjects('', 500).then((r) => r.map((p) => ({ id: p.id, name: p.name }))).catch(() => [])
  ]);
  return { prompts, tags, systems, projects };
}
