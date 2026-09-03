#!/usr/bin/env bash
# Sets up the Grants subsystem.
#
# Three collections:
#   Grant              — the grant *programme* (Tækniþróunarsjóður,
#                        Rannsóknasjóður, EU Horizon…). One row per
#                        programme; carries its funder, recurrence,
#                        whether the same call runs yearly etc.
#   GrantAward         — one row per award. Points at a Grant + an
#                        organization (the recipient), optional Project,
#                        carries the total amount + currency + the year
#                        the award was made.
#   GrantAwardPayment  — staged payouts (year 1 / year 2 / year 3 of a
#                        multi-year award — Rannís's TÞS works this way).
#                        One row per installment.
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
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/collections/$name")
  if [ "$code" = "200" ]; then echo "  collection $name exists — skipping."; return; fi
  echo "  creating collection $name…"
  curl -fsS "${AUTH[@]}" "$URL/collections" -d "$payload" >/dev/null
}

add_field() {
  local coll="$1" name="$2" payload="$3"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/fields/$coll/$name")
  if [ "$code" = "200" ]; then echo "  field $coll.$name exists — skipping."; return; fi
  echo "  adding field $coll.$name…"
  curl -fsS "${AUTH[@]}" "$URL/fields/$coll" -d "$payload" >/dev/null
}

ensure_relation() {
  local coll="$1" field="$2" related="$3" ondel="${4:-SET NULL}"
  local have
  have=$(curl -s "${AUTH[@]}" "$URL/relations/$coll/$field" | grep -o "\"collection\":\"$coll\"" | head -1 || true)
  if [ -n "$have" ]; then echo "  relation $coll.$field exists — skipping."; return; fi
  echo "  creating relation $coll.$field → $related ($ondel)…"
  curl -fsS "${AUTH[@]}" "$URL/relations" -d "{
    \"collection\": \"$coll\",
    \"field\": \"$field\",
    \"related_collection\": \"$related\",
    \"schema\": { \"on_delete\": \"$ondel\" }
  }" >/dev/null
}

