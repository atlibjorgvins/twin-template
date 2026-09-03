#!/usr/bin/env bash
# Buffer integration — twin queues Evergreen posts straight into Buffer.
#
#   buffer_channel             Snapshot of the Buffer channels (id from
#                              Buffer, name, service, avatar) so the UI
#                              can offer channel pickers offline.
#   posting_identity.channels  Per-platform default channel ids for a
#                              brand preset, e.g. {"facebook":"…",
#                              "instagram":"…","linkedin":"…"}.
#   campaign_post.buffer_post_id / buffered_at
#                              Set when a post is queued via the
#                              "Buffer post proxy" Directus Flow.
#
# The API call itself runs in a Directus Flow (webhook trigger →
# request to api.buffer.com/graphql) holding the Buffer API key
# server-side. Images ride as public URLs via Tailscale Funnel on
# :10000/assets.
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

echo "▶ buffer_channel collection"
ensure_collection "buffer_channel" '{
  "collection": "buffer_channel",
  "schema": { "name": "buffer_channel" },
  "meta": {
    "icon": "share",
    "hidden": false,
    "note": "Snapshot of Buffer channels (synced by hand / by Claude). id = Buffer channel id.",
    "display_template": "{{display_name}} ({{service}})"
  },
  "fields": [
    { "field": "id", "type": "string", "meta": { "interface": "input", "readonly": true }, "schema": { "is_primary_key": true, "length": 32 } }
  ]
}'
add_field buffer_channel name '{
  "field": "name", "type": "string",
  "meta": { "interface": "input", "width": "half" }, "schema": {}
}'
add_field buffer_channel display_name '{
  "field": "display_name", "type": "string",
  "meta": { "interface": "input", "width": "half" }, "schema": {}
}'
add_field buffer_channel service '{
  "field": "service", "type": "string",
  "meta": { "interface": "input", "width": "half", "note": "facebook | instagram | linkedin | …" }, "schema": {}
}'
add_field buffer_channel channel_type '{
  "field": "channel_type", "type": "string",
  "meta": { "interface": "input", "width": "half" }, "schema": {}
}'
add_field buffer_channel avatar '{
  "field": "avatar", "type": "string",
  "meta": { "interface": "input" }, "schema": {}
}'
add_field buffer_channel is_disconnected '{
  "field": "is_disconnected", "type": "boolean",
  "meta": { "interface": "boolean", "width": "half" }, "schema": { "default_value": false }
}'
add_field buffer_channel project_id '{
  "field": "project_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half",
    "note": "The twin project this channel posts for. Link it so Evergreen/campaigns know who it belongs to.",
    "display": "related-values", "display_options": { "template": "{{name}}" } },
  "schema": {}
}'

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
ensure_relation buffer_channel project_id Project "SET NULL"

echo "▶ posting_identity.channels"
add_field posting_identity channels '{
  "field": "channels", "type": "json",
  "meta": { "interface": "input-code", "options": { "language": "json" },
    "note": "Default Buffer channel id per platform for this identity, e.g. {\"facebook\":\"<id>\",\"instagram\":\"<id>\",\"linkedin\":\"<id>\"}." },
  "schema": {}
}'

echo "▶ campaign_post buffer fields"
add_field campaign_post buffer_post_id '{
  "field": "buffer_post_id", "type": "string",
  "meta": { "interface": "input", "readonly": true, "width": "half",
    "note": "Buffer post id once queued via the proxy flow." },
  "schema": {}
}'
add_field campaign_post buffered_at '{
  "field": "buffered_at", "type": "timestamp",
  "meta": { "interface": "datetime", "readonly": true, "width": "half" },
  "schema": {}
}'

echo "✓ done."
