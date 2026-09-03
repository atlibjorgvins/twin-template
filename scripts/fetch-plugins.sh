#!/usr/bin/env bash
#
# Materialise external plugins declared in plugins.json into
# src/lib/plugins/<id>/ — the GitHub ingest step (docs/plugin-contract.md §Ingest).
#
# twin is a static browser SPA, so an external plugin is CLONED IN and compiled
# into the bundle — there is no runtime loader. Each entry is cloned at a pinned
# ref, .git stripped, and the files land where twin's registry + build expect
# them (src/lib/plugins/<id>/). The dirs are gitignored — GitHub is their source
# of truth. Each plugin is cloned into a temp dir FIRST and swapped in only once
# the clone succeeds, so a failed/offline fetch keeps an already-good copy.
#
# Two modes, mirroring a package lockfile:
#
#   (default)   Resolve each plugins.json `ref` to the commit it points at,
#               clone that, and (re)write plugins.lock with the resolved SHAs.
#               This is the "bump/refresh" op — run it intentionally, commit the
#               updated plugins.lock. Exposed as `npm run plugins:update`.
#
#   --frozen    Ignore the moving `ref`; clone the exact SHA recorded in
#               plugins.lock, so the build is reproducible. Does NOT rewrite the
#               lock. This is what build/dev/check (npm pre-hooks) and deploy
#               use — `npm run plugins:fetch`. If the lock has no entry for a
#               plugin (e.g. just added to plugins.json), it warns and falls
#               back to the `ref` so the build still works; update the lock next.
set -euo pipefail

cd "$(dirname "$0")/.."
MANIFEST="plugins.json"
LOCK="plugins.lock"

FROZEN=false
[ "${1:-}" = "--frozen" ] && FROZEN=true

if [ ! -f "$MANIFEST" ]; then
  echo "No plugins.json — no external plugins to fetch."
  exit 0
fi

# "id<TAB>repo<TAB>ref" per external entry (node is always present).
ENTRIES="$(node -e '
  const m = require("./plugins.json");
  for (const p of (m.external || [])) {
    if (!p.id || !p.repo) { console.error("fetch-plugins: entry missing id/repo, skipped"); continue; }
    process.stdout.write([p.id, p.repo, p.ref || "main"].join("\t") + "\n");
  }
')"

if [ -z "$ENTRIES" ]; then
  echo "plugins.json has no external entries — nothing to fetch."
  exit 0
fi

# The SHA recorded in plugins.lock for an id ("" if none / no lock file).
# Read + JSON.parse the file directly — require() won't parse a .lock extension.
locked_sha() {
  node -e '
    try {
      const fs = require("fs");
      const l = JSON.parse(fs.readFileSync("./plugins.lock", "utf8"));
      const p = (l.plugins || {})[process.argv[1]];
      process.stdout.write(p && p.resolved ? p.resolved : "");
    } catch { process.stdout.write(""); }
  ' "$1" 2>/dev/null || true
}

# Clone repo@ref into a fresh path. --branch takes a branch or tag; fall back to
# a full clone + checkout so a commit SHA also works.
clone_into() {
  local repo="$1" ref="$2" dest="$3"
  if git clone --quiet --depth 1 --branch "$ref" "$repo" "$dest" 2>/dev/null; then
    :
  else
    git clone --quiet "$repo" "$dest" && git -C "$dest" checkout --quiet "$ref"
  fi
}

RESOLVED_TSV="$(mktemp)"   # id<TAB>repo<TAB>ref<TAB>sha — used to (re)write the lock

while IFS=$'\t' read -r id repo ref; do
  [ -n "$id" ] || continue
  target="src/lib/plugins/$id"

  want="$ref"
  if $FROZEN; then
    locked="$(locked_sha "$id")"
    if [ -n "$locked" ]; then
      want="$locked"
    else
      echo "  ! $id not in $LOCK — using ref '$ref' (run 'npm run plugins:update' to lock it)." >&2
    fi
  fi

  tmp="$(mktemp -d)"
  echo "▶ $id ← $repo @ $want"
  if clone_into "$repo" "$want" "$tmp/clone"; then
    sha="$(git -C "$tmp/clone" rev-parse HEAD)"
    rm -rf "$tmp/clone/.git"
    # A plugin may ship SvelteKit route pages under routes/ — file-based routing
    # needs them under src/routes/, so copy that subtree in verbatim. Everything
    # else becomes the plugin's lib dir. src/routes/<plugin paths> is gitignored.
    if [ -d "$tmp/clone/routes" ]; then
      cp -R "$tmp/clone/routes/." "src/routes/"
      rm -rf "$tmp/clone/routes"
      echo "  → routes/ → src/routes/"
    fi
    rm -rf "$target"
    mkdir -p "$(dirname "$target")"
    mv "$tmp/clone" "$target"
    printf '%s\t%s\t%s\t%s\n' "$id" "$repo" "$ref" "$sha" >> "$RESOLVED_TSV"
    echo "  → $target @ ${sha:0:12} ($(ls "$target" | tr '\n' ' '))"
  else
    if [ -d "$target" ]; then
      echo "  ! clone failed — keeping existing $target (offline?)." >&2
      # Preserve its lock line so a default re-write doesn't drop the entry.
      prev="$(locked_sha "$id")"
      [ -n "$prev" ] && printf '%s\t%s\t%s\t%s\n' "$id" "$repo" "$ref" "$prev" >> "$RESOLVED_TSV"
    else
      echo "✗ Cannot fetch '$id' and no local copy at $target — aborting." >&2
      rm -rf "$tmp"; rm -f "$RESOLVED_TSV"
      exit 1
    fi
  fi
  rm -rf "$tmp"
done <<< "$ENTRIES"

# In default mode, rewrite the lock from what we just resolved (prunes entries
# no longer in plugins.json). Frozen builds never touch the lock.
if ! $FROZEN; then
  node -e '
    const fs = require("fs");
    const lines = fs.readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean);
    const plugins = {};
    for (const ln of lines) { const [id, repo, ref, sha] = ln.split("\t"); plugins[id] = { repo, ref, resolved: sha }; }
    fs.writeFileSync("plugins.lock", JSON.stringify({ plugins }, null, 2) + "\n");
  ' "$RESOLVED_TSV"
  echo "✓ External plugins fetched; $LOCK updated."
else
  echo "✓ External plugins fetched (frozen to $LOCK)."
fi

rm -f "$RESOLVED_TSV"
