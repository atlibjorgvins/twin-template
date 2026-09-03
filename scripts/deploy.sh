#!/usr/bin/env bash
# Build → push → done, for one of the twin instances.
#
# One codebase, more than one deployment: the personal twin and the KLAK one.
# A deployment is a file in deploy/targets/<name>.conf naming four things —
# which Vite mode to build, which env file the schema scripts use, and the
# host + path to push the bundle to. Nothing else differs.
#
#   bash scripts/deploy.sh                  # personal (the default target)
#   bash scripts/deploy.sh --target klak    # the workplace twin
#   bash scripts/deploy.sh --list           # what targets exist
#   bash scripts/deploy.sh --target klak --build-only
#
# Overrides still work the way they always did:
#   NAS_HOST=nas NAS_PATH=/srv/twin/html bash scripts/deploy.sh
#   bash scripts/deploy.sh --host nas --path /srv/twin/html --restart
#
# Optional:
#   --restart    bounce the container after sync (rarely needed — only if you
#                changed nginx.conf or cache headers).
#   --build-only build and check, push nothing. What CI would run.

set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="${TWIN_TARGET:-personal}"
RESTART=false
BUILD_ONLY=false
HOST_OVERRIDE="${NAS_HOST:-}"
PATH_OVERRIDE="${NAS_PATH:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target|-t) TARGET="$2"; shift 2 ;;
    --host) HOST_OVERRIDE="$2"; shift 2 ;;
    --path) PATH_OVERRIDE="$2"; shift 2 ;;
    --restart) RESTART=true; shift ;;
    --build-only) BUILD_ONLY=true; shift ;;
    --list)
      echo "Targets in deploy/targets:"
      for f in deploy/targets/*.conf; do
        [[ -e "$f" ]] || continue
        n="$(basename "$f" .conf)"
        p="$(grep -E '^NAS_PATH=' "$f" | head -1 | cut -d= -f2-)"
        printf '  %-10s → %s\n' "$n" "$p"
      done
      exit 0 ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

CONF="deploy/targets/${TARGET}.conf"
if [[ ! -f "$CONF" ]]; then
  echo "✗ No such target '${TARGET}' — expected ${CONF}." >&2
  echo "  Available: $(ls deploy/targets/*.conf 2>/dev/null | xargs -n1 basename 2>/dev/null | sed 's/\.conf$//' | tr '\n' ' ')" >&2
  exit 1
fi

BUILD_MODE=""; ENV_FILE=".env"
# shellcheck disable=SC1090
source "$CONF"
NAS_HOST="${HOST_OVERRIDE:-${NAS_HOST:-}}"
NAS_PATH="${PATH_OVERRIDE:-${NAS_PATH:-}}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "✗ ${ENV_FILE} is missing — copy ${ENV_FILE}.example and fill it in." >&2
  exit 1
fi

# ── Preflight: does this build know which database it is talking to? ──
#
# Vite loads `.env` first and `.env.<mode>` on top, so a PUBLIC_* key the
# instance file leaves out falls through to the personal value. For a URL
# that is a wrong-looking site; for a TOKEN it is the workplace build
# shipping a key to the personal database, in a bundle anyone with the site
# can read. Setting the key to blank on purpose counts as setting it — this
# is about silence, not about emptiness.
keys_of() { grep -Eo '^[[:space:]]*(PUBLIC_[A-Z0-9_]+)=' "$1" | tr -d ' ' | sed 's/=$//' | sort -u; }

for required in PUBLIC_DIRECTUS_URL PUBLIC_DIRECTUS_TOKEN; do
  if ! keys_of "$ENV_FILE" | grep -qx "$required"; then
    echo "✗ ${ENV_FILE} does not set ${required}." >&2
    exit 1
  fi
done

if [[ -n "$BUILD_MODE" && -f .env ]]; then
  BLEED="$(comm -23 <(keys_of .env) <(keys_of "$ENV_FILE") | tr '\n' ' ')"
  if [[ -n "${BLEED// /}" ]]; then
    cat >&2 <<EOF
✗ ${ENV_FILE} is silent about keys that .env sets:
    ${BLEED}
  Vite would fall through to the personal values and bake them into the
  ${TARGET} bundle. Set each one in ${ENV_FILE} — blank is a fine answer:
$(for k in $BLEED; do echo "    ${k}="; done)
EOF
    exit 1
  fi
fi

INSTANCE_LABEL="$(grep -E '^PUBLIC_INSTANCE_LABEL=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)"
DIRECTUS="$(grep -E '^PUBLIC_DIRECTUS_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)"
echo "▶ Target: ${TARGET}${INSTANCE_LABEL:+ (${INSTANCE_LABEL})} · env ${ENV_FILE} · directus ${DIRECTUS}"

# Materialise external plugins (plugins.json) before building — they are
# gitignored, so a fresh clone has none until this runs. See fetch-plugins.sh
# and docs/plugin-contract.md §Ingest.
echo "▶ Fetching external plugins (frozen to plugins.lock)…"
bash scripts/fetch-plugins.sh --frozen

echo "▶ Building production bundle…"
if [[ -n "$BUILD_MODE" ]]; then
  BUILD_CMD=(npx vite build --mode "$BUILD_MODE")
else
  BUILD_CMD=(npm run build)
fi
"${BUILD_CMD[@]}" >/tmp/twin-build-"${TARGET}".log 2>&1 || {
  echo "✗ Build failed — see /tmp/twin-build-${TARGET}.log" >&2
  tail -40 /tmp/twin-build-"${TARGET}".log >&2
  exit 1
}
echo "  build/ size: $(du -sh build | awk '{print $1}')"

# A last sanity check on the artefact rather than on the inputs: the bundle
# is what ships, and this catches a stale build/ directory too. A path-shaped
# value ("/api", same-origin deployments) would match anything, so check the
# baked env file exactly rather than grepping the whole bundle for "/api".
if [[ "$DIRECTUS" == /* ]]; then
  if ! grep -qF "\"PUBLIC_DIRECTUS_URL\":\"${DIRECTUS}\"" build/_app/env.js 2>/dev/null; then
    echo "✗ build/_app/env.js does not carry PUBLIC_DIRECTUS_URL=${DIRECTUS} — wrong env, or a stale build/." >&2
    exit 1
  fi
elif [[ -n "$DIRECTUS" ]] && ! grep -rqF "$DIRECTUS" build; then
  echo "✗ The bundle does not mention ${DIRECTUS} — it was built against the wrong env." >&2
  exit 1
fi

if $BUILD_ONLY; then
  echo "✓ Built ${TARGET} (not deployed)."
  exit 0
fi

if [[ -z "$NAS_HOST" || -z "$NAS_PATH" ]]; then
  echo "✗ ${CONF} has no NAS_HOST/NAS_PATH, and none was passed." >&2
  exit 1
fi

echo "▶ Syncing build/ → ${NAS_HOST}:${NAS_PATH}"
# Transport selection:
#   - GNU rsync (3.x) → use it; --delete prunes orphaned files.
#   - Apple's openrsync (default on recent macOS) talks to Synology
#     unreliably (phantom password prompts even with working key
#     auth), so fall back to a tar-over-ssh pipe that only needs the
#     ssh we already know works. We wipe the remote dir first to get
#     the same orphan-pruning behaviour --delete would give.
RSYNC_KIND="$(rsync --version 2>/dev/null | head -1)"
if printf '%s' "$RSYNC_KIND" | grep -qi 'openrsync'; then
  echo "  (openrsync detected — using tar-over-ssh instead)"
  # COPYFILE_DISABLE=1 stops macOS from injecting AppleDouble (._foo)
  # sidecar entries into the tarball — GNU tar on the NAS misreads
  # those as the real files and the deploy ships ONLY metadata
  # headers, no index.html. --no-xattrs strips extended attributes
  # for the same reason. Wipe dotfiles too (.[!.]*) so a previous
  # broken deploy's leftover ._* files don't confuse nginx.
  ssh "$NAS_HOST" "rm -rf '${NAS_PATH:?}'/* '${NAS_PATH:?}'/.[!.]*" \
    && COPYFILE_DISABLE=1 tar --no-xattrs -C build -czf - . \
    | ssh "$NAS_HOST" "tar -C '${NAS_PATH}' -xzf -"
else
  rsync -avz --delete --human-readable build/ "${NAS_HOST}:${NAS_PATH}/"
fi

if $RESTART; then
  # If you ever change nginx.conf or want to flush in-flight requests.
  # Assumes docker-compose.yml lives in the parent of $NAS_PATH.
  REMOTE_COMPOSE_DIR="$(dirname "$NAS_PATH")"
  echo "▶ Restarting container (compose dir: $REMOTE_COMPOSE_DIR)"
  ssh "$NAS_HOST" "cd '$REMOTE_COMPOSE_DIR' && docker compose restart twin"
fi

echo "✓ Deployed ${TARGET}."
