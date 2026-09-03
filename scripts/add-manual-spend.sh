#!/usr/bin/env bash
# Manual ad spend — channels twin isn't connected to (billboards, print,
# radio, sponsorships…), tracked alongside Meta so reporting can blend them.
#
#   mk_manual_spend   A spend entry: label, channel, amount, date(s),
#                     attributed to a project and/or event.
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
    \"collection\": \"$coll\", \"field\": \"$field\", \"related_collection\": \"$related\",
    \"schema\": { \"on_delete\": \"$ondel\" }
  }" >/dev/null
}

echo "▶ mk_manual_spend collection"
ensure_collection "mk_manual_spend" '{
  "collection": "mk_manual_spend",
  "schema": { "name": "mk_manual_spend" },
  "meta": { "icon": "receipt_long", "note": "Manual ad spend on channels twin is not connected to (billboards, print, radio…)." }
}'

add_field mk_manual_spend label '{
  "field": "label", "type": "string",
  "meta": { "interface": "input", "note": "What this spend was for, e.g. \"Lækjartorg billboard\"." },
  "schema": {}
}'
add_field mk_manual_spend channel '{
  "field": "channel", "type": "string",
  "meta": { "interface": "select-dropdown", "note": "Channel / medium.",
    "options": { "allowOther": true, "choices": [
      {"text":"Billboard / OOH","value":"billboard"},
      {"text":"Print","value":"print"},
      {"text":"Radio","value":"radio"},
      {"text":"TV","value":"tv"},
      {"text":"Sponsorship","value":"sponsorship"},
      {"text":"Other","value":"other"}
    ] } },
  "schema": { "default_value": "other" }
}'
add_field mk_manual_spend amount '{
  "field": "amount", "type": "float",
  "meta": { "interface": "input", "note": "Spend amount in whole currency units." },
  "schema": {}
}'
add_field mk_manual_spend currency '{
  "field": "currency", "type": "string",
  "meta": { "interface": "input", "width": "half" },
  "schema": { "default_value": "ISK" }
}'
add_field mk_manual_spend spend_date '{
  "field": "spend_date", "type": "date",
  "meta": { "interface": "datetime", "width": "half", "note": "Date the spend lands on (used for period reporting)." },
  "schema": {}
}'
add_field mk_manual_spend end_date '{
  "field": "end_date", "type": "date",
  "meta": { "interface": "datetime", "width": "half", "note": "Optional end of the run (informational)." },
  "schema": {}
}'
add_field mk_manual_spend project_id '{
  "field": "project_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half",
    "display": "related-values", "display_options": { "template": "{{name}}" },
    "note": "Sub-project this spend is attributed to." },
  "schema": {}
}'
add_field mk_manual_spend event_id '{
  "field": "event_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half",
    "display": "related-values", "display_options": { "template": "{{name}}" },
    "note": "Optional event this spend is tied to." },
  "schema": {}
}'
add_field mk_manual_spend notes '{
  "field": "notes", "type": "text",
  "meta": { "interface": "input-multiline" },
  "schema": {}
}'
add_field mk_manual_spend date_created '{
  "field": "date_created", "type": "timestamp",
  "meta": { "special": ["date-created"], "interface": "datetime", "readonly": true, "hidden": true, "width": "half" },
  "schema": {}
}'
add_field mk_manual_spend date_updated '{
  "field": "date_updated", "type": "timestamp",
  "meta": { "special": ["date-updated"], "interface": "datetime", "readonly": true, "hidden": true, "width": "half" },
  "schema": {}
}'

ensure_relation mk_manual_spend project_id Project "SET NULL"
ensure_relation mk_manual_spend event_id event "SET NULL"

echo "Done."
