#!/usr/bin/env bash
# Extend the Dates collection for the Calendar view.
#   - source       — sync provenance: 'manual' (default), 'google', 'asana', etc.
#   - source_ref   — external id for dedup on re-sync
#   - scope        — work / private / both, like Person/Project
#   - project_id   — M2O → Project, for project-tied events
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
AUTH=(-H "Authorization: Bearer $PUBLIC_DIRECTUS_TOKEN" -H "Content-Type: application/json")

add_field() {
  local name="$1" payload="$2"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/fields/Dates/$name")
  if [ "$code" = "200" ]; then
    echo "  field Dates.$name exists — skipping."
    return
  fi
  echo "  adding field Dates.$name…"
  curl -fsS "${AUTH[@]}" "$URL/fields/Dates" -d "$payload" >/dev/null
}

ensure_relation() {
  local field="$1" related="$2" on_delete="${3:-SET NULL}"
  local have
  have=$(curl -s "${AUTH[@]}" "$URL/relations/Dates/$field" | grep -o "\"collection\":\"Dates\"" | head -1 || true)
  if [ -n "$have" ]; then
    echo "  relation Dates.$field exists — skipping."
    return
  fi
  echo "  creating relation Dates.$field → $related…"
  curl -fsS "${AUTH[@]}" "$URL/relations" -d "{
    \"collection\": \"Dates\",
    \"field\": \"$field\",
    \"related_collection\": \"$related\",
    \"schema\": { \"on_delete\": \"$on_delete\" }
  }" >/dev/null
}

echo "Extending Dates…"

add_field "source" '{
  "field": "source", "type": "string",
  "schema": { "default_value": "manual", "is_nullable": false },
  "meta": {
    "interface": "select-dropdown", "width": "half",
    "display": "labels",
    "options": { "choices": [
      {"text":"Manual","value":"manual"},
      {"text":"Google Calendar","value":"google"},
      {"text":"Asana","value":"asana"},
      {"text":"Slack","value":"slack"},
      {"text":"Email","value":"email"},
      {"text":"Other sync","value":"other_sync"}
    ], "allowOther": true }
  }
}'

add_field "source_ref" '{
  "field": "source_ref", "type": "string",
  "meta": {
    "interface": "input", "width": "half",
    "note": "External id for dedup on re-sync (e.g. Google event id)."
  }
}'

add_field "scope" '{
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

add_field "project_id" '{
  "field": "project_id", "type": "integer",
  "meta": {
    "interface": "select-dropdown-m2o", "special": ["m2o"],
    "options": { "template": "{{name}}" }, "display": "related-values",
    "display_options": { "template": "{{name}}" }, "width": "half"
  },
  "schema": { "is_nullable": true }
}'

ensure_relation "project_id" "Project" "SET NULL"

echo "Done."
