<script lang="ts">
  import Icon from '$lib/Icon.svelte';
  import type { IconName } from '$lib/icon-types';
  import {
    domainFromOrg,
    googleFaviconUrl,
    iconHorseUrl,
    logoCandidates,
    searchLinks,
    enrichOrgFromWeb,
    type EnrichResult
  } from '$lib/orgEnrich';
  import { updateOrg, uploadFromUrl, deleteDirectusFile, assetUrl, type Organization } from '$lib/directus';

  type Props = {
    org: Organization;
    open: boolean;
    onClose: () => void;
    onUpdated: (patch: Partial<Organization>) => void;
  };
  let { org, open = $bindable(false), onClose, onUpdated }: Props = $props();

  // ─── Derived ────────────────────────────────────────────────────────────
  const domain = $derived(domainFromOrg(org));
  const links = $derived(searchLinks(org));
  const suggestedWebsite = $derived(domain && !org.website ? `https://${domain}` : null);

  let logoBusy = $state(false);
  let websiteBusy = $state(false);
  let error = $state('');
  let logoPreviewBust = $state(0); // forces <img> to re-fetch after upload
  let manualUrl = $state('');
  let manualBusy = $state(false);

  // ─── Auto-fill state ────────────────────────────────────────────────────
  let autoBusy = $state(false);
  let autoResult = $state<EnrichResult | null>(null);
  let picked = $state<Record<string, boolean>>({});
  let applying = $state(false);

  // Friendly labels for the suggestion fields
  const FIELD_LABELS: Record<string, string> = {
    kennitala: 'Kennitala',
    legal_name: 'Legal name',
    founded_year: 'Founded',
    address_line1: 'Street address',
    address_line2: 'Address line 2',
    postal_code: 'Postal code',
    city: 'City',
    state_province: 'State / region',
    country: 'Country',
    org_type: 'Legal form',
    enrichment_notes: 'Description',
    opencorporates_url: 'OpenCorporates URL'
  };

  // Wikipedia data isn't useful here — we never use the description or
  // the Wikipedia URL on org records — so we drop those fields and the
  // Wikipedia fetched-indicator client-side. The server extension still
  // queries Wikipedia (changing that is a separate deploy); we just
  // don't surface its output.
  function isWikipediaField(field: string, sources: Record<string, string> | undefined): boolean {
    if (field === 'wikipedia_url') return true;
    const src = sources?.[field]?.toLowerCase() ?? '';
    return src.includes('wikipedia');
  }

  async function autoFill() {
    autoBusy = true;
    autoResult = null;
    error = '';
    try {
      const r = await enrichOrgFromWeb(org.id);
      // Strip Wikipedia-sourced suggestions before showing the picker.
      const suggestions: Record<string, string | number | null> = {};
      for (const [k, v] of Object.entries(r.suggestions)) {
        if (!isWikipediaField(k, r.sources)) suggestions[k] = v;
      }
      const fetched: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(r.fetched)) {
        if (!k.toLowerCase().includes('wikipedia')) fetched[k] = v;
      }
      autoResult = { ...r, suggestions, fetched };
      // Default: tick everything we kept.
      const initial: Record<string, boolean> = {};
      for (const k of Object.keys(suggestions)) initial[k] = true;
      picked = initial;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      autoBusy = false;
    }
  }

  async function applyPicked() {
    if (!autoResult) return;
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(autoResult.suggestions)) {
      if (picked[k]) patch[k] = v;
    }
    if (Object.keys(patch).length === 0) return;
    applying = true;
    error = '';
    try {
      const updated = await updateOrg(org.id, patch as never);
      onUpdated(updated);
      autoResult = null;
      picked = {};
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      applying = false;
    }
  }

  // ─── Actions ────────────────────────────────────────────────────────────
  async function grabLogoFromCandidates() {
    if (!domain) return;
    error = '';
    logoBusy = true;
    const tried: string[] = [];
    try {
      const candidates = logoCandidates(domain, 512);
      let lastErr: unknown = null;
      for (const url of candidates) {
        tried.push(new URL(url).host);
        try {
          const result = await uploadFromUrl(url, {
            title: `${org.name ?? domain} logo`
          });
          // Some servers return their homepage HTML with status 200 when an
          // icon path doesn't exist. Validate that what we got is actually
          // an image, otherwise roll the bad file back and try the next.
          if (result.type && !result.type.startsWith('image/')) {
            await deleteDirectusFile(result.id).catch(() => {});
            lastErr = new Error(`Got ${result.type} instead of an image`);
            continue;
          }
          if (typeof result.filesize === 'number' && result.filesize < 200) {
            // Suspiciously tiny — probably a 1×1 transparent placeholder.
            await deleteDirectusFile(result.id).catch(() => {});
            lastErr = new Error(`File is only ${result.filesize}B`);
            continue;
          }
          const patch = await updateOrg(org.id, { logo: result.id });
          onUpdated({ ...patch, logo: result.id });
          logoPreviewBust++;
          return; // success — stop walking the candidate list
        } catch (e) {
          lastErr = e;
          // try the next candidate
        }
      }
      // All sources failed.
      const reason = lastErr instanceof Error ? lastErr.message : String(lastErr);
      error =
        `Couldn't grab a usable logo for ${domain}. Tried ${tried.join(', ')}.\n` +
        `Last issue: ${reason}\n\n` +
        `Use "Paste an image URL" below — open the site, right-click the logo, copy image address.`;
    } finally {
      logoBusy = false;
    }
  }

  async function grabFromManualUrl() {
    const url = manualUrl.trim();
    if (!url) return;
    error = '';
    manualBusy = true;
    try {
      const result = await uploadFromUrl(url, {
        title: `${org.name ?? domain ?? 'org'} logo`
      });
      if (result.type && !result.type.startsWith('image/')) {
        await deleteDirectusFile(result.id).catch(() => {});
        throw new Error(`That URL returned ${result.type}, not an image. Make sure you copied the image URL itself, not the page URL.`);
      }
      const patch = await updateOrg(org.id, { logo: result.id });
      onUpdated({ ...patch, logo: result.id });
      logoPreviewBust++;
      manualUrl = '';
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      manualBusy = false;
    }
  }

  async function applySuggestedWebsite() {
    if (!suggestedWebsite) return;
    error = '';
    websiteBusy = true;
    try {
      const patch = await updateOrg(org.id, { website: suggestedWebsite });
      onUpdated(patch);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      websiteBusy = false;
    }
  }

  function close() {
    open = false;
    onClose?.();
  }
