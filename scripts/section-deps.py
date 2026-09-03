#!/usr/bin/env python3
"""Which sections of src/lib/directus.ts can be split out, and in what order.

    python3 scripts/section-deps.py            # all sections
    python3 scripts/section-deps.py 9180 9518  # one candidate range

A section is safe to extract when it is a leaf in BOTH directions:

  outgoing  it calls nothing defined elsewhere in directus.ts
  incoming  nothing left in directus.ts calls IT

Checking only the first direction is a mistake that has already been made: the
focus queue had zero outgoing dependencies, but the task-closing/Asana code
that stayed behind used FocusTask, FOCUS_FIELDS and getActiveFocusTask. Moving
it produced 27 "Cannot find name" errors, because `export * from` re-exports a
module outward without bringing its names back into this file's own scope.

Incoming dependencies are not a blocker — they are a signal that directus.ts
needs an explicit `import` (and `import type` for types, which
verbatimModuleSyntax requires). This script tells you which.

Type-only dependencies never block: `import type` is erased at compile time, so
it creates no runtime cycle.

Two things this script does NOT catch, both of which have bitten:

  * Relative paths inside the moved block. `from './scope'` meant src/lib/scope
    while the code lived in src/lib; from src/lib/data it means
    src/lib/data/scope. Rewrite to `$lib/scope` when moving.
  * DYNAMIC imports. `await import('./focusSession')` is invisible to any
    search for `from '...'`, and it failed exactly this way — the only symptom
    was one "Cannot find module" error after everything else was green.
"""
import re, sys

SRC = 'src/lib/directus.ts'
lines = open(SRC, encoding='utf8').read().split('\n')

defs = {}
for i, l in enumerate(lines):
    m = re.match(r'^(?:export\s+)?(?:async\s+)?(function|class)\s+([A-Za-z_$][\w$]*)', l)
    t = re.match(r'^(?:export\s+)?(type|interface|enum)\s+([A-Za-z_$][\w$]*)', l)
    c = re.match(r'^(?:export\s+)?(const|let)\s+([A-Za-z_$][\w$]*)', l)
    kind = name = None
    if m:   kind, name = 'runtime', m.group(2)
    elif t: kind, name = 'type',    t.group(2)
    elif c: kind, name = 'runtime', c.group(2)
    if not name: continue
    j = i + 1
    while j < len(lines) and not re.match(
            r'^(?:export\s+)?(?:async\s+)?(?:function|class|type|interface|enum|const|let)\s|^// ─', lines[j]):
        j += 1
    defs[name] = (i, j - 1, kind)

def strip_comments(text):
    """Names only count when they appear in code — 'decorate' showed up as an
    incoming dependency purely because two comments used the English word."""
    out = re.sub(r'/\*.*?\*/', '', text, flags=re.S)
    return '\n'.join(re.sub(r'//.*$', '', l) for l in out.split('\n'))

def analyse(start, end):
    inside  = strip_comments('\n'.join(lines[start:end+1]))
    outside = strip_comments('\n'.join(lines[:start] + lines[end+1:]))
    out_rt, out_ty, incoming = [], [], []
    for w in sorted(set(re.findall(r'\b[A-Za-z_$][\w$]*\b', inside))):
        if w not in defs: continue
        ds, de, kind = defs[w]
        if ds >= start and de <= end: continue
        (out_rt if kind == 'runtime' else out_ty).append(w)
    for w, (ds, de, kind) in defs.items():
        if not (ds >= start and de <= end): continue
        if re.search(r'\b' + re.escape(w) + r'\b', outside):
            incoming.append(f'{w}:{kind}')
    return out_rt, out_ty, sorted(incoming)

if len(sys.argv) == 3:
    s, e = int(sys.argv[1]) - 1, int(sys.argv[2]) - 1
    rt, ty, inc = analyse(s, e)
    print(f'lines {s+1}-{e+1} ({e-s+1} lines)')
    print(f'  outgoing runtime : {rt or "NONE — safe to move"}')
    print(f'  outgoing types   : {ty or "none"}   (import type — erased, no cycle)')
    print(f'  incoming         : {inc or "none"}  (directus.ts must import these back)')
    sys.exit(0)

banners = [(i, l) for i, l in enumerate(lines) if re.match(r'^// ─{2,}|^// ─── ', l)]
print(f'{len(defs)} definitions, {len(banners)} sections\n')
for idx, (ln, text) in enumerate(banners):
    nxt = banners[idx+1][0] - 1 if idx + 1 < len(banners) else len(lines) - 1
    if nxt - ln < 40: continue
    # A section that has already been moved leaves a "moved to" stub behind, and
    # the trailing re-export block makes the last one look like a 40-line
    # section with no dependencies — i.e. a leaf. It is not; there is nothing
    # there to move.
    section = '\n'.join(lines[ln:nxt+1])
    if 'oved to $lib/data/' in section and not re.search(
            r'^(?:export\s+)?(?:async\s+)?(?:function|const|let|class|type|interface|enum)\s',
            re.sub(r"^export \* from '[^']+';$", '', section, flags=re.M), re.M):
        continue
    rt, ty, inc = analyse(ln, nxt)
    flag = 'LEAF ' if not rt and not inc else ('needs-back-import' if not rt else '')
    title = re.sub(r'^// ─+\s*', '', text).strip(' ─')[:38]
    print(f'{ln+1:>6}-{nxt+1:<6} {nxt-ln:>5}L {title:<40} out={len(rt):<3} in={len(inc):<3} {flag}')
