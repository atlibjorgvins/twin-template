#!/usr/bin/env bash
# Budget envelopes — the thing the campaign manager never had.
#
#   mk_budget   An amount you intend to spend, scoped to a project, a
#               campaign or a medium, for a period (total / year / month).
#
# Why a collection and not a `budget` field on Project: a programme runs
# yearly cohorts, so the envelope has to be per year, and spend needs
# tracking per medium too. Both are impossible as one column.
#
# `include_descendants` is what makes a programme-level budget work: the
# envelope sits on the parent project, the spend arrives on the cohorts.
#
# Remaining = amount − spent − committed, where `committed` is money
# booked but not yet spent (signed insertion order, unbilled contract).
#
# finance_budget is NOT reused: that is a monthly target per finance
# category, a different shape and a different owner.
#
# Idempotent — safe to re-run.
set -eo pipefail

# TWIN_ENV_FILE picks the instance: `.env` (personal) or `.env.klak`.
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

echo "▶ mk_budget collection"
ensure_collection "mk_budget" '{
  "collection": "mk_budget",
  "schema": { "name": "mk_budget" },
  "meta": { "icon": "savings", "display_template": "{{label}}",
    "note": "A spending envelope: how much is meant to go to a project, campaign or medium in a period." }
}'

add_field mk_budget label '{
  "field": "label", "type": "string",
  "meta": { "interface": "input", "note": "What this envelope is called, e.g. \"SuperNova 2026 — paid social\"." },
  "schema": {}
}'
add_field mk_budget scope '{
  "field": "scope", "type": "string",
  "meta": { "interface": "select-dropdown", "width": "half",
    "note": "What the envelope is for. The matching fields below are the ones that apply.",
    "options": { "choices": [
      {"text":"Project","value":"project"},
      {"text":"Campaign","value":"campaign"},
      {"text":"Medium","value":"medium"}
    ] } },
  "schema": { "default_value": "project" }
}'
add_field mk_budget status '{
  "field": "status", "type": "string",
  "meta": { "interface": "select-dropdown", "width": "half",
    "note": "Draft envelopes are excluded from every roll-up.",
    "options": { "choices": [
      {"text":"Draft","value":"draft"},
      {"text":"Approved","value":"approved"},
      {"text":"Closed","value":"closed"}
    ] } },
  "schema": { "default_value": "approved" }
}'
add_field mk_budget project_id '{
  "field": "project_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half",
    "note": "Project the envelope belongs to. Required for scope = project.",
    "display": "related-values", "display_options": { "template": "{{name}}" } },
  "schema": {}
}'
add_field mk_budget include_descendants '{
  "field": "include_descendants", "type": "boolean",
  "meta": { "interface": "boolean", "width": "half",
    "note": "Count spend on sub-projects too — a programme budget over its cohorts. Off means this project row only." },
  "schema": { "default_value": true }
}'
add_field mk_budget campaign_id '{
  "field": "campaign_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half",
    "note": "Campaign the envelope belongs to. Required for scope = campaign.",
    "display": "related-values", "display_options": { "template": "{{name}}" } },
  "schema": {}
}'
add_field mk_budget medium '{
  "field": "medium", "type": "string",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half",
    "note": "Narrow the envelope to one medium. Required for scope = medium, optional otherwise.",
    "display": "related-values", "display_options": { "template": "{{label}}" },
    "options": { "filter": { "is_enabled": { "_eq": true } } } },
  "schema": {}
}'
add_field mk_budget period '{
  "field": "period", "type": "string",
  "meta": { "interface": "select-dropdown", "width": "half",
    "note": "Total = the whole run, no dates. Year/month = one repeating slice, from period_start.",
    "options": { "choices": [
      {"text":"Total (whole run)","value":"total"},
      {"text":"Year","value":"year"},
      {"text":"Month","value":"month"}
    ] } },
  "schema": { "default_value": "total" }
}'
add_field mk_budget period_start '{
  "field": "period_start", "type": "date",
  "meta": { "interface": "datetime", "width": "half",
    "note": "First day of the period. Leave empty when period = total (then the project or campaign dates bound it)." },
  "schema": {}
}'
add_field mk_budget amount '{
  "field": "amount", "type": "float",
  "meta": { "interface": "input", "width": "half", "note": "The envelope, in whole currency units." },
  "schema": {}
}'
add_field mk_budget currency '{
  "field": "currency", "type": "string",
  "meta": { "interface": "input", "width": "half" },
  "schema": { "default_value": "ISK" }
}'
add_field mk_budget committed '{
  "field": "committed", "type": "float",
  "meta": { "interface": "input", "width": "half",
    "note": "Booked but not yet spent — signed contracts, insertion orders. Counts against remaining." },
  "schema": { "default_value": 0 }
}'
add_field mk_budget notes '{
  "field": "notes", "type": "text",
  "meta": { "interface": "input-multiline" },
  "schema": {}
}'
add_field mk_budget date_created '{
  "field": "date_created", "type": "timestamp",
  "meta": { "special": ["date-created"], "interface": "datetime", "readonly": true, "hidden": true, "width": "half" },
  "schema": {}
}'
add_field mk_budget date_updated '{
  "field": "date_updated", "type": "timestamp",
  "meta": { "special": ["date-updated"], "interface": "datetime", "readonly": true, "hidden": true, "width": "half" },
  "schema": {}
}'

ensure_relation mk_budget project_id Project "SET NULL"
ensure_relation mk_budget campaign_id mk_campaign "SET NULL"
ensure_relation mk_budget medium mk_medium "SET NULL"

echo "Done."
