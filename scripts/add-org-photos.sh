#!/usr/bin/env bash
# Organization photo gallery — multiple typed photos per org.
#
#   PhotoType           Fixed-but-editable catalogue of photo kinds,
#                       managed in twin → Settings → Photo types.
#                       Seeded: Group photo, Location, In action, Product.
#   organization_photo  One photo on one org: file + type + caption.
#
# Idempotent — safe to re-run (seeding checks by name).
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
seed_photo_type() {
  local name="$1" sort="$2"
  local count
  count=$(curl -s "${AUTH[@]}" "$URL/items/PhotoType?filter%5Bname%5D%5B_eq%5D=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$name")&aggregate%5Bcount%5D=*" \
    | python3 -c "import sys,json;print(json.load(sys.stdin)['data'][0]['count'])")
  if [ "$count" != "0" ]; then echo "  PhotoType \"$name\" exists — skipping."; return; fi
  echo "  seeding PhotoType \"$name\"…"
  curl -fsS "${AUTH[@]}" "$URL/items/PhotoType" -d "{\"name\": \"$name\", \"sort\": $sort, \"status\": \"published\"}" >/dev/null
}

# ── PhotoType ────────────────────────────────────────────────────────
echo "▶ PhotoType collection"
ensure_collection "PhotoType" '{
  "collection": "PhotoType",
  "schema": { "name": "PhotoType" },
  "meta": {
    "icon": "photo_library",
    "hidden": false,
    "note": "Catalogue of organization photo kinds (Group photo, Location, In action, Product, …). Managed in twin Settings.",
    "display_template": "{{name}}",
    "sort_field": "sort",
    "archive_field": "status",
    "archive_value": "archived",
    "unarchive_value": "published",
    "archive_app_filter": true
  }
}'
add_field PhotoType name '{
  "field": "name", "type": "string",
  "meta": { "interface": "input", "required": true, "width": "half" },
  "schema": {}
}'
add_field PhotoType status '{
  "field": "status", "type": "string",
  "meta": {
    "interface": "select-dropdown", "width": "half",
    "options": { "choices": [
      { "text": "Published", "value": "published" },
      { "text": "Archived",  "value": "archived" }
    ] }
  },
  "schema": { "default_value": "published" }
}'
add_field PhotoType sort '{
  "field": "sort", "type": "integer",
  "meta": { "interface": "input", "hidden": true },
  "schema": {}
}'
add_field PhotoType date_created '{
  "field": "date_created", "type": "timestamp",
  "meta": { "interface": "datetime", "readonly": true, "hidden": true, "special": ["date-created"], "width": "half" },
  "schema": {}
}'
add_field PhotoType date_updated '{
  "field": "date_updated", "type": "timestamp",
  "meta": { "interface": "datetime", "readonly": true, "hidden": true, "special": ["date-updated"], "width": "half" },
  "schema": {}
}'

# ── organization_photo ───────────────────────────────────────────────
echo "▶ organization_photo collection"
ensure_collection "organization_photo" '{
  "collection": "organization_photo",
  "schema": { "name": "organization_photo" },
  "meta": {
    "icon": "imagesmode",
    "hidden": false,
    "note": "Photo gallery rows for organizations — file + PhotoType + caption. Multiple per org.",
    "display_template": "{{caption}}",
    "sort_field": "sort"
  }
}'
add_field organization_photo organization_id '{
  "field": "organization_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half",
    "display": "related-values", "display_options": { "template": "{{name}}" } },
  "schema": {}
}'
add_field organization_photo file_id '{
  "field": "file_id", "type": "uuid",
  "meta": { "interface": "file-image", "special": ["file"], "width": "half" },
  "schema": {}
}'
add_field organization_photo type_id '{
  "field": "type_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half",
    "display": "related-values", "display_options": { "template": "{{name}}" } },
  "schema": {}
}'
add_field organization_photo caption '{
  "field": "caption", "type": "string",
  "meta": { "interface": "input", "note": "Short description shown under the photo." },
  "schema": {}
}'
add_field organization_photo sort '{
  "field": "sort", "type": "integer",
  "meta": { "interface": "input", "hidden": true },
  "schema": {}
}'
add_field organization_photo date_created '{
  "field": "date_created", "type": "timestamp",
  "meta": { "interface": "datetime", "readonly": true, "hidden": true, "special": ["date-created"], "width": "half" },
  "schema": {}
}'
add_field organization_photo date_updated '{
  "field": "date_updated", "type": "timestamp",
  "meta": { "interface": "datetime", "readonly": true, "hidden": true, "special": ["date-updated"], "width": "half" },
  "schema": {}
}'
ensure_relation organization_photo organization_id organization "CASCADE"
ensure_relation organization_photo file_id directus_files "CASCADE"
ensure_relation organization_photo type_id PhotoType "SET NULL"

# ── Seed the starter types ───────────────────────────────────────────
echo "▶ seeding photo types"
seed_photo_type "Group photo" 10
seed_photo_type "Location" 20
seed_photo_type "In action" 30
seed_photo_type "Product" 40

echo "✓ done."
