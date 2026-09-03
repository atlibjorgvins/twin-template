#!/usr/bin/env bash
# brand_logo_asset — logos as a matrix, not a list of six columns.
#
# The six brand_logo* columns on Project and organization conflate two
# independent axes:
#
#   treatment   original / inverted / flat black — a COLOUR decision, driven
#               by what is behind the logo
#   lockup      primary / landscape / vertical / mark — a SHAPE decision,
#               driven by the space available
#
# Every lockup needs every treatment. A landscape logo in a dark navbar
# needs its inverted version exactly as much as the primary one does, and
# the column model has no slot for it — brand_logo_landscape is implicitly
# "landscape, original" and there is nowhere to put the other two.
#
# Twelve more columns would fix today and be wrong again the first time a
# brand wants a one-colour or outline treatment. So: rows, keyed by
# (lockup, treatment), the same shape brand_font_face already uses.
#
# BACK COMPATIBILITY IS THE POINT. Nothing migrates. The existing columns
# keep their values and keep being read — resolveLogoAssets() maps them into
# the matrix as
#
#   brand_logo           → primary/original      brand_logo_landscape → landscape/original
#   brand_logo_inverted  → primary/inverted      brand_logo_vertical  → vertical/original
#   brand_logo_black     → primary/flat          brand_logo_simple    → mark/original
#
# and a row in this collection simply wins over the column for the same
# cell. Thirteen projects already carry logos in those columns; none of them
# have to be touched for this to work, and rolling back is deleting rows.
#
# Additive and idempotent — safe to re-run.
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

ensure_collection() {
  local name="$1" payload="$2"
  local code; code=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/collections/$name")
  if [ "$code" = "200" ]; then echo "  collection $name exists — skipping."; return; fi
  echo "  creating collection $name…"; curl -fsS "${AUTH[@]}" "$URL/collections" -d "$payload" >/dev/null
}

add_field() {
  local coll="$1" name="$2" payload="$3"
  local code; code=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/fields/$coll/$name")
  if [ "$code" = "200" ]; then echo "  field $coll.$name exists — skipping."; return; fi
  echo "  adding field $coll.$name…"; curl -fsS "${AUTH[@]}" "$URL/fields/$coll" -d "$payload" >/dev/null
}

echo "▶ brand_logo_asset"
ensure_collection brand_logo_asset '{
  "collection": "brand_logo_asset",
  "meta": {
    "icon": "image",
    "note": "One logo file per lockup × treatment. Overrides the legacy brand_logo* columns for the same cell.",
    "display_template": "{{lockup}} / {{treatment}}",
    "sort_field": "sort"
  },
  "schema": {}
}'

add_field brand_logo_asset owner_kind '{
  "field": "owner_kind", "type": "string",
  "schema": { "is_nullable": false, "default_value": "project" },
  "meta": {
    "interface": "select-dropdown", "required": true,
    "options": { "choices": [
      { "text": "Project", "value": "project" },
      { "text": "Organization", "value": "organization" }
    ] }
  }
}'

add_field brand_logo_asset owner_id '{
  "field": "owner_id", "type": "integer",
  "schema": { "is_nullable": false },
  "meta": { "interface": "input", "required": true, "note": "Project.id or organization.id, per owner_kind." }
}'

add_field brand_logo_asset lockup '{
  "field": "lockup", "type": "string",
  "schema": { "is_nullable": false, "default_value": "primary" },
  "meta": {
    "interface": "select-dropdown", "required": true,
    "options": { "choices": [
      { "text": "Primary",   "value": "primary" },
      { "text": "Landscape", "value": "landscape" },
      { "text": "Vertical",  "value": "vertical" },
      { "text": "Mark",      "value": "mark" }
    ] },
    "note": "The SHAPE — driven by the space available."
  }
}'

add_field brand_logo_asset treatment '{
  "field": "treatment", "type": "string",
  "schema": { "is_nullable": false, "default_value": "original" },
  "meta": {
    "interface": "select-dropdown", "required": true,
    "options": { "choices": [
      { "text": "Original",   "value": "original" },
      { "text": "Inverted",   "value": "inverted" },
      { "text": "Flat black", "value": "flat" },
      { "text": "Flat white", "value": "white" }
    ] },
    "note": "The COLOUR — driven by what is behind the logo."
  }
}'

add_field brand_logo_asset file_id '{
  "field": "file_id", "type": "uuid",
  "schema": { "is_nullable": true },
  "meta": { "interface": "file-image", "special": ["file"], "note": "SVG where possible." }
}'

add_field brand_logo_asset notes '{
  "field": "notes", "type": "text",
  "schema": { "is_nullable": true },
  "meta": { "interface": "input-multiline", "note": "Clearspace, minimum size, when NOT to use this one." }
}'

add_field brand_logo_asset sort '{
  "field": "sort", "type": "integer",
  "schema": { "is_nullable": true },
  "meta": { "interface": "input", "hidden": true }
}'

echo "✔ brand_logo_asset ready."
