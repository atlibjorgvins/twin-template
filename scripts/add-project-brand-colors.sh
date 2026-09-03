#!/usr/bin/env bash
# Project brand palette — named color slots the Image Studio can bind
# dynamically ({project.background}, {project.text}, …) alongside the
# existing Project.color ("project color"). Only projects with at
# least one of these set appear in the Studio's project-context list.
#
#   Project.brand_background             Main background
#   Project.brand_background_secondary   Secondary background
#   Project.brand_text                   Text
#   Project.brand_accent                 Accent
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

echo "▶ Project brand palette"
add_field Project brand_background '{
  "field": "brand_background", "type": "string",
  "meta": { "interface": "select-color", "width": "half",
    "note": "Brand: main background color — usable as a dynamic color in Image Studio templates." },
  "schema": {}
}'
add_field Project brand_background_secondary '{
  "field": "brand_background_secondary", "type": "string",
  "meta": { "interface": "select-color", "width": "half",
    "note": "Brand: secondary background color." },
  "schema": {}
}'
add_field Project brand_text '{
  "field": "brand_text", "type": "string",
  "meta": { "interface": "select-color", "width": "half",
    "note": "Brand: text color." },
  "schema": {}
}'
add_field Project brand_accent '{
  "field": "brand_accent", "type": "string",
  "meta": { "interface": "select-color", "width": "half",
    "note": "Brand: accent color." },
  "schema": {}
}'

echo "✓ done."
