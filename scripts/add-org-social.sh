#!/usr/bin/env bash
# Social profiles per organization — a repeatable list, not a column per site.
#
# WHY A LIST: the org already carried linkedin, linkedin_url, instagram,
# facebook and twitter as separate columns. Every new platform (Bluesky,
# Threads, TikTok, YouTube, Mastodon…) meant a migration plus a UI edit, which
# is why four of those five were never rendered — 381 stored values sat
# invisible while the page showed only linkedin_url. A row per profile makes a
# new platform cost nothing.
#
# A collection rather than a json blob: "which orgs have an Instagram" is a
# question worth being able to ask, and Directus can edit rows natively.
#
# Idempotent — safe to re-run.
set -eo pipefail
# TWIN_ENV_FILE picks the instance: `.env` (personal) or `.env.klak`.
# A name relative to the repo root, so it reads the same from anywhere.
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/${TWIN_ENV_FILE:-.env}"
eval "$(grep -E '^(PUBLIC_DIRECTUS_URL|PUBLIC_DIRECTUS_TOKEN|DIRECTUS_ADMIN_URL)=' "$ENV_FILE" | sed 's/^/export /')"
# Schema tooling talks to Directus directly; the app-facing URL may be a
# same-origin path (/api) that only resolves in a browser. DIRECTUS_ADMIN_URL
# is the absolute URL for out-of-browser callers; fall back to the public one
# when it is absolute (KLAK, pre-/api setups).
URL="${DIRECTUS_ADMIN_URL:-$PUBLIC_DIRECTUS_URL}"; URL="${URL%/}"; TOKEN="$PUBLIC_DIRECTUS_TOKEN"
AUTH=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

ensure_collection() { local n="$1" p="$2" c; c=$(curl -sg -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/collections/$n"); if [ "$c" = "200" ]; then echo "  collection $n exists — skipping."; return; fi; echo "  creating $n…"; curl -fsS "${AUTH[@]}" "$URL/collections" -d "$p" >/dev/null; }
add_field() { local co="$1" na="$2" pa="$3" c; c=$(curl -sg -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/fields/$co/$na"); if [ "$c" = "200" ]; then echo "  field $co.$na exists — skipping."; return; fi; echo "  adding $co.$na…"; curl -fsS "${AUTH[@]}" "$URL/fields/$co" -d "$pa" >/dev/null; }
ensure_relation() {
  local coll="$1" field="$2" related="$3" ondel="${4:-SET NULL}" have
  have=$(curl -sg "${AUTH[@]}" "$URL/relations/$coll/$field" | grep -o "\"collection\":\"$coll\"" | head -1 || true)
  if [ -n "$have" ]; then echo "  relation $coll.$field exists — skipping."; return; fi
  echo "  creating relation $coll.$field → $related ($ondel)…"
  curl -fsS "${AUTH[@]}" "$URL/relations" -d "{\"collection\":\"$coll\",\"field\":\"$field\",\"related_collection\":\"$related\",\"schema\":{\"on_delete\":\"$ondel\"}}" >/dev/null
}

echo "▶ organization_social"
ensure_collection organization_social '{
  "collection": "organization_social",
  "schema": { "name": "organization_social" },
  "meta": { "icon": "share", "sort_field": "sort",
    "note": "One row per social profile. Platform is a free string so a new network needs no migration — the app supplies labels and icons for the ones it knows.",
    "display_template": "{{platform}} — {{url}}" }
}'
add_field organization_social organization_id '{"field":"organization_id","type":"integer","meta":{"interface":"select-dropdown-m2o","special":["m2o"]},"schema":{}}'
# Free string, NOT an enum: an enum is a migration every time a network appears,
# which is the exact trap this collection exists to escape.
add_field organization_social platform '{"field":"platform","type":"string","meta":{"interface":"input","note":"linkedin | instagram | facebook | x | tiktok | youtube | bluesky | threads | mastodon | … free text; unknown values still render, just without a branded icon."},"schema":{}}'
add_field organization_social url '{"field":"url","type":"string","meta":{"interface":"input","note":"Full profile URL. The legacy columns stored URLs despite being named like handles, so this is explicit."},"schema":{"max_length":500}}'
add_field organization_social handle '{"field":"handle","type":"string","meta":{"interface":"input","note":"Optional @name for display. Derived from the URL when not set."},"schema":{}}'
add_field organization_social sort '{"field":"sort","type":"integer","meta":{"interface":"input","hidden":true},"schema":{}}'
add_field organization_social date_created '{"field":"date_created","type":"timestamp","meta":{"special":["date-created"],"interface":"datetime","readonly":true,"hidden":true},"schema":{}}'
ensure_relation organization_social organization_id organization "CASCADE"

echo "✔ done — organization_social."
