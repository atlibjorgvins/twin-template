<script lang="ts">
  /**
   * Quick-log chip row. Drops onto every entity detail page (and the
   * Today dashboard) and gives a one-tap interaction log: "I just had
   * coffee with X" becomes a single click instead of an 8-field form.
   *
   * Each chip is bound to an ActivityKind row from the dynamic
   * catalogue (loaded once via `listActivityKinds`). Clicking a chip:
   *   1. Optimistically creates an Activity at `now()` with the
   *      current entity attached (Person via Activity_Person, Org and
   *      Project via direct M2O fields).
   *   2. Replaces the chip row with a transient "Logged — Undo" pill
   *      for ~5 s; pressing Undo deletes the freshly-created row.
   *   3. Fires `onLogged(activity)` so the parent can prepend to its
   *      activity list without a refetch.
   */
  import Icon from '$lib/Icon.svelte';
  import type { IconName } from '$lib/icon-types';
  import {
    createActivity,
    deleteActivity,
    attachPersonToActivity,
    listActivityKinds,
    type Activity,
    type ActivityKind
  } from '$lib/directus';
  import { scope } from '$lib/scope';

  // New interactions inherit the active Work/Private mode (unless the kind
  // pins its own scope). 'all' means untagged.
  const scopeDefault = $derived($scope === 'all' ? null : $scope);

  type Context =
    /** `morePersonIds` lets a single log attach several people at once
     *  (e.g. the "Log an interaction" sheet with multiple attendees). */
    | { kind: 'person'; personId: number; morePersonIds?: number[] }
    | { kind: 'organization'; orgId: number }
    | { kind: 'project'; projectId: number }
    /** Free-floating log — no entity attached. Used by the Today dashboard. */
    | { kind: 'standalone' };

  type Props = {
    context: Context;
    /** Max chips rendered. */
    limit?: number;
    /** Override which kinds appear; otherwise we pick the first `limit` by sort order. */
    keys?: string[];
    /** Optimistic-merge callback for the parent's activity list. */
    onLogged?: (a: Activity) => void;
  };

  let {
    context,
    limit = 5,
    keys = ['coffee', 'ran_into', 'call', 'meeting', 'mentoring'],
    onLogged
  }: Props = $props();

  let kinds = $state<ActivityKind[]>([]);
  let loading = $state(true);
  let error = $state('');

  // "Other" — log a free-text interaction that isn't one of the preset
  // chips. Reveals an inline text field; submitting logs it like a chip.
  let otherMode = $state(false);
  let otherText = $state('');
  let otherBusy = $state(false);

  // Location — one-tap GPS capture, reverse-geocoded to a place label when
  // possible (falls back to "lat, lng"). Attached to whatever is logged next.
  let location = $state<string | null>(null);
  let locating = $state(false);
  let locError = $state('');

  // Visible chips, in `keys` order when provided, falling back to `sort`.
  const visible = $derived.by<ActivityKind[]>(() => {
    if (kinds.length === 0) return [];
    if (keys && keys.length > 0) {
      const byKey: Record<string, ActivityKind> = {};
      for (const k of kinds) byKey[k.key] = k;
      const picked = keys.map((k) => byKey[k]).filter(Boolean) as ActivityKind[];
      if (picked.length >= limit) return picked.slice(0, limit);
      // Pad with remaining kinds in `sort` order so the row stays full
      // even if a `keys` entry doesn't exist in the catalogue.
      const fillers = kinds.filter((k) => !keys.includes(k.key));
      return [...picked, ...fillers].slice(0, limit);
    }
    return kinds.slice(0, limit);
  });

  $effect(() => { void loadKinds(); });
  async function loadKinds() {
    loading = true;
    try {
      kinds = await listActivityKinds();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  // ─── Undo state ────────────────────────────────────────────────────────
  // After a successful log we keep the row visible as an "Undo" pill for
  // a few seconds; the timer is cancelled if the user logs something
  // else in the meantime (each click resets the window).
  let lastLog = $state<{ activity: Activity; kind: ActivityKind } | null>(null);
  let undoTimer: ReturnType<typeof setTimeout> | null = null;
  const UNDO_MS = 5000;

  function startUndoWindow(activity: Activity, kind: ActivityKind) {
    lastLog = { activity, kind };
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = setTimeout(() => {
      lastLog = null;
      undoTimer = null;
    }, UNDO_MS);
  }

  // Reverse-geocode coords to a concise place label via OpenStreetMap
  // Nominatim. Best-effort with a short timeout; returns null on any issue
  // so the caller can fall back to raw coordinates.
  async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const r = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&lat=${lat}&lon=${lng}`,
        { signal: ctrl.signal, headers: { Accept: 'application/json' } }
      );
      clearTimeout(t);
      if (!r.ok) return null;
      const j = await r.json();
      const a = j.address ?? {};
      const street = a.house_number && a.road ? `${a.road} ${a.house_number}` : a.road;
      const place = a.city || a.town || a.village || a.suburb || a.municipality;
      const parts = [j.name, street, place].filter(Boolean);
      const label = [...new Set(parts)].slice(0, 2).join(', ');
      return label || (typeof j.display_name === 'string' ? j.display_name.split(',').slice(0, 2).join(', ') : null);
    } catch {
      return null;
    }
  }

  async function captureLocation() {
    if (locating) return;
    locError = '';
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      locError = 'Location not available';
      return;
    }
    locating = true;
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 60000
        })
      );
      const { latitude: lat, longitude: lng } = pos.coords;
      const name = await reverseGeocode(lat, lng);
      location = name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    } catch (e) {
      locError = (e as GeolocationPositionError)?.code === 1 ? 'Permission denied' : "Couldn't get location";
    } finally {
      locating = false;
    }
  }

  // Attach every person in the context (primary + any extras) to a freshly
  // logged activity. Failures are non-fatal — the row is already logged and
  // links can be fixed on the detail page.
  async function attachContextPeople(activityId: number) {
    if (context.kind !== 'person') return;
    const ids = [context.personId, ...(context.morePersonIds ?? [])];
    for (const pid of ids) {
      try { await attachPersonToActivity(activityId, pid); } catch { /* recoverable */ }
    }
  }

  async function clickChip(kind: ActivityKind) {
    error = '';
    const occurredAt = new Date().toISOString();
    const payload: Parameters<typeof createActivity>[0] = {
      title: kind.label,
      kind: kind.key,
      kind_id: kind.id,
      significance: kind.default_significance ?? 'normal',
      occurred_at: occurredAt,
      scope: kind.scope ?? scopeDefault,
      location: location ?? null,
      organization_id: context.kind === 'organization' ? context.orgId : null,
      project_id: context.kind === 'project' ? context.projectId : null
    } as Parameters<typeof createActivity>[0];

    try {
      const created = await createActivity(payload);
      await attachContextPeople(created.id);
      // Decorate the activity so the parent renders the kind chip with
      // emoji/color without a second fetch.
      const decorated: Activity = { ...created, kind_id: kind } as Activity;
      onLogged?.(decorated);
      startUndoWindow(decorated, kind);
      location = null; locError = '';
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  // Log a free-text "Other" interaction. Mirrors clickChip but takes the
  // title from the text field and uses the catalogue's 'other' kind if it
  // exists (else a bare 'other' string kind).
  async function submitOther() {
    const title = otherText.trim();
    if (!title || otherBusy) return;
    otherBusy = true;
    error = '';
    const otherKind = kinds.find((k) => k.key === 'other') ?? null;
    const payload = {
      title,
      kind: otherKind?.key ?? 'other',
      kind_id: otherKind?.id ?? null,
      significance: 'normal',
      occurred_at: new Date().toISOString(),
      scope: scopeDefault,
      location: location ?? null,
      organization_id: context.kind === 'organization' ? context.orgId : null,
      project_id: context.kind === 'project' ? context.projectId : null
    } as Parameters<typeof createActivity>[0];
    try {
      const created = await createActivity(payload);
      await attachContextPeople(created.id);
      const decorated: Activity = { ...created, kind_id: otherKind } as Activity;
      onLogged?.(decorated);
      // Undo strip shows the typed title as the label.
      const pseudo = {
        id: otherKind?.id ?? -1,
        key: 'other',
        label: title,
        icon: otherKind?.icon,
        emoji: otherKind?.emoji ?? '📝',
        color: otherKind?.color
      } as ActivityKind;
      otherMode = false;
      otherText = '';
      startUndoWindow(decorated, pseudo);
      location = null; locError = '';
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      otherBusy = false;
    }
  }

  async function undoLast() {
    if (!lastLog) return;
    const { activity } = lastLog;
    if (undoTimer) { clearTimeout(undoTimer); undoTimer = null; }
    lastLog = null;
    try {
      await deleteActivity(activity.id);
      // Tell the parent to drop the optimistically-added row.
      onLogged?.({ ...activity, status: '__deleted__' } as Activity);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
</script>

<div
  class="quick-log-chips"
  style="background: var(--bg-secondary); border: 1px solid var(--border-subtle); border-radius: var(--radius-md);"
>
  {#snippet locationChip()}
    {#if location}
      <span
        class="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium"
        style="border-radius: var(--radius-pill); background: var(--accent-alpha-10); color: var(--accent-electric); border: 1px solid var(--accent-alpha-30);"
        title={location}
      >
        <Icon name="globe" size={14} />
        <span class="max-w-[150px] truncate">{location}</span>
        <button type="button" class="ml-0.5 hover:opacity-70" aria-label="Clear location" onclick={() => { location = null; locError = ''; }}>
          <Icon name="x" size={11} />
        </button>
      </span>
    {:else}
      <button
        type="button"
        class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition disabled:opacity-60"
        style="border: 1px dashed var(--border-subtle); border-radius: var(--radius-pill); background: var(--bg-tertiary); color: var(--text-secondary);"
        title="Attach your current GPS location"
        disabled={locating}
        onclick={captureLocation}
      >
        <Icon name="globe" size={14} /> {locating ? 'Locating…' : 'Location'}
      </button>
    {/if}
  {/snippet}

  {#if loading}
    <div class="px-3 py-2 text-xs text-ink-400">Loading kinds…</div>
  {:else if lastLog}
    <!-- Undo strip — full row swap so the chips don't shift around mid-click. -->
    <div class="flex items-center justify-between gap-3 px-3 py-2 text-sm">
      <span class="inline-flex items-center gap-1.5">
        {#if lastLog.kind.icon}
          <Icon name={lastLog.kind.icon as IconName} size={14} />
        {:else}
          <span aria-hidden="true">{lastLog.kind.emoji ?? '✓'}</span>
        {/if}
        Logged <strong>{lastLog.kind.label}</strong>
      </span>
      <button
        type="button"
        class="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium"
        style="border: 1px solid var(--border-subtle); border-radius: var(--radius-pill); color: var(--accent-electric);"
        onclick={undoLast}
      >↩ Undo</button>
    </div>
  {:else if otherMode}
    <!-- Free-text "Other" log. -->
    <div class="flex flex-col gap-1.5 p-2">
      <div class="flex items-center gap-1.5">
        <!-- svelte-ignore a11y_autofocus -->
        <input
          type="text"
          class="min-w-0 flex-1 rounded-full px-3 py-1 text-xs"
          style="border: 1px solid var(--border-subtle); background: var(--bg-tertiary); color: var(--text-primary);"
          placeholder="What happened? (e.g. lunch, intro email)"
          bind:value={otherText}
          autofocus
          onkeydown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void submitOther(); }
            else if (e.key === 'Escape') { otherMode = false; otherText = ''; }
          }}
        />
        <button
          type="button"
          class="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium"
          style="border-radius: var(--radius-pill); background: var(--accent-electric); color: var(--accent-text);"
          disabled={otherBusy || !otherText.trim()}
          onclick={submitOther}
        >{otherBusy ? '…' : 'Log'}</button>
        <button
          type="button"
          class="nav-icon"
          aria-label="Cancel"
          onclick={() => { otherMode = false; otherText = ''; }}
        ><Icon name="x" size={14} /></button>
      </div>
      <div class="flex flex-wrap items-center gap-1.5">
        {@render locationChip()}
      </div>
    </div>
  {:else}
    <div class="flex flex-wrap items-center gap-1.5 p-2">
      <span class="px-1 font-display text-[10px] uppercase tracking-wider text-ink-400">
        Quick log
      </span>
      {#each visible as kind (kind.id)}
        <button
          type="button"
          class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition"
          style={`border: 1px solid var(--border-subtle); border-radius: var(--radius-pill); ${kind.color ? `background: ${kind.color}1a; color: ${kind.color};` : 'background: var(--bg-tertiary); color: var(--text-secondary);'}`}
          title={`Log ${kind.label.toLowerCase()} now`}
          onclick={() => clickChip(kind)}
        >
          {#if kind.icon}
            <Icon name={kind.icon as IconName} size={14} />
          {:else if kind.emoji}
            <span aria-hidden="true">{kind.emoji}</span>
          {/if}
          {kind.label}
        </button>
      {/each}
      <button
        type="button"
        class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition"
        style="border: 1px dashed var(--border-subtle); border-radius: var(--radius-pill); background: var(--bg-tertiary); color: var(--text-secondary);"
        title="Log something else"
        onclick={() => { otherMode = true; otherText = ''; }}
      >
        <Icon name="plus" size={14} /> Other
      </button>
      {@render locationChip()}
    </div>
  {/if}
  {#if error || locError}
    <div
      class="mx-2 mb-2 px-3 py-1 text-xs"
      style="color: var(--state-danger); border: 1px solid var(--border-subtle); border-radius: var(--radius-md);"
    >{error || locError}</div>
  {/if}
</div>
