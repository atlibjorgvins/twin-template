#!/usr/bin/env bash
# Activity ↔ Organization link table — lets an interaction reference
# multiple organizations (mirrors Activity_Person for people). The legacy
# single Activity.organization_id stays as-is; the UI reads/writes the
# junction and treats organization_id as a back-compat fallback.
#
#   Activity_organization   activity_id → Activity (CASCADE)
#                           organization_id → organization (CASCADE)
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
URL="${DIRECTUS_ADMIN_URL:-$PUBLIC_DIRECTUS_URL}"; URL="${URL%/}"
TOKEN="$PUBLIC_DIRECTUS_TOKEN"
AUTH=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

ensure_collection() {
  local name="$1" payload="$2"
  local code; code=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/collections/$name")
  if [ "$code" = "200" ]; then echo "  collection $name exists — skipping."; return; fi
  echo "  creating collection $name…"
  curl -fsS "${AUTH[@]}" "$URL/collections" -d "$payload" >/dev/null
}
add_field() {
  local coll="$1" name="$2" payload="$3"
  local code; code=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/fields/$coll/$name")
  if [ "$code" = "200" ]; then echo "  field $coll.$name exists — skipping."; return; fi
  echo "  adding field $coll.$name…"
  curl -fsS "${AUTH[@]}" "$URL/fields/$coll" -d "$payload" >/dev/null
}
ensure_relation() {
  local coll="$1" field="$2" related="$3" ondel="${4:-SET NULL}"
  local have; have=$(curl -s "${AUTH[@]}" "$URL/relations/$coll/$field" | grep -o "\"collection\":\"$coll\"" | head -1 || true)
  if [ -n "$have" ]; then echo "  relation $coll.$field exists — skipping."; return; fi
  echo "  creating relation $coll.$field → $related ($ondel)…"
  curl -fsS "${AUTH[@]}" "$URL/relations" -d "{
    \"collection\": \"$coll\", \"field\": \"$field\", \"related_collection\": \"$related\",
    \"schema\": { \"on_delete\": \"$ondel\" }
  }" >/dev/null
}

echo "▶ Activity_organization junction"
ensure_collection "Activity_organization" '{
  "collection": "Activity_organization",
  "schema": { "name": "Activity_organization" },
  "meta": { "icon": "link", "hidden": true,
    "note": "Links an organization to an activity (interaction).",
    "display_template": "{{organization_id.name}}" }
}'

add_field Activity_organization activity_id '{
  "field": "activity_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "hidden": true },
  "schema": {}
}'
add_field Activity_organization organization_id '{
  "field": "organization_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"],
    "display": "related-values", "display_options": { "template": "{{name}}" } },
  "schema": {}
}'

ensure_relation Activity_organization activity_id Activity "CASCADE"
ensure_relation Activity_organization organization_id organization "CASCADE"

echo "Done."