</script>

{#if open}
  <div
    class="fixed inset-0 z-40 flex items-end justify-center bg-ink-900/40 p-0 sm:items-center sm:p-4"
    role="dialog"
    aria-modal="true"
    aria-label="Enrich organization"
    onclick={close}
    onkeydown={(e) => e.key === 'Escape' && close()}
    tabindex="-1"
  >
    <div
      class="card w-full max-w-md rounded-b-none rounded-t-card max-h-[92vh] overflow-y-auto scroll-momentum p-5 pb-safe-plus-2 sm:max-h-[85vh] sm:rounded-card sm:pb-5"
      role="document"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
      tabindex="-1"
    >
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="card-title"><Icon name="sparkles" size={16} /> Enrich {org.name ?? 'this org'}</div>
          <div class="mt-0.5 text-xs text-ink-500">
            {#if domain}
              Detected domain: <code class="font-medium text-ink-900">{domain}</code>
            {:else}
              No domain found in email or website. Add one to unlock auto-enrichment.
            {/if}
          </div>
        </div>
        <button class="btn-ghost !px-2" onclick={close} aria-label="Close">×</button>
      </div>

      {#if error}
        <div class="mt-3 whitespace-pre-line rounded-md border border-tag-sales bg-tag-sales/30 px-3 py-2 text-xs text-tag-salesText">
          {error}
        </div>
      {/if}

      <!-- Auto-fill from web (RSK / OpenCorporates via Directus
           extension). The server extension's Wikipedia branch is
           intentionally filtered out — the description and wiki
           URL it returns are not accurate enough for our records. -->
      <div class="mt-4 space-y-2">
        <div class="muted-label">Auto-fill from the web</div>
        {#if !autoResult}
          <button
            class="btn-primary w-full !py-2"
            onclick={autoFill}
            disabled={autoBusy}
          >
            <Icon name="sparkles" size={14} />
            {autoBusy ? 'Searching…' : `Search company registers for ${org.name ?? 'this org'}`}
          </button>
          <div class="text-[11px] leading-snug text-ink-400">
            Pulls from <strong>RSK / Fyrirtækjaskrá</strong> (kennitala, legal name, address, founded year, legal form — direct hit when the org already has a kennitala) and <strong>OpenCorporates</strong> (international fallback; needs <code>OPENCORPORATES_API_KEY</code> in <code>docker-compose.yml</code> beyond 50 lookups/day).
          </div>
        {:else}
          <div class="rounded-[10px] border border-surface-divider p-3">
            <div class="flex items-start justify-between gap-2">
              <div class="text-sm">
                <span class="font-medium text-ink-900">Suggestions for "{autoResult.query}"</span>
                <div class="mt-0.5 text-xs text-ink-500">
                  {#each Object.entries(autoResult.fetched) as [src, ok]}
                    <span class="mr-2 inline-flex items-center gap-1">
                      <span class="inline-block h-1.5 w-1.5 rounded-full {ok ? 'bg-tag-nutritionText' : 'bg-tag-salesText'}"></span>
                      {src}
                    </span>
                  {/each}
                </div>
              </div>
              <button class="text-xs text-ink-400 hover:text-ink-700" onclick={() => (autoResult = null)}>×</button>
            </div>

            {#if Object.keys(autoResult.suggestions).length === 0}
              <div class="mt-2 text-xs text-ink-500">
                Nothing new to suggest. The org already has these fields set, or no source returned data.
              </div>
            {:else}
              <ul class="mt-2 space-y-1.5">
                {#each Object.entries(autoResult.suggestions) as [k, v]}
                  <li class="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      class="mt-0.5 h-4 w-4 rounded border-surface-border text-brand focus:ring-brand"
                      checked={picked[k]}
                      onchange={(e) => (picked = { ...picked, [k]: (e.currentTarget as HTMLInputElement).checked })}
                    />
                    <div class="min-w-0 flex-1">
                      <div class="text-xs font-medium text-ink-500">{FIELD_LABELS[k] ?? k}</div>
                      <div class="break-words text-sm text-ink-900">{v}</div>
                    </div>
                  </li>
                {/each}
              </ul>
              <button
                class="btn-primary mt-3 w-full !py-2"
                onclick={applyPicked}
                disabled={applying || Object.values(picked).every((p) => !p)}
              >
                {applying ? 'Applying…' : 'Apply selected'}
              </button>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Auto fixes -->
      {#if domain}
        <div class="mt-4 space-y-2">
          <div class="muted-label">Auto-grab</div>

          <!-- Logo — tries the site's apple-touch-icon, icon.horse,
               DuckDuckGo and Google favicon in order. Clearbit's free
               Logo API used to lead this list but has been shut down. -->
          <div class="flex items-center gap-3 rounded-[10px] border border-surface-divider p-3">
            <div class="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-hover">
              <img
                src={`${iconHorseUrl(domain)}?_=${logoPreviewBust}`}
                alt=""
                class="h-12 w-12 object-contain"
                onerror={(e) => ((e.currentTarget as HTMLImageElement).src = googleFaviconUrl(domain, 64))}
              />
            </div>
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium text-ink-900">Grab logo from site</div>
              <div class="truncate text-xs text-ink-500">
                {#if org.logo}
                  Already set — this will replace it.
                {:else}
                  Tries apple-touch-icon → icon.horse → favicon.
                {/if}
              </div>
            </div>
            <button
              class="btn-primary !px-3 !py-2 text-xs"
              onclick={grabLogoFromCandidates}
              disabled={logoBusy}
            >
              {logoBusy ? '…' : org.logo ? 'Replace' : 'Grab'}
            </button>
          </div>

          <!-- Manual image URL (escape hatch for high-res logos) -->
          <div class="rounded-[10px] border border-surface-divider p-3">
            <div class="text-sm font-medium text-ink-900">Paste an image URL</div>
            <div class="mt-0.5 text-xs text-ink-500">
              For a high-res logo, right-click any image on the site (or open the page's <code>og:image</code>) and paste the URL here.
            </div>
            <div class="mt-2 flex gap-2">
              <input
                type="url"
                class="input flex-1 text-xs"
                placeholder="https://…/logo.png"
                bind:value={manualUrl}
              />
              <button
                class="btn-primary !px-3 !py-2 text-xs"
                onclick={grabFromManualUrl}
                disabled={manualBusy || !manualUrl.trim()}
              >
                {manualBusy ? '…' : 'Grab'}
              </button>
            </div>
          </div>

          <!-- Website suggestion -->
          {#if suggestedWebsite}
            <div class="flex items-center gap-3 rounded-[10px] border border-surface-divider p-3">
              <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-surface-hover text-ink-500">
                <Icon name="globe" size={18} />
              </span>
              <div class="min-w-0 flex-1">
                <div class="text-sm font-medium text-ink-900">Set website</div>
                <div class="truncate text-xs text-ink-500">{suggestedWebsite}</div>
              </div>
              <button
                class="btn-primary !px-3 !py-2 text-xs"
                onclick={applySuggestedWebsite}
                disabled={websiteBusy}
              >
                {websiteBusy ? '…' : 'Apply'}
              </button>
            </div>
          {/if}
        </div>
      {/if}

      <!-- Search links -->
      <div class="mt-4">
        <div class="muted-label mb-1.5">Look it up</div>
        <div class="flex flex-wrap gap-1.5">
          {#each links as l}
            <a
              href={l.url}
              target="_blank"
              rel="noreferrer"
              class="inline-flex items-center gap-1.5 rounded-full border border-surface-border bg-surface-card px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-surface-hover"
            >
              <Icon name={l.icon as IconName} size={12} />
              {l.label}
            </a>
          {/each}
        </div>
        <p class="mt-2 text-[11px] leading-snug text-ink-400">
          Browser CORS blocks scraping arbitrary sites client-side. For full
          auto-fill (description, og:image, social links) we'll wire a Directus
          Flow in Phase E — until then, these tabs are the fast manual path.
        </p>
      </div>
    </div>
  </div>
{/if}
