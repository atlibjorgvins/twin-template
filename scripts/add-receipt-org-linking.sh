#!/usr/bin/env bash
# Receipt → organization linking + a learnable merchant alias map.
#
#   finance_receipt.org_id        m2o → organization, set when we can tell
#                                 which org a receipt's merchant text means
#   receipt_merchant_alias        the teaching store: "this merchant text
#                                 means that organization". Written once by
#                                 hand, reused automatically forever after.
#
# Why a separate collection rather than a hardcoded map: the OCR'd merchant
# string on a real receipt is often a place or a branch, not a company name
# ("Naustabryggja"), and no static list survives that. The alias table lets
# the answer be taught once and then applied without asking again.
#
# Additive and idempotent — safe to re-run. Same style as add-finances.sh.
set -eo pipefail

# TWIN_ENV_FILE picks the instance: `.env` (personal) or `.env.klak`.
# A name relative to the repo root, so it reads the same from anywhere.
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/${TWIN_ENV_FILE:-.env}"
eval "$(grep -E '^(PUBLIC_DIRECTUS_URL|PUBLIC_DIRECTUS_TOKEN|DIRECTUS_ADMIN_URL)=' "$ENV_FILE" | sed 's/^/export /')"
# Schema tooling talks to Directus directly; the app-facing URL may be a
# same-origin path (/api) that only resolves in a browser. DIRECTUS_ADMIN_URL
# is the absolute URL for out-of-browser callers; fall back to the public one
# when it is absolute (KLAK, pre-/api setups).
URL="${DIRECTUS_ADMIN_URL:-$PUBLIC_DIRECTUS_URL}"; URL="${URL%/}"; TOKEN="$PUBLIC_DIRECTUS_TOKEN"
AUTH=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

ensure_collection() {
  local name="$1" payload="$2"
  local code; code=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/collections/$name")
  if [ "$code" = "200" ]; then echo "  collection $name exists — skipping."; return; fi
  echo "  creating collection $name…"; curl -fsS "${AUTH[@]}" "$URL/collections" -d "$payload" >/dev/null
}

add_field() {
  local coll="$1" name="$2" payload="$3"
  local code; code=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/fields/$coll/$name")
  if [ "$code" = "200" ]; then echo "  field $coll.$name exists — skipping."; return; fi
  echo "  adding field $coll.$name…"; curl -fsS "${AUTH[@]}" "$URL/fields/$coll" -d "$payload" >/dev/null
}

ensure_relation() {
  local coll="$1" field="$2" related="$3"
  local existing
  existing=$(curl -s "${AUTH[@]}" "$URL/relations/$coll/$field" -o /dev/null -w "%{http_code}")
  if [ "$existing" = "200" ]; then echo "  relation $coll.$field exists — skipping."; return; fi
  echo "  creating relation $coll.$field → $related…"
  curl -fsS "${AUTH[@]}" "$URL/relations" -d "{
    \"collection\": \"$coll\",
    \"field\": \"$field\",
    \"related_collection\": \"$related\",
    \"schema\": { \"on_delete\": \"SET NULL\" }
  }" >/dev/null
}

echo "▶ finance_receipt.org_id"
add_field finance_receipt org_id '{
  "field": "org_id", "type": "integer",
  "schema": { "is_nullable": true },
  "meta": {
    "interface": "select-dropdown-m2o", "special": ["m2o"],
    "options": { "template": "{{name}}" },
    "note": "Organization this receipt is from. Auto-filled on an exact name or a taught alias match."
  }
}'
# SET NULL, not CASCADE: deleting an org must not delete receipts — the
# photo is the evidence and outlives any org record.
ensure_relation finance_receipt org_id organization

echo "▶ finance_receipt.project_id"
add_field finance_receipt project_id '{
  "field": "project_id", "type": "integer",
  "schema": { "is_nullable": true },
  "meta": {
    "interface": "select-dropdown-m2o", "special": ["m2o"],
    "options": { "template": "{{name}}" },
    "note": "Project this expense belongs to. Set by hand — a receipt cannot be attributed to a project by its text alone."
  }
}'
# Project, capital P — the collection name is case-sensitive and differs from
# the route label.
ensure_relation finance_receipt project_id Project

echo "▶ receipt_merchant_alias"
ensure_collection receipt_merchant_alias '{
  "collection": "receipt_merchant_alias",
  "meta": {
    "icon": "sell", "note": "Teaches which organization a receipt merchant string means.",
    "display_template": "{{match_text}}", "sort_field": "sort"
  },
  "schema": {}
}'

add_field receipt_merchant_alias match_text '{
  "field": "match_text", "type": "string",
  "schema": { "is_nullable": false },
  "meta": {
    "interface": "input", "required": true,
    "note": "Merchant text as OCR read it. Matched accent- and case-insensitively."
  }
}'

add_field receipt_merchant_alias org_id '{
  "field": "org_id", "type": "integer",
  "schema": { "is_nullable": true },
  "meta": {
    "interface": "select-dropdown-m2o", "special": ["m2o"],
    "options": { "template": "{{name}}" },
    "note": "The organization that merchant text means."
  }
}'
ensure_relation receipt_merchant_alias org_id organization

add_field receipt_merchant_alias hits '{
  "field": "hits", "type": "integer",
  "schema": { "is_nullable": true, "default_value": 0 },
  "meta": { "interface": "input", "readonly": true, "note": "How many receipts this alias has resolved." }
}'

add_field receipt_merchant_alias sort '{
  "field": "sort", "type": "integer",
  "schema": { "is_nullable": true },
  "meta": { "interface": "input", "hidden": true }
}'

add_field receipt_merchant_alias date_created '{
  "field": "date_created", "type": "timestamp",
  "meta": {
    "special": ["date-created"], "interface": "datetime",
    "readonly": true, "hidden": true
  }
}'

echo "Done."
