<script lang="ts">
  // Platform-accurate EVENT-PAGE previews (not feed posts): how this
  // event would look as a Facebook Event, a LinkedIn Event, and on the
  // klak.is viðburður page. Mirrors each platform's event chrome closely
  // enough to double as a check before publishing. White cards on the
  // platform's font stack regardless of app theme — that's authentic.
  type Platform = 'facebook' | 'linkedin' | 'klakis';
  type Props = {
    platform: Platform;
    name: string;
    start?: string | null;
    end?: string | null;
    location?: string | null;
    summary?: string | null;
    coverUrl?: string | null;
    hostName?: string | null;
    hostAvatarUrl?: string | null;
    attendeeCount?: number;
    /** klak.is accent — the project's brand primary, falls back to KLAK pink. */
    accent?: string | null;
  };
  let {
    platform,
    name,
    start = null,
    end = null,
    location = null,
    summary = null,
    coverUrl = null,
    hostName = null,
    hostAvatarUrl = null,
    attendeeCount = 0,
    accent = null
  }: Props = $props();

  const host = $derived(hostName?.trim() || 'Your organization');
  const klakAccent = $derived(accent?.trim() || '#FF5E72');

  function d(iso?: string | null) {
    return iso ? new Date(iso) : null;
  }
  // "Sat, 13 Mar 2026 at 17:00" (Facebook style)
  const fbWhen = $derived.by(() => {
    const s = d(start);
    if (!s) return 'Date to be set';
    const day = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(s);
    const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(s);
    return `${day} at ${time}`;
  });
  // "Saturday, March 13, 2026" (LinkedIn style)
  const liWhen = $derived.by(() => {
    const s = d(start);
    if (!s) return 'Date to be set';
    const day = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(s);
    const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(s);
    return `${day} · ${time}`;
  });
  // "13. mars 2026 · 17:00" (Icelandic / klak.is style)
  const isWhen = $derived.by(() => {
    const s = d(start);
    if (!s) return '';
    const day = new Intl.DateTimeFormat('is-IS', { day: 'numeric', month: 'long', year: 'numeric' }).format(s);
    const time = new Intl.DateTimeFormat('is-IS', { hour: '2-digit', minute: '2-digit' }).format(s);
    return `${day} · ${time}`;
  });

  const initials = $derived(
    host.split(/\s+/).map((w) => w[0]).filter((c) => !!c && /[\p{L}\p{N}]/u.test(c)).slice(0, 2).join('').toUpperCase() || 'K'
  );
  const responded = $derived(attendeeCount > 0 ? attendeeCount : 12 + (name.length % 88));
</script>

