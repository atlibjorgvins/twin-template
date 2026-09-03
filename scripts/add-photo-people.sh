#!/usr/bin/env bash
# Photo navigator (Immich) — Directus support.
#
#   photo_person   Mapping between an Immich face cluster ("person" in
#                  Immich terms) and a Directus Person record. Immich
#                  does the face recognition + clustering; twin's
#                  /tools/photos review queue assigns each cluster to a
#                  Person here. Once mapped, every past and future photo
#                  of that face is reachable from the Person record.
#
#                  id            = Immich person uuid (primary key)
#                  person_id     = Directus Person (null until mapped)
#                  immich_name   = name set in Immich, if any (sync aid)
#                  face_count    = #assets at last sync (review ordering)
#                  thumbnail_ok  = cluster has a face thumb in Immich
#                  hidden        = ignore this cluster (strangers, noise)
#
# Photos themselves NEVER enter Directus — twin reads assets/thumbnails
# straight from Immich (tailscale serve :8444 → key-injecting nginx →
# immich-server).
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

echo "▶ photo_person collection"
ensure_collection "photo_person" '{
  "collection": "photo_person",
  "schema": { "name": "photo_person" },
  "meta": {
    "icon": "face",
    "hidden": false,
    "note": "Immich face cluster ↔ Person mapping. id = Immich person uuid.",
    "display_template": "{{immich_name}} → {{person_id.name}}"
  },
  "fields": [
    { "field": "id", "type": "string", "meta": { "interface": "input", "readonly": true, "note": "Immich person uuid" }, "schema": { "is_primary_key": true, "length": 36 } }
  ]
}'
add_field photo_person person_id '{
  "field": "person_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "width": "half",
    "display": "related-values", "display_options": { "template": "{{name}}" },
    "note": "Directus Person this face cluster belongs to. Null = unreviewed." },
  "schema": { "is_nullable": true }
}'
add_field photo_person immich_name '{
  "field": "immich_name", "type": "string",
  "meta": { "interface": "input", "width": "half", "note": "Name set inside Immich, if any." },
  "schema": {}
}'
add_field photo_person face_count '{
  "field": "face_count", "type": "integer",
  "meta": { "interface": "input", "width": "half", "note": "Assets in this cluster at last sync." },
  "schema": { "default_value": 0 }
}'
add_field photo_person hidden '{
  "field": "hidden", "type": "boolean",
  "meta": { "interface": "boolean", "width": "half", "note": "Skip in the review queue (strangers, misfires)." },
  "schema": { "default_value": false }
}'
add_field photo_person mapped_at '{
  "field": "mapped_at", "type": "timestamp",
  "meta": { "interface": "datetime", "readonly": true, "width": "half" },
  "schema": {}
}'
ensure_relation photo_person person_id Person "SET NULL"

echo "✓ done."