# ─── Grant (programme) ────────────────────────────────────────────────
echo "▶ Grant collection"
ensure_collection "Grant" '{
  "collection": "Grant",
  "schema": { "name": "Grant" },
  "meta": {
    "icon": "card_giftcard",
    "hidden": false,
    "note": "A grant programme (Tækniþróunarsjóður, Rannsóknasjóður, EU Horizon, etc.). Individual awards live in GrantAward; this row carries the programme metadata.",
    "display_template": "{{name}}",
    "sort_field": "sort",
    "archive_field": "status",
    "archive_value": "archived",
    "unarchive_value": "published",
    "archive_app_filter": true
  },
  "fields": [
    { "field": "id",           "type": "integer",  "meta": { "hidden": true, "readonly": true, "interface": "input" }, "schema": { "is_primary_key": true, "has_auto_increment": true } },
    { "field": "status",       "type": "string",   "meta": { "interface": "select-dropdown", "options": { "choices": [{"text":"Draft","value":"draft"},{"text":"Published","value":"published"},{"text":"Archived","value":"archived"}] }, "display": "labels", "width": "half" }, "schema": { "default_value": "published", "is_nullable": false } },
    { "field": "sort",         "type": "integer",  "meta": { "interface": "input", "hidden": true } },
    { "field": "date_created", "type": "timestamp","meta": { "special": ["date-created"], "interface": "datetime", "readonly": true, "hidden": true } },
    { "field": "date_updated", "type": "timestamp","meta": { "special": ["date-updated"], "interface": "datetime", "readonly": true, "hidden": true } }
  ]
}'
add_field "Grant" "name"           '{ "field": "name",            "type": "string", "schema": { "max_length": 200, "is_nullable": false }, "meta": { "interface": "input", "required": true, "note": "Human-readable programme name." } }'
add_field "Grant" "short_name"     '{ "field": "short_name",      "type": "string", "schema": { "max_length": 32,  "is_nullable": true  }, "meta": { "interface": "input", "note": "Common abbreviation, e.g. TÞS." } }'
add_field "Grant" "funder_label"   '{ "field": "funder_label",    "type": "string", "schema": { "max_length": 128, "is_nullable": true  }, "meta": { "interface": "input", "note": "Free-text funder when the funder isn''t in the org list (e.g. \"EU\")." } }'
add_field "Grant" "funder_org_id"  '{ "field": "funder_org_id",   "type": "integer","schema": { "is_nullable": true }, "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "options": { "template": "{{name}}" }, "note": "Funding organisation (Rannís, etc.) when it exists in the org list." } }'
add_field "Grant" "category"       '{ "field": "category",        "type": "string", "schema": { "max_length": 32, "is_nullable": true }, "meta": { "interface": "select-dropdown", "options": { "choices": [
  {"text":"R&D / Innovation","value":"rnd"},
  {"text":"Research","value":"research"},
  {"text":"Climate / Sustainability","value":"climate"},
  {"text":"Design","value":"design"},
  {"text":"Culture / Film","value":"culture"},
  {"text":"Infrastructure","value":"infrastructure"},
  {"text":"Student / Education","value":"student"},
  {"text":"Export / Internationalisation","value":"export"},
  {"text":"Equity / Investment","value":"equity"},
  {"text":"Other","value":"other"}
] }, "display": "labels", "note": "What domain the programme funds." } }'
add_field "Grant" "country"        '{ "field": "country",         "type": "string", "schema": { "max_length": 64, "is_nullable": true, "default_value": "Iceland" }, "meta": { "interface": "input", "note": "Home country / scope of the programme." } }'
add_field "Grant" "currency"       '{ "field": "currency",        "type": "string", "schema": { "max_length": 8, "is_nullable": true, "default_value": "ISK" }, "meta": { "interface": "select-dropdown", "options": { "choices": [{"text":"ISK","value":"ISK"},{"text":"EUR","value":"EUR"},{"text":"USD","value":"USD"},{"text":"GBP","value":"GBP"}] }, "display": "labels", "note": "Default currency the programme awards in." } }'
add_field "Grant" "is_recurring"   '{ "field": "is_recurring",    "type": "boolean", "schema": { "default_value": false }, "meta": { "interface": "boolean", "display": "boolean", "note": "True for annual / regular calls (Tækniþróunarsjóður runs every year)." } }'
add_field "Grant" "recurrence"     '{ "field": "recurrence",      "type": "string", "schema": { "max_length": 32, "is_nullable": true }, "meta": { "interface": "select-dropdown", "options": { "choices": [
  {"text":"Annual","value":"annual"},
  {"text":"Biannual","value":"biannual"},
  {"text":"Quarterly","value":"quarterly"},
  {"text":"Ad-hoc","value":"ad_hoc"}
] }, "display": "labels", "note": "Cadence of the programme call." } }'
add_field "Grant" "typical_duration_years" '{ "field": "typical_duration_years", "type": "integer", "schema": { "is_nullable": true }, "meta": { "interface": "input", "note": "Typical award duration in years (1–3 for most R&D, can be more for research)." } }'
add_field "Grant" "website"        '{ "field": "website",         "type": "string", "schema": { "max_length": 256, "is_nullable": true }, "meta": { "interface": "input", "note": "Programme home page or call URL." } }'
add_field "Grant" "summary"        '{ "field": "summary",         "type": "text",   "schema": { "is_nullable": true }, "meta": { "interface": "input-multiline", "note": "Short description of what the programme funds and who is eligible." } }'
add_field "Grant" "color"          '{ "field": "color",           "type": "string", "schema": { "max_length": 16, "is_nullable": true }, "meta": { "interface": "select-color", "display": "color", "note": "Accent colour for chips / pills." } }'

ensure_relation "Grant" "funder_org_id" "organization" "SET NULL"

