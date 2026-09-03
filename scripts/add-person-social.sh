#!/usr/bin/env bash
# Social profiles for people — the same shape as organization_social.
#
# A SEPARATE TABLE rather than a person_id column on organization_social,
# because a table called organization_social holding people is a lie that
# every future reader has to decode. The COST of duplication is schema only:
# the catalogue, the URL/handle parsing, the card and the header strip are all
# shared code, parameterised by which collection they are pointed at.
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

echo "▶ person_social"
ensure_collection person_social '{
  "collection": "person_social",
  "schema": { "name": "person_social" },
  "meta": { "icon": "share", "sort_field": "sort",
    "note": "One row per social profile for a person. Same columns as organization_social so the two share their UI and helpers.",
    "display_template": "{{platform}} — {{url}}" }
}'
add_field person_social person_id '{"field":"person_id","type":"integer","meta":{"interface":"select-dropdown-m2o","special":["m2o"]},"schema":{}}'
add_field person_social platform '{"field":"platform","type":"string","meta":{"interface":"input","note":"linkedin | instagram | facebook | x | tiktok | youtube | bluesky | threads | mastodon | … free text, same catalogue as organizations."},"schema":{}}'
add_field person_social url '{"field":"url","type":"string","meta":{"interface":"input","note":"Full profile URL."},"schema":{"max_length":500}}'
add_field person_social handle '{"field":"handle","type":"string","meta":{"interface":"input","note":"Optional @name. Derived from the URL when not set."},"schema":{}}'
add_field person_social sort '{"field":"sort","type":"integer","meta":{"interface":"input","hidden":true},"schema":{}}'
add_field person_social date_created '{"field":"date_created","type":"timestamp","meta":{"special":["date-created"],"interface":"datetime","readonly":true,"hidden":true},"schema":{}}'
ensure_relation person_social person_id Person "CASCADE"

echo "✔ done — person_social."
