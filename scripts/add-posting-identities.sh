#!/usr/bin/env bash
# Posting identities — reusable presets for the Evergreen previews'
# "posting identity" (page name, handle, avatar). Managed in Settings;
# one row is the default. Campaigns reference a preset via identity_id
# instead of carrying free-typed brand fields.
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
    \"collection\": \"$coll\",
    \"field\": \"$field\",
    \"related_collection\": \"$related\",
    \"schema\": { \"on_delete\": \"$ondel\" }
  }" >/dev/null
}

echo "▶ posting_identity collection"
ensure_collection "posting_identity" '{
  "collection": "posting_identity",
  "schema": { "name": "posting_identity" },
  "meta": {
    "icon": "badge",
    "hidden": false,
    "note": "Posting-identity presets (page name / handle / avatar) shown in Evergreen post previews. One row is the default.",
    "display_template": "{{name}}",
    "sort_field": "sort"
  }
}'
add_field posting_identity name '{
  "field": "name", "type": "string",
  "meta": { "interface": "input", "required": true, "width": "half",
    "note": "Page/account display name (e.g. KLAK - Icelandic Startups)." },
  "schema": {}
}'
add_field posting_identity handle '{
  "field": "handle", "type": "string",
  "meta": { "interface": "input", "width": "half",
    "note": "Handle shown in Instagram previews (e.g. klak.is)." },
  "schema": {}
}'
add_field posting_identity avatar_url '{
  "field": "avatar_url", "type": "string",
  "meta": { "interface": "input",
    "note": "Avatar image URL — any URL, including a Directus asset URL." },
  "schema": {}
}'
add_field posting_identity is_default '{
  "field": "is_default", "type": "boolean",
  "meta": { "interface": "boolean", "width": "half",
    "note": "Preselected in the Evergreen workbench. Only one row should be default." },
  "schema": { "default_value": false }
}'
add_field posting_identity sort '{
  "field": "sort", "type": "integer",
  "meta": { "interface": "input", "hidden": true },
  "schema": {}
}'
add_field posting_identity date_created '{
  "field": "date_created", "type": "timestamp",
  "meta": { "interface": "datetime", "readonly": true, "hidden": true, "special": ["date-created"], "width": "half" },
  "schema": {}
}'
add_field posting_identity date_updated '{
  "field": "date_updated", "type": "timestamp",
  "meta": { "interface": "datetime", "readonly": true, "hidden": true, "special": ["date-updated"], "width": "half" },
  "schema": {}
}'

echo "▶ campaign.identity_id"
add_field campaign identity_id '{
  "field": "identity_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half",
    "display": "related-values", "display_options": { "template": "{{name}}" },
    "note": "Posting-identity preset used by this campaign'"'"'s previews. Empty = the default preset." },
  "schema": {}
}'
ensure_relation campaign identity_id posting_identity "SET NULL"

echo "✓ done."
