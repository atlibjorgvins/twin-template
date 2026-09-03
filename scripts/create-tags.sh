#!/usr/bin/env bash
# One-off: create Tag collection + Person_tag / organization_tag junctions.
# Idempotent — safe to re-run.
#
# Schema:
#   Tag                 id, name, color, scope, status, sort, timestamps
#   Person_tag          id, person_id        → Person,        tag_id → Tag
#   organization_tag    id, organization_id  → organization,  tag_id → Tag
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
AUTH=(-H "Authorization: Bearer $PUBLIC_DIRECTUS_TOKEN" -H "Content-Type: application/json")

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

# ─── Tag ────────────────────────────────────────────────────────────────────
ensure_collection "Tag" '{
  "collection": "Tag",
  "schema": { "name": "Tag" },
  "meta": {
    "icon": "label",
    "note": "Reusable label that can be attached to People and Organizations.",
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

echo "Ensuring Tag fields…"
add_field "Tag" "name" '{
  "field": "name", "type": "string",
  "meta": { "interface": "input", "required": true, "note": "Short, lowercase preferred (e.g. \"investor\", \"klak\", \"ib700\")." },
  "schema": { "is_nullable": false, "is_unique": true }
}'
add_field "Tag" "color" '{
  "field": "color", "type": "string",
  "meta": {
    "interface": "select-color", "width": "half",
    "note": "Optional accent color shown on the pill.",
    "display": "color"
  }
}'
add_field "Tag" "scope" '{
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
add_field "Tag" "description" '{
  "field": "description", "type": "text",
  "meta": { "interface": "input-multiline" }
}'

# ─── Person_tag (M2M junction) ──────────────────────────────────────────────
ensure_collection "Person_tag" '{
  "collection": "Person_tag",
  "schema": { "name": "Person_tag" },
  "meta": {
    "icon": "link",
    "hidden": false,
    "note": "Junction: a tag attached to a Person.",
    "display_template": "{{person_id.full_name}} — {{tag_id.name}}",
    "sort_field": "sort"
  },
  "fields": [
    { "field": "id",           "type": "integer",  "meta": { "hidden": true, "readonly": true, "interface": "input" }, "schema": { "is_primary_key": true, "has_auto_increment": true } },
    { "field": "sort",         "type": "integer",  "meta": { "interface": "input", "hidden": true } },
    { "field": "date_created", "type": "timestamp","meta": { "special": ["date-created"], "interface": "datetime", "readonly": true, "hidden": true } }
  ]
}'

echo "Ensuring Person_tag fields…"
add_field "Person_tag" "person_id" '{
  "field": "person_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "options": { "template": "{{full_name}}" }, "width": "half", "required": true },
  "schema": { "is_nullable": false }
}'
add_field "Person_tag" "tag_id" '{
  "field": "tag_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "options": { "template": "{{name}}" }, "width": "half", "required": true },
  "schema": { "is_nullable": false }
}'

echo "Ensuring Person_tag relations…"
ensure_relation "Person_tag" "person_id" "Person"
ensure_relation "Person_tag" "tag_id"    "Tag"

# ─── organization_tag (M2M junction) ────────────────────────────────────────
ensure_collection "organization_tag" '{
  "collection": "organization_tag",
  "schema": { "name": "organization_tag" },
  "meta": {
    "icon": "link",
    "hidden": false,
    "note": "Junction: a tag attached to an Organization.",
    "display_template": "{{organization_id.name}} — {{tag_id.name}}",
    "sort_field": "sort"
  },
  "fields": [
    { "field": "id",           "type": "integer",  "meta": { "hidden": true, "readonly": true, "interface": "input" }, "schema": { "is_primary_key": true, "has_auto_increment": true } },
    { "field": "sort",         "type": "integer",  "meta": { "interface": "input", "hidden": true } },
    { "field": "date_created", "type": "timestamp","meta": { "special": ["date-created"], "interface": "datetime", "readonly": true, "hidden": true } }
  ]
}'

echo "Ensuring organization_tag fields…"
add_field "organization_tag" "organization_id" '{
  "field": "organization_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "options": { "template": "{{name}}" }, "width": "half", "required": true },
  "schema": { "is_nullable": false }
}'
add_field "organization_tag" "tag_id" '{
  "field": "tag_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "options": { "template": "{{name}}" }, "width": "half", "required": true },
  "schema": { "is_nullable": false }
}'

echo "Ensuring organization_tag relations…"
ensure_relation "organization_tag" "organization_id" "organization"
ensure_relation "organization_tag" "tag_id"          "Tag"

echo "Done."
