<script lang="ts">
  import Icon from '$lib/Icon.svelte';
  import TagPill from '$lib/TagPill.svelte';
  import { isCurrentMember, type Organization, type Project, type ProjectPerson } from '$lib/directus';

  let { links }: { links: ProjectPerson[] } = $props();

  function projectOf(r: ProjectPerson): Project | null {
    return r.project_id && typeof r.project_id === 'object' ? (r.project_id as Project) : null;
  }
  /** Short tenure label: a single year, a from–to span, or "since". */
  function tenure(link: ProjectPerson): string | null {
    const y = (d?: string | null) => (d ? d.slice(0, 4) : null);
    const from = y(link.start_date);
    const to = y(link.end_date);
    if (from && to) return from === to ? from : `${from}–${to}`;
    if (to) return `until ${to}`;
    if (from) return isCurrentMember(link) ? `since ${from}` : from;
    return null;
  }
  function ownerOf(p: Project): Organization | null {
    return p.owner_org_id && typeof p.owner_org_id === 'object'
      ? (p.owner_org_id as Organization)
      : null;
  }
</script>

<div class="card">
  <div class="card-header">
    <span class="card-title"><Icon name="sparkles" size={16} /> Projects <span class="text-ink-300 font-normal">{links.length}</span></span>
  </div>
  {#if links.length === 0}
    <div class="px-4 pb-4 text-sm text-ink-400">Not linked to any projects yet.</div>
  {:else}
    <ul class="divide-y divide-surface-divider">
      {#each links as link (link.id)}
        {@const p = projectOf(link)}
        {#if p}
          {@const owner = ownerOf(p)}
          <li class="px-4 py-2.5 hover:bg-surface-hover">
            <a href={`/projects/${p.id}`} class="flex items-center gap-3 text-sm">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="truncate font-medium text-ink-900">{p.name ?? '(no name)'}</span>
                  {#if p.kind}<TagPill tone="online">{p.kind}</TagPill>{/if}
                  {#if p.status === 'draft'}<TagPill tone="sales">draft</TagPill>{/if}
                  {#if !isCurrentMember(link)}
                    <span class="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase" style="background: var(--bg-tertiary); color: var(--text-secondary);">former</span>
                  {/if}
                </div>
                <div class="mt-0.5 flex items-center gap-2 text-xs text-ink-400">
                  {#if owner}
                    <Icon name="building" size={12} />
                    <span class="truncate">{owner.name}</span>
                  {/if}
                  {#if link.role_in_project}
                    {#if owner}<span class="text-ink-300">·</span>{/if}
                    <span class="truncate">{link.role_in_project}</span>
                  {/if}
                  {#if tenure(link)}
                    <span class="text-ink-300">·</span>
                    <span class="shrink-0 tabular-nums">{tenure(link)}</span>
                  {/if}
                </div>
              </div>
              <Icon name="chevron-right" size={14} class="text-ink-300" />
            </a>
          </li>
        {/if}
      {/each}
    </ul>
  {/if}
</div>
