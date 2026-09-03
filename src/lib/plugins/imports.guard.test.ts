// The plugin boundary, enforced. See docs/plugin-contract.md.
//
// Two rules a Twin plugin must never break — checked here so a violation fails
// CI instead of shipping:
//
//   1. Plugin code talks to storage through the neutral `repo` port, never
//      `@directus/sdk` or the raw `$lib/data/client`. That is what keeps a
//      plugin backend-neutral — the whole point of the phase-3 port.
//   2. A plugin never reaches into another plugin's internals. Plugins compose
//      only through the registry (which imports each manifest) and through
//      shared core in `$lib/data`. Plugin A importing `plugins/B/anything` is a
//      hidden coupling that breaks the moment B is disabled or removed.
//
// The scan is textual (read files, match import specifiers) so it needs no
// build step and can't be fooled by a type-only import — a forbidden dependency
// is forbidden whether or not it survives to runtime.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const PLUGINS_DIR = dirname(fileURLToPath(import.meta.url));

/** Every source file under src/lib/plugins/, recursively. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.(ts|svelte|js)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** Import/re-export specifiers in a file — `from '…'` and `import('…')`. */
function importSpecifiers(src: string): string[] {
  const specs: string[] = [];
  const re = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) specs.push(m[1]);
  return specs;
}

/** The plugin a file belongs to — its first path segment under plugins/, or
 *  null for framework files at the top level (registry.ts, catalogue.ts, …). */
function pluginOf(file: string): string | null {
  const rel = relative(PLUGINS_DIR, file);
  const parts = rel.split(/[/\\]/);
  return parts.length > 1 ? parts[0] : null;
}

const FILES = sourceFiles(PLUGINS_DIR).filter((f) => !/\.test\.ts$/.test(f));

test('no plugin file imports @directus/sdk or the raw client', () => {
  const offenders: string[] = [];
  for (const file of FILES) {
    for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
      if (spec === '@directus/sdk' || spec === '$lib/data/client') {
        offenders.push(`${relative(PLUGINS_DIR, file)} → ${spec}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Plugin code must use the neutral \`repo\` port, not the backend directly:\n  ${offenders.join('\n  ')}`
  );
});

test('no plugin reaches into another plugin’s internals', () => {
  const offenders: string[] = [];
  for (const file of FILES) {
    const owner = pluginOf(file);
    if (!owner) continue; // framework file — the registry may import manifests
    for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
      // Alias form: `$lib/plugins/<other>/…`
      let other: string | null = null;
      const alias = spec.match(/^\$lib\/plugins\/([^/]+)\//);
      if (alias) other = alias[1];
      // Relative form: `../<other>/…` climbing out of the plugin dir
      const rel = spec.match(/^\.\.\/([^/]+)\//);
      if (rel) other = rel[1];
      if (other && other !== owner) {
        offenders.push(`${relative(PLUGINS_DIR, file)} → ${spec}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Plugins compose through the registry, not by importing each other:\n  ${offenders.join('\n  ')}`
  );
});
