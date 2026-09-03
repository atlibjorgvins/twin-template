<script lang="ts">
  /**
   * Obsidian-style markdown editor.
   *
   * Underneath: a CodeMirror 6 editor backed by `@codemirror/lang-markdown`.
   * What's saved is plain markdown — the editor never produces HTML.
   *
   * On top: an optional Live Preview mode (decorations hide markdown
   * syntax tokens on lines where the cursor isn't), a floating selection
   * toolbar, a `/` slash-command menu, wiki-link autocomplete (`[[…]]`)
   * that searches People/Orgs/Projects via Directus, image paste/drop
   * with Directus upload, and Tab/Enter shortcuts inside tables.
   */
  import { onDestroy, onMount, tick } from 'svelte';
  import { EditorState, EditorSelection, Compartment, RangeSetBuilder } from '@codemirror/state';
  import {
    EditorView,
    keymap,
    Decoration,
    ViewPlugin,
    type ViewUpdate,
    type DecorationSet
  } from '@codemirror/view';
  import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
  import {
    syntaxHighlighting,
    HighlightStyle,
    syntaxTree,
    bracketMatching,
    indentOnInput
  } from '@codemirror/language';
  import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
  import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
  import { tags as t } from '@lezer/highlight';

  import Icon from '$lib/Icon.svelte';
  import {
    toggleBold,
    toggleItalic,
    toggleStrikethrough,
    toggleInlineCode,
    toggleHeading,
    toggleBulletList,
    toggleNumberedList,
    toggleTodo,
    toggleQuote,
    insertLink
  } from '$lib/markdown/commands';
  import { wikiLinkSource } from '$lib/markdown/wikiLink';
  import { mentionSource } from '$lib/markdown/mention';
  import { imagePasteExtension } from '$lib/markdown/imagePaste';
  import { SLASH_ITEMS, type SlashItem } from '$lib/markdown/slashItems';

  type Mode = 'live' | 'source';
  type Props = {
    value: string;
    onChange: (value: string) => void;
    mode?: Mode;
    placeholder?: string;
  };
  let { value, onChange, mode = 'live', placeholder = '' }: Props = $props();

  let host: HTMLDivElement | undefined = $state();
  let containerEl: HTMLDivElement | undefined = $state();
  let view: EditorView | null = null;
  let lastSetValue = value;
  const livePreviewCompartment = new Compartment();

  // Mobile layout flips the floating toolbar into a docked bottom strip
  // because (a) the iOS native selection menu already owns the space
  // above the caret, (b) a horizontal bubble can clip off-viewport at
  // 375px width, and (c) finger-sized tap targets need ~36px not ~28px.
  // Reactive so resizing/rotating switches modes live.
  let isMobile = $state(false);
  let mq: MediaQueryList | null = null;
  function updateIsMobile() {
    if (!mq) return;
    isMobile = mq.matches;
  }

  // ── Helga highlight ────────────────────────────────────────────────────
  const helgaHighlight = HighlightStyle.define([
    { tag: t.heading1, fontFamily: 'var(--font-display)', fontWeight: '700', fontSize: '1.9em', letterSpacing: '-0.03em', color: 'var(--text-primary)' },
    { tag: t.heading2, fontFamily: 'var(--font-display)', fontWeight: '700', fontSize: '1.55em', letterSpacing: '-0.025em', color: 'var(--text-primary)' },
    { tag: t.heading3, fontFamily: 'var(--font-display)', fontWeight: '600', fontSize: '1.25em', letterSpacing: '-0.02em', color: 'var(--text-primary)' },
    { tag: t.heading4, fontFamily: 'var(--font-display)', fontWeight: '600', fontSize: '1.1em', color: 'var(--text-primary)' },
    { tag: [t.heading5, t.heading6], fontFamily: 'var(--font-display)', fontWeight: '600', fontSize: '1em', color: 'var(--text-secondary)' },
    { tag: t.strong, fontWeight: '700', color: 'var(--text-primary)' },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--text-tertiary)' },
    { tag: t.link, color: 'var(--accent-electric)' },
    { tag: t.url, color: 'var(--accent-electric)' },
    { tag: t.monospace, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', backgroundColor: 'var(--bg-tertiary)', padding: '0 4px', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)' },
    { tag: t.quote, color: 'var(--text-secondary)', fontStyle: 'italic' },
    { tag: t.list, color: 'var(--text-primary)' },
    { tag: t.processingInstruction, color: 'var(--text-tertiary)' },
    { tag: t.contentSeparator, color: 'var(--text-tertiary)' }
  ]);

  // ── Live-preview decoration plugin ────────────────────────────────────
  const MARK_NODES = new Set([
    'HeaderMark',
    'EmphasisMark',
    'StrongMark',
    'CodeMark',
    'LinkMark',
    'URL',
    'QuoteMark',
    'ListMark',
    'StrikethroughMark'
  ]);

  function buildLivePreviewDecorations(viewIn: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const cursor = viewIn.state.selection.main;
    const cursorLine = viewIn.state.doc.lineAt(cursor.head).number;
    for (const { from, to } of viewIn.visibleRanges) {
      syntaxTree(viewIn.state).iterate({
        from,
        to,
        enter: (node) => {
          if (!MARK_NODES.has(node.name)) return;
          const line = viewIn.state.doc.lineAt(node.from);
          if (line.number === cursorLine) return;
          builder.add(node.from, node.to, Decoration.replace({}));
        }
      });
    }
    return builder.finish();
  }

  const livePreviewPlugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(v: EditorView) {
        this.decorations = buildLivePreviewDecorations(v);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = buildLivePreviewDecorations(update.view);
        }
      }
    },
    { decorations: (v) => v.decorations }
  );

  // ── Theme ──────────────────────────────────────────────────────────────
  const helgaTheme = EditorView.theme({
    '&': { color: 'var(--text-primary)', backgroundColor: 'transparent', fontSize: '15px', lineHeight: '1.65' },
    '.cm-scroller': { fontFamily: 'var(--font-body)', padding: '4px 0' },
    '.cm-content': { padding: '8px 4px', caretColor: 'var(--accent-electric)' },
    '.cm-line': { padding: '0 2px' },
    '.cm-cursor': { borderLeftColor: 'var(--accent-electric)', borderLeftWidth: '2px' },
    '&.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'var(--accent-alpha-30)' },
    '.cm-selectionMatch': { backgroundColor: 'var(--accent-alpha-10)' },
    '.cm-gutters': { display: 'none' },
    '.cm-tooltip': {
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-md)',
      color: 'var(--text-primary)',
      boxShadow: 'none'
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
      padding: '4px 10px',
      fontFamily: 'var(--font-body)',
      fontSize: '13px'
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      background: 'var(--accent-alpha-10)',
      color: 'var(--accent-electric)'
    },
    '.cm-completionDetail': { color: 'var(--text-tertiary)', fontSize: '11px', fontStyle: 'normal' }
  });

  // ── Toolbar state ──────────────────────────────────────────────────────
  // Floats above any non-empty selection. Position recalculated from
  // CodeMirror's coordsAtPos so it tracks scroll inside the editor.
  let toolbar = $state<{ visible: boolean; top: number; left: number }>({
    visible: false,
    top: 0,
    left: 0
  });

  function updateToolbar(v: EditorView) {
    const r = v.state.selection.main;
    if (r.empty || !containerEl) {
      toolbar = { visible: false, top: 0, left: 0 };
      return;
    }
    // Mobile uses a sticky bottom strip, so we don't compute floating
    // coordinates — just flip visibility on.
    if (isMobile) {
      toolbar = { visible: true, top: 0, left: 0 };
      return;
    }
    const start = v.coordsAtPos(r.from);
    const end = v.coordsAtPos(r.to);
    if (!start || !end) return;
    const box = containerEl.getBoundingClientRect();
    const left = (start.left + end.right) / 2 - box.left;
    const top = Math.min(start.top, end.top) - box.top - 8;
    toolbar = { visible: true, top, left };
  }

  // ── Slash menu state ───────────────────────────────────────────────────
  let slash = $state<{
    visible: boolean;
    top: number;
    left: number;
    query: string;
    triggerPos: number;
    selectedIdx: number;
  }>({
    visible: false,
    top: 0,
    left: 0,
    query: '',
    triggerPos: -1,
    selectedIdx: 0
  });
  const filteredSlash = $derived.by<SlashItem[]>(() => {
    const q = slash.query.toLowerCase().trim();
    if (!q) return SLASH_ITEMS;
    return SLASH_ITEMS.filter(
      (it) => it.label.toLowerCase().includes(q) || it.keywords.some((k) => k.includes(q))
    );
  });

  function openSlashMenu(v: EditorView, pos: number) {
    if (!containerEl) return;
    const coords = v.coordsAtPos(pos);
    if (!coords) return;
    const box = containerEl.getBoundingClientRect();
    slash = {
      visible: true,
      top: coords.bottom - box.top + 4,
      left: coords.left - box.left,
      query: '',
      triggerPos: pos,
      selectedIdx: 0
    };
  }
  function closeSlashMenu() {
    slash = { visible: false, top: 0, left: 0, query: '', triggerPos: -1, selectedIdx: 0 };
  }
  function runSlashItem(item: SlashItem) {
    if (!view) return;
    // Remove the "/query" trigger first so the inserted content is clean.
    if (slash.triggerPos >= 0) {
      view.dispatch({
        changes: { from: slash.triggerPos, to: view.state.selection.main.head, insert: '' },
        selection: { anchor: slash.triggerPos }
      });
    }
    closeSlashMenu();
    item.run(view);
  }

  // ── Image upload status (surfaced as a small badge below the toolbar) ──
  let imageUploading = $state(false);
  let imageError = $state('');

  // ── Table Tab/Enter keymap ─────────────────────────────────────────────
  // Inside a markdown table row (line starts and ends with `|`) Tab moves
  // the cursor into the next cell, Shift+Tab into the previous one, and
  // Enter at the end of the last row appends a new row with matching
  // column count.
  function isTableLine(line: string): boolean {
    return /^\s*\|.*\|\s*$/.test(line);
  }
  function cellRangesIn(line: string, lineFrom: number): { from: number; to: number }[] {
    const out: { from: number; to: number }[] = [];
    const idxs: number[] = [];
    for (let i = 0; i < line.length; i++) if (line[i] === '|') idxs.push(i);
    for (let i = 0; i < idxs.length - 1; i++) {
      out.push({ from: lineFrom + idxs[i] + 1, to: lineFrom + idxs[i + 1] });
    }
    return out;
  }
  function tableNextCell(v: EditorView, dir: 1 | -1): boolean {
    const r = v.state.selection.main;
    if (!r.empty) return false;
    const line = v.state.doc.lineAt(r.head);
    if (!isTableLine(line.text)) return false;
    const cells = cellRangesIn(line.text, line.from);
    if (!cells.length) return false;
    const idx = cells.findIndex((c) => r.head >= c.from && r.head <= c.to);
    const next = idx + dir;
    if (next >= 0 && next < cells.length) {
      const target = cells[next];
      v.dispatch({ selection: EditorSelection.range(target.from + 1, target.to - 1) });
      v.focus();
      return true;
    }
    // Walked off the line — try adjacent table line in the same direction.
    const adjLineNum = line.number + dir;
    if (adjLineNum < 1 || adjLineNum > v.state.doc.lines) return false;
    const adjacent = v.state.doc.line(adjLineNum);
    if (adjacent && isTableLine(adjacent.text)) {
      const c = cellRangesIn(adjacent.text, adjacent.from);
      if (c.length) {
        const target = dir === 1 ? c[0] : c[c.length - 1];
        v.dispatch({ selection: EditorSelection.range(target.from + 1, target.to - 1) });
        v.focus();
        return true;
      }
    }
    return false;
  }
  function tableEnterNewRow(v: EditorView): boolean {
    const r = v.state.selection.main;
    if (!r.empty) return false;
    const line = v.state.doc.lineAt(r.head);
    if (!isTableLine(line.text)) return false;
    // Count columns from the line itself.
    const cells = cellRangesIn(line.text, line.from);
    if (!cells.length) return false;
    const cols = cells.length;
    const blank = '|' + ' '.repeat(8) + '|'.repeat(0) + '   '.repeat(0); // placeholder
    const row = '|' + Array(cols).fill('   ').join('|') + '|';
    v.dispatch({
      changes: { from: line.to, to: line.to, insert: '\n' + row },
      selection: EditorSelection.cursor(line.to + 2) // just after the first `| `
    });
    v.focus();
    return true;
  }

  // ── Build state ────────────────────────────────────────────────────────
  function buildState(initial: string) {
    return EditorState.create({
      doc: initial,
      extensions: [
        history(),
        closeBrackets(),
        keymap.of([
          // Order matters — these run before defaultKeymap.
          { key: 'Mod-b', run: toggleBold },
          { key: 'Mod-i', run: toggleItalic },
          { key: 'Mod-Shift-x', run: toggleStrikethrough },
          { key: 'Mod-e', run: toggleInlineCode },
          { key: 'Mod-k', run: insertLink },
          { key: 'Mod-Alt-1', run: toggleHeading(1) },
          { key: 'Mod-Alt-2', run: toggleHeading(2) },
          { key: 'Mod-Alt-3', run: toggleHeading(3) },
          { key: 'Tab', run: (v) => tableNextCell(v, 1) },
          { key: 'Shift-Tab', run: (v) => tableNextCell(v, -1) },
          { key: 'Enter', run: tableEnterNewRow },
          ...closeBracketsKeymap,
          // Autocomplete keymap binds Escape → closeCompletion, so the
          // mention / wiki-link / brackets popups all dismiss on Esc.
          ...completionKeymap,
          ...defaultKeymap,
          ...historyKeymap
        ]),
        markdown({ base: markdownLanguage, codeLanguages: [] }),
        syntaxHighlighting(helgaHighlight),
        bracketMatching(),
        indentOnInput(),
        EditorView.lineWrapping,
        autocompletion({
          override: [wikiLinkSource, mentionSource],
          icons: false,
          activateOnTyping: true
        }),
        imagePasteExtension({
          onUploading: (b) => (imageUploading = b),
          onError: (m) => (imageError = m)
        }),
        helgaTheme,
        livePreviewCompartment.of(mode === 'live' ? [livePreviewPlugin] : []),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            const next = u.state.doc.toString();
            if (next !== lastSetValue) {
              lastSetValue = next;
              onChange(next);
            }
            // Slash menu tracking: if the user typed past the trigger,
            // update its query and recompute position-aware filters.
            if (slash.visible) {
              const head = u.view.state.selection.main.head;
              if (head < slash.triggerPos) {
                closeSlashMenu();
              } else {
                slash = {
                  ...slash,
                  query: u.view.state.sliceDoc(slash.triggerPos + 1, head)
                };
              }
            }
            // Detect a fresh `/` trigger at line start (or after whitespace).
            else {
              const head = u.view.state.selection.main.head;
              if (head > 0 && u.view.state.sliceDoc(head - 1, head) === '/') {
                const lineStart = u.view.state.doc.lineAt(head).from;
                const before = u.view.state.sliceDoc(lineStart, head - 1);
                if (!before.trim()) openSlashMenu(u.view, head - 1);
              }
            }
          }
          if (u.selectionSet || u.docChanged) updateToolbar(u.view);
        }),
        EditorView.domEventHandlers({
          blur() {
            // Defer so the toolbar click handler can fire first.
            setTimeout(() => {
              if (document.activeElement !== view?.contentDOM) {
                toolbar = { visible: false, top: 0, left: 0 };
                closeSlashMenu();
              }
            }, 120);
            return false;
          }
        })
      ]
    });
  }

  onMount(() => {
    if (!host) return;
    view = new EditorView({ state: buildState(value), parent: host });
    if (typeof window !== 'undefined' && window.matchMedia) {
      mq = window.matchMedia('(max-width: 640px), (pointer: coarse)');
      updateIsMobile();
      mq.addEventListener('change', updateIsMobile);
    }
  });

  onDestroy(() => {
    view?.destroy();
    view = null;
    mq?.removeEventListener('change', updateIsMobile);
    mq = null;
  });

  $effect(() => {
    if (!view) return;
    if (value === lastSetValue) return;
    const current = view.state.doc.toString();
    if (current === value) {
      lastSetValue = value;
      return;
    }
    lastSetValue = value;
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  });

  $effect(() => {
    if (!view) return;
    view.dispatch({
      effects: livePreviewCompartment.reconfigure(mode === 'live' ? [livePreviewPlugin] : [])
    });
  });

  // Toolbar button helper — runs a command, keeps focus in the editor.
  function run(cmd: (v: EditorView) => boolean) {
    if (!view) return;
    cmd(view);
    void tick().then(() => updateToolbar(view!));
  }

  // Slash menu + selection toolbar keyboard handlers — wired via a
  // window keydown so Esc works even when focus is on the editor's
  // content area. Esc precedence: slash menu → selection toolbar.
  function onWindowKey(e: KeyboardEvent) {
    if (slash.visible) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSlashMenu();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        slash = { ...slash, selectedIdx: Math.min(slash.selectedIdx + 1, filteredSlash.length - 1) };
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        slash = { ...slash, selectedIdx: Math.max(0, slash.selectedIdx - 1) };
        return;
      }
      if (e.key === 'Enter') {
        const it = filteredSlash[slash.selectedIdx];
        if (it) {
          e.preventDefault();
          runSlashItem(it);
        }
        return;
      }
    }
    // Selection toolbar: Esc clears the selection (collapses to caret)
    // which hides the toolbar via the existing updateToolbar logic.
    if (toolbar.visible && e.key === 'Escape' && view) {
      const r = view.state.selection.main;
      if (!r.empty) {
        e.preventDefault();
        view.dispatch({ selection: EditorSelection.cursor(r.head) });
        toolbar = { visible: false, top: 0, left: 0 };
      }
    }
  }
