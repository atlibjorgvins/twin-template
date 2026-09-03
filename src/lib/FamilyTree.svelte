<script lang="ts">
  import { getPluginSetting } from '$lib/plugins/settings';
  import Avatar from '$lib/Avatar.svelte';
  import { personName, assetUrl, FAMILY_LABEL, type FamilyEdge, type Person } from '$lib/directus';

  // The user is the sole real principal in this system. When viewing the
  // family graph from anyone else's page, the centred-and-ringed person
  // represents *them*, not "you". Owner-detection is intentionally narrow —
  // email is the canonical identifier.
  // Which email marks "you" in the tree — a per-device plugin setting
  // (family plugin detail page), empty by default on a fresh install.
  const OWNER_EMAIL = String(getPluginSetting('family', 'owner_email', '')).toLowerCase();

  type Props = { viewer: Person; edges: FamilyEdge[] };
  let { viewer, edges }: Props = $props();

  // ─── Highlight state ────────────────────────────────────────────────────
  // Click a card → mark it as "focused" and highlight every card connected
  // to it via the relationship graph: parents, children, spouses, the chain
  // for derived edges. Click again (or click empty space) to clear.
  let focusedKey = $state<string | null>(null);

  // Siblings sit on the same row as the viewer and visually compete with the
  // parents above (same generation, similar avatar size). Collapse them into
  // a stacked chip by default — one tap expands into the full sibling row.
  let siblingsExpanded = $state(false);
  // Collateral groups (aunts/uncles, cousins, in-laws) share the same
  // collapsed-chip-with-stacked-avatars pattern. Keyed by a stable label so
  // we don't have to track each one with its own variable.
  let groupExpanded = $state<Record<string, boolean>>({});

  // A card's stable identity for highlight lookup. Person id is enough
  // because each person appears once at most per tree.
  function keyOf(personId: number): string {
    return `p:${personId}`;
  }

  // Build adjacency: for each card key, which other keys are "related" so
  // hovering/focusing one lights up the chain.
  const relatedTo = $derived.by(() => {
    const m = new Map<string, Set<string>>();
    function link(a: string, b: string) {
      if (!m.has(a)) m.set(a, new Set());
      if (!m.has(b)) m.set(b, new Set());
      m.get(a)!.add(b);
      m.get(b)!.add(a);
    }
    const viewerKey = keyOf(viewer.id);
    for (const e of edges) {
      const otherKey = keyOf(e.other.id);
      if (e.derivedVia) {
        // Derived edges: connect the inferred person to the linking person
        // (e.g. grandchild → child) AND to the viewer via that chain.
        link(otherKey, keyOf(e.derivedVia.id));
        link(otherKey, viewerKey); // also part of viewer's family
      } else {
        link(viewerKey, otherKey);
      }
    }
    return m;
  });

  const isOwner = $derived(
    OWNER_EMAIL.length > 0 && typeof viewer.email === 'string' && viewer.email.toLowerCase() === OWNER_EMAIL
  );

  // ─── Bucket edges by relation ───────────────────────────────────────────
  // Direct lineage (the spine — drawn as a centred vertical column):
  const grandparents = $derived(edges.filter((e) => ['grandfather', 'grandmother', 'grandparent'].includes(e.relation)));
  const parents = $derived(edges.filter((e) => ['father', 'mother', 'parent', 'stepfather', 'stepmother'].includes(e.relation)));
  const children = $derived(edges.filter((e) => ['son', 'daughter', 'child', 'stepchild'].includes(e.relation)));
  const grandchildren = $derived(edges.filter((e) => ['grandson', 'granddaughter', 'grandchild'].includes(e.relation)));

  // Same generation as viewer — siblings flank to the left, spouse to the right.
  const siblings = $derived(edges.filter((e) => ['brother', 'sister', 'sibling'].includes(e.relation)));
  const spouses = $derived(edges.filter((e) => ['spouse', 'partner', 'ex_partner'].includes(e.relation)));

  // Collateral — rendered as a labelled aside, never on the spine.
  const auntsUncles = $derived(edges.filter((e) => ['uncle', 'aunt', 'uncle_or_aunt'].includes(e.relation)));
  const cousins = $derived(edges.filter((e) => e.relation === 'cousin'));
  const inLaws = $derived(edges.filter((e) => /_in_law$|^in_law$/.test(e.relation)));
</script>

