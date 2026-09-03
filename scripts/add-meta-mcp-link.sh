#!/usr/bin/env bash
# Meta Ads MCP link — organize ad accounts before any sync.
#
#   mk_ad_account             Registry of Meta ad accounts visible to
#                             the connected MCP user (names/ids only —
#                             no performance data). project_id links an
#                             account to the twin project it runs for;
#                             that link is the GATE: push/pull only
#                             touches accounts that are linked.
#   mk_campaign.ad_account_id Which ad account a campaign publishes
#                             into — required before /meta-push.
#   mk_metric.ref_id          Meta entity id for pulled insights, so
#                             rows match by id instead of fuzzy name.
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

echo "▶ mk_ad_account collection"
# The Meta ad account id is the primary key — declared inline so
# Directus doesn't auto-create an integer autoincrement id.
ensure_collection "mk_ad_account" '{
  "collection": "mk_ad_account",
  "schema": { "name": "mk_ad_account" },
  "meta": {
    "icon": "account_balance_wallet",
    "hidden": false,
    "note": "Meta ad accounts visible to the connected Ads MCP user. Link each to a client organization — unlinked accounts are never pushed to or pulled from.",
    "display_template": "{{name}}"
  },
  "fields": [{
    "field": "id", "type": "string",
    "meta": { "interface": "input", "readonly": true },
    "schema": { "is_primary_key": true, "length": 64 }
  }]
}'
add_field mk_ad_account name '{
  "field": "name", "type": "string",
  "meta": { "interface": "input", "width": "half" },
  "schema": {}
}'
add_field mk_ad_account business_name '{
  "field": "business_name", "type": "string",
  "meta": { "interface": "input", "width": "half" },
  "schema": {}
}'
add_field mk_ad_account currency '{
  "field": "currency", "type": "string",
  "meta": { "interface": "input", "width": "half" },
  "schema": {}
}'
add_field mk_ad_account account_status '{
  "field": "account_status", "type": "string",
  "meta": { "interface": "input", "width": "half" },
  "schema": {}
}'
add_field mk_ad_account is_enabled '{
  "field": "is_enabled", "type": "boolean",
  "meta": { "interface": "boolean", "width": "half",
    "note": "MCP-enabled and queryable — false means Meta won'\''t let the connector touch it." },
  "schema": { "default_value": true }
}'
add_field mk_ad_account project_id '{
  "field": "project_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half",
    "note": "The twin project this account runs for. THE GATE: unlinked accounts are never synced.",
    "display": "related-values", "display_options": { "template": "{{name}}" } },
  "schema": {}
}'
add_field mk_ad_account date_synced '{
  "field": "date_synced", "type": "timestamp",
  "meta": { "interface": "datetime", "width": "half", "readonly": true },
  "schema": {}
}'
ensure_relation mk_ad_account project_id Project "SET NULL"

echo "▶ mk_campaign.ad_account_id"
add_field mk_campaign ad_account_id '{
  "field": "ad_account_id", "type": "string",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half",
    "note": "Which Meta ad account this campaign publishes into — required before pushing via the Ads MCP.",
    "display": "related-values", "display_options": { "template": "{{name}}" } },
  "schema": { "length": 64 }
}'
ensure_relation mk_campaign ad_account_id mk_ad_account "SET NULL"

echo "▶ mk_metric.ref_id"
add_field mk_metric ref_id '{
  "field": "ref_id", "type": "string",
  "meta": { "interface": "input", "width": "half",
    "note": "Meta entity id for MCP-pulled insights — id-based upserts beat name matching." },
  "schema": {}
}'

echo "✓ done."
