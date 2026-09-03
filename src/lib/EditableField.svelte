<script lang="ts">
  import Icon from '$lib/Icon.svelte';
  import { COUNTRIES, DEFAULT_COUNTRY, parsePhone, toE164, formatPhone, type CountryCode } from '$lib/phone';
  import { formatError } from '$lib/directus';

  type InputType = 'text' | 'email' | 'tel' | 'url' | 'date' | 'select' | 'phone';

  let {
    value = null,
    type = 'text',
    placeholder = '—',
    options = [] as { label: string; value: string; group?: string }[],
    suggestions = [] as string[],
    disabled = false,
    href,
    wrap = false,
    onSave
  }: {
    value: string | null | undefined;
    type?: InputType;
    placeholder?: string;
    /** `group` is optional; when any option carries one the select
     *  renders <optgroup>s. */
    options?: { label: string; value: string; group?: string }[];
    /** Free-entry autocompletions (rendered as a <datalist>) for text
     *  fields — nudges consistent vocabulary (e.g. role titles) without
     *  restricting input. */
    suggestions?: string[];
    disabled?: boolean;
    /** Let the value wrap to multiple lines instead of truncating with an
     *  ellipsis. Off by default (form rows want single-line, right-aligned
     *  values); turn on for hero titles where a long Icelandic name should
     *  wrap rather than clip to "Hermann Björn…". */
    wrap?: boolean;
    /** Optional click-through. If a function, called with the current value
     *  to produce the URL. Read-mode renders the value as an external link;
     *  the edit pencil still triggers edit mode. Useful for fields like
     *  kennitala that map to a public registry page. */
    href?: string | ((value: string) => string);
    onSave: (next: string | null) => Promise<void> | void;
  } = $props();

  /** Resolve the href prop to a string for the current value, or '' if N/A. */
  const resolvedHref = $derived.by(() => {
    if (!href || value == null || value === '') return '';
    if (typeof href === 'function') {
      try { return href(String(value)); } catch { return ''; }
    }
    return href;
  });

  // Line handling for the read-mode value: clip to one line (default) or
  // allow wrapping when `wrap` is set (hero titles).
  const lineCls = $derived(wrap ? 'whitespace-normal break-words' : 'truncate');

  // Stable per-instance id for the optional suggestions <datalist>.
  const datalistId = `ef-dl-${Math.random().toString(36).slice(2, 9)}`;

  let editing = $state(false);
  let draft = $state('');
  let saving = $state(false);
  let error = $state('');
  let inputEl: HTMLInputElement | HTMLSelectElement | null = $state(null);
  let wrapEl: HTMLElement | null = $state(null);

  // Phone-only state
  let phoneCountry = $state<CountryCode>(DEFAULT_COUNTRY);
  let phoneNational = $state('');

  // Commit only when focus leaves the WHOLE editor — moving between the
  // country picker and the number field (or clicking a datalist option)
  // must not save-and-close. relatedTarget is where focus is going; if it's
  // still inside the editor, keep editing.
  function onFocusOut() {
    // Defer so focus settles, then commit only if it landed OUTSIDE the
    // editor. Checking activeElement (not relatedTarget) survives mobile
    // browsers that null relatedTarget when a native <select> opens.
    setTimeout(() => {
      if (!editing) return;
      if (wrapEl && document.activeElement && wrapEl.contains(document.activeElement)) return;
      commit();
    }, 0);
  }

  // Phone: if the number field gets a value carrying a country code
  // (pasted "+1 202…", or "0044…"), lift it into the country picker and
  // keep only the national part. Only when a known prefix is recognised —
  // otherwise leave what was typed untouched.
  function onPhoneInput() {
    if (!/[+]/.test(phoneNational) && !/^\s*00\d/.test(phoneNational)) return;
    const parsed = parsePhone(phoneNational, phoneCountry);
    if (parsed.recognized) {
      phoneCountry = parsed.country;
      phoneNational = parsed.national;
    }
  }

  // Email: strip a pasted "mailto:" prefix and any wrapping <>, live.
  function cleanEmail(v: string): string {
    return v.replace(/^\s*mailto:/i, '').replace(/^\s*<|>\s*$/g, '').trim();
  }
  function onEmailInput() {
    const cleaned = cleanEmail(draft);
    if (cleaned !== draft) draft = cleaned;
  }

  function begin() {
    if (disabled) return;
    if (type === 'phone') {
      const parsed = parsePhone(value ?? '', DEFAULT_COUNTRY);
      phoneCountry = parsed.country;
      phoneNational = parsed.national;
      draft = parsed.e164;
    } else {
      draft = value ?? '';
    }
    editing = true;
    error = '';
    queueMicrotask(() => inputEl?.focus());
  }

  async function commit() {
    if (!editing) return;
    let normalized: string | null;
    if (type === 'phone') {
      const e = toE164(phoneCountry, phoneNational);
      normalized = e === '' ? null : e;
    } else {
      const next = (type === 'email' ? cleanEmail(draft) : draft.trim());
      normalized = next === '' ? null : next;
    }
    if (normalized === (value ?? null)) {
      editing = false;
      return;
    }
    saving = true;
    error = '';
    try {
      await onSave(normalized);
      editing = false;
    } catch (e) {
      error = formatError(e);
    } finally {
      saving = false;
    }
  }

  function cancel() {
    editing = false;
    error = '';
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && type !== 'select') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  }

  function displayDate(v: string) {
    if (!v) return '';
    try {
      return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(v));
    } catch {
      return v;
    }
  }
  // Strip noise from URLs so the visible portion is the meaningful part.
  // (Hovering still shows the full original via the button's title attr.)
  function displayUrl(v: string) {
    if (!v) return v;
    return v.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
  }
  // The full plain value, used for the native hover tooltip.
  const tooltip = $derived.by(() => {
    if (value == null || value === '') return undefined;
    if (type === 'date') return displayDate(value);
    if (type === 'phone') return formatPhone(value);
    return String(value);
  });
  // What we show in the truncated span — a friendlier rendering for URLs.
  const display = $derived.by(() => {
    if (value == null || value === '') return '';
    if (type === 'date') return displayDate(value);
    if (type === 'phone') return formatPhone(value);
    if (type === 'url') return displayUrl(String(value));
    if (type === 'select') {
      // Show the option's label, not the raw stored value.
      return options.find((o) => o.value === String(value))?.label ?? String(value);
    }
    return String(value);
  });

  // Resolve a stored URL into something the browser will follow even if the
  // user typed a bare domain like "klak.is".
  function absUrl(v: string) {
    if (!v) return v;
    return /^https?:\/\//i.test(v) ? v : `https://${v}`;
  }
