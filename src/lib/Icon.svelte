<script lang="ts">
  // Lucide-style inline icons. Kept local to avoid an icon-lib dependency.
  import type { IconName } from './icon-types';

  let {
    name,
    size = 18,
    stroke = 1.75,
    class: klass = ''
  }: { name: IconName; size?: number; stroke?: number; class?: string } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  class={klass}
  aria-hidden="true"
>
  {#if name === 'home'}
    <path d="M3 11.5 12 4l9 7.5" /><path d="M5 10v10h14V10" />
  {:else if name === 'search'}
    <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
  {:else if name === 'bolt'}
    <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
  {:else if name === 'users'}
    <circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.2 3.5-5 6.5-5s5.7 1.8 6.5 5" /><circle cx="17" cy="9" r="2.5" /><path d="M21.5 18c-.4-1.8-1.7-3-3.5-3.3" />
  {:else if name === 'building'}
    <rect x="4" y="3" width="16" height="18" rx="2" /><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-4h4v4" />
  {:else if name === 'calendar'}
    <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v4M16 3v4" />
  {:else if name === 'tag'}
    <path d="m3 12 9-9h7v7l-9 9-7-7Z" /><circle cx="15" cy="9" r="1.2" />
  {:else if name === 'chevron-right'}
    <path d="m9 6 6 6-6 6" />
  {:else if name === 'chevron-left'}
    <path d="m15 6-6 6 6 6" />
  {:else if name === 'plus'}
    <path d="M12 5v14M5 12h14" />
  {:else if name === 'arrow-right'}
    <path d="M5 12h14M13 6l6 6-6 6" />
  {:else if name === 'mail'}
    <rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" />
  {:else if name === 'phone'}
    <path d="M5 4h4l2 5-3 2a11 11 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
  {:else if name === 'globe'}
    <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18" />
  {:else if name === 'school'}
    <path d="M22 10 12 5 2 10l10 5 10-5Z" /><path d="M6 12v5c0 1 2.5 2.5 6 2.5s6-1.5 6-2.5v-5" /><path d="M22 10v6" />
  {:else if name === 'sparkles'}
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />
  {:else if name === 'pencil'}
    <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4Z" />
  {:else if name === 'settings'}
    <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
  {:else if name === 'bell'}
    <path d="M6 8a6 6 0 1 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9Z" /><path d="M10 21a2 2 0 0 0 4 0" />
  {:else if name === 'move'}
    <path d="M5 9 2 12l3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20" />
  {:else if name === 'notebook'}
    <path d="M4 4h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4z" /><path d="M8 4v18M4 8h2M4 12h2M4 16h2M4 20h2" />
  {:else if name === 'menu'}
    <path d="M3 6h18M3 12h18M3 18h18" />
  {:else if name === 'x'}
    <path d="M18 6 6 18M6 6l12 12" />
  {:else if name === 'trash'}
    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M10 11v6M14 11v6" />
  {:else if name === 'wallet'}
    <path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2" /><path d="M21 12a2 2 0 0 0-2-2h-4a2 2 0 0 0 0 4h4a2 2 0 0 0 2-2Z" />
  {:else if name === 'message-square'}
    <path d="M21 12a8 8 0 0 1-12 7l-5 1 1-5a8 8 0 1 1 16-3Z" />
  {:else if name === 'coffee'}
    <path d="M4 9h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9Z" />
    <path d="M17 11h2a2 2 0 0 1 0 4h-2" />
    <path d="M8 3v3M12 3v3" />
  {:else if name === 'utensils'}
    <path d="M5 3v6c0 1.5 1 2 2 2v10" />
    <path d="M9 3v6c0 1.5-1 2-2 2" />
    <path d="M17 3c-2.5 0-4 2-4 5s1.5 5 4 5v8" />
  {:else if name === 'wine'}
    <path d="M7 3h10l-1 6a4 4 0 0 1-8 0L7 3Z" />
    <path d="M12 13v7M9 20h6" />
  {:else if name === 'footprints'}
    <path d="M8.5 3c1.5 0 2.5 1.5 2.5 3.5S10.5 11 9 12c-1 .5-2 0-2-1 0-2-1-3-1-5s1-3 2.5-3Z" />
    <circle cx="6.5" cy="14.5" r="1" />
    <path d="M16.5 12c1.5 0 2.5 1.5 2.5 3.5S18.5 20 17 21c-1 .5-2 0-2-1 0-2-1-3-1-5s1-3 2.5-3Z" />
    <circle cx="14.5" cy="9.5" r="1" />
  {:else if name === 'biceps'}
    <!-- Flexed arm: shoulder → elbow → forearm up to the fist, with the
         bicep bulge as the inner curve. -->
    <path d="M12.4 13a5 5 0 0 1 9.6 2c0 3.9-4 7-9 7-4.1 0-8.2-.8-10.4-2.5-.4-.3-.6-.8-.6-1.4C2.1 12.7 2.6 2 10 2a3 3 0 0 1 3 3 2 2 0 0 1-2 2c-1.1 0-1.6-.4-2-1" />
    <path d="M15 14a5 5 0 0 0-7.6 2" />
    <path d="M10 6.8C8 8 9.5 13 8 15" />
  {:else if name === 'mic'}
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <path d="M12 18v3M9 21h6" />
  {:else if name === 'image'}
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="1.5" />
    <path d="m3 17 5-5 4 4 3-3 6 6" />
  {:else if name === 'receipt'}
    <path d="M5 3v18l2-1.2L9 21l2-1.2L13 21l2-1.2L17 21l2-1.2V3l-2 1.2L15 3l-2 1.2L11 3 9 4.2 7 3Z" />
    <path d="M8 8h8M8 12h8M8 16h5" />
  {:else if name === 'command'}
    <path d="m7 8 4 4-4 4" />
    <path d="M13 16h4" />
  {:else if name === 'layers'}
    <path d="m12 3 9 5-9 5-9-5 9-5Z" />
    <path d="m3 13 9 5 9-5" />
  {:else if name === 'eye'}
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />
  {:else if name === 'lock'}
    <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
  {:else if name === 'lock-open'}
    <!-- Shackle swung open to the right — the same body, so a row of locked
         and unlocked layers reads as one control in two states. -->
    <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
    <path d="M8 10.5V7.5a4 4 0 0 1 7.7-1.5" />
  {:else if name === 'eye-off'}
    <path d="M4 4l16 16" />
    <path d="M10.6 5.8A9.8 9.8 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17.6 17.6 0 0 1-3 3.8M6.6 6.6A17 17 0 0 0 2.5 12S6 18.5 12 18.5a9.6 9.6 0 0 0 4.4-1.1" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  {:else if name === 'download'}
    <path d="M12 3v12M7 10l5 5 5-5" />
    <path d="M4 19h16" />
  {:else if name === 'check'}
    <path d="m5 12 5 5 9-11" />
  {:else if name === 'list-checks'}
    <!-- Two ticked rows over one open row: reads as "tasks", not "done". -->
    <path d="m3 6 2 2 3-3.5" />
    <path d="m3 13 2 2 3-3.5" />
    <path d="M12 6h9M12 13h9M12 19.5h9" />
  {:else if name === 'clock'}
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  {:else if name === 'gift'}
    <rect x="3" y="8" width="18" height="13" rx="1" />
    <path d="M3 12h18M12 8v13" />
    <path d="M12 8a3 3 0 0 1-3-3 2 2 0 0 1 4 0 2 2 0 0 1 4 0 3 3 0 0 1-3 3" />
  {:else if name === 'flag'}
    <path d="M5 21V3" />
    <path d="M5 4h12l-3 4 3 4H5" />
  {:else if name === 'graduation-cap'}
    <path d="M2 10 12 5l10 5-10 5L2 10Z" />
    <path d="M6 12v4c0 1.5 2.5 3 6 3s6-1.5 6-3v-4" />
    <path d="M22 10v6" />
  {:else if name === 'book-open'}
    <path d="M12 5v15" />
    <path d="M12 5a6 6 0 0 0-9-1v16a6 6 0 0 1 9 1" />
    <path d="M12 5a6 6 0 0 1 9-1v16a6 6 0 0 0-9 1" />
  {:else if name === 'cake'}
    <path d="M4 13h16v8H4z" />
    <path d="M4 17h16" />
    <path d="M6 9v4M12 9v4M18 9v4" />
    <path d="M6 7v1M12 7v1M18 7v1" />
  {:else if name === 'hand-wave'}
    <path d="M7 20c-2-2-3-4-3-7l3-3" />
    <path d="M14 3 9 8" />
    <path d="M17 5 9 13" />
    <path d="M19 9 11 17" />
    <path d="M20 13l-4 4-2 2c-2 2-5 2-7 1" />
  {:else if name === 'linkedin'}
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <path d="M8 10v7" />
    <path d="M8 7v.01" />
    <path d="M12 17v-4a2.5 2.5 0 0 1 5 0v4" />
    <path d="M12 10v7" />
  {:else if name === 'facebook'}
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <path d="M14 9h2V6h-2a3 3 0 0 0-3 3v2H9v3h2v6h3v-6h2l1-3h-3V9.5A.5.5 0 0 1 14 9Z" />
  {:else if name === 'instagram'}
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <circle cx="12" cy="12" r="3.5" />
    <circle cx="17" cy="7" r="0.6" fill="currentColor" stroke="none" />
  {:else if name === 'x-twitter'}
    <path d="M4 4l7.5 9.5L4.5 20H7l6-6.5L17 20h3l-7.7-9.8L19.5 4H17l-5.5 6L7 4Z" />
  {:else if name === 'filter'}
    <path d="M3 5h18l-7 8v6l-4-2v-4L3 5Z" />
  {:else if name === 'sliders'}
    <path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h12M20 18h0" />
    <circle cx="16" cy="6" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="18" cy="18" r="2" />
  {:else if name === 'bookmark'}
    <path d="M6 3h12v18l-6-4-6 4V3Z" />
  {:else if name === 'copy'}
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  {:else if name === 'chart-bar'}
    <!-- Three rising columns on a baseline — the Insights dashboard. -->
    <path d="M4 20h16" />
    <path d="M7 20v-6M12 20V8M17 20v-9" />
  {/if}
</svg>
