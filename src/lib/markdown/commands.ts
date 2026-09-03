// CodeMirror commands that mutate the markdown source the way a user
// expects when clicking toolbar buttons. Every command is a plain
// function `(view: EditorView) => boolean` so it composes cleanly with
// keymaps. They never touch the DOM directly — the toolbar in
// MarkdownEditor.svelte just calls these and the editor re-renders.

import type { EditorView } from '@codemirror/view';
import { EditorSelection, type ChangeSpec, type SelectionRange } from '@codemirror/state';

// ── Inline marks ────────────────────────────────────────────────────────

function wrapRange(
  view: EditorView,
  range: SelectionRange,
  mark: string
): { changes: ChangeSpec; range: SelectionRange } {
  const text = view.state.sliceDoc(range.from, range.to);
  const outerFrom = Math.max(0, range.from - mark.length);
  const outerTo = Math.min(view.state.doc.length, range.to + mark.length);
  const before = view.state.sliceDoc(outerFrom, range.from);
  const after = view.state.sliceDoc(range.to, outerTo);

  // Mark already wraps the selection from the outside → strip it.
  if (before === mark && after === mark) {
    return {
      changes: [
        { from: outerFrom, to: range.from, insert: '' },
        { from: range.to, to: outerTo, insert: '' }
      ],
      range: EditorSelection.range(range.from - mark.length, range.to - mark.length)
    };
  }
  // Or the selection itself includes the marks at both ends → unwrap.
  if (text.startsWith(mark) && text.endsWith(mark) && text.length >= mark.length * 2) {
    const inner = text.slice(mark.length, text.length - mark.length);
    return {
      changes: { from: range.from, to: range.to, insert: inner },
      range: EditorSelection.range(range.from, range.from + inner.length)
    };
  }
  // Otherwise wrap the selection in the mark.
  return {
    changes: { from: range.from, to: range.to, insert: mark + text + mark },
    range: EditorSelection.range(range.from + mark.length, range.to + mark.length)
  };
}

function inlineToggle(mark: string) {
  return (view: EditorView): boolean => {
    const tr = view.state.changeByRange((range) => {
      if (range.empty) {
        // No selection — drop both marks and park the cursor between them.
        const pos = range.from;
        return {
          changes: { from: pos, to: pos, insert: mark + mark },
          range: EditorSelection.cursor(pos + mark.length)
        };
      }
      return wrapRange(view, range, mark);
    });
    view.dispatch(tr);
    view.focus();
    return true;
  };
}

export const toggleBold = inlineToggle('**');
export const toggleItalic = inlineToggle('*');
export const toggleStrikethrough = inlineToggle('~~');
export const toggleInlineCode = inlineToggle('`');

// ── Block prefixes ──────────────────────────────────────────────────────