{#snippet avatar(size: number)}
  {#if hostAvatarUrl}
    <img src={hostAvatarUrl} alt="" style="width:{size}px;height:{size}px;border-radius:50%;object-fit:cover;flex-shrink:0;" />
  {:else}
    <span style="width:{size}px;height:{size}px;border-radius:50%;flex-shrink:0;display:grid;place-items:center;background:linear-gradient(135deg,#2C8C99,#1D6BFE);color:#fff;font-weight:700;font-size:{Math.round(size*0.4)}px;">{initials}</span>
  {/if}
{/snippet}

{#snippet cover(ratio: string, bg: string)}
  {#if coverUrl}
    <div style="aspect-ratio:{ratio};background:{bg};overflow:hidden;"><img src={coverUrl} alt="" style="width:100%;height:100%;object-fit:cover;display:block;" /></div>
  {:else}
    <div style="aspect-ratio:{ratio};display:grid;place-items:center;background:repeating-linear-gradient(45deg,#fafafa,#fafafa 12px,#f0f0f0 12px,#f0f0f0 24px);color:#8e8e8e;font-size:12px;">no cover image</div>
  {/if}
{/snippet}

<div class="ev-root" data-platform={platform}>
  {#if platform === 'facebook'}
    <div class="ev-card" style="max-width:500px;">
      {@render cover('16 / 9', '#e4e6eb')}
      <div style="padding:14px 16px;">
        <div style="font-size:13px;font-weight:700;color:#c0392b;text-transform:uppercase;letter-spacing:0.2px;">{fbWhen}</div>
        <div style="font-size:22px;font-weight:800;color:#050505;line-height:1.2;margin-top:2px;">{name}</div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:13.5px;color:#65676b;">
          {@render avatar(28)}
          <span>Event by <span style="color:#050505;font-weight:600;">{host}</span></span>
        </div>
        {#if location}
          <div style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:13.5px;color:#65676b;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#65676b"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"/></svg>
            {location}
          </div>
        {/if}
        <div style="font-size:13px;color:#65676b;margin-top:8px;">{responded} people responded · Public</div>
        <div style="display:flex;gap:8px;margin-top:12px;">
          <span style="flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;background:#1877F2;color:#fff;font-weight:600;font-size:14px;border-radius:6px;padding:8px 0;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z"/></svg> Going
          </span>
          <span style="flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;background:#e4e6eb;color:#050505;font-weight:600;font-size:14px;border-radius:6px;padding:8px 0;">★ Interested</span>
          <span style="display:inline-flex;align-items:center;justify-content:center;background:#e4e6eb;color:#050505;border-radius:6px;padding:8px 12px;font-weight:600;">Share</span>
        </div>
        {#if summary}
          <div style="margin-top:14px;border-top:1px solid #e4e6eb;padding-top:12px;">
            <div style="font-size:17px;font-weight:700;color:#050505;margin-bottom:6px;">Details</div>
            <div style="font-size:14px;color:#050505;line-height:1.45;white-space:pre-wrap;">{summary}</div>
          </div>
        {/if}
      </div>
    </div>
  {:else if platform === 'linkedin'}
    <div class="ev-card" style="max-width:500px;border-radius:8px;">
      {@render cover('2 / 1', '#eef3f8')}
      <div style="padding:16px;">
        <div style="font-size:13px;color:#0a66c2;font-weight:600;">{liWhen}{#if location} · {location}{/if}</div>
        <div style="font-size:20px;font-weight:600;color:rgba(0,0,0,0.9);line-height:1.25;margin-top:4px;">{name}</div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:10px;">
          {@render avatar(32)}
          <span style="font-size:13px;color:rgba(0,0,0,0.9);">{host}<span style="color:rgba(0,0,0,0.6);"> · Event</span></span>
        </div>
        <div style="font-size:13px;color:rgba(0,0,0,0.6);margin-top:8px;">{responded} attendees</div>
        <div style="display:flex;gap:8px;margin-top:12px;">
          <span style="display:inline-flex;align-items:center;gap:6px;background:#0a66c2;color:#fff;font-weight:600;font-size:15px;border-radius:20px;padding:7px 18px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z"/></svg> Attend
          </span>
          <span style="display:inline-flex;align-items:center;gap:6px;border:1px solid #0a66c2;color:#0a66c2;font-weight:600;font-size:15px;border-radius:20px;padding:7px 18px;">Share</span>
        </div>
        {#if summary}
          <div style="margin-top:14px;border-top:1px solid rgba(0,0,0,0.08);padding-top:12px;">
            <div style="font-size:16px;font-weight:600;color:rgba(0,0,0,0.9);margin-bottom:6px;">About this event</div>
            <div style="font-size:14px;color:rgba(0,0,0,0.9);line-height:1.45;white-space:pre-wrap;">{summary}</div>
          </div>
        {/if}
      </div>
    </div>
  {:else}
    <!-- klak.is viðburður page -->
    <div class="ev-card" style="max-width:560px;border-radius:14px;background:#FDFDFA;">
      {@render cover('16 / 9', '#f0efe6')}
      <div style="padding:22px 24px 26px;">
        <div style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:{klakAccent};">
          <span style="width:8px;height:8px;border-radius:50%;background:{klakAccent};display:inline-block;"></span> Viðburður
        </div>
        <h1 style="font-size:30px;font-weight:800;color:#2D2D2D;line-height:1.1;margin:8px 0 0;letter-spacing:-0.02em;">{name}</h1>
        <div style="display:flex;flex-wrap:wrap;gap:16px;margin-top:14px;">
          {#if isWhen}
            <div style="display:flex;align-items:center;gap:7px;font-size:14px;color:#2D2D2D;">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={klakAccent} stroke-width="2"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>
              {isWhen}
            </div>
          {/if}
          {#if location}
            <div style="display:flex;align-items:center;gap:7px;font-size:14px;color:#2D2D2D;">
              <svg width="17" height="17" viewBox="0 0 24 24" fill={klakAccent}><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"/></svg>
              {location}
            </div>
          {/if}
        </div>
        {#if summary}
          <p style="font-size:15.5px;color:#3a3a3a;line-height:1.6;margin:18px 0 0;white-space:pre-wrap;">{summary}</p>
        {/if}
        <div style="margin-top:22px;">
          <span style="display:inline-block;background:{klakAccent};color:#FFFCE9;font-weight:700;font-size:15px;border-radius:999px;padding:11px 26px;">Skrá mig</span>
        </div>
        <div style="margin-top:18px;display:flex;align-items:center;gap:8px;font-size:13px;color:#6b6b6b;border-top:1px solid #ebe9dd;padding-top:14px;">
          {@render avatar(24)} Á vegum {host}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .ev-root {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  }
  .ev-card {
    background: #fff;
    border: 1px solid #dbdbdb;
    border-radius: 10px;
    overflow: hidden;
    margin: 0 auto;
  }
</style>
