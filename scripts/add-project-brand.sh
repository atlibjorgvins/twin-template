#!/usr/bin/env bash
# Project brand segment — optional per-project brand identity:
#
#   Project.brand_colors     JSON array of swatches:
#                            [{ "hex": "#FF5A5F", "label": "Primary" }, …]
#   Project.brand_logo       Directus file (the project/program logo —
#                            distinct from Project.color, the UI accent).
#   project_brand_asset      Gallery of brand files (wordmarks, banner
#                            crops, pattern tiles, …) with a label, in
#                            the organization_photo mould.
#
# Surfaces as the "Brand" card on /projects/[id]; downstream consumers:
# the image studio + Evergreen can pull a project's palette and assets.
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

echo "▶ Project brand fields"
add_field Project brand_colors '{
  "field": "brand_colors", "type": "json",
  "meta": { "interface": "input-code", "options": { "language": "json" },
    "note": "Brand palette: [{ \"hex\": \"#1D6BFE\", \"label\": \"Primary\" }, …]. Optional." },
  "schema": {}
}'
add_field Project brand_logo '{
  "field": "brand_logo", "type": "uuid",
  "meta": { "interface": "file-image", "special": ["file"], "width": "half",
    "note": "Project/program logo. Optional — distinct from the UI accent color." },
  "schema": {}
}'
ensure_relation Project brand_logo directus_files "SET NULL"

echo "▶ project_brand_asset collection"
ensure_collection "project_brand_asset" '{
  "collection": "project_brand_asset",
  "schema": { "name": "project_brand_asset" },
  "meta": {
    "icon": "palette",
    "hidden": true,
    "note": "Brand asset gallery per project — wordmarks, banners, pattern tiles. Surfaced on the project page Brand card.",
    "display_template": "{{label}}",
    "sort_field": "sort"
  }
}'
add_field project_brand_asset project_id '{
  "field": "project_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half" },
  "schema": {}
}'
add_field project_brand_asset file_id '{
  "field": "file_id", "type": "uuid",
  "meta": { "interface": "file", "special": ["file"], "width": "half" },
  "schema": {}
}'
add_field project_brand_asset label '{
  "field": "label", "type": "string",
  "meta": { "interface": "input", "note": "What this asset is — wordmark, banner, pattern…" },
  "schema": {}
}'
add_field project_brand_asset sort '{
  "field": "sort", "type": "integer",
  "meta": { "interface": "input", "hidden": true },
  "schema": {}
}'
add_field project_brand_asset date_created '{
  "field": "date_created", "type": "timestamp",
  "meta": { "interface": "datetime", "readonly": true, "hidden": true, "special": ["date-created"], "width": "half" },
  "schema": {}
}'
ensure_relation project_brand_asset project_id Project "CASCADE"
ensure_relation project_brand_asset file_id directus_files "CASCADE"

echo "✓ done."