// Strip a leading heading / list / quote / todo prefix from a line.
function stripBlockPrefix(line: string): { rest: string; removed: number } {
  const m = line.match(/^(#{1,6}\s+|>\s+|-\s\[[ xX]\]\s+|[-*+]\s+|\d+\.\s+)/);
  if (!m) return { rest: line, removed: 0 };
  return { rest: line.slice(m[0].length), removed: m[0].length };
}

function applyLinePrefix(
  view: EditorView,
  makePrefix: (currentPrefix: string, idx: number) => string
): boolean {
  // For each selection range, rewrite every line it spans with the new
  // prefix. After the rewrite, *collapse the selection to a cursor at
  // the end of the last modified line* — that's what users expect right
  // after clicking "H1": stop the highlight, leave the caret ready to
  // keep typing. (Leaving the original range selected meant pressing
  // Enter would replace the whole heading, which felt broken.)
  const changes: ChangeSpec[] = [];
  const newRanges: SelectionRange[] = [];

  let runningDelta = 0;

  for (const r of view.state.selection.ranges) {
    const fromLineNum = view.state.doc.lineAt(r.from).number;
    const toLineNum = view.state.doc.lineAt(r.to).number;

    let rangeDelta = 0;
    let lastNewLineEnd = 0;

    for (let n = fromLineNum; n <= toLineNum; n++) {
      const line = view.state.doc.line(n);
      const stripped = stripBlockPrefix(line.text);
      const currentPrefix = line.text.slice(0, stripped.removed);
      const newPrefix = makePrefix(currentPrefix, n - fromLineNum);
      const nextText = newPrefix + stripped.rest;
      changes.push({ from: line.from, to: line.to, insert: nextText });

      const delta = nextText.length - line.text.length;
      rangeDelta += delta;
      // Track where the last rewritten line ends in the *new* document
      // coordinates so we can park the cursor there.
      lastNewLineEnd = line.to + runningDelta + rangeDelta;
    }

    newRanges.push(EditorSelection.cursor(lastNewLineEnd));
    runningDelta += rangeDelta;
  }

  view.dispatch({
    changes,
    selection: EditorSelection.create(newRanges, newRanges.length - 1)
  });
  view.focus();
  return true;
}

export function toggleHeading(level: 1 | 2 | 3) {
  const marker = '#'.repeat(level) + ' ';
  return (view: EditorView): boolean =>
    applyLinePrefix(view, (current) => (current === marker ? '' : marker));
}

export const toggleQuote = (view: EditorView): boolean =>
  applyLinePrefix(view, (current) => (current === '> ' ? '' : '> '));

export const toggleBulletList = (view: EditorView): boolean =>
  applyLinePrefix(view, (current) => (/^[-*+]\s+$/.test(current) ? '' : '- '));

export const toggleNumberedList = (view: EditorView): boolean =>
  applyLinePrefix(view, (current, idx) => (/^\d+\.\s+$/.test(current) ? '' : `${idx + 1}. `));

export const toggleTodo = (view: EditorView): boolean =>
  applyLinePrefix(view, (current) => (/^-\s\[[ xX]\]\s+$/.test(current) ? '' : '- [ ] '));

// ── Insertions ──────────────────────────────────────────────────────────

export function insertAtCursor(view: EditorView, text: string, cursorOffset?: number): void {
  const r = view.state.selection.main;
  const cursor = cursorOffset == null ? r.from + text.length : r.from + cursorOffset;
  view.dispatch({
    changes: { from: r.from, to: r.to, insert: text },
    selection: EditorSelection.cursor(cursor)
  });
  view.focus();
}

export function insertLink(view: EditorView): boolean {
  const r = view.state.selection.main;
  const selected = view.state.sliceDoc(r.from, r.to) || 'link text';
  const insert = `[${selected}](url)`;
  const urlFrom = r.from + selected.length + 3;
  view.dispatch({
    changes: { from: r.from, to: r.to, insert },
    selection: EditorSelection.range(urlFrom, urlFrom + 3)
  });
  view.focus();
  return true;
}

export function insertImage(view: EditorView, url: string, alt = 'image'): void {
  insertAtCursor(view, `![${alt}](${url})\n`);
}

export function insertTable(view: EditorView): boolean {
  const tbl = [
    '| Column A | Column B | Column C |',
    '|----------|----------|----------|',
    '| Cell     | Cell     | Cell     |',
    '| Cell     | Cell     | Cell     |',
    ''
  ].join('\n');
  insertAtCursor(view, tbl);
  return true;
}

export function insertDivider(view: EditorView): boolean {
  insertAtCursor(view, '\n\n---\n\n');
  return true;
}

export function insertCodeBlock(view: EditorView, lang = ''): boolean {
  const r = view.state.selection.main;
  const selected = view.state.sliceDoc(r.from, r.to);
  const block = '```' + lang + '\n' + (selected || '') + '\n```\n';
  const cursorPos = r.from + 4 + lang.length;
  view.dispatch({
    changes: { from: r.from, to: r.to, insert: block },
    selection: EditorSelection.cursor(cursorPos)
  });
  view.focus();
  return true;
}
