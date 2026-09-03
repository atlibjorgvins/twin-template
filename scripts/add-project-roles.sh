#!/usr/bin/env bash
# Adds the `ProjectRole` catalogue collection — a managed enum for
# the `role_in_project` field on Project_people + Project_organization.
# Until now that field was free-text; this collection makes it a
# fixed set users curate from /settings/project-roles.
#
# Both junctions keep their `role_in_project` as a plain string
# column (stores the canonical `key`), so existing data stays
# valid; the UI just constrains future input to the catalogue.
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

echo "▶ ProjectRole catalogue"
ensure_collection "ProjectRole" '{
  "collection": "ProjectRole",
  "schema": { "name": "ProjectRole" },
  "meta": {
    "icon": "badge",
    "hidden": false,
    "note": "Canonical roles a person or organisation can have in a project (e.g. student, teacher, partner, sponsor, host). Stored as a key string on Project_people.role_in_project and Project_organization.role_in_project.",
    "display_template": "{{label}}",
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

add_field "ProjectRole" "key" '{
  "field": "key", "type": "string",
  "schema": { "max_length": 64, "is_nullable": false, "is_unique": true },
  "meta": { "interface": "input", "required": true, "note": "Stable slug stored on Project_people / Project_organization. Lower-case, snake_case (e.g. teacher, partner_org)." }
}'
add_field "ProjectRole" "label" '{
  "field": "label", "type": "string",
  "schema": { "max_length": 128, "is_nullable": false },
  "meta": { "interface": "input", "required": true, "note": "Human-readable name (e.g. Teacher, Partner Org)." }
}'
add_field "ProjectRole" "applies_to" '{
  "field": "applies_to", "type": "string",
  "schema": { "max_length": 16, "is_nullable": false, "default_value": "both" },
  "meta": { "interface": "select-dropdown", "options": { "choices": [{"text":"Person","value":"person"},{"text":"Organisation","value":"org"},{"text":"Both","value":"both"}] }, "display": "labels", "note": "Which junction(s) can pick this role." }
}'
add_field "ProjectRole" "color" '{
  "field": "color", "type": "string",
  "schema": { "max_length": 16, "is_nullable": true },
  "meta": { "interface": "select-color", "display": "color", "note": "Optional accent for chips / pills." }
}'

echo "✓ Done."
