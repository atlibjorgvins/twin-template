<script lang="ts">
  // The Spotlight overlay — a bare search box over People + Organizations,
  // summoned system-wide by the desktop shell's global shortcut (⌘K by
  // default; src-tauri/src/lib.rs + $lib/desktop.ts). Renders chromeless (the
  // layout treats /spotlight as a bare route) in its own small always-on-top
  // window. Esc or losing focus dismisses; Enter opens the pick in the main
  // window. Also loads in a plain browser for verification, where picking a
  // result simply navigates.
  import { onMount } from 'svelte';
  import { searchPeople } from '$lib/data/people';
  import { searchOrgs } from '$lib/data/orgs';
  import { personName } from '$lib/directus';
  import { spotlightDismiss, spotlightOpen, onSpotlightShown } from '$lib/desktop';
  import Icon from '$lib/Icon.svelte';

  type Hit = { kind: 'person' | 'org'; id: number | string; title: string; sub: string };

  let q = $state('');
  let hits = $state<Hit[]>([]);
  let sel = $state(0);
  let input: HTMLInputElement | undefined = $state();
  let seq = 0;

  onMount(() => {
    input?.focus();
    // Re-shown by the shell: reload so the local backend re-hydrates and the
    // query starts clean. (The shell re-centers and refocuses the window.)
    void onSpotlightShown(() => location.reload());
  });

  async function run(term: string) {
    const my = ++seq;
    if (!term.trim()) {
      hits = [];
      return;
    }
    const [people, orgs] = await Promise.all([
      searchPeople(term, 6).catch(() => []),
      searchOrgs(term, 4).catch(() => [])
    ]);
    if (my !== seq) return; // a newer keystroke already superseded this query
    hits = [
      ...people.map(
        (p: { id: number | string; email?: string | null } & Record<string, unknown>) => ({
          kind: 'person' as const,
          id: p.id,
          title: personName(p as never) || `Person ${p.id}`,
          sub: (p.email as string) || 'person'
        })
      ),
      ...orgs.map((o: { id: number | string; name?: string | null; website?: string | null }) => ({
        kind: 'org' as const,
        id: o.id,
        title: o.name || `Organization ${o.id}`,
        sub: o.website || 'organization'
      }))
    ];
    sel = 0;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      void spotlightDismiss();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      sel = Math.min(sel + 1, hits.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      sel = Math.max(sel - 1, 0);
    } else if (e.key === 'Enter' && hits[sel]) {
      e.preventDefault();
      pick(hits[sel]);
    }
  }

  function pick(h: Hit) {
    void spotlightOpen(h.kind === 'person' ? `/people/${h.id}` : `/orgs/${h.id}`);
  }
</script>

<svelte:head><title>Search · Twin</title></svelte:head>

<!-- svelte-ignore a11y_no_static_element_interactions — key handling lives on
     the input; this wrapper only paints the panel. -->
<div
  class="flex h-screen w-screen flex-col overflow-hidden"
  style="background: var(--bg-primary); border: 1px solid var(--border-strong); border-radius: var(--radius-lg);"
>
  <div class="flex items-center gap-3 px-4 py-3" style="border-bottom: 1px solid var(--border-subtle);">
    <span style="color: var(--accent-electric);"><Icon name="search" size={18} /></span>
    <!-- svelte-ignore a11y_autofocus — the window exists only for this field -->
    <input
      bind:this={input}
      bind:value={q}
      oninput={() => void run(q)}
      onkeydown={onKey}
      type="text"
      autofocus
      placeholder="Search people and organizations…"
      class="w-full bg-transparent font-display text-lg outline-none"
      style="color: var(--text-primary);"
    />
    <kbd class="text-[10px] uppercase tracking-wider text-ink-400">esc</kbd>
  </div>

  <div class="flex-1 overflow-y-auto py-1">
    {#if q.trim() && hits.length === 0}
      <p class="px-4 py-3 text-sm text-ink-500">Nothing matches “{q}”.</p>
    {:else}
      {#each hits as h, i (h.kind + '-' + h.id)}
        <button
          type="button"
          class="flex w-full items-center gap-3 px-4 py-2 text-left"
          style={`background: ${i === sel ? 'var(--accent-alpha-10)' : 'transparent'};`}
          onmouseenter={() => (sel = i)}
          onclick={() => pick(h)}
        >
          <span
            class="flex h-7 w-7 shrink-0 items-center justify-center"
            style="border-radius: var(--radius-md); background: var(--bg-tertiary); color: var(--text-secondary);"
          >
            <Icon name={h.kind === 'person' ? 'users' : 'building'} size={14} />
          </span>
          <span class="min-w-0">
            <span class="block truncate font-medium" style="color: var(--text-primary);">{h.title}</span>
            <span class="block truncate text-xs text-ink-400">{h.sub}</span>
          </span>
          {#if i === sel}
            <kbd class="ml-auto text-[10px] uppercase tracking-wider text-ink-400">↵</kbd>
          {/if}
        </button>
      {/each}
    {/if}
  </div>
</div>
