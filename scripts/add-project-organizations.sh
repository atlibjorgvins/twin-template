#!/usr/bin/env bash
# Adds the `Project_organization` M2M junction so projects can carry
# more than one related org. `Project.owner_org_id` stays as the
# primary owner pick; this table is for partners, sponsors, hosts,
# clients — anyone involved who isn't the owner.
#
# Soft-archive pattern matches Project_people: archive_field = status.
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
  local coll="$1" field="$2" related="$3"
  local have
  have=$(curl -s "${AUTH[@]}" "$URL/relations/$coll/$field" | grep -o "\"collection\":\"$coll\"" | head -1 || true)
  if [ -n "$have" ]; then echo "  relation $coll.$field exists — skipping."; return; fi
  echo "  creating relation $coll.$field → $related…"
  curl -fsS "${AUTH[@]}" "$URL/relations" -d "{
    \"collection\": \"$coll\",
    \"field\": \"$field\",
    \"related_collection\": \"$related\",
    \"schema\": { \"on_delete\": \"CASCADE\" }
  }" >/dev/null
}

echo "▶ Project_organization junction"
ensure_collection "Project_organization" '{
  "collection": "Project_organization",
  "schema": { "name": "Project_organization" },
  "meta": {
    "icon": "link",
    "hidden": false,
    "note": "Links an organisation to a project with an optional role label (partner, sponsor, client, host…). Project.owner_org_id stays as the primary owner — this table is for everyone else involved.",
    "display_template": "{{organization_id.name}} — {{role_in_project}} — {{project_id.name}}",
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

add_field "Project_organization" "project_id" '{
  "field": "project_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "options": { "template": "{{name}}" }, "width": "half", "required": true },
  "schema": { "is_nullable": false }
}'
add_field "Project_organization" "organization_id" '{
  "field": "organization_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "options": { "template": "{{name}}" }, "width": "half", "required": true },
  "schema": { "is_nullable": false }
}'
add_field "Project_organization" "role_in_project" '{
  "field": "role_in_project", "type": "string",
  "meta": { "interface": "input", "note": "e.g. partner, sponsor, client, host, venue" }
}'
add_field "Project_organization" "notes" '{ "field": "notes", "type": "text", "meta": { "interface": "input-multiline" } }'

ensure_relation "Project_organization" "project_id"      "Project"
ensure_relation "Project_organization" "organization_id" "organization"

echo "✓ Done."