</script>

<svelte:window onkeydown={onWindowKey} />

<!-- Clicking anywhere in the editor card focuses the editor and parks the
     cursor at the end of the doc. Without this, clicks in the empty area
     below short notes feel inert — the user has to find the actual text
     to start typing. We only fire when the click landed outside the
     editor's content area (otherwise CodeMirror's own click handling
     places the cursor where the user clicked, which we want to preserve). -->
<div
  bind:this={containerEl}
  class="markdown-editor-container"
  onclick={(e) => {
    if (!view) return;
    const target = e.target as HTMLElement | null;
    // CodeMirror handles clicks within `.cm-content` itself.
    if (target?.closest('.cm-content')) return;
    // Don't steal clicks from the floating toolbar / slash menu.
    if (target?.closest('.md-toolbar, .md-slash, .md-status')) return;
    const endPos = view.state.doc.length;
    view.dispatch({ selection: { anchor: endPos } });
    view.focus();
  }}
  role="presentation"
>
  <div
    bind:this={host}
    class="markdown-editor"
    data-placeholder={placeholder}
    data-empty={value.length === 0}
  ></div>

  <!-- Selection toolbar.
       Desktop: a floating bubble positioned above the selection.
       Mobile: a docked, horizontally-scrollable strip pinned to the
       bottom of the editor card. Same buttons either way. -->
  {#if toolbar.visible}
    <div
      class="md-toolbar"
      class:md-toolbar--mobile={isMobile}
      style={isMobile ? '' : `top: ${toolbar.top}px; left: ${toolbar.left}px; transform: translate(-50%, -100%);`}
      onmousedown={(e) => e.preventDefault()}
      ontouchstart={(e) => {
        // On iOS, tapping a toolbar button steals focus from the editor
        // and collapses the selection before our click handler runs.
        // Preventing the default touchstart keeps the selection intact.
        if (isMobile) e.preventDefault();
      }}
    >
      <div class="md-toolbar-inner">
        <button title="Heading 1" onclick={() => run(toggleHeading(1))}><span class="font-display font-bold">H1</span></button>
        <button title="Heading 2" onclick={() => run(toggleHeading(2))}><span class="font-display font-bold">H2</span></button>
        <button title="Heading 3" onclick={() => run(toggleHeading(3))}><span class="font-display font-bold">H3</span></button>
        <span class="sep" aria-hidden="true"></span>
        <button title="Bold (⌘B)" onclick={() => run(toggleBold)}><span class="font-bold">B</span></button>
        <button title="Italic (⌘I)" onclick={() => run(toggleItalic)}><span class="italic">I</span></button>
        <button title="Strikethrough (⌘⇧X)" onclick={() => run(toggleStrikethrough)}><span style="text-decoration: line-through;">S</span></button>
        <button title="Inline code (⌘E)" onclick={() => run(toggleInlineCode)}><span style="font-family: ui-monospace,Menlo,monospace;">{'<>'}</span></button>
        <span class="sep" aria-hidden="true"></span>
        <button title="Link (⌘K)" onclick={() => run(insertLink)}><Icon name="globe" size={14} /></button>
        <button title="Quote" onclick={() => run(toggleQuote)}>&ldquo;&rdquo;</button>
        <button title="Bullet list" onclick={() => run(toggleBulletList)}>•</button>
        <button title="Numbered list" onclick={() => run(toggleNumberedList)}>1.</button>
        <button title="To-do" onclick={() => run(toggleTodo)}>☐</button>
      </div>
    </div>
  {/if}

  <!-- Slash command menu -->
  {#if slash.visible && filteredSlash.length > 0}
    <div
      class="md-slash"
      style="top: {slash.top}px; left: {slash.left}px;"
      onmousedown={(e) => e.preventDefault()}
    >
      <div class="md-slash-head">Type to filter — <span class="opacity-60">Esc to cancel</span></div>
      {#each filteredSlash as item, i (item.label)}
        <button
          class="md-slash-item"
          aria-selected={i === slash.selectedIdx}
          onclick={() => runSlashItem(item)}
          onmouseenter={() => (slash = { ...slash, selectedIdx: i })}
        >
          <span class="md-slash-label">{item.label}</span>
          <span class="md-slash-hint">{item.hint}</span>
          {#if item.shortcut}
            <span class="md-slash-shortcut">{item.shortcut}</span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}

  <!-- Image upload status / errors -->
  {#if imageUploading || imageError}
    <div class="md-status" class:err={!!imageError}>
      {imageError || 'Uploading image…'}
      {#if imageError}
        <button class="md-status-x" onclick={() => (imageError = '')} aria-label="Dismiss">×</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .markdown-editor-container {
    position: relative;
    width: 100%;
  }
  .markdown-editor {
    width: 100%;
    min-height: 24rem;
    display: flex;
    flex-direction: column;
  }
  /* Stretch CodeMirror to fill the host so clicks anywhere within the
     card visible area land on `.cm-content` and CM's native click
     handler can position the cursor. */
  .markdown-editor :global(.cm-editor) {
    outline: none;
    background: transparent;
    flex: 1 1 auto;
    min-height: 24rem;
  }
  .markdown-editor :global(.cm-editor.cm-focused) { outline: none; }
  .markdown-editor :global(.cm-scroller) { min-height: 24rem; }
  .markdown-editor[data-empty='true']::before {
    content: attr(data-placeholder);
    position: absolute;
    pointer-events: none;
    color: var(--text-tertiary);
    padding: 12px 6px;
    font-family: var(--font-body);
    font-size: 15px;
    line-height: 1.65;
  }

  /* ── Selection toolbar ──────────────────────────────────────────────
       Desktop default: a floating bubble. Mobile (.md-toolbar--mobile):
       a docked, scrollable strip pinned to the bottom of the editor
       card. The strip uses position:sticky so it follows the editor in
       the page flow without floating over the iOS native selection
       menu. Tap targets bump from 28px → 36px on mobile. */
  .md-toolbar {
    position: absolute;
    z-index: 30;
    padding: 4px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
  }
  .md-toolbar-inner {
    display: inline-flex;
    align-items: center;
    gap: 1px;
    white-space: nowrap;
  }
  .md-toolbar button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.75rem;
    height: 1.75rem;
    padding: 0 0.4rem;
    font-size: 12px;
    color: var(--text-secondary);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
  }
  .md-toolbar button:hover {
    background: var(--accent-alpha-10);
    color: var(--accent-electric);
  }
  .md-toolbar .sep {
    flex-shrink: 0;
    width: 1px;
    height: 1rem;
    background: var(--border-subtle);
    margin: 0 0.15rem;
  }

  /* Mobile variant: full-width strip, sticky to the bottom of the
     editor container, horizontally scrollable, generous tap targets.
     We override the inline `top/left/transform` set on desktop by
     pinning position to `auto/0/0/bottom: 0`. */
  .md-toolbar--mobile {
    position: sticky;
    top: auto !important;
    left: 0 !important;
    right: 0;
    bottom: 0;
    transform: none !important;
    z-index: 30;
    margin-top: 0.5rem;
    padding: 6px 4px;
    border-radius: var(--radius-md);
    box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.10);
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch;
    /* Hide scrollbar — feel native. */
    scrollbar-width: none;
  }
  .md-toolbar--mobile::-webkit-scrollbar { display: none; }
  .md-toolbar--mobile .md-toolbar-inner {
    gap: 2px;
    min-width: 100%;
    justify-content: flex-start;
  }
  .md-toolbar--mobile button {
    min-width: 2.5rem;
    height: 2.5rem;
    padding: 0 0.6rem;
    font-size: 14px;
  }
  .md-toolbar--mobile .sep {
    height: 1.25rem;
  }

  /* Slash command menu */
  .md-slash {
    position: absolute;
    z-index: 30;
    width: min(19rem, calc(100vw - 1.5rem));
    max-height: 22rem;
    overflow-y: auto;
    background: var(--bg-secondary);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
    padding: 4px;
  }
  .md-slash-head {
    font-family: var(--font-display);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-tertiary);
    padding: 6px 8px;
  }
  .md-slash-item {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-rows: auto auto;
    column-gap: 0.5rem;
    width: 100%;
    text-align: left;
    padding: 6px 8px;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: var(--text-primary);
    transition: background var(--transition-fast), color var(--transition-fast);
  }
  .md-slash-item:hover,
  .md-slash-item[aria-selected='true'] {
    background: var(--accent-alpha-10);
    color: var(--accent-electric);
  }
  .md-slash-label {
    grid-column: 1;
    grid-row: 1;
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 13px;
    letter-spacing: -0.01em;
  }
  .md-slash-hint {
    grid-column: 1;
    grid-row: 2;
    font-size: 11px;
    color: var(--text-tertiary);
  }
  .md-slash-shortcut {
    grid-column: 2;
    grid-row: 1 / span 2;
    align-self: center;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 10px;
    color: var(--text-tertiary);
    padding: 2px 6px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
  }

  /* Image upload status badge */
  .md-status {
    position: absolute;
    bottom: -0.5rem;
    right: 0;
    transform: translateY(100%);
    padding: 4px 10px;
    font-size: 12px;
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-pill);
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }
  .md-status.err {
    color: var(--state-danger);
    border-color: var(--state-danger);
  }
  .md-status-x {
    background: transparent;
    border: none;
    color: inherit;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
  }
</style>
