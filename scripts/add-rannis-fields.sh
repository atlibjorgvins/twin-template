#!/usr/bin/env bash
# Schema changes to receive the Rannís Tækniþróunarsjóður feed.
#
# Two new taxonomy collections, plus per-row metadata on Org and
# GrantAward so the same domain framework drives both surfaces.
#
#   Domain       — Yfirflokkur (top-level economic domain).
#                  Used by Org (primary domain) and GrantAward
#                  (this-award snapshot). 28 distinct values in the
#                  current Rannís export; the seed below covers them.
#   Subdomain    — Undirflokkur (sub-domain). 23 distinct values.
#                  Flat — same subdomain can be picked under
#                  multiple Domains, so no parent FK.
#
# Plus on existing collections:
#   Organization.domain_id     (M2O Domain)
#   Organization.subdomain_id  (M2O Subdomain)
#   Organization.region        (string acronym — HB/NV/VL/NA/AL/SL/VF/RN)
#   GrantAward.domain_id       (M2O Domain)
#   GrantAward.subdomain_id    (M2O Subdomain)
#   GrantAward.region_acronym  (string)
#   GrantAward.applicant_label, contact_label, contact_person_id,
#     contact_org_id, external_id, external_source, fund_year,
#     booking_year, description.
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

# ─── Domain ─────────────────────────────────────────────────────────
echo "▶ Domain collection"
ensure_collection "Domain" '{
  "collection": "Domain",
  "schema": { "name": "Domain" },
  "meta": {
    "icon": "category",
    "hidden": false,
    "note": "Top-level economic / thematic domain (Yfirflokkur). Used by Organization (primary domain) and GrantAward (per-award snapshot).",
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
add_field "Domain" "name"  '{ "field": "name",  "type": "string", "schema": { "max_length": 200, "is_nullable": false }, "meta": { "interface": "input", "required": true, "note": "Yfirflokkur — e.g. \"Heilbrigðistækni og lækningatæki\"." } }'
add_field "Domain" "color" '{ "field": "color", "type": "string", "schema": { "max_length": 16, "is_nullable": true }, "meta": { "interface": "select-color", "note": "Optional accent colour for chips / charts." } }'
add_field "Domain" "note"  '{ "field": "note",  "type": "text",   "schema": { "is_nullable": true }, "meta": { "interface": "input-multiline", "note": "Internal description / scope notes." } }'

# ─── Subdomain ──────────────────────────────────────────────────────
echo "▶ Subdomain collection"
ensure_collection "Subdomain" '{
  "collection": "Subdomain",
  "schema": { "name": "Subdomain" },
  "meta": {
    "icon": "label",
    "hidden": false,
    "note": "Undirflokkur — sub-domain. Flat list; a subdomain can apply across multiple Domains.",
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
add_field "Subdomain" "name" '{ "field": "name", "type": "string", "schema": { "max_length": 200, "is_nullable": false }, "meta": { "interface": "input", "required": true } }'
add_field "Subdomain" "note" '{ "field": "note", "type": "text",   "schema": { "is_nullable": true }, "meta": { "interface": "input-multiline" } }'

# ─── Organization extensions ────────────────────────────────────────
echo "▶ Organization fields"
add_field "organization" "domain_id"    '{ "field": "domain_id",    "type": "integer", "schema": { "is_nullable": true }, "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "options": { "template": "{{name}}" }, "note": "Primary domain (Yfirflokkur) for this org." } }'
ensure_relation "organization" "domain_id" "Domain"
add_field "organization" "subdomain_id" '{ "field": "subdomain_id", "type": "integer", "schema": { "is_nullable": true }, "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "options": { "template": "{{name}}" }, "note": "Primary subdomain (Undirflokkur) for this org." } }'
ensure_relation "organization" "subdomain_id" "Subdomain"
add_field "organization" "region"       '{ "field": "region",       "type": "string", "schema": { "max_length": 4, "is_nullable": true }, "meta": { "interface": "select-dropdown", "options": { "choices": [
  {"text":"Höfuðborgarsvæðið (HB)","value":"HB"},
  {"text":"Suðurnes (RN)","value":"RN"},
  {"text":"Vesturland (VL)","value":"VL"},
  {"text":"Vestfirðir (VF)","value":"VF"},
  {"text":"Norðurland vestra (NV)","value":"NV"},
  {"text":"Norðurland eystra (NA)","value":"NA"},
  {"text":"Austurland (AL)","value":"AL"},
  {"text":"Suðurland (SL)","value":"SL"}
] }, "display": "labels", "note": "Landshluti — Icelandic region." } }'