# ─── GrantAward ───────────────────────────────────────────────────────
echo "▶ GrantAward collection"
ensure_collection "GrantAward" '{
  "collection": "GrantAward",
  "schema": { "name": "GrantAward" },
  "meta": {
    "icon": "redeem",
    "hidden": false,
    "note": "One row per granted award. Points at a Grant + an organization (recipient) and carries the total awarded + currency + year. Multi-year staged payouts live in GrantAwardPayment.",
    "display_template": "{{grant_id.name}} — {{organization_id.name}} ({{awarded_year}})",
    "sort_field": "sort",
    "archive_field": "status",
    "archive_value": "archived",
    "unarchive_value": "published",
    "archive_app_filter": true
  },
  "fields": [
    { "field": "id",           "type": "integer",  "meta": { "hidden": true, "readonly": true, "interface": "input" }, "schema": { "is_primary_key": true, "has_auto_increment": true } },
    { "field": "status",       "type": "string",   "meta": { "interface": "select-dropdown", "options": { "choices": [{"text":"Draft","value":"draft"},{"text":"Published","value":"published"},{"text":"Archived","value":"archived"}] }, "display": "labels", "width": "half" }, "schema": { "default_value": "published", "is_nullable": false } },
    { "field": "sort",         "type": "integer",  "meta": { "interface": "input", "hidden": true } },
    { "field": "date_created", "type": "timestamp","meta": { "special": ["date-created"], "interface": "datetime", "readonly": true, "hidden": true } },
    { "field": "date_updated", "type": "timestamp","meta": { "special": ["date-updated"], "interface": "datetime", "readonly": true, "hidden": true } }
  ]
}'
add_field "GrantAward" "grant_id"         '{ "field": "grant_id",         "type": "integer", "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "options": { "template": "{{name}}" }, "width": "half", "required": true }, "schema": { "is_nullable": false } }'
add_field "GrantAward" "organization_id"  '{ "field": "organization_id",  "type": "integer", "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "options": { "template": "{{name}}" }, "width": "half", "required": true }, "schema": { "is_nullable": false } }'
add_field "GrantAward" "project_id"       '{ "field": "project_id",       "type": "integer", "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "options": { "template": "{{name}}" }, "note": "Optional — the project this award funded." }, "schema": { "is_nullable": true } }'
add_field "GrantAward" "award_name"       '{ "field": "award_name",       "type": "string", "schema": { "max_length": 200, "is_nullable": true }, "meta": { "interface": "input", "note": "Optional working title (e.g. \"TÞS-2024-Vöxtur — AI biomarker pipeline\")." } }'
add_field "GrantAward" "awarded_year"     '{ "field": "awarded_year",     "type": "integer", "schema": { "is_nullable": true }, "meta": { "interface": "input", "note": "Calendar year the award was granted." } }'
add_field "GrantAward" "award_date"       '{ "field": "award_date",       "type": "date", "schema": { "is_nullable": true }, "meta": { "interface": "datetime", "display": "datetime", "note": "Date the award was confirmed." } }'
add_field "GrantAward" "total_amount"     '{ "field": "total_amount",     "type": "decimal", "schema": { "is_nullable": true, "numeric_precision": 18, "numeric_scale": 2 }, "meta": { "interface": "input", "note": "Total amount of the award (sum across all payouts)." } }'
add_field "GrantAward" "currency"         '{ "field": "currency",         "type": "string", "schema": { "max_length": 8, "is_nullable": true, "default_value": "ISK" }, "meta": { "interface": "select-dropdown", "options": { "choices": [{"text":"ISK","value":"ISK"},{"text":"EUR","value":"EUR"},{"text":"USD","value":"USD"},{"text":"GBP","value":"GBP"}] }, "display": "labels" } }'
add_field "GrantAward" "duration_years"   '{ "field": "duration_years",   "type": "integer", "schema": { "is_nullable": true }, "meta": { "interface": "input", "note": "Award duration in years (used to derive default payment schedule)." } }'
add_field "GrantAward" "stage"            '{ "field": "stage",            "type": "string", "schema": { "max_length": 32, "is_nullable": true }, "meta": { "interface": "input", "note": "Programme-specific phase (Sproti / Sprota / Vöxtur for TÞS)." } }'
add_field "GrantAward" "award_status"     '{ "field": "award_status",     "type": "string", "schema": { "max_length": 32, "is_nullable": true, "default_value": "awarded" }, "meta": { "interface": "select-dropdown", "options": { "choices": [
  {"text":"Applied","value":"applied"},
  {"text":"Awarded","value":"awarded"},
  {"text":"Active","value":"active"},
  {"text":"Completed","value":"completed"},
  {"text":"Cancelled","value":"cancelled"},
  {"text":"Rejected","value":"rejected"}
] }, "display": "labels", "note": "Lifecycle of the award itself, distinct from row status." } }'
add_field "GrantAward" "notes"            '{ "field": "notes",            "type": "text", "schema": { "is_nullable": true }, "meta": { "interface": "input-multiline" } }'

