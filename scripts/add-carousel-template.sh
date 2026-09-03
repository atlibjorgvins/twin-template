#!/usr/bin/env bash
# Carousel / "summary post" templates — extends image_template so the
# Image Studio can hold a multi-slide collage built from an event's
# photo gallery (kind = 'carousel'). Reuses the existing layer renderer;
# only the structure + fill state are new.
#
#   image_template.slides       json — ordered slides, each a collage
#                               layout key: [{ "layout": "hero-2" }, …]
#   image_template.assignments  json — flat array (global placement
#                               order across slides) of Directus file
#                               ids or null: ["uuid", null, "uuid", …]
#   image_template.overlay      json — brand overlay config applied to
#                               every slide: { title, logoRole, … }
#   image_template.event_id     M2O event — the bound event whose
#                               gallery fills the placements
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
  local code; code=$(curl -sk -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/fields/$coll/$name")
  if [ "$code" = "200" ]; then echo "  field $coll.$name exists — skipping."; return; fi
  echo "  adding field $coll.$name…"
  curl -fsSk "${AUTH[@]}" "$URL/fields/$coll" -d "$payload" >/dev/null
}
ensure_relation() {
  local coll="$1" field="$2" related="$3" ondel="${4:-SET NULL}"
  local have; have=$(curl -sk "${AUTH[@]}" "$URL/relations/$coll/$field" | grep -o "\"collection\":\"$coll\"" | head -1 || true)
  if [ -n "$have" ]; then echo "  relation $coll.$field exists — skipping."; return; fi
  echo "  creating relation $coll.$field → $related ($ondel)…"
  curl -fsSk "${AUTH[@]}" "$URL/relations" -d "{
    \"collection\": \"$coll\", \"field\": \"$field\",
    \"related_collection\": \"$related\", \"schema\": { \"on_delete\": \"$ondel\" }
  }" >/dev/null
}

echo "▶ image_template carousel fields"
add_field image_template slides '{
  "field": "slides", "type": "json",
  "meta": { "interface": "input-code", "options": { "language": "json" },
    "note": "Carousel: ordered slides, each a collage layout key." },
  "schema": {}
}'
add_field image_template assignments '{
  "field": "assignments", "type": "json",
  "meta": { "interface": "input-code", "options": { "language": "json" },
    "note": "Carousel: file id (or null) per placement, in global slide order." },
  "schema": {}
}'
add_field image_template overlay '{
  "field": "overlay", "type": "json",
  "meta": { "interface": "input-code", "options": { "language": "json" },
    "note": "Carousel: brand overlay config (title, logo role) applied to every slide." },
  "schema": {}
}'
add_field image_template event_id '{
  "field": "event_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half",
    "note": "Carousel: the event whose photo gallery fills the placements.",
    "display": "related-values", "display_options": { "template": "{{name}}" } },
  "schema": {}
}'
ensure_relation image_template event_id event "SET NULL"

echo "✓ done."
