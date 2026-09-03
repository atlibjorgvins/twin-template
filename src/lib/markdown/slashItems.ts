// Slash-command catalogue. Each item knows how to mutate the editor.
// The menu UI lives in MarkdownEditor.svelte — this module is the data
// source so the catalogue is easy to extend without touching layout.

import type { EditorView } from '@codemirror/view';
import {
  toggleHeading,
  toggleBulletList,
  toggleNumberedList,
  toggleTodo,
  toggleQuote,
  insertTable,
  insertDivider,
  insertCodeBlock,
  insertAtCursor
} from './commands';

export type SlashItem = {
  /** Display name in the menu. */
  label: string;
  /** One-line description shown under the label. */
  hint: string;
  /** Words used by the type-to-filter logic in the menu. */
  keywords: string[];
  /** Optional shortcut hint shown on the right (e.g. "# space"). */
  shortcut?: string;
  /** Mutator. Returns once the editor has been changed. */
  run: (view: EditorView) => void;
};

export const SLASH_ITEMS: SlashItem[] = [
  {
    label: 'Heading 1',
    hint: 'Section title',
    keywords: ['h1', 'heading', 'title'],
    shortcut: '#',
    run: (v) => toggleHeading(1)(v)
  },
  {
    label: 'Heading 2',
    hint: 'Subsection title',
    keywords: ['h2', 'heading', 'subtitle'],
    shortcut: '##',
    run: (v) => toggleHeading(2)(v)
  },
  {
    label: 'Heading 3',
    hint: 'Minor title',
    keywords: ['h3', 'heading'],
    shortcut: '###',
    run: (v) => toggleHeading(3)(v)
  },
  {
    label: 'Bullet list',
    hint: 'Plain bullets',
    keywords: ['list', 'ul', 'bullet'],
    shortcut: '- space',
    run: (v) => toggleBulletList(v)
  },
  {
    label: 'Numbered list',
    hint: 'Ordered list',
    keywords: ['list', 'ol', 'numbered'],
    shortcut: '1.',
    run: (v) => toggleNumberedList(v)
  },
  {
    label: 'To-do',
    hint: 'Checkbox list',
    keywords: ['todo', 'task', 'checkbox'],
    shortcut: '- [ ]',
    run: (v) => toggleTodo(v)
  },
  {
    label: 'Quote',
    hint: 'Block quote',
    keywords: ['quote', 'blockquote'],
    shortcut: '>',
    run: (v) => toggleQuote(v)
  },
  {
    label: 'Table',
    hint: '3-column starter',
    keywords: ['table', 'grid'],
    run: (v) => insertTable(v)
  },
  {
    label: 'Code block',
    hint: 'Fenced code',
    keywords: ['code', 'snippet', 'pre'],
    shortcut: '```',
    run: (v) => insertCodeBlock(v)
  },
  {
    label: 'Divider',
    hint: 'Horizontal rule',
    keywords: ['divider', 'hr', 'rule'],
    shortcut: '---',
    run: (v) => insertDivider(v)
  },
  // Whole-document templates. Insert at cursor — the user is in control
  // of where they live.
  {
    label: 'Meeting note template',
    hint: 'Attendees / agenda / decisions / actions',
    keywords: ['template', 'meeting'],
    run: (v) =>
      insertAtCursor(
        v,
        [
          '# Meeting — TITLE',
          '',
          '**Attendees:** ',
          '**Date:** ',
          '',
          '## Agenda',
          '- ',
          '',
          '## Notes',
          '',
          '## Decisions',
          '- ',
          '',
          '## Action items',
          '- [ ] '
        ].join('\n')
      )
  },
  {
    label: 'Daily journal',
    hint: 'Energy / wins / blockers / tomorrow',
    keywords: ['template', 'journal', 'daily'],
    run: (v) =>
      insertAtCursor(
        v,
        [
          '# ' + new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
          '',
          '## Energy',
          '',
          '## Wins',
          '- ',
          '',
          '## Blockers',
          '- ',
          '',
          '## Tomorrow',
          '- [ ] '
        ].join('\n')
      )
  }
];
