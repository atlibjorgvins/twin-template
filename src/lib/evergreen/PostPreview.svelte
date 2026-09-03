<script lang="ts">
  // Platform-accurate post preview for the Evergreen machine. Mimics the
  // real Instagram / Facebook / LinkedIn post anatomy (header, media,
  // action rows, caption truncation) closely enough to double as report
  // material. Platforms render white cards regardless of app theme —
  // that's authentic, not a styling gap.
  import type { CampaignPlatform } from '$lib/directus';

  type Props = {
    platform: CampaignPlatform;
    text: string;
    imageUrl?: string | null;
    brandName?: string | null;
    brandHandle?: string | null;
    avatarUrl?: string | null;
    /** Click-to-edit caption. On blur the full edited text is handed
     *  back via onEdit — the workbench turns it into a per-platform
     *  override template. */
    editable?: boolean;
    onEdit?: (text: string) => void;
  };
  let {
    platform,
    text,
    imageUrl = null,
    brandName,
    brandHandle,
    avatarUrl,
    editable = false,
    onEdit
  }: Props = $props();

  // The loaded image's real ratio, used in place of the platform placeholder.
  // Reset whenever the image changes: paging to the next team must not draw the
  // new image at the previous one's shape, which is the kind of stale-preview
  // bug you only notice after publishing.
  let naturalAspect = $state<string | null>(null);
  $effect(() => {
    void imageUrl;
    naturalAspect = null;
  });

  // ── In-place caption editing ────────────────────────────────────
  let editing = $state(false);
  let draft = $state('');
  function startEdit() {
    if (!editable || editing) return;
    draft = text;
    expanded = true; // edit the full text, never the collapsed slice
    editing = true;
  }
  function commitEdit() {
    editing = false;
    if (onEdit && draft !== text) onEdit(draft);
  }
  /** Svelte action: size the textarea to its content + focus at end. */
  function editArea(el: HTMLTextAreaElement) {
    const fit = () => {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    el.addEventListener('input', fit);
    return { destroy: () => el.removeEventListener('input', fit) };
  }

  const pageName = $derived(brandName?.trim() || 'Your page');
  const handle = $derived((brandHandle?.trim() || pageName).replace(/^@/, ''));

  // Deterministic plausible engagement so the preview is stable.
  const seed = $derived([...(text + pageName)].reduce((n, ch) => n + ch.charCodeAt(0), 0));
  const likes = $derived(40 + (seed % 187));
  const comments = $derived(2 + (seed % 14));
  const shares = $derived(1 + (seed % 7));

  // Caption truncation, mirroring each platform's collapse behaviour.
  let expanded = $state(false);
  const LIMIT: Record<string, number> = { instagram: 125, facebook: 240, linkedin: 210, general: 9999 };
  const limit = $derived(LIMIT[platform] ?? 9999);
  const isTruncated = $derived(!expanded && text.length > limit);
  const shownText = $derived(isTruncated ? text.slice(0, limit).replace(/\s+\S*$/, '') : text);

  // Hashtags + mentions get the platform's link colour. Escape first,
  // then wrap — the only HTML injected is our own <span>s.
  const LINK_COLOR: Record<string, string> = {
    instagram: '#00376B',
    facebook: '#1877F2',
    linkedin: '#0A66C2',
    general: '#2C8C99'
  };
  function richCaption(raw: string): string {
    const esc = raw
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const color = LINK_COLOR[platform] ?? LINK_COLOR.general;
    return esc.replace(
      /(^|\s)([#@][\p{L}\p{N}_.]+)/gu,
      (_, pre: string, tag: string) => `${pre}<span style="color:${color}">${tag}</span>`
    );
  }
  const initials = $derived(
    pageName
      .split(/\s+/)
      .map((w) => w[0])
      .filter((ch) => !!ch && /[\p{L}\p{N}]/u.test(ch))
      .slice(0, 2)
      .join('')
      .toUpperCase()
  );
</script>

{#snippet avatar(size: number, radius: string)}
  {#if avatarUrl}
    <img src={avatarUrl} alt="" style="width:{size}px;height:{size}px;border-radius:{radius};object-fit:cover;flex-shrink:0;" />
  {:else}
    <span
      style="width:{size}px;height:{size}px;border-radius:{radius};flex-shrink:0;display:grid;place-items:center;background:linear-gradient(135deg,#2C8C99,#1D6BFE);color:#fff;font-weight:700;font-size:{Math.round(size * 0.38)}px;"
    >{initials}</span>
  {/if}
{/snippet}

{#snippet media(aspect: string)}
  {#if imageUrl}
    <!-- The image's OWN ratio wins once it has loaded. The per-platform value
         is only a placeholder for the pre-load layout: hard-coding 1.91/1 for
         Facebook cropped every square image to a letterbox in the preview, so
         a 1:1 post looked wrong in the one place you check it before posting.
         Facebook and LinkedIn both render feed images at their native ratio,
         so the preview should too. object-contain, not cover — a preview must
         never hide part of what will be published. -->
    <div style="aspect-ratio:{naturalAspect ?? aspect};background:#f0f2f5;overflow:hidden;">
      <img
        src={imageUrl}
        alt=""
        onload={(e) => {
          const im = e.currentTarget as HTMLImageElement;
          if (im.naturalWidth > 0 && im.naturalHeight > 0) {
            naturalAspect = `${im.naturalWidth} / ${im.naturalHeight}`;
          }
        }}
        style="width:100%;height:100%;object-fit:contain;display:block;"
      />
    </div>
  {:else}
    <div
      style="aspect-ratio:{aspect};display:grid;place-items:center;background:repeating-linear-gradient(45deg,#fafafa,#fafafa 12px,#f0f0f0 12px,#f0f0f0 24px);color:#8e8e8e;font-size:12px;"
    >no image on this record</div>
  {/if}
{/snippet}

{#snippet caption()}
  <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
  {#if editing}
    <textarea
      class="pp-edit"
      bind:value={draft}
      use:editArea
      onblur={commitEdit}
      onkeydown={(e) => {
        if (e.key === 'Escape') { draft = text; editing = false; }
      }}
    ></textarea>
  {:else if editable && !text.trim()}
    <span style="color:#8e8e8e;cursor:text;" onclick={startEdit}>Write this platform's text…</span>
  {:else}
    <span
      style="white-space:pre-wrap;word-break:break-word;"
      style:cursor={editable ? 'text' : undefined}
      title={editable ? 'Click to edit this platform’s text' : undefined}
      onclick={startEdit}
    >{@html richCaption(shownText)}</span>{#if isTruncated}<span
        style="color:#8e8e8e;cursor:pointer;"
        onclick={(e) => { e.stopPropagation(); expanded = true; }}
      >… more</span>{/if}
  {/if}
{/snippet}

<div class="pp-root" data-platform={platform}>
  <!-- Story. Deliberately caption-less: a story carries no caption on either
       Instagram or Facebook, so showing an editable caption box here would
       invite copy that silently never publishes. Everything the viewer reads
       has to be inside the 1080x1920 image. -->
  {#if platform === 'instagram_story' || platform === 'facebook_story'}
    <div class="pp-card" style="max-width:260px;border-radius:12px;overflow:hidden;background:#000;">
      <div style="position:relative;aspect-ratio:9 / 16;background:#111;">
        {#if imageUrl}
          <img
            src={imageUrl}
            alt=""
            style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;"
          />
        {:else}
          <div
            style="position:absolute;inset:0;display:grid;place-items:center;color:#8e8e8e;font-size:12px;background:repeating-linear-gradient(45deg,#1a1a1a,#1a1a1a 12px,#222 12px,#222 24px);"
          >no image — a story is image-only</div>
        {/if}
        <!-- Progress pip + author, as both apps overlay them. -->
        <div style="position:absolute;top:6px;left:8px;right:8px;height:2px;border-radius:2px;background:rgba(255,255,255,0.85);"></div>
        <div style="position:absolute;top:14px;left:8px;right:8px;display:flex;align-items:center;gap:7px;">
          {@render avatar(24, '50%')}
          <span style="font-weight:600;font-size:12px;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,0.5);">{handle}</span>
        </div>
      </div>
      <div style="padding:7px 9px;font-size:10px;color:#8e8e8e;background:#000;">
        {platform === 'instagram_story' ? 'Instagram story' : 'Facebook story'} · 9:16 · no caption
      </div>
    </div>
  {:else if platform === 'instagram'}
    <div class="pp-card" style="max-width:380px;">
      <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;">
        {@render avatar(32, '50%')}
        <span style="font-weight:600;font-size:13px;color:#262626;">{handle}</span>
        <span style="margin-left:auto;color:#262626;letter-spacing:1px;font-weight:700;">···</span>
      </div>
      {@render media('1 / 1')}
      <div style="display:flex;align-items:center;gap:14px;padding:10px 12px 6px;color:#262626;">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20.5s-7.5-4.7-9.4-9.3C1.2 7.6 3.3 4.5 6.6 4.5c2.1 0 3.9 1.2 5.4 3.2 1.5-2 3.3-3.2 5.4-3.2 3.3 0 5.4 3.1 4 6.7C19.5 15.8 12 20.5 12 20.5Z"/></svg>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.6L3 21l1.9-5.6A8.5 8.5 0 1 1 21 11.5Z"/></svg>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z"/></svg>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="margin-left:auto;"><path d="M19 21V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v16l7-5 7 5Z"/></svg>
      </div>
      <div style="padding:0 12px;font-size:13px;font-weight:600;color:#262626;">{likes.toLocaleString()} likes</div>
      <div style="padding:4px 12px 0;font-size:13px;color:#262626;line-height:1.4;">
        <span style="font-weight:600;">{handle}</span>
        {@render caption()}
      </div>
      <div style="padding:6px 12px 0;font-size:13px;color:#8e8e8e;">View all {comments} comments</div>
      <div style="padding:6px 12px 12px;font-size:10px;color:#8e8e8e;letter-spacing:0.2px;text-transform:uppercase;">Just now</div>
    </div>
  {:else if platform === 'facebook'}
    <div class="pp-card" style="max-width:420px;border-radius:8px;">
      <div style="display:flex;align-items:flex-start;gap:8px;padding:12px 12px 0;">
        {@render avatar(40, '50%')}
        <div style="min-width:0;">
          <div style="font-weight:600;font-size:14.5px;color:#050505;line-height:1.2;">{pageName}</div>
          <div style="display:flex;align-items:center;gap:4px;font-size:12.5px;color:#65676b;">
            Just now ·
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm7.9 9h-3.4a15.6 15.6 0 0 0-1.2-5.9A8 8 0 0 1 19.9 11ZM12 20a14 14 0 0 1-2.4-7h4.8A14 14 0 0 1 12 20Zm-2.4-9a14 14 0 0 1 2.4-7 14 14 0 0 1 2.4 7H9.6Zm-.9-5.9A15.6 15.6 0 0 0 7.5 11H4.1a8 8 0 0 1 4.6-5.9ZM4.1 13h3.4a15.6 15.6 0 0 0 1.2 5.9A8 8 0 0 1 4.1 13Zm11.2 5.9a15.6 15.6 0 0 0 1.2-5.9h3.4a8 8 0 0 1-4.6 5.9Z"/></svg>
          </div>
        </div>
        <span style="margin-left:auto;color:#65676b;font-weight:700;letter-spacing:1px;">···</span>
      </div>
      <div style="padding:8px 12px;font-size:14.5px;color:#050505;line-height:1.35;">
        {@render caption()}
      </div>
      {@render media('1.91 / 1')}
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;font-size:14px;color:#65676b;">
        <span style="display:inline-flex;align-items:center;gap:4px;">
          <span style="display:inline-grid;place-items:center;width:18px;height:18px;border-radius:50%;background:#1877F2;color:#fff;">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M2 10h4v12H2V10Zm20 1.5c0-1.1-.9-2-2-2h-6.3l1-4.6v-.3c0-.4-.2-.8-.4-1.1L13.2 2 6.6 8.6c-.4.3-.6.8-.6 1.4v10c0 1.1.9 2 2 2h9c.8 0 1.5-.5 1.8-1.2l3-7.1c.1-.2.2-.5.2-.7v-1.5Z"/></svg>
          </span>
          <span style="display:inline-grid;place-items:center;width:18px;height:18px;border-radius:50%;background:#F33E58;color:#fff;margin-left:-6px;">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.5-4.7-9.7-9.3C.7 8 2.8 4.7 6.1 4.7c2 0 3.7 1.1 5.1 3 1.4-1.9 3.1-3 5.1-3 3.3 0 5.4 3.3 3.8 7-2.2 4.6-8.1 9.3-8.1 9.3Z"/></svg>
          </span>
          {likes.toLocaleString()}
        </span>
        <span>{comments} comments · {shares} shares</span>
      </div>
      <div style="margin:0 12px;border-top:1px solid #e4e6eb;display:flex;">
        {#each [['Like', 'M7 10v12H4a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1h3Zm2 12V9.6L13.7 2c.4.1.8.3 1 .7.3.3.4.7.4 1.1v.3l-1 4.9H20a2 2 0 0 1 2 2v1.4c0 .3 0 .5-.1.8l-3 7.1A2 2 0 0 1 17 22H9Z'], ['Comment', 'M12 2A10 10 0 0 0 2 12c0 1.8.5 3.5 1.3 5L2 22l5.3-1.2A10 10 0 1 0 12 2Z'], ['Share', 'M14 5l7 7-7 7v-4.1C7.4 14.9 4.4 16.6 2 20c1-6 4-10 12-10.9V5Z']] as [label, d] (label)}
          <span style="flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 0;color:#65676b;font-size:14px;font-weight:600;">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d={d}/></svg>
            {label}
          </span>
        {/each}
      </div>
    </div>
  {:else if platform === 'linkedin'}
    <div class="pp-card" style="max-width:420px;border-radius:8px;">
      <div style="display:flex;align-items:flex-start;gap:8px;padding:12px 14px 0;">
        {@render avatar(46, '50%')}
        <div style="min-width:0;">
          <div style="font-weight:600;font-size:14px;color:rgba(0,0,0,0.9);line-height:1.25;">{pageName}</div>
          <div style="font-size:12px;color:rgba(0,0,0,0.6);">{(1200 + seed % 9000).toLocaleString()} followers</div>
          <div style="display:flex;align-items:center;gap:4px;font-size:12px;color:rgba(0,0,0,0.6);">
            Just now ·
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm7.9 9h-3.4a15.6 15.6 0 0 0-1.2-5.9A8 8 0 0 1 19.9 11ZM12 20a14 14 0 0 1-2.4-7h4.8A14 14 0 0 1 12 20Zm-2.4-9a14 14 0 0 1 2.4-7 14 14 0 0 1 2.4 7H9.6Zm-.9-5.9A15.6 15.6 0 0 0 7.5 11H4.1a8 8 0 0 1 4.6-5.9ZM4.1 13h3.4a15.6 15.6 0 0 0 1.2 5.9A8 8 0 0 1 4.1 13Zm11.2 5.9a15.6 15.6 0 0 0 1.2-5.9h3.4a8 8 0 0 1-4.6 5.9Z"/></svg>
          </div>
        </div>
        <span style="margin-left:auto;color:rgba(0,0,0,0.6);font-weight:700;letter-spacing:1px;">···</span>
      </div>
      <div style="padding:10px 14px;font-size:14px;color:rgba(0,0,0,0.9);line-height:1.4;">
        {@render caption()}
      </div>
      {@render media('1.91 / 1')}
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 14px;font-size:12px;color:rgba(0,0,0,0.6);">
        <span style="display:inline-flex;align-items:center;gap:4px;">
          <span style="display:inline-grid;place-items:center;width:16px;height:16px;border-radius:50%;background:#378FE9;color:#fff;">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M2 10h4v12H2V10Zm20 1.5c0-1.1-.9-2-2-2h-6.3l1-4.6v-.3c0-.4-.2-.8-.4-1.1L13.2 2 6.6 8.6c-.4.3-.6.8-.6 1.4v10c0 1.1.9 2 2 2h9c.8 0 1.5-.5 1.8-1.2l3-7.1c.1-.2.2-.5.2-.7v-1.5Z"/></svg>
          </span>
          <span style="display:inline-grid;place-items:center;width:16px;height:16px;border-radius:50%;background:#DF704D;color:#fff;margin-left:-5px;">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.5-4.7-9.7-9.3C.7 8 2.8 4.7 6.1 4.7c2 0 3.7 1.1 5.1 3 1.4-1.9 3.1-3 5.1-3 3.3 0 5.4 3.3 3.8 7-2.2 4.6-8.1 9.3-8.1 9.3Z"/></svg>
          </span>
          {likes.toLocaleString()}
        </span>
        <span>{comments} comments</span>
      </div>
      <div style="margin:0 8px;border-top:1px solid rgba(0,0,0,0.08);display:flex;">
        {#each [['Like', 'M7 10v12H4a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1h3Zm2 12V9.6L13.7 2c.4.1.8.3 1 .7.3.3.4.7.4 1.1v.3l-1 4.9H20a2 2 0 0 1 2 2v1.4c0 .3 0 .5-.1.8l-3 7.1A2 2 0 0 1 17 22H9Z'], ['Comment', 'M12 2A10 10 0 0 0 2 12c0 1.8.5 3.5 1.3 5L2 22l5.3-1.2A10 10 0 1 0 12 2Z'], ['Repost', 'M17 2l4 4-4 4V7H8a3 3 0 0 0-3 3v1H3v-1a5 5 0 0 1 5-5h9V2ZM7 22l-4-4 4-4v3h9a3 3 0 0 0 3-3v-1h2v1a5 5 0 0 1-5 5H7v3Z'], ['Send', 'M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z']] as [label, d] (label)}
          <span style="flex:1;display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:10px 0;color:rgba(0,0,0,0.6);font-size:13px;font-weight:600;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d={d}/></svg>
            {label}
          </span>
        {/each}
      </div>
    </div>
  {:else}
    <!-- General — neutral card: the brief's content without platform chrome. -->
    <div class="pp-card" style="max-width:420px;border-radius:8px;">
      <div style="display:flex;align-items:center;gap:10px;padding:12px 14px 0;">
        {@render avatar(36, '8px')}
        <div style="font-weight:600;font-size:14px;color:#262626;">{pageName}</div>
      </div>
      <div style="padding:10px 14px;font-size:14px;color:#262626;line-height:1.45;">
        {@render caption()}
      </div>
      {@render media('1.91 / 1')}
      <div style="padding:10px 14px;font-size:12px;color:#8e8e8e;">General post — adapts to any channel</div>
    </div>
  {/if}
</div>

<style>
  .pp-root {
    /* Platform posts render on the host platform's font stack, not ours. */
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  }
  .pp-card {
    background: #fff;
    border: 1px solid #dbdbdb;
    border-radius: 12px;
    overflow: hidden;
    margin: 0 auto;
  }
  /* Seamless in-place editor — inherits the platform's typography so
     editing feels like typing into the real post. */
  .pp-edit {
    display: block;
    width: 100%;
    font: inherit;
    color: inherit;
    line-height: inherit;
    background: transparent;
    border: none;
    outline: 1px dashed rgba(0, 0, 0, 0.25);
    outline-offset: 2px;
    border-radius: 3px;
    padding: 0;
    margin: 0;
    resize: none;
    overflow: hidden;
  }
</style>
