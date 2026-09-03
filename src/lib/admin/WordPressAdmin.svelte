<script lang="ts">
  // Settings → WordPress. Connection status + one-time setup for the
  // klak.is "WordPress proxy" Flow (Application Password held
  // server-side). Publishing itself happens per-event on the event
  // page; this page is connect + verify, mirroring Settings → Meta.
  import Icon from '$lib/Icon.svelte';
  import { PUBLIC_DIRECTUS_URL } from '$env/static/public';
  import { wordpressConfigured } from '$lib/wordpress';

  const configured = wordpressConfigured();
  const WP_URL = 'https://klak.is/wp-json/{{$trigger.body.path}}';
  const METHOD_TMPL = '{{$trigger.body.method}}';
  const BODY_TMPL = '{{$trigger.body.body}}';

  let copiedKey = $state('');
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        /* nothing else to try */
      }
      ta.remove();
    }
    copiedKey = key;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copiedKey = ''), 1500);
  }
</script>

<div class="space-y-5">
  <!-- Status -->
  <div class="rounded-[14px] border border-surface-border bg-surface-card p-4">
    <div class="flex items-center gap-3">
      <span
        class="flex h-9 w-9 shrink-0 items-center justify-center"
        style="background: var(--bg-tertiary); color: var(--text-secondary); border-radius: var(--radius-md);"
      >
        <Icon name="globe" size={16} />
      </span>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="font-medium text-ink-900">WordPress proxy</span>
          {#if configured}
            <span class="rounded-full bg-tag-eventText/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-tag-eventText">Connected</span>
          {:else}
            <span class="rounded-full bg-tag-sales/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-tag-salesText">Not connected</span>
          {/if}
        </div>
        <div class="text-xs text-ink-500">
          {#if configured}
            Event publishing routes through your Directus Flow; the Application Password stays server-side.
          {:else}
            Create the Flow below and set <code class="font-mono">WP_FLOW_ID</code> to go live.
          {/if}
        </div>
      </div>
    </div>
  </div>

  <!-- Setup -->
  <div class="rounded-[14px] border border-surface-border bg-surface-card">
    <div class="border-b border-surface-divider px-4 py-3">
      <span class="font-medium text-ink-900">Connection setup</span>
      <span class="ml-2 text-xs text-ink-400">Application Password · proxy Flow</span>
    </div>
    <div class="space-y-4 px-4 py-4 text-sm">
      <ol class="space-y-3 text-ink-600">
        <li>
          <span class="font-medium text-ink-900">1. Create an Application Password</span> on your WordPress site —
          <a class="text-tag-eventText underline" href="https://klak.is/wp-admin/profile.php" target="_blank" rel="noreferrer">WP Admin → Users → Profile → Application Passwords</a>,
          for a user who can edit events. Copy the generated password (shown once).
        </li>
        <li>
          <span class="font-medium text-ink-900">2. Base64-encode</span> <span class="font-mono">username:that-password</span> (keep the spaces) — that string is your Basic credential.
        </li>
        <li>
          <span class="font-medium text-ink-900">3. Create a Directus Flow</span> named “WordPress proxy” —
          <a class="text-tag-eventText underline" href={`${PUBLIC_DIRECTUS_URL}/admin/settings/flows`} target="_blank" rel="noreferrer">open Flows</a>.
          Trigger: <strong>Webhook</strong>, method <strong>POST</strong>, response body “Data of last operation”.
        </li>
        <li>
          <span class="font-medium text-ink-900">4. Add one “Web Request” operation:</span>
          <div class="mt-1.5 space-y-1.5">
            <div class="flex items-stretch gap-2">
              <span class="w-16 shrink-0 pt-1.5 text-[11px] uppercase tracking-wide text-ink-400">Method</span>
              <code class="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-[8px] border border-surface-border px-2.5 py-1.5 font-mono text-[11px] text-ink-900" style="background: var(--bg-tertiary);">{METHOD_TMPL}</code>
              <button type="button" onclick={() => copy(METHOD_TMPL, 'm')} class="flex shrink-0 items-center rounded-[8px] border border-surface-border px-2 text-xs text-ink-700 hover:bg-surface-hover"><Icon name={copiedKey === 'm' ? 'check' : 'copy'} size={12} /></button>
            </div>
            <div class="flex items-stretch gap-2">
              <span class="w-16 shrink-0 pt-1.5 text-[11px] uppercase tracking-wide text-ink-400">URL</span>
              <code class="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-[8px] border border-surface-border px-2.5 py-1.5 font-mono text-[11px] text-ink-900" style="background: var(--bg-tertiary);">{WP_URL}</code>
              <button type="button" onclick={() => copy(WP_URL, 'u')} class="flex shrink-0 items-center rounded-[8px] border border-surface-border px-2 text-xs text-ink-700 hover:bg-surface-hover"><Icon name={copiedKey === 'u' ? 'check' : 'copy'} size={12} /></button>
            </div>
            <div class="flex items-stretch gap-2">
              <span class="w-16 shrink-0 pt-1.5 text-[11px] uppercase tracking-wide text-ink-400">Headers</span>
              <code class="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-[8px] border border-surface-border px-2.5 py-1.5 font-mono text-[11px] text-ink-900" style="background: var(--bg-tertiary);">Authorization: Basic &lt;base64&gt; · Content-Type: application/json</code>
              <button type="button" onclick={() => copy('Authorization', 'h')} class="flex shrink-0 items-center rounded-[8px] border border-surface-border px-2 text-xs text-ink-700 hover:bg-surface-hover"><Icon name={copiedKey === 'h' ? 'check' : 'copy'} size={12} /></button>
            </div>
            <div class="flex items-stretch gap-2">
              <span class="w-16 shrink-0 pt-1.5 text-[11px] uppercase tracking-wide text-ink-400">Body</span>
              <code class="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-[8px] border border-surface-border px-2.5 py-1.5 font-mono text-[11px] text-ink-900" style="background: var(--bg-tertiary);">{BODY_TMPL}</code>
              <button type="button" onclick={() => copy(BODY_TMPL, 'b')} class="flex shrink-0 items-center rounded-[8px] border border-surface-border px-2 text-xs text-ink-700 hover:bg-surface-hover"><Icon name={copiedKey === 'b' ? 'check' : 'copy'} size={12} /></button>
            </div>
          </div>
          <p class="mt-1.5 text-xs text-ink-400">The credential lives only in this header, server-side. twin sends just <span class="font-mono">{'{ method, path, body }'}</span>.</p>
        </li>
        <li>
          <span class="font-medium text-ink-900">5. Copy the Flow’s id</span> into
          <code class="font-mono">WP_FLOW_ID</code> in <span class="font-mono">src/lib/wordpress.ts</span>, then deploy.
        </li>
      </ol>
      <p class="text-xs text-ink-500">
        Events publish from each event’s page (choose Draft or Publish). twin stores the WordPress post id, so re-publishing updates the same post — never a duplicate.
      </p>
    </div>
  </div>
</div>
