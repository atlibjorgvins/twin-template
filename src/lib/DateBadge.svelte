<script lang="ts">
  // Helga date badge — a compact, two-row "tear-off calendar" stamp.
  // Top row: month abbreviation in display font. Bottom row: large day
  // number in display font. Useful in lists where each row references a
  // date (events, follow-ups, activity feeds) and you want the date to
  // read at a glance without consuming a full date string.
  //
  // Sizes scale with the Helga typography ramp via `size` prop:
  //   - 'sm' fits in dense rows (avatar-md companion)
  //   - 'md' is the default — pair with avatar-lg or in section headers
  //   - 'lg' anchors hero cards
  //
  // `tone` swaps the accent strip on the top row:
  //   - 'accent' → chartreuse-on-black (dark) / teal (light) — for "today"
  //   - 'muted'  → neutral border, default for past/future dates
  //
  // The whole badge respects `data-theme` via tokens — no hex outside vars.

  type Size = 'sm' | 'md' | 'lg';
  type Tone = 'accent' | 'muted';
  type Props = {
    date: Date | string;
    size?: Size;
    tone?: Tone;
    /** Optional weekday line under the day number (e.g. "Mon"). */
    weekday?: boolean;
    /** Override the locale (defaults to en-GB). */
    locale?: string;
  };

  let {
    date,
    size = 'md',
    tone = 'muted',
    weekday = false,
    locale = 'en-GB'
  }: Props = $props();

  const parsed = $derived(typeof date === 'string' ? new Date(date) : date);
  const monthLabel = $derived(
    new Intl.DateTimeFormat(locale, { month: 'short' }).format(parsed).toUpperCase()
  );
  const dayLabel = $derived(parsed.getDate());
  const weekdayLabel = $derived(
    new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(parsed)
  );

  // Pixel sizes by tier — tuned so each badge is comfortably tappable on
  // mobile (>=44px on `md`) and harmonises with the avatar ramp.
  const dims: Record<Size, { w: string; monthH: string; monthFs: string; dayFs: string; weekFs: string }> = {
    sm: { w: '2.25rem', monthH: '0.75rem', monthFs: '8px',  dayFs: '14px', weekFs: '8px' },
    md: { w: '2.75rem', monthH: '0.875rem', monthFs: '10px', dayFs: '20px', weekFs: '9px' },
    lg: { w: '3.75rem', monthH: '1.125rem', monthFs: '12px', dayFs: '28px', weekFs: '10px' }
  };
  const d = $derived(dims[size]);

  const monthStyle = $derived(
    tone === 'accent'
      ? `background: var(--accent-electric); color: var(--accent-text);`
      : `background: var(--bg-tertiary); color: var(--text-tertiary);`
  );
</script>

<span
  class="date-badge inline-flex flex-col items-stretch overflow-hidden text-center"
  style="width: {d.w}; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--bg-secondary);"
  aria-label={new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(parsed)}
>
  <span
    class="font-display font-medium uppercase"
    style="height: {d.monthH}; font-size: {d.monthFs}; line-height: {d.monthH}; letter-spacing: 0.12em; {monthStyle}"
  >{monthLabel}</span>
  <span
    class="font-display font-bold tabular-nums"
    style="font-size: {d.dayFs}; line-height: 1.1; letter-spacing: -0.04em; color: var(--text-primary); padding: 2px 0;"
  >{dayLabel}</span>
  {#if weekday}
    <span
      class="font-display uppercase"
      style="font-size: {d.weekFs}; letter-spacing: 0.1em; color: var(--text-tertiary); padding-bottom: 2px;"
    >{weekdayLabel}</span>
  {/if}
</span>