{#snippet personNode(person: Person, relation: string, derived: boolean = false, self: boolean = false, small: boolean = false, viaName: string | null = null, viaRelation: string | null = null)}
  {@const k = keyOf(person.id)}
  {@const focused = focusedKey === k}
  {@const linked = focusedKey !== null && focusedKey !== k && (relatedTo.get(focusedKey)?.has(k) ?? false)}
  {@const dimmed = focusedKey !== null && !focused && !linked}
  <button
    type="button"
    class="ftree-card {small ? 'ftree-card-sm' : ''}"
    data-focused={focused ? 'on' : undefined}
    data-linked={linked ? 'on' : undefined}
    data-dimmed={dimmed ? 'on' : undefined}
    title={derived ? `Inferred via ${viaName ?? 'another person'}` : 'Click for connections, double-click to open'}
    onclick={(e) => {
      e.stopPropagation();
      focusedKey = focused ? null : k;
    }}
    ondblclick={(e) => {
      // Double-click navigates to that person's page.
      e.stopPropagation();
      window.location.href = `/people/${person.id}`;
    }}
  >
    <span class="ftree-tick" aria-hidden="true"></span>
    <span class="ftree-avatar {self ? 'ring-2 ring-brand ring-offset-2 ring-offset-surface-card' : ''}">
      <Avatar
        name={personName(person)}
        src={assetUrl(person.person_picture, { width: small ? 80 : 128, height: small ? 80 : 128, fit: 'cover' })}
        size={small ? 36 : 56}
        position={person.image_focal ?? ''}
      />
    </span>
    <div class="ftree-name">{personName(person)}</div>
    <div class="ftree-rel {derived ? 'italic' : ''}">
      {self ? (isOwner ? 'You' : 'Current') : (FAMILY_LABEL[relation] ?? relation)}
    </div>
    {#if derived && viaName}
      <div class="ftree-via">
        via <strong>{viaName.split(' ')[0]}</strong>{viaRelation ? ` (${FAMILY_LABEL[viaRelation] ?? viaRelation})` : ''}
      </div>
    {/if}
  </button>
{/snippet}

<!-- A "couple" cluster used for grandparents/parents — two avatars centred
     with a gap-bar joining them. -->
{#snippet coupleCluster(items: FamilyEdge[])}
  <div class="ftree-couple" data-couple={items.length > 1 ? 'on' : 'off'}>
    {#each items as e, i (e.id + ':' + e.relation)}
      {#if i > 0}
        <span class="ftree-couple-bar" aria-hidden="true"></span>
      {/if}
      {@render personNode(e.other, e.relation, !!e.derivedVia, false, false, e.derivedVia?.name ?? null, e.derivedVia?.relation ?? null)}
    {/each}
  </div>
{/snippet}

<!-- Sibling row: cards spread under a single bus line. Used for children,
     grandchildren, and the siblings-flank in the self row. -->
{#snippet siblingFlow(items: FamilyEdge[], hideTicks: boolean = false)}
  <div class="ftree-row" data-bus={items.length > 1 ? 'on' : 'off'} data-hide-ticks={hideTicks ? 'on' : 'off'}>
    {#each items as e (e.id + ':' + e.relation)}
      {@render personNode(e.other, e.relation, !!e.derivedVia, false, false, e.derivedVia?.name ?? null, e.derivedVia?.relation ?? null)}
    {/each}
  </div>
{/snippet}

<!-- Collapsible collateral group: aunts/uncles, cousins, in-laws.
     Collapsed → stacked-avatar chip + count. Expanded → labelled aside
     of small avatar cards. The `groupKey` keys into the shared expansion
     map so each group remembers its own state independently. -->
{#snippet collapsibleGroup(groupKey: string, label: string, items: FamilyEdge[])}
  {#if items.length > 0}
    {@const expanded = !!groupExpanded[groupKey]}
    {#if expanded}
      <div class="ftree-aside ftree-aside-standalone">
        <button
          type="button"
          class="ftree-siblings-collapse"
          aria-expanded="true"
          title={`Collapse ${label.toLowerCase()}`}
          onclick={(e) => { e.stopPropagation(); groupExpanded = { ...groupExpanded, [groupKey]: false }; }}
        >
          <span class="ftree-aside-label">{label} · {items.length}</span>
          <span class="ftree-siblings-caret" aria-hidden="true">▾</span>
        </button>
        <div class="ftree-aside-row">
          {#each items as e (e.id + ':' + e.relation)}
            {@render personNode(e.other, e.relation, !!e.derivedVia, false, true, e.derivedVia?.name ?? null, e.derivedVia?.relation ?? null)}
          {/each}
        </div>
      </div>
    {:else}
      <button
        type="button"
        class="ftree-siblings-chip"
        aria-expanded="false"
        title={`${items.length} ${label.toLowerCase()} — tap to expand`}
        onclick={(e) => { e.stopPropagation(); groupExpanded = { ...groupExpanded, [groupKey]: true }; }}
      >
        <span class="ftree-siblings-stack" aria-hidden="true">
          {#each items.slice(0, 3) as e (e.id + ':' + e.relation)}
            <span class="ftree-siblings-stack-avatar">
              <Avatar
                name={personName(e.other)}
                src={assetUrl(e.other.person_picture, { width: 64, height: 64, fit: 'cover' })}
                size={28}
                position={e.other.image_focal ?? ''}
              />
            </span>
          {/each}
        </span>
        <span class="ftree-siblings-chip-label">
          {items.length} {label.toLowerCase()}
        </span>
      </button>
    {/if}
  {/if}
{/snippet}

<div
  class="ftree px-2 pb-4 pt-2 sm:px-4"
  role="presentation"
  onclick={() => (focusedKey = null)}
  onkeydown={(e) => { if (e.key === 'Escape') focusedKey = null; }}
>
  {#if focusedKey !== null}
    <div class="mb-2 text-center text-xs text-ink-500">
      Showing connections — tap anywhere outside a card to clear.
    </div>
  {/if}
  <!-- Generation +2: grandparents (centred) -->
  {#if grandparents.length > 0}
    {@render coupleCluster(grandparents)}
    {#if parents.length > 0}<div class="ftree-stem"></div>{/if}
  {/if}

  <!-- Generation +1: parents row + aunts aside (parents stay centred — the
       aside is grid-positioned to the right so it never offsets the spine). -->
  {#if parents.length > 0 || auntsUncles.length > 0}
    <div class="ftree-frame">
      <div class="ftree-frame-spacer"></div>
      <div class="ftree-frame-spine">
        {#if parents.length > 0}
          {@render coupleCluster(parents)}
        {/if}
      </div>
      <aside class="ftree-frame-aside">
        {@render collapsibleGroup('auntsUncles', 'Aunts & uncles', auntsUncles)}
      </aside>
    </div>
    {#if parents.length > 0}<div class="ftree-stem"></div>{/if}
  {/if}

  <!-- Generation 0: viewer ALWAYS at the geometric centre. Siblings sit in
       the left grid column (right-aligned, butted up against viewer);
       spouse sits in the right column (left-aligned). The 1fr/auto/1fr grid
       guarantees the auto column (viewer) lands on the spine centre. -->
  <div class="ftree-self">
    <div class="ftree-self-side ftree-self-siblings">
      {#if siblings.length > 0}
        {#if siblingsExpanded}
          <!-- Expanded: full row, but visually framed as its own group so it
               doesn't bleed into the viewer/parents axis. -->
          <div class="ftree-siblings-group">
            <button
              type="button"
              class="ftree-siblings-collapse"
              aria-expanded="true"
              title="Collapse siblings"
              onclick={(e) => { e.stopPropagation(); siblingsExpanded = false; }}
            >
              <span class="ftree-aside-label">Siblings · {siblings.length}</span>
              <span class="ftree-siblings-caret" aria-hidden="true">▾</span>
            </button>
            <div class="ftree-aside-row">
              {#each siblings as e (e.id + ':' + e.relation)}
                {@render personNode(e.other, e.relation, !!e.derivedVia, false, true, e.derivedVia?.name ?? null, e.derivedVia?.relation ?? null)}
              {/each}
            </div>
          </div>
        {:else}
          <!-- Collapsed: stacked avatar chip with a count. Tap to expand. -->
          <button
            type="button"
            class="ftree-siblings-chip"
            aria-expanded="false"
            title={`${siblings.length} sibling${siblings.length === 1 ? '' : 's'} — tap to expand`}
            onclick={(e) => { e.stopPropagation(); siblingsExpanded = true; }}
          >
            <span class="ftree-siblings-stack" aria-hidden="true">
              {#each siblings.slice(0, 3) as e (e.id + ':' + e.relation)}
                <span class="ftree-siblings-stack-avatar">
                  <Avatar
                    name={personName(e.other)}
                    src={assetUrl(e.other.person_picture, { width: 64, height: 64, fit: 'cover' })}
                    size={28}
                    position={e.other.image_focal ?? ''}
                  />
                </span>
              {/each}
            </span>
            <span class="ftree-siblings-chip-label">
              {siblings.length} {siblings.length === 1 ? 'sibling' : 'siblings'}
            </span>
          </button>
        {/if}
      {/if}
    </div>
    <div class="ftree-self-center" data-spouse={spouses.length > 0 ? 'on' : 'off'}>
      {@render personNode(viewer, 'self', false, true)}
    </div>
    <div class="ftree-self-side ftree-self-spouse">
      {#if spouses.length > 0}
        {#each spouses as e (e.id + ':' + e.relation)}
          {@render personNode(e.other, e.relation, !!e.derivedVia, false, false, e.derivedVia?.name ?? null, e.derivedVia?.relation ?? null)}
        {/each}
      {/if}
    </div>
  </div>

  <!-- Generation -1: children — centred under viewer -->
  {#if children.length > 0}
    <div class="ftree-stem"></div>
    {@render siblingFlow(children)}
  {/if}

  <!-- Generation -2: grandchildren -->
  {#if grandchildren.length > 0}
    <div class="ftree-stem"></div>
    {@render siblingFlow(grandchildren)}
  {/if}

  <!-- Side branches (cousins + in-laws): own appendix below the spine. -->
  {#if cousins.length > 0 || inLaws.length > 0}
    <div class="mt-5 w-full border-t border-surface-divider pt-3 flex flex-wrap gap-2 justify-center">
      {@render collapsibleGroup('cousins', 'Cousins', cousins)}
      {@render collapsibleGroup('inLaws', 'In-laws', inLaws)}
    </div>
  {/if}

  {#if grandparents.length === 0 && parents.length === 0 && auntsUncles.length === 0 && siblings.length === 0 && spouses.length === 0 && children.length === 0 && grandchildren.length === 0 && cousins.length === 0 && inLaws.length === 0}
    <div class="mt-2 text-center text-xs text-ink-400">
      No relations yet. Switch to the List view and click <strong>Add relation</strong> to start.
    </div>
  {/if}
</div>

<style>
  .ftree {
    --line: 1.5px solid #C6CCD4;
    --line-strong: 2px solid #98A1AE;
    --tick-h: 14px;
    --row-gap: 1rem;
    --stem-h: 18px;
    --avatar: 56px;
    --avatar-sm: 36px;
    overflow-x: auto;
  }

  /* Spine row layout: cards under a centred bus line. nowrap so the bus
     line and per-card ticks always align — when there are too many siblings
     to fit, the row scrolls horizontally inside the .ftree container. */
  .ftree :global(.ftree-row) {
    position: relative;
    display: flex;
    flex-wrap: nowrap;
    justify-content: center;
    align-items: flex-start;
    gap: var(--row-gap);
    padding-top: var(--tick-h);
    margin-top: 2px;
  }
  @media (max-width: 479px) {
    .ftree :global(.ftree-row) {
      flex-wrap: wrap;
    }
  }
  .ftree :global(.ftree-row[data-bus='on'])::before {
    content: '';
    position: absolute;
    top: 0;
    left: calc(var(--avatar) / 2 + 0.5rem);
    right: calc(var(--avatar) / 2 + 0.5rem);
    border-top: var(--line);
  }

  /* Vertical stem between two spine generations. */
  .ftree :global(.ftree-stem) {
    width: 0;
    height: var(--stem-h);
    margin: 0 auto;
    border-left: var(--line-strong);
  }

  /* Couple cluster: two avatars side-by-side joined by a gap-only bar. */
  .ftree :global(.ftree-couple) {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    gap: 0;
  }
  .ftree :global(.ftree-couple-bar) {
    margin-top: calc(var(--tick-h) + var(--avatar) / 2);
    width: var(--row-gap);
    height: 0;
    border-top: var(--line);
    flex: 0 0 auto;
  }

  /* Cards. */
  .ftree :global(.ftree-card) {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    width: 5rem;
    flex-shrink: 0;
  }
  @media (min-width: 640px) {
    .ftree :global(.ftree-card) { width: 6rem; }
  }
  .ftree :global(.ftree-card-sm) { width: 4rem; }
  @media (min-width: 640px) {
    .ftree :global(.ftree-card-sm) { width: 4.5rem; }
  }

  .ftree :global(.ftree-tick) {
    position: absolute;
    top: calc(-1 * var(--tick-h));
    left: 50%;
    height: var(--tick-h);
    border-left: var(--line);
  }
  .ftree :global(.ftree-row[data-bus='off'] .ftree-tick),
  .ftree :global(.ftree-row[data-hide-ticks='on'] .ftree-tick),
  .ftree :global(.ftree-aside .ftree-tick),
  .ftree :global(.ftree-couple .ftree-tick) {
    display: none;
  }

  .ftree :global(.ftree-avatar) { border-radius: 9999px; position: relative; }
  .ftree :global(.ftree-name) {
    max-width: 5rem;
    text-align: center;
    font-size: 11px;
    font-weight: 500;
    line-height: 1.15;
    color: #0F172A;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  @media (min-width: 640px) {
    .ftree :global(.ftree-name) { max-width: 6rem; }
  }
  .ftree :global(.ftree-card-sm .ftree-name) {
    max-width: 4rem; font-size: 10px;
  }
  .ftree :global(.ftree-rel) { font-size: 10px; color: #7A8593; }
  .ftree :global(.ftree-rel.italic) { font-style: italic; }

  /* ── Parents-row frame: 3-col grid keeps the spine perfectly centred,
        with the aunts aside floating in the right column. The middle 'auto'
        column is the spine slot — geometrically dead-centre. -->         */
  .ftree :global(.ftree-frame) {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: start;
    column-gap: 1rem;
  }
  .ftree :global(.ftree-frame-spine) { justify-self: center; }
  .ftree :global(.ftree-frame-aside) { justify-self: start; min-width: 0; }
  .ftree :global(.ftree-frame-spacer) { /* empty 1fr — balances the right column to keep the spine centred */ }

  /* On mobile, stack: spacer hides, aside drops below the spine. */
  @media (max-width: 767px) {
    .ftree :global(.ftree-frame) {
      grid-template-columns: 1fr;
    }
    .ftree :global(.ftree-frame-spacer) { display: none; }
    .ftree :global(.ftree-frame-aside) { justify-self: center; margin-top: 0.5rem; }
  }

  /* ── Self row: VIEWER ALWAYS AT GEOMETRIC CENTRE.
        Same 1fr/auto/1fr trick — auto column holds viewer, the two 1fr
        columns absorb equal space, so viewer pins to the page centre
        regardless of how many siblings or spouses surround them.        */
  .ftree :global(.ftree-self) {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: start;
    column-gap: 1rem;
    margin-top: 2px;
  }
  @media (max-width: 479px) {
    .ftree :global(.ftree-self) {
      grid-template-columns: 1fr;
      justify-items: center;
      row-gap: 0.75rem;
    }
  }
  .ftree :global(.ftree-self-side) {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    flex-wrap: wrap;
    justify-content: center;
  }
  .ftree :global(.ftree-self-siblings) {
    justify-self: end;
    flex-direction: row-reverse;
  }
  @media (max-width: 479px) {
    .ftree :global(.ftree-self-siblings) {
      justify-self: center;
      flex-direction: row;
    }
  }
  .ftree :global(.ftree-self-spouse) {
    justify-self: start;
  }
  @media (max-width: 479px) {
    .ftree :global(.ftree-self-spouse) {
      justify-self: center;
    }
  }
  .ftree :global(.ftree-self-center) {
    position: relative;
    justify-self: center;
  }

  /* Couple bar from viewer to first spouse — bridges the grid gap on the
     right side of the centre cell, never crossing viewer's avatar. */
  .ftree :global(.ftree-self-center[data-spouse='on'])::after {
    content: '';
    position: absolute;
    top: calc(var(--tick-h) + var(--avatar) / 2);
    left: 100%;
    width: 1rem;
    border-top: var(--line);
  }
  @media (max-width: 479px) {
    .ftree :global(.ftree-self-center[data-spouse='on'])::after {
      display: none;
    }
  }

  /* ── Aside (collateral relatives): smaller cards, dashed neutral panel. */
  .ftree :global(.ftree-aside) {
    padding: 0.5rem 0.75rem;
    border-radius: 12px;
    background: rgba(248, 250, 252, 0.7);
    border: 1px dashed rgba(198, 204, 212, 0.7);
    max-width: max-content;
  }
  .ftree :global(.ftree-aside-standalone) {
    margin-left: auto;
    margin-right: auto;
  }
  .ftree :global(.ftree-aside-label) {
    text-align: center;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #98A1AE;
    margin-bottom: 0.25rem;
  }
  .ftree :global(.ftree-aside-row) {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: flex-start;
    gap: 0.5rem;
  }

  /* Cards are <button> now — strip browser button chrome. */
  .ftree :global(.ftree-card) {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0.25rem;
    border-radius: 12px;
    transition: background-color 150ms ease, transform 150ms ease, opacity 150ms ease;
  }
  .ftree :global(.ftree-card:hover:not([data-dimmed='on'])) {
    background-color: rgba(44, 140, 153, 0.06);
  }
  .ftree :global(.ftree-card:focus-visible) {
    outline: 2px solid #2C8C99;
    outline-offset: 2px;
  }

  /* Highlight states drive the "show me who's connected" interaction.
     Click a card → it becomes focused (brand ring), every related card
     (parents, children, derivation chain) lights up too, everyone else
     fades to 35% opacity so the eye locks onto the chain. */
  .ftree :global(.ftree-card[data-focused='on']) {
    background-color: rgba(44, 140, 153, 0.10);
  }
  .ftree :global(.ftree-card[data-focused='on'] .ftree-avatar) {
    box-shadow: 0 0 0 2px #2C8C99, 0 0 0 4px rgba(44, 140, 153, 0.25);
    border-radius: 9999px;
  }
  .ftree :global(.ftree-card[data-linked='on'] .ftree-avatar) {
    box-shadow: 0 0 0 2px rgba(44, 140, 153, 0.55);
    border-radius: 9999px;
  }
  .ftree :global(.ftree-card[data-dimmed='on']) {
    opacity: 0.35;
  }

  /* ── Siblings as a sidecar group, not a peer row of the parents.
        Collapsed: stacked-avatar chip with a count.
        Expanded: dashed aside aligned with the viewer's avatar, never
        on the parents-children spine. */
  .ftree :global(.ftree-siblings-chip) {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0.625rem 0.25rem 0.25rem;
    background: rgba(248, 250, 252, 0.7);
    border: 1px dashed rgba(198, 204, 212, 0.7);
    border-radius: 9999px;
    cursor: pointer;
    transition: background-color 150ms ease, border-color 150ms ease;
    /* Pull the chip up so it lines up with the viewer's avatar, not the
       relation label. */
    margin-top: 0.5rem;
  }
  .ftree :global(.ftree-siblings-chip:hover) {
    background-color: rgba(44, 140, 153, 0.06);
    border-color: rgba(44, 140, 153, 0.45);
  }
  .ftree :global(.ftree-siblings-chip:focus-visible) {
    outline: 2px solid #2C8C99;
    outline-offset: 2px;
  }
  .ftree :global(.ftree-siblings-stack) {
    display: inline-flex;
    align-items: center;
  }
  .ftree :global(.ftree-siblings-stack-avatar) {
    display: inline-flex;
    border-radius: 9999px;
    box-shadow: 0 0 0 2px #FFFFFF;
  }
  .ftree :global(.ftree-siblings-stack-avatar + .ftree-siblings-stack-avatar) {
    margin-left: -0.5rem;
  }
  .ftree :global(.ftree-siblings-chip-label) {
    font-size: 11px;
    font-weight: 500;
    color: #5F6B7A;
    white-space: nowrap;
  }

  /* Expanded sibling group — own labelled aside, separates them visually
     from the parents-children spine. */
  .ftree :global(.ftree-siblings-group) {
    padding: 0.5rem 0.75rem;
    border-radius: 12px;
    background: rgba(248, 250, 252, 0.7);
    border: 1px dashed rgba(198, 204, 212, 0.7);
    max-width: max-content;
  }
  .ftree :global(.ftree-siblings-collapse) {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    width: 100%;
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0 0 0.25rem;
  }
  .ftree :global(.ftree-siblings-caret) {
    font-size: 10px;
    color: #98A1AE;
  }

  /* "via X" label on derived edges — explicit lineage breadcrumb. */
  .ftree :global(.ftree-via) {
    font-size: 9.5px;
    color: #98A1AE;
    text-align: center;
    line-height: 1.2;
    margin-top: -0.15rem;
  }
  .ftree :global(.ftree-via strong) {
    color: #5F6B7A;
    font-weight: 600;
  }
</style>
