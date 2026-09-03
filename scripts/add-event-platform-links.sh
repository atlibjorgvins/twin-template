#!/usr/bin/env bash
# Event ↔ platform ID registry — twin as the source of truth.
#
#   event_platform_link   One row per (event × external platform),
#                         holding the platform's own id + live URL so
#                         twin never creates duplicates and can push
#                         updates to the right object. Built first for
#                         klak.is (WordPress "vidburdure"), but platform
#                         is free-text so Facebook / Instagram / LinkedIn
#                         event ids slot into the same table later.
#
#     event_id     → M2O event (CASCADE — drop links when the event goes)
#     platform     wordpress | facebook | instagram | linkedin | …
#     external_id  the platform's id (e.g. WP post id "226272")
#     url          live link to the object on that platform
#     status       last known remote status (draft | publish | …)
#     synced_at    when twin last pushed/pulled this link
#
# Dedup key: (platform, external_id). A backfill below seeds existing
# klak.is imports from event.external_ref ("klak:<id>").
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
    \"collection\": \"$coll\", \"field\": \"$field\",
    \"related_collection\": \"$related\", \"schema\": { \"on_delete\": \"$ondel\" }
  }" >/dev/null
}

echo "▶ event_platform_link collection"
ensure_collection "event_platform_link" '{
  "collection": "event_platform_link",
  "schema": { "name": "event_platform_link" },
  "meta": {
    "icon": "link",
    "hidden": false,
    "note": "Per-event external platform ids (WordPress/klak.is, Facebook, …) so twin is the source of truth and never duplicates.",
    "display_template": "{{platform}} · {{external_id}}"
  }
}'
add_field event_platform_link event_id '{
  "field": "event_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half" },
  "schema": {}
}'
ensure_relation event_platform_link event_id event "CASCADE"
add_field event_platform_link platform '{
  "field": "platform", "type": "string",
  "meta": { "interface": "input", "width": "half", "note": "wordpress | facebook | instagram | linkedin | …" },
  "schema": {}
}'
add_field event_platform_link external_id '{
  "field": "external_id", "type": "string",
  "meta": { "interface": "input", "width": "half", "note": "The platform’s own id (e.g. WP post id)." },
  "schema": {}
}'
add_field event_platform_link url '{
  "field": "url", "type": "text",
  "meta": { "interface": "input", "note": "Live link on that platform." },
  "schema": { "data_type": "text" }
}'
add_field event_platform_link status '{
  "field": "status", "type": "string",
  "meta": { "interface": "input", "width": "half", "note": "Last known remote status (draft | publish | …)." },
  "schema": {}
}'
add_field event_platform_link synced_at '{
  "field": "synced_at", "type": "timestamp",
  "meta": { "interface": "datetime", "width": "half", "readonly": true },
  "schema": {}
}'

echo "✓ schema done. (Run scripts/backfill-event-platform-links.mjs to seed klak.is ids from external_ref.)"
