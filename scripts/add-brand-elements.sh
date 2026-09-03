#!/usr/bin/env bash
# `brand_element` — the parts of a brand that are neither a logo nor a colour:
# background patterns, gradients, graphic elements, and photography direction.
#
#   brand_element  owner_kind owner_id kind name notes file_id
#                  gradient_stops gradient_angle tile_width on_dark sort
#
# Owner-keyed like brand_palette_color and brand_logo_asset, NOT project-only
# like the older project_brand_asset — brands live on organizations too, and
# these have to inherit down the same parent chain as everything else.
#
# One table for four kinds rather than four tables: they differ in how they are
# RENDERED, not in what they are. A pattern needs a tile width, a gradient needs
# stops, and the columns the other kinds do not use stay null — which is far
# cheaper than four collections, four resolvers and four editors that drift.
#
# Gradients are authored, not uploaded: stops + angle are the source of truth
# and the CSS is derived from them, so a gradient can be recoloured, re-angled
# and pasted into code. `file_id` stays available for an exported raster, for
# tools that cannot take CSS.
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

ensure_collection() { local n="$1" p="$2"; local c; c=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/collections/$n"); if [ "$c" = "200" ]; then echo "  collection $n exists — skipping."; return; fi; echo "  creating $n…"; curl -fsS "${AUTH[@]}" "$URL/collections" -d "$p" >/dev/null; }
add_field() { local co="$1" na="$2" pa="$3"; local c; c=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/fields/$co/$na"); if [ "$c" = "200" ]; then echo "  field $co.$na exists — skipping."; return; fi; echo "  adding $co.$na…"; curl -fsS "${AUTH[@]}" "$URL/fields/$co" -d "$pa" >/dev/null; }
ensure_relation() {
  local coll="$1" field="$2" related="$3" ondel="${4:-SET NULL}"
  local have; have=$(curl -s "${AUTH[@]}" "$URL/relations/$coll/$field" | grep -o "\"collection\":\"$coll\"" | head -1 || true)
  if [ -n "$have" ]; then echo "  relation $coll.$field exists — skipping."; return; fi
  echo "  creating relation $coll.$field → $related ($ondel)…"
  curl -fsS "${AUTH[@]}" "$URL/relations" -d "{ \"collection\": \"$coll\", \"field\": \"$field\", \"related_collection\": \"$related\", \"schema\": { \"on_delete\": \"$ondel\" } }" >/dev/null
}

echo "▶ brand_element"
ensure_collection "brand_element" '{
  "collection": "brand_element",
  "schema": { "name": "brand_element" },
  "meta": { "icon": "texture", "sort_field": "sort",
    "note": "Patterns, gradients, graphic elements and photography direction for one brand.",
    "display_template": "{{kind}} — {{name}}" }
}'
add_field brand_element owner_kind '{ "field": "owner_kind", "type": "string", "meta": { "interface": "select-dropdown", "width": "half", "note": "Which collection owns this brand.", "options": { "choices": [ { "text": "Project", "value": "project" }, { "text": "Organization", "value": "organization" } ] } }, "schema": {} }'
add_field brand_element owner_id '{ "field": "owner_id", "type": "integer", "meta": { "interface": "input", "width": "half", "note": "Id within owner_kind." }, "schema": {} }'
add_field brand_element kind '{ "field": "kind", "type": "string", "meta": { "interface": "select-dropdown", "width": "half", "note": "How this element is rendered.", "options": { "choices": [ { "text": "Pattern", "value": "pattern" }, { "text": "Gradient", "value": "gradient" }, { "text": "Graphic element", "value": "graphic" }, { "text": "Photography", "value": "photography" } ] } }, "schema": { "default_value": "graphic" } }'
add_field brand_element name '{ "field": "name", "type": "string", "meta": { "interface": "input", "width": "half" }, "schema": {} }'
add_field brand_element notes '{ "field": "notes", "type": "text", "meta": { "interface": "input-multiline", "note": "How and where to use it. For photography this IS the payload." }, "schema": {} }'
add_field brand_element file_id '{ "field": "file_id", "type": "uuid", "meta": { "interface": "file-image", "special": ["file"], "note": "The artwork. Required for patterns, graphics and photography; optional raster export for a gradient." }, "schema": {} }'
add_field brand_element gradient_stops '{ "field": "gradient_stops", "type": "json", "meta": { "interface": "input-code", "note": "[{ hex, pos }] — the source of truth for a gradient. CSS is derived from this, so it stays recolourable.", "options": { "language": "json" } }, "schema": {} }'
add_field brand_element gradient_angle '{ "field": "gradient_angle", "type": "integer", "meta": { "interface": "input", "width": "half", "note": "Degrees, CSS convention (180 = top to bottom)." }, "schema": { "default_value": 180 } }'
add_field brand_element tile_width '{ "field": "tile_width", "type": "integer", "meta": { "interface": "input", "width": "half", "note": "Intended tile width in px, so a pattern is previewed at the size it is meant to be used." }, "schema": {} }'
add_field brand_element on_dark '{ "field": "on_dark", "type": "boolean", "meta": { "interface": "boolean", "special": ["cast-boolean"], "width": "half", "note": "Preview against the inverse background rather than the main one." }, "schema": { "default_value": false } }'
add_field brand_element sort '{ "field": "sort", "type": "integer", "meta": { "interface": "input", "hidden": true }, "schema": {} }'
add_field brand_element date_created '{ "field": "date_created", "type": "timestamp", "meta": { "special": ["date-created"], "interface": "datetime", "readonly": true, "hidden": true }, "schema": {} }'
add_field brand_element date_updated '{ "field": "date_updated", "type": "timestamp", "meta": { "special": ["date-updated"], "interface": "datetime", "readonly": true, "hidden": true }, "schema": {} }'
ensure_relation brand_element file_id directus_files "SET NULL"

echo "✔ done — brand_element ready."
