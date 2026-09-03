<script lang="ts">
  // Projects linked to an org via either the owner_org_id pick or the
  // Project_organization junction. Each row carries `relation` so we
  // can tag owners differently from partners/sponsors/hosts and pull
  // the role label through from the junction.
  import Icon from '$lib/Icon.svelte';
  import TagPill from '$lib/TagPill.svelte';
  import {
    listProjectRoles,
    type OrgProject,
    type ProjectRole
  } from '$lib/directus';

  let { projects }: { projects: OrgProject[] } = $props();

  // Role catalogue — resolve role_in_project keys to their human label.
  let roleCatalogue = $state<ProjectRole[]>([]);
  $effect(() => {
    void (async () => {
      try { roleCatalogue = await listProjectRoles(); } catch { /* fall back to raw key */ }
    })();
  });
  function roleLabel(key: string | null | undefined): string {
    if (!key) return '';
    return roleCatalogue.find((r) => r.key === key)?.label ?? key;
  }
</script>

<div class="card">
  <div class="card-header">
    <span class="card-title"><Icon name="sparkles" size={16} /> Projects <span class="text-ink-300 font-normal">{projects.length}</span></span>
  </div>
  {#if projects.length === 0}
    <div class="px-4 pb-4 text-sm text-ink-400">No projects linked yet. Set this org as the owner on a project, or attach it from a project's Organisations tab.</div>
  {:else}
    <ul class="divide-y divide-surface-divider">
      {#each projects as p (p.id)}
        <li class="px-4 py-2.5 hover:bg-surface-hover">
          <a href={`/projects/${p.id}`} class="flex items-center gap-3 text-sm">
            {#if p.color}
              <span class="inline-block h-2 w-2 shrink-0 rounded-full" style:background-color={p.color} aria-hidden="true"></span>
            {/if}
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="truncate font-medium text-ink-900">{p.name ?? '(no name)'}</span>
                {#if p.relation === 'owner'}
                  <TagPill tone="online">owner</TagPill>
                {:else if p.role_in_project}
                  <TagPill tone="neutral">{roleLabel(p.role_in_project)}</TagPill>
                {:else}
                  <TagPill tone="neutral">partner</TagPill>
                {/if}
                {#if p.kind}<span class="text-xs text-ink-400">· {p.kind}</span>{/if}
                {#if p.status === 'draft'}<TagPill tone="sales">draft</TagPill>{/if}
              </div>
              {#if p.summary}
                <div class="mt-0.5 truncate text-xs text-ink-400">{p.summary}</div>
              {/if}
            </div>
            <Icon name="chevron-right" size={14} class="text-ink-300" />
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</div>
