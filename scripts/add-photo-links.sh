#!/usr/bin/env bash
# Photo navigator — per-photo tagging.
#
#   photo_link   Tags one Immich asset (a photo/video on the NAS) to a
#                record: organization, Project or Person. Complements
#                photo_person (face-cluster mapping): clusters cover
#                "every photo of this face" automatically, photo_link
#                covers deliberate per-photo curation — org team shots,
#                project event coverage, people missed by recognition.
#
#                asset_id     = Immich asset uuid
#                collection   = organization | Project | Person
#                item_id      = id in that collection
#
# Photos never enter Directus — only their Immich ids.
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

echo "▶ photo_link collection"
ensure_collection "photo_link" '{
  "collection": "photo_link",
  "schema": { "name": "photo_link" },
  "meta": {
    "icon": "photo_library",
    "hidden": false,
    "note": "Tags an Immich asset to an organization / Project / Person. asset_id = Immich asset uuid.",
    "display_template": "{{collection}} #{{item_id}}"
  },
  "fields": [
    { "field": "id", "type": "integer", "meta": { "interface": "input", "readonly": true, "hidden": true }, "schema": { "is_primary_key": true, "has_auto_increment": true } }
  ]
}'
add_field photo_link asset_id '{
  "field": "asset_id", "type": "string",
  "meta": { "interface": "input", "width": "half", "note": "Immich asset uuid" },
  "schema": { "length": 36, "is_nullable": false }
}'
add_field photo_link collection '{
  "field": "collection", "type": "string",
  "meta": { "interface": "select-dropdown", "width": "half",
    "options": { "choices": [
      { "text": "Organization", "value": "organization" },
      { "text": "Project", "value": "Project" },
      { "text": "Person", "value": "Person" }
    ] } },
  "schema": { "is_nullable": false }
}'
add_field photo_link item_id '{
  "field": "item_id", "type": "integer",
  "meta": { "interface": "input", "width": "half" },
  "schema": { "is_nullable": false }
}'
add_field photo_link date_created '{
  "field": "date_created", "type": "timestamp",
  "meta": { "interface": "datetime", "readonly": true, "width": "half", "special": ["date-created"] },
  "schema": {}
}'

echo "✓ done."
