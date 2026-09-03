<script lang="ts">
  // Connect an Asana project to a twin project, once, and have it stick.
  //
  // The mapping is keyed on the Asana project GID, never the name. Renaming
  // "Markaðsmál" in Asana must not break the link, and two workspaces can hold
  // projects with the same name.
  //
  // Two ways to name the Asana side, because the API may be unreachable:
  //   1. Pick from Asana — needs the proxy Flow to have a real token.
  //   2. Type the gid by hand — always available, and the only option while
  //      the Flow still holds its placeholder. The unmapped names shown on the
  //      task cards tell you what to look for.
  import Icon from '$lib/Icon.svelte';
  import {
    saveAsanaProjectLink,
    deleteAsanaProjectLink,
    formatError,
    type AsanaProjectLink,
    type Project
  } from '$lib/directus';
  import { asanaMe, listAsanaProjects, type AsanaProject } from '$lib/asana';

  let {
    links = $bindable([] as AsanaProjectLink[]),
    projects = [] as Pick<Project, 'id' | 'name' | 'parent_id'>[],
    /** Asana project names seen on tasks that have no twin project — the
     *  shortlist of what actually needs connecting. */
    suggestions = [] as { gid: string | null; name: string; count: number }[],
    onApply
  }: {
    links?: AsanaProjectLink[];
    projects?: Pick<Project, 'id' | 'name' | 'parent_id'>[];
    suggestions?: { gid: string | null; name: string; count: number }[];
    /**
     * Re-run the mapping over existing tasks after a change.
     *
     * Receives the authoritative list. Relying on `bind:links` having reached
     * the parent before it reads its own state is a race — the first live run
     * assigned the tasks but never stamped the link, because the parent still
     * held the pre-save array.
     */
    onApply?: (links: AsanaProjectLink[]) => void | Promise<void>;
  } = $props();

  let gid = $state('');
  let name = $state('');
  let projectId = $state<number | null>(null);
  let busy = $state(false);
  let err = $state('');
  let note = $state('');

  // Asana picker (optional path)
  let asanaProjects = $state<AsanaProject[]>([]);
  let loadingAsana = $state(false);
  let asanaErr = $state('');

  const projectOptions = $derived.by(() => {
    const byParent = new Map<number | null, typeof projects>();
    for (const p of projects) {
      const parent = p.parent_id as number | { id: number } | null;
      const k = parent == null ? null : typeof parent === 'object' ? parent.id : Number(parent);
      (byParent.get(k) ?? byParent.set(k, []).get(k)!).push(p);
    }
    const out: { id: number; label: string }[] = [];
    const seen = new Set<number>();
    const walk = (parent: number | null, depth: number) => {
      for (const p of byParent.get(parent) ?? []) {
        if (seen.has(p.id)) continue;   // cycle guard — a self-parent would hang
        seen.add(p.id);
        out.push({ id: p.id, label: `${'— '.repeat(depth)}${p.name ?? `#${p.id}`}` });
        walk(p.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  });

  const projName = $derived(new Map(projects.map((p) => [p.id, p.name ?? `#${p.id}`])));
  function linkProjectId(l: AsanaProjectLink): number | null {
    const p = l.project_id;
    return p == null ? null : typeof p === 'object' ? p.id : Number(p);
  }

  async function loadAsanaProjects() {
    loadingAsana = true;
    asanaErr = '';
    try {
      const me = await asanaMe();
      const ws = me.workspaces?.[0]?.gid;
      if (!ws) throw new Error('That Asana account has no workspace we can read.');
      asanaProjects = await listAsanaProjects(ws);
      if (asanaProjects.length === 0) asanaErr = 'Asana returned no active projects for this workspace.';
    } catch (e) {
      asanaErr = formatError(e);
    } finally {
      loadingAsana = false;
    }
  }

  function pickAsana(p: AsanaProject) {
    gid = p.gid;
    name = p.name ?? '';
  }

  async function save() {
    const g = gid.trim();
    if (!g) { err = 'An Asana project gid is required.'; return; }
    if (projectId == null) { err = 'Pick the twin project to connect it to.'; return; }
    busy = true; err = ''; note = '';
    try {
      const saved = await saveAsanaProjectLink({
        asana_project_gid: g,
        asana_project_name: name.trim() || null,
        project_id: projectId
      });
      // Replace-by-gid locally too, so re-pointing an existing link doesn't
      // show two rows until the next reload.
      const rest = links.filter((l) => l.asana_project_gid !== g);
      const next = [...rest, { ...saved, project_id: projectId }].sort((a, b) =>
        (a.asana_project_name ?? '').localeCompare(b.asana_project_name ?? '')
      );
      links = next;
      gid = ''; name = ''; projectId = null;
      note = 'Connected. Applying to existing tasks…';
      await onApply?.(next);
    } catch (e) {
      err = formatError(e);
    } finally {
      busy = false;
    }
  }

  async function remove(l: AsanaProjectLink) {
    if (!confirm(`Forget the link for “${l.asana_project_name ?? l.asana_project_gid}”?\n\nTasks already assigned keep their project — this only stops future ones being mapped.`)) return;
    busy = true; err = '';
    try {
      await deleteAsanaProjectLink(l.id);
      links = links.filter((x) => x.id !== l.id);
    } catch (e) {
      err = formatError(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="apl">
  <p class="apl-lede">
    Connect an Asana project to a twin project once. Every task that arrives
    from it afterwards lands on that project by itself.
  </p>

  {#if suggestions.length > 0}
    <div class="apl-sugg">
      <span class="apl-sugg-head">Seen on unassigned tasks</span>
      <div class="apl-sugg-row">
        {#each suggestions as s (s.name)}
          <button
            type="button"
            class="apl-chip"
            title={s.gid ? `gid ${s.gid}` : 'No gid known yet — Asana has not been reachable to resolve it'}
            onclick={() => { if (s.gid) gid = s.gid; name = s.name; }}
          >{s.name} <span class="apl-chip-n">{s.count}</span></button>
        {/each}
      </div>
    </div>
  {/if}

  <div class="apl-form">
    <label class="apl-field">
      <span>Asana project gid</span>
      <input type="text" bind:value={gid} placeholder="1201234567890123" inputmode="numeric" />
    </label>
    <label class="apl-field">
      <span>Name (for display)</span>
      <input type="text" bind:value={name} placeholder="Markaðsmál" />
    </label>
    <label class="apl-field">
      <span>twin project</span>
      <select bind:value={projectId}>
        <option value={null}>— pick a project —</option>
        {#each projectOptions as o (o.id)}<option value={o.id}>{o.label}</option>{/each}
      </select>
    </label>
    <button class="btn-primary apl-save" onclick={save} disabled={busy}>
      <Icon name="check" size={13} /> {busy ? 'Saving…' : 'Connect'}
    </button>
  </div>

  <details class="apl-asana">
    <summary>Pick from Asana instead</summary>
    <div class="apl-asana-body">
      <button class="btn-ghost text-xs" onclick={loadAsanaProjects} disabled={loadingAsana}>
        {loadingAsana ? 'Asking Asana…' : 'Load my Asana projects'}
      </button>
      {#if asanaErr}
        <p class="apl-err">
          {asanaErr}
          <br />
          <span class="apl-hint">
            If this says the credential was rejected, the “Asana API proxy” Flow
            still holds its placeholder — paste a personal access token into that
            operation’s Authorization header as <code>Bearer &lt;token&gt;</code>.
            The gid field above works without it.
          </span>
        </p>
      {/if}
      {#if asanaProjects.length > 0}
        <div class="apl-sugg-row">
          {#each asanaProjects as p (p.gid)}
            <button type="button" class="apl-chip" onclick={() => pickAsana(p)}>{p.name ?? p.gid}</button>
          {/each}
        </div>
      {/if}
    </div>
  </details>

  {#if err}<p class="apl-err">{err}</p>{/if}
  {#if note}<p class="apl-note">{note}</p>{/if}

  <ul class="apl-list">
    {#each links as l (l.id)}
      {@const pid = linkProjectId(l)}
      <li>
        <div class="apl-pair">
          <span class="apl-a">{l.asana_project_name ?? l.asana_project_gid}</span>
          <Icon name="arrow-right" size={12} />
          <span class="apl-b">{pid != null ? (projName.get(pid) ?? `#${pid}`) : 'not connected'}</span>
        </div>
        <div class="apl-meta">
          {#if l.task_count}<span>{l.task_count} assigned</span>{/if}
          {#if l.last_applied}<span>last {String(l.last_applied).slice(0, 10)}</span>{/if}
          <button type="button" class="apl-del" title="Forget this link" onclick={() => remove(l)}>
            <Icon name="x" size={12} />
          </button>
        </div>
      </li>
    {/each}
    {#if links.length === 0}
      <li class="apl-empty">No connections yet.</li>
    {/if}
  </ul>
</div>

<style>
  .apl-lede { font-size: 12px; color: var(--text-secondary); margin-bottom: 0.7rem; }
  .apl-sugg { margin-bottom: 0.7rem; }
  .apl-sugg-head {
    display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-secondary); margin-bottom: 0.25rem;
  }
  .apl-sugg-row { display: flex; flex-wrap: wrap; gap: 0.3rem; }
  .apl-chip {
    display: inline-flex; align-items: center; gap: 0.25rem;
    font-size: 11px; border-radius: 999px; padding: 0.15rem 0.5rem;
    background: var(--bg-tertiary); color: var(--text-secondary);
    border: 1px solid transparent; cursor: pointer;
  }
  .apl-chip:hover { border-color: var(--brand, #2f7d7d); color: var(--brand, #2f7d7d); }
  .apl-chip-n { opacity: 0.65; }

  .apl-form { display: grid; gap: 0.5rem; grid-template-columns: 1fr; margin-bottom: 0.6rem; }
  @media (min-width: 640px) { .apl-form { grid-template-columns: 1fr 1fr 1fr auto; align-items: end; } }
  .apl-field { display: flex; flex-direction: column; gap: 0.2rem; min-width: 0; }
  .apl-field span { font-size: 10px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-secondary); }
  .apl-field input, .apl-field select {
    width: 100%; font-size: 12px; padding: 0.3rem 0.45rem;
    border-radius: 8px; border: 1px solid var(--border-subtle);
    background: var(--bg-tertiary); color: var(--text-primary);
  }
  .apl-save { white-space: nowrap; }

  .apl-asana { margin-bottom: 0.6rem; }
  .apl-asana summary { font-size: 11px; color: var(--text-secondary); cursor: pointer; }
  .apl-asana-body { padding-top: 0.4rem; display: flex; flex-direction: column; gap: 0.4rem; }
  .apl-err { font-size: 11px; color: #B3332F; }
  .apl-hint { color: var(--text-secondary); }
  .apl-note { font-size: 11px; color: var(--text-secondary); }

  .apl-list { display: flex; flex-direction: column; gap: 0.15rem; }
  .apl-list li {
    display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
    padding: 0.4rem 0.1rem; border-top: 1px solid var(--border-subtle); font-size: 12px;
  }
  .apl-pair { display: flex; align-items: center; gap: 0.35rem; min-width: 0; flex: 1; color: var(--text-secondary); }
  .apl-a { font-weight: 500; color: var(--text-primary); }
  .apl-b { font-weight: 500; color: var(--text-primary); }
  .apl-meta { display: flex; align-items: center; gap: 0.5rem; font-size: 10px; color: var(--text-secondary); }
  .apl-del { display: inline-flex; padding: 0.1rem; border-radius: 6px; cursor: pointer; background: none; border: 0; color: var(--text-secondary); }
  .apl-del:hover { color: #B3332F; background: var(--bg-tertiary); }
  .apl-empty { color: var(--text-secondary); font-size: 11px; border-top: 0; }
</style>
