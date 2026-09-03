<script lang="ts">
  // Settings → Asana. A status page, not a configuration page: the token lives
  // in the "Asana API proxy" Flow on the NAS and twin never sees it, so there
  // is nothing here to type. What there IS to know is whether the chain works,
  // and that has exactly one honest test — GET users/me, which only answers if
  // Directus is reachable, the Flow is active AND Asana accepted the token.
  //
  // Worth knowing when this breaks: a 403 page of HTML rather than JSON is
  // CloudFront, not Asana. It means the request was malformed before it
  // arrived — most often a GET carrying a body, which is what the Flow did
  // until its request step was split into GET and write branches.
  import { onMount } from 'svelte';
  import Icon from '$lib/Icon.svelte';
  import SettingsSubpageHeader from '$lib/admin/SettingsSubpageHeader.svelte';
  import { asanaConfigured, asanaFlowId, asanaMe, listAsanaProjects, type AsanaMe, type AsanaProject } from '$lib/asana';
  import { formatError } from '$lib/directus';

  let me = $state<AsanaMe | null>(null);
  let projects = $state<Record<string, AsanaProject[]>>({});
  let loading = $state(true);
  let error = $state('');
  let cloudfront = $state(false);

  onMount(() => void load());

  async function load() {
    loading = true;
    error = '';
    cloudfront = false;
    try {
      me = await asanaMe();
      // Projects per workspace — the useful thing to see once connected, and a
      // second GET proving reads work generally rather than for one endpoint.
      for (const w of me.workspaces ?? []) {
        projects[w.gid] = await listAsanaProjects(w.gid).catch(() => []);
      }
    } catch (e) {
      const msg = formatError(e);
      error = msg;
      // The signature of a malformed request rather than a rejected token.
      cloudfront = /cloudfront|could not be satisfied|<!doctype html/i.test(msg);
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head><title>Asana · Settings · Hub</title></svelte:head>

<section class="space-y-4">
  <SettingsSubpageHeader
    title="Asana"
    subtitle="Read and update Asana tasks from twin. The personal access token lives server-side in a Directus Flow — twin never sees it, so there is nothing to enter here. This page exists to tell you whether the chain works."
  />

  {#if loading}
    <div class="card p-4 text-sm text-ink-400">Checking the connection…</div>
  {:else if me}
    <div class="card p-4 text-sm">
      <div class="flex flex-wrap items-center gap-2">
        <Icon name="check" size={14} />
        <span class="text-ink-900">Connected</span>
        <span class="text-ink-500">{me.name}{me.email ? ` <${me.email}>` : ''}</span>
        <span class="ml-auto text-xs text-ink-400">{(me.workspaces ?? []).length} workspace{(me.workspaces ?? []).length === 1 ? '' : 's'}</span>
      </div>
    </div>

    {#each me.workspaces ?? [] as w (w.gid)}
      <div class="card">
        <div class="card-header">
          <span class="card-title"><Icon name="layers" size={16} /> {w.name ?? w.gid}
            <span class="font-normal text-ink-300">{(projects[w.gid] ?? []).length} projects</span>
          </span>
        </div>
        {#if (projects[w.gid] ?? []).length === 0}
          <p class="px-4 pb-4 text-sm text-ink-400">No projects returned for this workspace.</p>
        {:else}
          <ul class="divide-y divide-surface-divider">
            {#each (projects[w.gid] ?? []).slice(0, 25) as p (p.gid)}
              <li class="flex items-center gap-2 px-4 py-2">
                <span class="min-w-0 flex-1 truncate text-sm text-ink-900">{p.name ?? p.gid}</span>
                <a
                  href={`https://app.asana.com/0/${p.gid}`}
                  target="_blank"
                  rel="noreferrer"
                  class="shrink-0 text-xs text-ink-400 hover:text-brand"
                >open ↗</a>
              </li>
            {/each}
          </ul>
          {#if (projects[w.gid] ?? []).length > 25}
            <p class="px-4 pb-3 pt-1 text-xs text-ink-400">
              Showing 25 of {(projects[w.gid] ?? []).length}.
            </p>
          {/if}
        {/if}
      </div>
    {/each}
  {:else}
    <div class="card p-4 text-sm text-ink-600">
      <p class="font-medium text-ink-900">Not connected.</p>
      {#if !asanaConfigured()}
        <p class="mt-1">
          No Flow id is set in <code>src/lib/asana.ts</code>. Create the
          <strong>“Asana API proxy”</strong> Flow in Directus and put its id there.
        </p>
      {:else if cloudfront}
        <!-- Worth spelling out: this is the failure that wasted an afternoon. -->
        <p class="mt-1">
          Asana never saw the request — that response is a CloudFront error page, not an
          Asana error, so the request was rejected at the edge before reaching the API.
          The usual cause is a <strong>GET carrying a body</strong>: the Flow's request step
          must not declare a body for reads. Split it into a GET step with no body and a
          write step that keeps <code>{'{{$trigger.body.body}}'}</code>.
        </p>
      {:else}
        <p class="mt-1">
          The Flow answered, but not with an account. If Asana says the token is invalid,
          replace the <code>Authorization</code> header in the Flow's request step with a
          fresh personal access token.
        </p>
      {/if}
      <p class="mt-2 text-xs text-ink-400">Flow id: <code>{asanaFlowId() || '—'}</code></p>
      {#if error}<p class="mt-2 text-xs text-tag-salesText">{error.slice(0, 400)}</p>{/if}
    </div>
  {/if}

  <button class="btn-ghost text-xs" onclick={() => load()}>Re-check</button>
</section>
