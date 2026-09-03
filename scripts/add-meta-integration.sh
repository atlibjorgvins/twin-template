#!/usr/bin/env bash
# Meta (Graph API) integration — twin publishes to Facebook Pages +
# Instagram and pulls ad reports straight from Meta, mirroring the
# Buffer pattern: the access token lives server-side in a Directus
# Flow ("Meta Graph proxy"), never in the browser.
#
#   meta_channel               Snapshot of the publishing targets the
#                              connected System User can reach — one row
#                              per Facebook Page / Instagram account
#                              (id, name, kind, @handle, avatar). Synced
#                              from Meta by twin's "Sync from Meta"
#                              action. project_id links a target to a
#                              twin project; that link is the GATE, same
#                              as mk_ad_account — unlinked targets are
#                              never published to.
#   posting_identity.meta_channel_id
#                              Default Meta target for a brand preset,
#                              so a campaign/post picks its Page/IG
#                              automatically (complements .channels which
#                              holds the Buffer channel ids).
#   campaign_post.meta_post_id / meta_posted_at
#                              Set when a post is published straight to
#                              Meta via the proxy flow (vs queued to
#                              Buffer).
#
# Ad accounts already live in mk_ad_account (see add-meta-mcp-link.sh)
# and are reused for the ad-report pull.
#
# The Graph call itself runs in a Directus Flow holding the System User
# token (expiration: never). See /settings/meta in twin for the exact
# Flow "Run Script" body and the Flow id to wire into src/lib/directus.ts.
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

echo "▶ meta_channel collection"
# The Meta object id (Page id or IG user id) is the primary key —
# declared inline so Directus doesn't auto-create an autoincrement id.
ensure_collection "meta_channel" '{
  "collection": "meta_channel",
  "schema": { "name": "meta_channel" },
  "meta": {
    "icon": "share",
    "hidden": false,
    "note": "Publishing targets reachable by the connected System User — one row per Facebook Page / Instagram account. Synced from Meta. Link each to a client org; unlinked targets are never published to.",
    "display_template": "{{name}} ({{kind}})"
  },
  "fields": [{
    "field": "id", "type": "string",
    "meta": { "interface": "input", "readonly": true },
    "schema": { "is_primary_key": true, "length": 64 }
  }]
}'
add_field meta_channel name '{
  "field": "name", "type": "string",
  "meta": { "interface": "input", "width": "half" }, "schema": {}
}'
add_field meta_channel kind '{
  "field": "kind", "type": "string",
  "meta": { "interface": "select-dropdown", "width": "half",
    "note": "facebook_page | instagram",
    "options": { "choices": [
      { "text": "Facebook Page", "value": "facebook_page" },
      { "text": "Instagram", "value": "instagram" }
    ] } },
  "schema": { "default_value": "facebook_page" }
}'
# The backing Facebook Page id. For an Instagram target this is the
# Page the IG Business account is connected through (IG publishing is
# routed via its Page).
add_field meta_channel page_id '{
  "field": "page_id", "type": "string",
  "meta": { "interface": "input", "width": "half",
    "note": "Backing Facebook Page id. For Instagram, the Page the IG account is connected through." },
  "schema": { "length": 64 }
}'
add_field meta_channel ig_user_id '{
  "field": "ig_user_id", "type": "string",
  "meta": { "interface": "input", "width": "half",
    "note": "Instagram Business account id (instagram kind only)." },
  "schema": { "length": 64 }
}'
add_field meta_channel username '{
  "field": "username", "type": "string",
  "meta": { "interface": "input", "width": "half", "note": "@handle (Instagram)." },
  "schema": {}
}'
add_field meta_channel category '{
  "field": "category", "type": "string",
  "meta": { "interface": "input", "width": "half", "note": "Page category." },
  "schema": {}
}'
add_field meta_channel avatar '{
  "field": "avatar", "type": "text",
  "meta": { "interface": "input", "note": "Picture URL (Meta CDN URLs exceed 255 chars — use text)." },
  "schema": { "data_type": "text" }
}'
add_field meta_channel is_enabled '{
  "field": "is_enabled", "type": "boolean",
  "meta": { "interface": "boolean", "width": "half",
    "note": "Available as a publishing target. Uncheck to hide without deleting." },
  "schema": { "default_value": true }
}'
add_field meta_channel project_id '{
  "field": "project_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half",
    "note": "The twin project this target belongs to. THE GATE: unlinked targets are never published to.",
    "display": "related-values", "display_options": { "template": "{{name}}" } },
  "schema": {}
}'
add_field meta_channel date_synced '{
  "field": "date_synced", "type": "timestamp",
  "meta": { "interface": "datetime", "width": "half", "readonly": true },
  "schema": {}
}'
ensure_relation meta_channel project_id Project "SET NULL"

echo "▶ posting_identity.meta_channel_id"
add_field posting_identity meta_channel_id '{
  "field": "meta_channel_id", "type": "string",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half",
    "note": "Default Meta publishing target (Page/IG) for this identity.",
    "display": "related-values", "display_options": { "template": "{{name}}" } },
  "schema": { "length": 64 }
}'
ensure_relation posting_identity meta_channel_id meta_channel "SET NULL"

echo "▶ campaign_post meta fields"
add_field campaign_post meta_post_id '{
  "field": "meta_post_id", "type": "string",
  "meta": { "interface": "input", "readonly": true, "width": "half",
    "note": "Meta post/media id once published straight to Meta via the proxy flow." },
  "schema": {}
}'
add_field campaign_post meta_posted_at '{
  "field": "meta_posted_at", "type": "timestamp",
  "meta": { "interface": "datetime", "readonly": true, "width": "half" },
  "schema": {}
}'

echo "✓ done."
