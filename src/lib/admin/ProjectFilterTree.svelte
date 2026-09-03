<script lang="ts">
  // Collapsible project picker for the /orgs filter sidebar.
  // Renders projects in their parent_id hierarchy — top-level rows
  // can be expanded to reveal children. Each row has a checkbox; the
  // checked set bubbles up via `selected` (bindable).
  //
  // Designed for the Twin DB where projects nest at most a few levels
  // (University → Course → Cohort). For deeper trees the indentation
  // continues to step but no horizontal scroll lock — the page handles
  // that.
  import Icon from '$lib/Icon.svelte';
  import type { Project } from '$lib/directus';

  type Props = {
    projects: Array<Pick<Project, 'id' | 'name' | 'parent_id' | 'kind' | 'color'>>;
    selected: Set<number>;
  };
  let { projects, selected = $bindable() }: Props = $props();

  type Node = {
    project: Props['projects'][number];
    children: Node[];
  };

  // Build the tree once whenever `projects` changes. Orphans (parent
  // that we don't have access to) get re-rooted as top-level so they
  // don't disappear.
  const tree = $derived.by<Node[]>(() => {
    const byId = new Map<number, Node>();
    for (const p of projects) byId.set(p.id, { project: p, children: [] });
    const roots: Node[] = [];
    for (const node of byId.values()) {
      const parent = node.project.parent_id;
      const parentId = parent && typeof parent === 'object' ? parent.id : (typeof parent === 'number' ? parent : null);
      const parentNode = parentId != null ? byId.get(parentId) : null;
      if (parentNode) parentNode.children.push(node);
      else roots.push(node);
    }
    const sortRec = (arr: Node[]) => {
      arr.sort((a, b) => (a.project.name ?? '').localeCompare(b.project.name ?? ''));
      arr.forEach((n) => sortRec(n.children));
    };
    sortRec(roots);
    return roots;
  });

  // Expansion state per project id. Top-level nodes with at least one
  // child default to collapsed so the tree is calm on first paint.
  let expanded = $state(new Set<number>());
  function toggleExpand(id: number) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    expanded = next;
  }

  // Collect every descendant id for a given node — used by the
  // cascade-on-toggle behaviour below.
  function collectDescendants(node: Node, into: number[] = []): number[] {
    for (const child of node.children) {
      into.push(child.project.id);
      collectDescendants(child, into);
    }
    return into;
  }
  function nodeById(id: number): Node | null {
    const find = (arr: Node[]): Node | null => {
      for (const n of arr) {
        if (n.project.id === id) return n;
        const found = find(n.children);
        if (found) return found;
      }
      return null;
    };
    return find(tree);
  }
  function toggleSelect(id: number) {
    const next = new Set(selected);
    const node = nodeById(id);
    const descendants = node ? collectDescendants(node) : [];
    if (next.has(id)) {
      // Deselecting a parent also unchecks its whole subtree, otherwise
      // the indeterminate marker would lie about the state.
      next.delete(id);
      for (const d of descendants) next.delete(d);
    } else {
      // Selecting a parent cascades to every descendant so the filter
      // immediately means "this branch of the tree".
      next.add(id);
      for (const d of descendants) next.add(d);
    }
    selected = next;
  }

  // Indeterminate checkbox state — checked when fully selected, dash
  // marker when only some descendants are. Set via $effect because
  // `indeterminate` isn't a bindable HTML attribute.
  function isIndeterminate(node: Node): boolean {
    if (selected.has(node.project.id)) return false;
    const descendants = collectDescendants(node);
    if (descendants.length === 0) return false;
    return descendants.some((id) => selected.has(id));
  }

  // Filter input — typing narrows the visible tree to matching nodes
  // and their ancestors (so a deeply-nested match still has its
  // breadcrumb visible). Empty query shows everything.
  let q = $state('');
  function matchSet(): Set<number> | null {
    const query = q.trim().toLowerCase();
    if (!query) return null;
    const matches = new Set<number>();
    // Find every node whose name matches, then walk up via parent_id
    // and add each ancestor too.
    const byId = new Map(projects.map((p) => [p.id, p]));
    for (const p of projects) {
      if ((p.name ?? '').toLowerCase().includes(query)) {
        let cursor: typeof p | undefined = p;
        const seen = new Set<number>();
        while (cursor && !seen.has(cursor.id)) {
          seen.add(cursor.id);
          matches.add(cursor.id);
          const parent = cursor.parent_id;
          const parentId = parent && typeof parent === 'object' ? parent.id : (typeof parent === 'number' ? parent : null);
          cursor = parentId ? byId.get(parentId) : undefined;
        }
      }
    }
    return matches;
  }
  const visibleSet = $derived(matchSet());
</script>

<div class="space-y-2">
  <input
    type="search"
    class="input w-full text-sm"
    placeholder="Search projects in tree…"
    bind:value={q}
  />
  {#if tree.length === 0}
    <p class="text-xs text-ink-400">No projects yet.</p>
  {:else}
    <ul class="space-y-0.5">
      {#each tree as node (node.project.id)}
        {@render branch(node, 0)}
      {/each}
    </ul>
  {/if}
</div>

{#snippet branch(node: Node, depth: number)}
  {#if !visibleSet || visibleSet.has(node.project.id)}
    {@const isOpen = expanded.has(node.project.id)}
    {@const isSelected = selected.has(node.project.id)}
    {@const isPartial = isIndeterminate(node)}
    {@const hasChildren = node.children.length > 0}
    <li>
      <div
        class="flex items-center gap-1.5 rounded-md px-1 py-1 text-sm hover:bg-surface-hover"
        style="padding-left: {depth * 14}px;"
      >
        {#if hasChildren}
          <button
            type="button"
            class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-400 hover:bg-surface-divider hover:text-ink-700"
            onclick={() => toggleExpand(node.project.id)}
            aria-expanded={isOpen}
            aria-label={isOpen ? 'Collapse' : 'Expand'}
          >
            <Icon name={isOpen ? 'chevron-left' : 'chevron-right'} size={12} class={isOpen ? 'rotate-90' : ''} />
          </button>
        {:else}
          <span class="inline-block h-5 w-5 shrink-0"></span>
        {/if}
        <label class="flex flex-1 cursor-pointer items-center gap-2 min-w-0">
          <input
            type="checkbox"
            class="h-4 w-4 rounded border-surface-border text-brand focus:ring-brand"
            checked={isSelected}
            indeterminate={isPartial}
            onchange={() => toggleSelect(node.project.id)}
          />
          {#if node.project.color}
            <span class="inline-block h-2 w-2 shrink-0 rounded-full" style:background-color={node.project.color}></span>
          {/if}
          <span class="truncate {isSelected ? 'font-medium text-ink-900' : 'text-ink-700'}">{node.project.name ?? `Project ${node.project.id}`}</span>
          {#if node.project.kind}
            <span class="ml-auto text-[10px] uppercase tracking-wider text-ink-300">{node.project.kind}</span>
          {/if}
        </label>
      </div>
      {#if hasChildren && (isOpen || visibleSet)}
        <ul class="space-y-0.5">
          {#each node.children as child (child.project.id)}
            {@render branch(child, depth + 1)}
          {/each}
        </ul>
      {/if}
    </li>
  {/if}
{/snippet}
