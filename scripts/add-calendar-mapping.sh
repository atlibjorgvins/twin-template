#!/usr/bin/env bash
# CalendarMapping — one row per source calendar name (external_calendar
# on Dates) so the ingest and the UI know which Project an event from
# that calendar should default-link to.
#
# Example use: you@work.example → "KLAK / VMS" project, so every meeting
# from the work calendar lands attached to KLAK without manual
# triage. The personal calendar (atli.bjorgvinsson@gmail.com) maps to
# nothing and stays unattached.
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

echo "▶ CalendarMapping collection"
ensure_collection "CalendarMapping" '{
  "collection": "CalendarMapping",
  "schema": { "name": "CalendarMapping" },
  "meta": {
    "icon": "event_repeat",
    "hidden": false,
    "note": "Maps an external calendar source (Apple/Google calendar name on Dates.external_calendar) to a default Project so events from that calendar auto-link.",
    "display_template": "{{external_calendar}}",
    "sort_field": "sort",
    "archive_field": "status",
    "archive_value": "archived",
    "unarchive_value": "published",
    "archive_app_filter": true
  },
  "fields": [
    { "field": "id",           "type": "integer",  "meta": { "hidden": true, "readonly": true, "interface": "input" }, "schema": { "is_primary_key": true, "has_auto_increment": true } },
    { "field": "status",       "type": "string",   "meta": { "interface": "select-dropdown", "options": { "choices": [{"text":"Published","value":"published"},{"text":"Archived","value":"archived"}] }, "display": "labels", "width": "half" }, "schema": { "default_value": "published", "is_nullable": false } },
    { "field": "sort",         "type": "integer",  "meta": { "interface": "input", "hidden": true } },
    { "field": "date_created", "type": "timestamp","meta": { "special": ["date-created"], "interface": "datetime", "readonly": true, "hidden": true } },
    { "field": "date_updated", "type": "timestamp","meta": { "special": ["date-updated"], "interface": "datetime", "readonly": true, "hidden": true } }
  ]
}'
add_field "CalendarMapping" "external_calendar" '{ "field": "external_calendar", "type": "string", "schema": { "max_length": 200, "is_nullable": false, "is_unique": true }, "meta": { "interface": "input", "required": true, "note": "Source calendar name as it appears on Dates.external_calendar (e.g. \"you@work.example\")." } }'
add_field "CalendarMapping" "project_id"        '{ "field": "project_id",        "type": "integer", "schema": { "is_nullable": true }, "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "options": { "template": "{{name}}" }, "note": "Default project to attach events from this calendar to." } }'
ensure_relation "CalendarMapping" "project_id" "Project"
add_field "CalendarMapping" "scope"             '{ "field": "scope",             "type": "string", "schema": { "max_length": 16, "is_nullable": true }, "meta": { "interface": "select-dropdown", "options": { "choices": [{"text":"Work","value":"work"},{"text":"Private","value":"private"},{"text":"Both","value":"both"}] }, "display": "labels", "note": "Optional default scope for events from this calendar." } }'
add_field "CalendarMapping" "note"              '{ "field": "note",              "type": "text",   "schema": { "is_nullable": true }, "meta": { "interface": "input-multiline" } }'

echo "✓ Done."
