#!/usr/bin/env bash
# One-off: create Activity collection + Activity_Person junction in Directus.
# Activities link a date+kind to optional Person(s), Organization, and Project.
# Idempotent.
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
  local exists
  exists=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/collections/$name")
  if [ "$exists" = "200" ]; then
    echo "$name already exists — skipping collection create."
    return
  fi
  echo "Creating collection $name…"
  curl -fsS "${AUTH[@]}" "$URL/collections" -d "$payload" >/dev/null
  echo "  $name created."
}

add_field() {
  local coll="$1" name="$2" payload="$3"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/fields/$coll/$name")
  if [ "$code" = "200" ]; then
    echo "  field $coll.$name exists — skipping."
    return
  fi
  echo "  adding field $coll.$name…"
  curl -fsS "${AUTH[@]}" "$URL/fields/$coll" -d "$payload" >/dev/null
}

ensure_relation() {
  local coll="$1" field="$2" related="$3" on_delete="${4:-SET NULL}"
  local have
  have=$(curl -s "${AUTH[@]}" "$URL/relations/$coll/$field" | grep -o "\"collection\":\"$coll\"" | head -1 || true)
  if [ -n "$have" ]; then
    echo "  relation $coll.$field exists — skipping."
    return
  fi
  echo "  creating relation $coll.$field → $related (on_delete=$on_delete)…"
  curl -fsS "${AUTH[@]}" "$URL/relations" -d "{
    \"collection\": \"$coll\",
    \"field\": \"$field\",
    \"related_collection\": \"$related\",
    \"schema\": { \"on_delete\": \"$on_delete\" }
  }" >/dev/null
}

# ─── Activity ───────────────────────────────────────────────────────────────
ensure_collection "Activity" '{
  "collection": "Activity",
  "schema": { "name": "Activity" },
  "meta": {
    "icon": "event_note",
    "note": "Anything that happened — meeting, call, mentoring session, talk, milestone. Links to people, an org, and a project.",
    "display_template": "{{occurred_at}} · {{kind}} · {{title}}",
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

echo "Ensuring Activity fields…"
add_field "Activity" "title" '{ "field": "title", "type": "string", "meta": { "interface": "input", "required": true, "note": "Short headline — e.g. \"Mentored Gulleggið team\"" }, "schema": { "is_nullable": false } }'
add_field "Activity" "kind" '{
  "field": "kind", "type": "string",
  "meta": {
    "interface": "select-dropdown", "width": "half",
    "options": { "choices": [
      {"text":"Meeting","value":"meeting"},
      {"text":"Call","value":"call"},
      {"text":"Email","value":"email"},
      {"text":"Message","value":"message"},
      {"text":"Mentoring","value":"mentoring"},
      {"text":"Teaching","value":"teaching"},
      {"text":"Talk / Presentation","value":"talk"},
      {"text":"Event","value":"event"},
      {"text":"Intro","value":"intro"},
      {"text":"Milestone","value":"milestone"},
      {"text":"Note","value":"note"},
      {"text":"Other","value":"other"}
    ] }
  },
  "schema": { "default_value": "meeting" }
}'
add_field "Activity" "significance" '{
  "field": "significance", "type": "string",
  "meta": {
    "interface": "select-dropdown", "width": "half", "display": "labels",
    "options": { "choices": [
      {"text":"Minor","value":"minor"},
      {"text":"Normal","value":"normal"},
      {"text":"Major","value":"major"}
    ] }
  },
  "schema": { "default_value": "normal" }
}'
add_field "Activity" "occurred_at" '{
  "field": "occurred_at", "type": "timestamp",
  "meta": { "interface": "datetime", "width": "half", "required": true },
  "schema": { "is_nullable": false }
}'
add_field "Activity" "end_at" '{
  "field": "end_at", "type": "timestamp",
  "meta": { "interface": "datetime", "width": "half", "note": "Optional — for multi-day or duration." }
}'
add_field "Activity" "scope" '{
  "field": "scope", "type": "string",
  "meta": {
    "interface": "select-dropdown", "width": "half",
    "options": { "choices": [
      {"text":"Work","value":"work"},
      {"text":"Private","value":"private"},
      {"text":"Both","value":"both"}
    ] }
  }
}'
add_field "Activity" "location" '{ "field": "location", "type": "string", "meta": { "interface": "input", "width": "half" } }'
add_field "Activity" "summary" '{ "field": "summary", "type": "text", "meta": { "interface": "input-multiline" } }'
add_field "Activity" "organization_id" '{
  "field": "organization_id", "type": "integer",
  "meta": {
    "interface": "select-dropdown-m2o", "special": ["m2o"],
    "options": { "template": "{{name}}" }, "display": "related-values",
    "display_options": { "template": "{{name}}" }, "width": "half"
  },
  "schema": { "is_nullable": true }
}'
add_field "Activity" "project_id" '{
  "field": "project_id", "type": "integer",
  "meta": {
    "interface": "select-dropdown-m2o", "special": ["m2o"],
    "options": { "template": "{{name}}" }, "display": "related-values",
    "display_options": { "template": "{{name}}" }, "width": "half"
  },
  "schema": { "is_nullable": true }
}'

echo "Ensuring Activity relations…"
ensure_relation "Activity" "organization_id" "organization" "SET NULL"
ensure_relation "Activity" "project_id"      "Project"      "SET NULL"

# ─── Activity_Person (M2M junction) ────────────────────────────────────────
ensure_collection "Activity_Person" '{
  "collection": "Activity_Person",
  "schema": { "name": "Activity_Person" },
  "meta": {
    "icon": "link",
    "hidden": false,
    "note": "Links a person to an activity, with an optional role in that activity.",
    "display_template": "{{person_id.full_name}} — {{role}} — {{activity_id.title}}",
    "sort_field": "sort"
  },
  "fields": [
    { "field": "id",           "type": "integer",  "meta": { "hidden": true, "readonly": true, "interface": "input" }, "schema": { "is_primary_key": true, "has_auto_increment": true } },
    { "field": "sort",         "type": "integer",  "meta": { "interface": "input", "hidden": true } },
    { "field": "date_created", "type": "timestamp","meta": { "special": ["date-created"], "interface": "datetime", "readonly": true, "hidden": true } }
  ]
}'

echo "Ensuring Activity_Person fields…"
add_field "Activity_Person" "activity_id" '{
  "field": "activity_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "options": { "template": "{{title}}" }, "width": "half", "required": true },
  "schema": { "is_nullable": false }
}'
add_field "Activity_Person" "person_id" '{
  "field": "person_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "options": { "template": "{{full_name}}" }, "width": "half", "required": true },
  "schema": { "is_nullable": false }
}'
add_field "Activity_Person" "role" '{
  "field": "role", "type": "string",
  "meta": { "interface": "input", "note": "e.g. mentor, mentee, attendee, organizer, speaker" }
}'

echo "Ensuring Activity_Person relations…"
ensure_relation "Activity_Person" "activity_id" "Activity" "CASCADE"
ensure_relation "Activity_Person" "person_id"   "Person"   "CASCADE"

echo "Done."
