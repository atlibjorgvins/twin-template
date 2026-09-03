#!/usr/bin/env bash
# Brand roles on organization, mirroring Project.
#
# The Brand card was written for projects because that is where the need
# showed up first — cohorts and programmes each have their own look. But a
# brand belongs to whoever owns it, and most of the time that is a company:
# KLAK has a brand, and "KLAK - Icelandic Startups" the project merely
# borrows it.
#
# Same field names as Project on purpose. One resolver, one card, one brand
# book can then serve both by swapping the collection name, instead of two
# parallel implementations drifting apart.
#
# organization.parent_organization already exists, so inheritance up the
# ownership chain works exactly like Project.parent_id.
#
# The `logo` field organization already has is left alone: it is the small
# avatar used in lists, not a brand asset with a colour treatment.
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

add_field() {
  local coll="$1" name="$2" payload="$3"
  local code; code=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/fields/$coll/$name")
  if [ "$code" = "200" ]; then echo "  field $coll.$name exists — skipping."; return; fi
  echo "  adding field $coll.$name…"; curl -fsS "${AUTH[@]}" "$URL/fields/$coll" -d "$payload" >/dev/null
}

logo_field() {
  add_field organization "$1" "{
    \"field\": \"$1\", \"type\": \"uuid\",
    \"schema\": { \"is_nullable\": true },
    \"meta\": { \"interface\": \"file-image\", \"special\": [\"file\"], \"note\": \"$2\" }
  }"
}
color_field() {
  add_field organization "$1" "{
    \"field\": \"$1\", \"type\": \"string\",
    \"schema\": { \"is_nullable\": true },
    \"meta\": { \"interface\": \"select-color\", \"note\": \"$2\" }
  }"
}

echo "▶ organization logo roles"
logo_field brand_logo           "Full colour — lives on the main background."
logo_field brand_logo_inverted  "Lives on the inverse background."
logo_field brand_logo_black     "Flat black, for print and other edge cases."
logo_field brand_logo_landscape "Wide lockup — headers, navbars."
logo_field brand_logo_vertical  "Stacked lockup — square-ish placements."
logo_field brand_logo_simple    "Mark only — favicons, avatars, small sizes."

echo "▶ organization colour roles"
color_field brand_primary  "Main brand colour — buttons, accents."
color_field brand_bg_light "The surface the brand normally sits on (Original logo)."
color_field brand_bg_dark  "The contrast surface (Inverted logo)."

echo "▶ organization typeface"
add_field organization brand_font '{
  "field": "brand_font", "type": "string",
  "schema": { "is_nullable": true },
  "meta": {
    "interface": "input",
    "note": "Typeface name as a person would say it. Inherits up parent_organization."
  }
}'

echo "▶ organization.brand_colors (legacy swatch list, kept for the image studio)"
add_field organization brand_colors '{
  "field": "brand_colors", "type": "json",
  "schema": { "is_nullable": true },
  "meta": { "interface": "input-code", "note": "Freeform swatch list. The role fields above are the source of truth." }
}'

echo "✔ organization brand roles ready."