ensure_relation "GrantAward" "grant_id"        "Grant"        "CASCADE"
ensure_relation "GrantAward" "organization_id" "organization" "CASCADE"
ensure_relation "GrantAward" "project_id"      "Project"      "SET NULL"

# ─── GrantAwardPayment ────────────────────────────────────────────────
echo "▶ GrantAwardPayment collection"
ensure_collection "GrantAwardPayment" '{
  "collection": "GrantAwardPayment",
  "schema": { "name": "GrantAwardPayment" },
  "meta": {
    "icon": "payments",
    "hidden": false,
    "note": "One installment of a GrantAward. Rannís awards typically pay over 1–3 years; this captures the per-year planned + actual amounts so reports can show what was awarded vs. what landed.",
    "display_template": "{{award_id.award_name}} — {{installment_label}} — {{actual_amount}}",
    "sort_field": "sort",
    "archive_field": "status",
    "archive_value": "archived",
    "unarchive_value": "published",
    "archive_app_filter": true
  },
  "fields": [
    { "field": "id",           "type": "integer",  "meta": { "hidden": true, "readonly": true, "interface": "input" }, "schema": { "is_primary_key": true, "has_auto_increment": true } },
    { "field": "status",       "type": "string",   "meta": { "interface": "select-dropdown", "options": { "choices": [{"text":"Draft","value":"draft"},{"text":"Published","value":"published"},{"text":"Archived","value":"archived"}] }, "display": "labels", "width": "half" }, "schema": { "default_value": "published", "is_nullable": false } },
    { "field": "sort",         "type": "integer",  "meta": { "interface": "input", "hidden": true } },
    { "field": "date_created", "type": "timestamp","meta": { "special": ["date-created"], "interface": "datetime", "readonly": true, "hidden": true } },
    { "field": "date_updated", "type": "timestamp","meta": { "special": ["date-updated"], "interface": "datetime", "readonly": true, "hidden": true } }
  ]
}'
add_field "GrantAwardPayment" "award_id"          '{ "field": "award_id",          "type": "integer", "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "options": { "template": "{{award_name}}" }, "width": "half", "required": true }, "schema": { "is_nullable": false } }'
add_field "GrantAwardPayment" "installment_label" '{ "field": "installment_label", "type": "string", "schema": { "max_length": 32, "is_nullable": true }, "meta": { "interface": "input", "note": "Free-text label (e.g. \"Year 1\", \"Milestone 2\")." } }'
add_field "GrantAwardPayment" "installment_index" '{ "field": "installment_index", "type": "integer", "schema": { "is_nullable": true }, "meta": { "interface": "input", "note": "Order — 1, 2, 3 …" } }'
add_field "GrantAwardPayment" "planned_amount"    '{ "field": "planned_amount",    "type": "decimal", "schema": { "is_nullable": true, "numeric_precision": 18, "numeric_scale": 2 }, "meta": { "interface": "input" } }'
add_field "GrantAwardPayment" "actual_amount"     '{ "field": "actual_amount",     "type": "decimal", "schema": { "is_nullable": true, "numeric_precision": 18, "numeric_scale": 2 }, "meta": { "interface": "input" } }'
add_field "GrantAwardPayment" "planned_date"      '{ "field": "planned_date",      "type": "date", "schema": { "is_nullable": true }, "meta": { "interface": "datetime", "display": "datetime" } }'
add_field "GrantAwardPayment" "actual_date"       '{ "field": "actual_date",       "type": "date", "schema": { "is_nullable": true }, "meta": { "interface": "datetime", "display": "datetime" } }'
add_field "GrantAwardPayment" "payment_status"    '{ "field": "payment_status",    "type": "string", "schema": { "max_length": 32, "is_nullable": true, "default_value": "planned" }, "meta": { "interface": "select-dropdown", "options": { "choices": [
  {"text":"Planned","value":"planned"},
  {"text":"Paid","value":"paid"},
  {"text":"Withheld","value":"withheld"},
  {"text":"Cancelled","value":"cancelled"}
] }, "display": "labels" } }'
add_field "GrantAwardPayment" "notes"             '{ "field": "notes",             "type": "text", "schema": { "is_nullable": true }, "meta": { "interface": "input-multiline" } }'

ensure_relation "GrantAwardPayment" "award_id" "GrantAward" "CASCADE"

echo "✓ Done."
