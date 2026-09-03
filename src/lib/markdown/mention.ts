// @-mention autocomplete. Typing `@` followed by part of a person's
// name opens a popup that searches People in Directus. Picking a result
// expands the `@query` token into a markdown link to that person's
// page: `[Name](/people/123)` — so it round-trips through the markdown
// editor and renders as a link in any other markdown viewer too.

import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { searchPeople, personName } from '$lib/directus';

export async function mentionSource(
  context: CompletionContext
): Promise<CompletionResult | null> {
  // Match `@` followed by anything that isn't a newline, `]`, or `[`.
  // The earlier regex constrained the query too tightly and stopped
  // matching past 20 chars or after a second space — which felt like
  // the popup "stopped working" mid-name.
  const before = context.matchBefore(/@[^\n\]\[@]*/);
  if (!before || !before.text.startsWith('@')) return null;

  const query = before.text.slice(1).trim();

  // Don't trigger on the bare `@` keystroke unless completion was
  // invoked manually (Ctrl-Space → context.explicit === true).
  if (!query && !context.explicit) return null;

  // Avoid firing when `@` is mid-word (e.g. inside an email address).
  if (before.from > 0) {
    const prevChar = context.state.sliceDoc(before.from - 1, before.from);
    if (/[\w.]/.test(prevChar)) return null;
  }

  // Tokenise the query so "@atli björg" matches "Atli Björgvinsson".
  // Directus' `_icontains` looks for a case-insensitive literal substring, so passing
  // "atli björg" as a single query is too brittle. Instead we search by
  // the most-specific token (longest, then first) and filter the rest
  // of the tokens client-side against the resolved name. Falls back to
  // an empty query when the user just typed `@`.
  const tokens = query.split(/\s+/).filter(Boolean);
  const primary = tokens.slice().sort((a, b) => b.length - a.length)[0] ?? '';
  let people: Array<{ id: number; full_name?: string | null; first_name?: string | null; last_name?: string | null }> = [];
  try {
    people = (await searchPeople(primary, 30)) as typeof people;
  } catch {
    return null;
  }
  if (tokens.length > 1) {
    const lowerTokens = tokens.map((t) => t.toLowerCase());
    people = people.filter((p) => {
      const haystack = personName(p as never).toLowerCase();
      return lowerTokens.every((t) => haystack.includes(t));
    });
  }
  people = people.slice(0, 8);

  return {
    from: before.from,
    to: context.pos,
    filter: false, // server ranks; client-side filter would discard hits
    // No `validFor` — that's deliberate. Setting it lets CodeMirror
    // reuse the existing list while it still matches, and combined
    // with `filter: false` the popup gets stuck on the original
    // results as the user keeps typing. Without it, every keystroke
    // re-invokes this source and we get fresh Directus matches.
    options: people.map((p) => {
      const name = personName(p as never);
      return {
        label: name,
        type: 'person',
        detail: 'person',
        apply: `[${name}](/people/${p.id})`
      };
    })
  };
}