# ─── GrantAward extensions ──────────────────────────────────────────
echo "▶ GrantAward fields"
add_field "GrantAward" "external_id"       '{ "field": "external_id",      "type": "string", "schema": { "max_length": 64, "is_nullable": true, "is_unique": false }, "meta": { "interface": "input", "note": "External identifier from the source feed (rannis_id, etc.) — used to dedupe re-imports." } }'
add_field "GrantAward" "external_source"   '{ "field": "external_source",  "type": "string", "schema": { "max_length": 32, "is_nullable": true }, "meta": { "interface": "input", "note": "Source feed slug, e.g. \"rannis\"." } }'
add_field "GrantAward" "applicant_label"   '{ "field": "applicant_label",  "type": "string", "schema": { "max_length": 200, "is_nullable": true }, "meta": { "interface": "input", "note": "Raw applicant name from the feed. Always kept even after the org is linked so we can see the original spelling." } }'
add_field "GrantAward" "contact_label"     '{ "field": "contact_label",    "type": "string", "schema": { "max_length": 200, "is_nullable": true }, "meta": { "interface": "input", "note": "Raw Verkefnisstjóri name from the feed." } }'
add_field "GrantAward" "contact_person_id" '{ "field": "contact_person_id","type": "integer", "schema": { "is_nullable": true }, "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "options": { "template": "{{full_name}}" }, "note": "Linked person, if the contact is a person." } }'
ensure_relation "GrantAward" "contact_person_id" "Person"
add_field "GrantAward" "contact_org_id"    '{ "field": "contact_org_id",   "type": "integer", "schema": { "is_nullable": true }, "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "options": { "template": "{{name}}" }, "note": "Linked org, if the contact is an organisation (e.g. a tech-transfer office)." } }'
ensure_relation "GrantAward" "contact_org_id" "organization"
add_field "GrantAward" "domain_id"         '{ "field": "domain_id",        "type": "integer", "schema": { "is_nullable": true }, "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "options": { "template": "{{name}}" }, "note": "Yfirflokkur for this award." } }'
ensure_relation "GrantAward" "domain_id" "Domain"
add_field "GrantAward" "subdomain_id"      '{ "field": "subdomain_id",     "type": "integer", "schema": { "is_nullable": true }, "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "options": { "template": "{{name}}" }, "note": "Undirflokkur for this award." } }'
ensure_relation "GrantAward" "subdomain_id" "Subdomain"
add_field "GrantAward" "region_acronym"    '{ "field": "region_acronym",   "type": "string", "schema": { "max_length": 4, "is_nullable": true }, "meta": { "interface": "select-dropdown", "options": { "choices": [
  {"text":"Höfuðborgarsvæðið (HB)","value":"HB"},
  {"text":"Suðurnes (RN)","value":"RN"},
  {"text":"Vesturland (VL)","value":"VL"},
  {"text":"Vestfirðir (VF)","value":"VF"},
  {"text":"Norðurland vestra (NV)","value":"NV"},
  {"text":"Norðurland eystra (NA)","value":"NA"},
  {"text":"Austurland (AL)","value":"AL"},
  {"text":"Suðurland (SL)","value":"SL"}
] }, "display": "labels", "note": "Region recorded for this award." } }'
add_field "GrantAward" "fund_year"         '{ "field": "fund_year",        "type": "integer", "schema": { "is_nullable": true }, "meta": { "interface": "input", "note": "Year the award was made (fund_year in source)." } }'
add_field "GrantAward" "booking_year"      '{ "field": "booking_year",     "type": "integer", "schema": { "is_nullable": true }, "meta": { "interface": "input", "note": "Year the payout is booked." } }'
add_field "GrantAward" "description"       '{ "field": "description",      "type": "text",    "schema": { "is_nullable": true }, "meta": { "interface": "input-multiline", "note": "Project abstract / description from the source feed." } }'

echo "✓ Done."
