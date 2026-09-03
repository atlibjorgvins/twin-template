import { listAiKeys, listAiTaskBindings, type AiKey, type AiTaskBinding } from '$lib/directus';

export const ssr = false;

export async function load(): Promise<{ keys: AiKey[]; bindings: AiTaskBinding[] }> {
  const [keys, bindings] = await Promise.all([
    listAiKeys().catch(() => [] as AiKey[]),
    listAiTaskBindings().catch(() => [] as AiTaskBinding[])
  ]);
  return { keys, bindings };
}
