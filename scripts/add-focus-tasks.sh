#!/usr/bin/env bash
# "Actively working on" — a manual focus queue. One task is active at a
# time; the front page shows it with a live timer + Stop / Next.
#
#   focus_task   title, status (queued|active|done), project link, notes,
#                queue sort, accumulated seconds, current-session start.
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

echo "▶ focus_task collection"
ensure_collection "focus_task" '{
  "collection": "focus_task",
  "schema": { "name": "focus_task" },
  "meta": { "icon": "target", "note": "Actively working on — manual focus queue with time tracking." }
}'

add_field focus_task title '{
  "field": "title", "type": "string",
  "meta": { "interface": "input", "note": "What you are working on." }, "schema": {}
}'
add_field focus_task status '{
  "field": "status", "type": "string",
  "meta": { "interface": "select-dropdown", "width": "half",
    "options": { "choices": [
      {"text":"Queued","value":"queued"},
      {"text":"Active","value":"active"},
      {"text":"Done","value":"done"}
    ] } },
  "schema": { "default_value": "queued" }
}'
add_field focus_task sort '{
  "field": "sort", "type": "integer",
  "meta": { "interface": "input", "hidden": true, "note": "Queue order." }, "schema": {}
}'
add_field focus_task seconds_spent '{
  "field": "seconds_spent", "type": "integer",
  "meta": { "interface": "input", "width": "half", "note": "Accumulated time (seconds)." },
  "schema": { "default_value": 0 }
}'
add_field focus_task started_at '{
  "field": "started_at", "type": "timestamp",
  "meta": { "interface": "datetime", "width": "half", "note": "When the current active session began (null when not active)." },
  "schema": {}
}'
add_field focus_task project_id '{
  "field": "project_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half",
    "display": "related-values", "display_options": { "template": "{{name}}" },
    "note": "Linked project." }, "schema": {}
}'
add_field focus_task notes '{
  "field": "notes", "type": "text",
  "meta": { "interface": "input-multiline", "note": "Details / sub-steps." }, "schema": {}
}'
add_field focus_task date_created '{
  "field": "date_created", "type": "timestamp",
  "meta": { "special": ["date-created"], "interface": "datetime", "readonly": true, "hidden": true }, "schema": {}
}'
add_field focus_task date_updated '{
  "field": "date_updated", "type": "timestamp",
  "meta": { "special": ["date-updated"], "interface": "datetime", "readonly": true, "hidden": true }, "schema": {}
}'

ensure_relation focus_task project_id Project "SET NULL"

echo "Done."
