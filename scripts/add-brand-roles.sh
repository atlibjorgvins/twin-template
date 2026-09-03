#!/usr/bin/env bash
# Structured brand roles on Project.
#
# Logos (3 fixed roles — replaces "one freeform logo"):
#   brand_logo           (existing) — Original, full colour
#   brand_logo_inverted  — for dark placements
#   brand_logo_black     — flat black, edge cases
#
# Colours (3 fixed roles; text colours are derived in the app):
#   brand_primary   — main brand colour (hex)
#   brand_bg_light  — light background (hex)
#   brand_bg_dark   — dark background (hex)
#
# All nullable; roles inherit from the parent project until set (resolved
# app-side). The freeform brand_colors list stays untouched.
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

add_field() {
  local coll="$1" name="$2" payload="$3"
  local code; code=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/fields/$coll/$name")
  if [ "$code" = "200" ]; then echo "  field $coll.$name exists — skipping."; return; fi
  echo "  adding field $coll.$name…"
  curl -fsS "${AUTH[@]}" "$URL/fields/$coll" -d "$payload" >/dev/null
}
ensure_relation() {
  local coll="$1" field="$2" related="$3"
  local have; have=$(curl -s "${AUTH[@]}" "$URL/relations/$coll/$field" | grep -o "\"collection\":\"$coll\"" | head -1 || true)
  if [ -n "$have" ]; then echo "  relation $coll.$field exists — skipping."; return; fi
  echo "  creating relation $coll.$field → $related…"
  curl -fsS "${AUTH[@]}" "$URL/relations" -d "{
    \"collection\": \"$coll\", \"field\": \"$field\", \"related_collection\": \"$related\",
    \"schema\": { \"on_delete\": \"SET NULL\" }
  }" >/dev/null
}

echo "Project logo roles:"
for F in brand_logo_inverted brand_logo_black brand_logo_landscape brand_logo_vertical brand_logo_simple; do
  case "$F" in
    brand_logo_inverted)  NOTE="Inverted logo for inverse/contrast placements.";;
    brand_logo_black)     NOTE="Flat black logo for edge cases.";;
    brand_logo_landscape) NOTE="Wide/landscape lockup — headers, navbars.";;
    brand_logo_vertical)  NOTE="Stacked/vertical lockup — square-ish placements.";;
    brand_logo_simple)    NOTE="Simple mark only — favicons, avatars, small sizes.";;
  esac
  add_field Project "$F" "{
    \"field\": \"$F\",
    \"type\": \"uuid\",
    \"schema\": { \"is_nullable\": true },
    \"meta\": { \"interface\": \"file-image\", \"special\": [\"file\"], \"note\": \"$NOTE\" }
  }"
  ensure_relation Project "$F" "directus_files"
done

echo "Project colour roles:"
for F in brand_primary brand_bg_light brand_bg_dark; do
  case "$F" in
    brand_primary)  NOTE="Main brand colour (hex).";;
    brand_bg_light) NOTE="Light background colour (hex).";;
    brand_bg_dark)  NOTE="Dark background colour (hex).";;
  esac
  add_field Project "$F" "{
    \"field\": \"$F\",
    \"type\": \"string\",
    \"schema\": { \"is_nullable\": true, \"max_length\": 9 },
    \"meta\": { \"interface\": \"select-color\", \"note\": \"$NOTE\" }
  }"
done

echo "Done."
