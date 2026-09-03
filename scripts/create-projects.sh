#!/usr/bin/env bash
# One-off: create Project collection + Project_people junction in Directus.
# Idempotent: skips creation if the collection already exists.
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
  local coll="$1" field="$2" related="$3"
  local have
  have=$(curl -s "${AUTH[@]}" "$URL/relations/$coll/$field" | grep -o "\"collection\":\"$coll\"" | head -1 || true)
  if [ -n "$have" ]; then
    echo "  relation $coll.$field exists — skipping."
    return
  fi
  echo "  creating relation $coll.$field → $related…"
  curl -fsS "${AUTH[@]}" "$URL/relations" -d "{
    \"collection\": \"$coll\",
    \"field\": \"$field\",
    \"related_collection\": \"$related\",
    \"schema\": { \"on_delete\": \"CASCADE\" }
  }" >/dev/null
}

# ─── Project ────────────────────────────────────────────────────────────────
ensure_collection "Project" '{
  "collection": "Project",
  "schema": { "name": "Project" },
  "meta": {
    "icon": "folder_special",
    "note": "Horizontal initiative — course, program, campaign, theme, or project.",
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

echo "Ensuring Project fields…"
add_field "Project" "name"    '{ "field": "name", "type": "string", "meta": { "interface": "input", "required": true }, "schema": { "is_nullable": false } }'
add_field "Project" "kind"    '{
  "field": "kind", "type": "string",
  "meta": {
    "interface": "select-dropdown", "width": "half",
    "options": { "choices": [
      {"text":"Project","value":"project"},
      {"text":"Course","value":"course"},
      {"text":"Program","value":"program"},
      {"text":"Campaign","value":"campaign"},
      {"text":"Theme","value":"theme"},
      {"text":"Other","value":"other"}
    ] }
  }
}'
add_field "Project" "scope"   '{
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
add_field "Project" "summary" '{ "field": "summary", "type": "text", "meta": { "interface": "input-multiline" } }'
add_field "Project" "owner_org_id" '{
  "field": "owner_org_id", "type": "integer",
  "meta": {
    "interface": "select-dropdown-m2o", "special": ["m2o"],
    "options": { "template": "{{name}}" }, "display": "related-values",
    "display_options": { "template": "{{name}}" }
  },
  "schema": { "is_nullable": true }
}'
add_field "Project" "start_date" '{ "field": "start_date", "type": "date", "meta": { "interface": "datetime", "width": "half" } }'
add_field "Project" "end_date"   '{ "field": "end_date",   "type": "date", "meta": { "interface": "datetime", "width": "half" } }'

echo "Ensuring Project relations…"
ensure_relation "Project" "owner_org_id" "organization"

# ─── Project_people (M2M junction) ──────────────────────────────────────────
ensure_collection "Project_people" '{
  "collection": "Project_people",
  "schema": { "name": "Project_people" },
  "meta": {
    "icon": "link",
    "hidden": false,
    "note": "Links a person to a project with an optional role-in-project label.",
    "display_template": "{{person_id.full_name}} — {{role_in_project}} — {{project_id.name}}",
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

echo "Ensuring Project_people fields…"
add_field "Project_people" "project_id" '{
  "field": "project_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "options": { "template": "{{name}}" }, "width": "half", "required": true },
  "schema": { "is_nullable": false }
}'
add_field "Project_people" "person_id" '{
  "field": "person_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "options": { "template": "{{full_name}}" }, "width": "half", "required": true },
  "schema": { "is_nullable": false }
}'
add_field "Project_people" "role_in_project" '{
  "field": "role_in_project", "type": "string",
  "meta": { "interface": "input", "note": "e.g. student, teacher, advisor, partner, lead" }
}'
add_field "Project_people" "notes" '{ "field": "notes", "type": "text", "meta": { "interface": "input-multiline" } }'

echo "Ensuring Project_people relations…"
ensure_relation "Project_people" "project_id" "Project"
ensure_relation "Project_people" "person_id"  "Person"

echo "Done."
