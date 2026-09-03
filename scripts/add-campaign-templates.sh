#!/usr/bin/env bash
# Campaign manager templates — reusable structure snapshots.
#
#   mk_template   One saved snapshot of a campaign structure (or part
#                 of one) as JSON:
#                   level 'structure'      whole tree (meta campaigns
#                                          → ad sets → ads)
#                   level 'meta_campaign'  one Meta campaign subtree
#                   level 'ad_set'         one ad set + its ads
#                   level 'ad'             a single ad
#                 The payload stores settings + creative text +
#                 image_id references (Directus files stay valid).
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

echo "▶ mk_template collection"
ensure_collection "mk_template" '{
  "collection": "mk_template",
  "schema": { "name": "mk_template" },
  "meta": {
    "icon": "bookmark",
    "hidden": false,
    "note": "Campaign manager templates — JSON snapshots of Meta structures (whole tree, campaign, ad set or ad) for reuse.",
    "display_template": "{{name}} · {{level}}"
  }
}'
add_field mk_template name '{
  "field": "name", "type": "string",
  "meta": { "interface": "input", "required": true, "width": "half" },
  "schema": {}
}'
add_field mk_template level '{
  "field": "level", "type": "string",
  "meta": { "interface": "select-dropdown", "width": "half",
    "options": { "choices": [
      { "text": "Whole structure", "value": "structure" },
      { "text": "Meta campaign",   "value": "meta_campaign" },
      { "text": "Ad set",          "value": "ad_set" },
      { "text": "Ad",              "value": "ad" }
    ] } },
  "schema": {}
}'
add_field mk_template payload '{
  "field": "payload", "type": "json",
  "meta": { "interface": "input-code", "options": { "language": "json" },
    "note": "Snapshot of the structure subtree — settings, creative text, image_id references." },
  "schema": {}
}'
add_field mk_template date_created '{
  "field": "date_created", "type": "timestamp",
  "meta": { "interface": "datetime", "readonly": true, "hidden": true, "special": ["date-created"], "width": "half" },
  "schema": {}
}'
add_field mk_template date_updated '{
  "field": "date_updated", "type": "timestamp",
  "meta": { "interface": "datetime", "readonly": true, "hidden": true, "special": ["date-updated"], "width": "half" },
  "schema": {}
}'

echo "✓ done."
