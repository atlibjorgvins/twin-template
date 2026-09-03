#!/usr/bin/env bash
# Remembered mapping: an Asana project ⇒ a twin project.
#
# Connect "Markaðsmál" once and every future task that arrives from that
# Asana project lands on the right twin project without being told again.
#
#   asana_project_link   asana_project_gid (unique), asana_project_name,
#                        project_id → Project, task_count, last_applied
#
#   focus_task           + asana_project_gid, asana_project_name
#                          Cached on the row so resolving a task's project
#                          costs one Asana call EVER, not one per render.
#                          Ingestion happens outside twin, so these may be
#                          null on arrival; twin backfills them.
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
    \"collection\": \"$coll\", \"field\": \"$field\", \"related_collection\": \"$related\",
    \"schema\": { \"on_delete\": \"$ondel\" }
  }" >/dev/null
}

echo "Asana ⇄ twin project links"

ensure_collection asana_project_link '{
  "collection": "asana_project_link",
  "meta": {
    "icon": "link",
    "note": "Remembered mapping from an Asana project to a twin project.",
    "display_template": "{{asana_project_name}} → {{project_id.name}}",
    "sort_field": "asana_project_name"
  },
  "schema": {}
}'

add_field asana_project_link asana_project_gid '{
  "field": "asana_project_gid", "type": "string",
  "meta": { "interface": "input", "required": true, "width": "half",
            "note": "Asana project gid — the stable id, not the name." },
  "schema": { "is_unique": true }
}'
add_field asana_project_link asana_project_name '{
  "field": "asana_project_name", "type": "string",
  "meta": { "interface": "input", "width": "half",
            "note": "Cached for display; Asana is the source of truth." },
  "schema": {}
}'
add_field asana_project_link project_id '{
  "field": "project_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "width": "half",
            "options": { "template": "{{name}}" } },
  "schema": {}
}'
ensure_relation asana_project_link project_id Project "SET NULL"

add_field asana_project_link task_count '{
  "field": "task_count", "type": "integer",
  "meta": { "interface": "input", "readonly": true, "width": "half",
            "note": "Tasks assigned through this link so far." },
  "schema": { "default_value": 0 }
}'
add_field asana_project_link last_applied '{
  "field": "last_applied", "type": "timestamp",
  "meta": { "interface": "datetime", "readonly": true, "width": "half" },
  "schema": {}
}'
add_field asana_project_link date_created '{
  "field": "date_created", "type": "timestamp",
  "meta": { "interface": "datetime", "readonly": true, "hidden": true,
            "special": ["date-created"] },
  "schema": {}
}'

echo "focus_task — cache which Asana project a task came from"
add_field focus_task asana_project_gid '{
  "field": "asana_project_gid", "type": "string",
  "meta": { "interface": "input", "width": "half",
            "note": "Filled by twin on first resolve, or by the ingester." },
  "schema": {}
}'
add_field focus_task asana_project_name '{
  "field": "asana_project_name", "type": "string",
  "meta": { "interface": "input", "width": "half" },
  "schema": {}
}'

echo
echo "Done. Next: connect a pair in twin at /tasks → Projects."