</script>

{#if editing}
  <span class="inline-flex items-center gap-1.5" bind:this={wrapEl} onfocusout={onFocusOut}>
    {#if type === 'select'}
      <select
        bind:this={inputEl as HTMLSelectElement}
        bind:value={draft}
        onkeydown={handleKey}
        class="rounded-md border border-brand bg-surface-card px-2 py-1.5 text-base md:text-sm text-ink-900 focus:outline-none"
      >
        <option value="">—</option>
        <!-- Grouped when any option names a group, flat otherwise. A 14-entry
             list of Icelandic regions and world regions is unreadable without
             the split; every other caller passes no group and is unaffected. -->
        {#if options.some((o) => o.group)}
          {#each [...new Set(options.map((o) => o.group ?? ''))] as g (g)}
            {#if g}
              <optgroup label={g}>
                {#each options.filter((o) => o.group === g) as opt (opt.value)}
                  <option value={opt.value}>{opt.label}</option>
                {/each}
              </optgroup>
            {:else}
              {#each options.filter((o) => !o.group) as opt (opt.value)}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            {/if}
          {/each}
        {:else}
          {#each options as opt}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        {/if}
      </select>
    {:else if type === 'phone'}
      <select
        bind:value={phoneCountry}
        onkeydown={handleKey}
        class="rounded-md border border-brand bg-surface-card px-1.5 py-1.5 text-base md:text-sm text-ink-900 focus:outline-none"
        title="Country code"
      >
        {#each COUNTRIES as c}
          <option value={c}>{c.flag} {c.code}</option>
        {/each}
      </select>
      <input
        bind:this={inputEl as HTMLInputElement}
        type="tel"
        inputmode="tel"
        bind:value={phoneNational}
        oninput={onPhoneInput}
        onkeydown={handleKey}
        placeholder="paste full number or type digits"
        class="rounded-md border border-brand bg-surface-card px-2 py-1.5 text-base md:text-sm text-left sm:text-right text-ink-900 focus:outline-none min-w-[140px]"
      />
    {:else}
      <input
        bind:this={inputEl as HTMLInputElement}
        type={type === 'url' ? 'url' : type}
        bind:value={draft}
        oninput={type === 'email' ? onEmailInput : undefined}
        onkeydown={handleKey}
        placeholder={placeholder}
        list={suggestions.length > 0 ? datalistId : undefined}
        class="rounded-md border border-brand bg-surface-card px-2 py-1.5 text-base md:text-sm text-left sm:text-right text-ink-900 focus:outline-none min-w-[140px]"
      />
      {#if suggestions.length > 0}
        <datalist id={datalistId}>
          {#each suggestions as s (s)}<option value={s}></option>{/each}
        </datalist>
      {/if}
    {/if}
    {#if saving}
      <span class="text-xs text-ink-400">saving…</span>
    {/if}
  </span>
  {#if error}
    <span class="ml-2 block text-[11px] text-tag-salesText">{error}</span>
  {/if}
{:else if value}
  <!-- Read mode: value renders as plain selectable text — or as a real
       <a> for url/email/phone — so clicks COPY / NAVIGATE the way the user
       expects. The edit pencil is a separate button revealed on hover (or
       tappable on mobile at low opacity). Double-click the value also
       enters edit mode.  -->
  <span
    class="group flex w-full min-w-0 max-w-full items-center sm:justify-end gap-1.5 rounded-md px-1.5 py-0.5 text-left sm:text-right text-ink-900"
    title={tooltip}
  >
    {#if resolvedHref}
      <!-- Custom click-through (e.g. kennitala → RSK). Opens in a new tab so
           the user doesn't lose this page. Double-click → edit mode. -->
      <a
        href={resolvedHref}
        target="_blank"
        rel="noreferrer"
        class="block min-w-0 flex-1 {lineCls} text-left sm:text-right hover:underline"
        ondblclick={begin}
      >{display}</a>
    {:else if type === 'url'}
      <a
        href={absUrl(String(value))}
        target="_blank"
        rel="noreferrer"
        class="block min-w-0 flex-1 {lineCls} text-left sm:text-right hover:underline"
        ondblclick={begin}
      >{display}</a>
    {:else if type === 'email'}
      <a
        href={`mailto:${value}`}
        class="block min-w-0 flex-1 {lineCls} text-left sm:text-right hover:underline"
        ondblclick={begin}
      >{display}</a>
    {:else if type === 'phone'}
      <a
        href={`tel:${value}`}
        class="block min-w-0 flex-1 {lineCls} text-left sm:text-right hover:underline"
        ondblclick={begin}
      >{display}</a>
    {:else}
      <!-- Plain text — selectable. Double-click to edit; the pencil
           button alongside is the keyboard-accessible edit affordance. -->
      <span
        class="block min-w-0 flex-1 {lineCls} text-left sm:text-right select-text"
        ondblclick={begin}
      >{display}</span>
    {/if}
    {#if !disabled}
      <button
        type="button"
        onclick={begin}
        aria-label="Edit"
        title="Edit (or double-click the value)"
        class="shrink-0 rounded p-0.5 text-ink-300 opacity-30 hover:bg-surface-hover hover:text-ink-700 hover:opacity-100 group-hover:opacity-100 focus:opacity-100"
      >
        <Icon name="sparkles" size={11} />
      </button>
    {/if}
  </span>
{:else}
  <!-- Empty state: nothing to copy or follow, so a single click does the
       useful thing — opens the editor. -->
  <button
    type="button"
    onclick={begin}
    title={tooltip}
    class="group flex w-full min-w-0 max-w-full items-center sm:justify-end gap-1.5 rounded-md px-1.5 py-0.5 text-left sm:text-right text-ink-300 hover:bg-surface-hover disabled:cursor-default disabled:hover:bg-transparent"
    disabled={disabled}
  >
    <span class="block min-w-0 flex-1 truncate text-left sm:text-right">{placeholder}</span>
    {#if !disabled}
      <Icon name="sparkles" size={11} class="shrink-0 opacity-50 group-hover:opacity-100" />
    {/if}
  </button>
{/if}
