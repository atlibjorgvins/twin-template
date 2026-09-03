#!/usr/bin/env bash
# Education history + spoken languages for people. Two child collections,
# each an M2O back to Person (CASCADE delete), mirroring the
# Person_organization / RolesCard pattern:
#   Person_education  person_id institution degree field start_year end_year notes sort
#   Person_language   person_id language proficiency sort
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
URL="${DIRECTUS_ADMIN_URL:-$PUBLIC_DIRECTUS_URL}"; URL="${URL%/}"; TOKEN="$PUBLIC_DIRECTUS_TOKEN"
AUTH=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

ensure_collection() { local n="$1" p="$2"; local c; c=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/collections/$n"); if [ "$c" = "200" ]; then echo "  collection $n exists — skipping."; return; fi; echo "  creating $n…"; curl -fsS "${AUTH[@]}" "$URL/collections" -d "$p" >/dev/null; }
add_field() { local co="$1" na="$2" pa="$3"; local c; c=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/fields/$co/$na"); if [ "$c" = "200" ]; then echo "  field $co.$na exists — skipping."; return; fi; echo "  adding $co.$na…"; curl -fsS "${AUTH[@]}" "$URL/fields/$co" -d "$pa" >/dev/null; }
ensure_relation() {
  local coll="$1" field="$2" related="$3" ondel="${4:-SET NULL}"
  local have; have=$(curl -s "${AUTH[@]}" "$URL/relations/$coll/$field" | grep -o "\"collection\":\"$coll\"" | head -1 || true)
  if [ -n "$have" ]; then echo "  relation $coll.$field exists — skipping."; return; fi
  echo "  creating relation $coll.$field → $related ($ondel)…"
  curl -fsS "${AUTH[@]}" "$URL/relations" -d "{ \"collection\": \"$coll\", \"field\": \"$field\", \"related_collection\": \"$related\", \"schema\": { \"on_delete\": \"$ondel\" } }" >/dev/null
}

echo "▶ Person_education"
ensure_collection "Person_education" '{
  "collection": "Person_education",
  "schema": { "name": "Person_education" },
  "meta": { "icon": "school", "sort_field": "sort",
    "note": "A degree / studies entry for a person.",
    "display_template": "{{degree}} — {{institution}}" }
}'
add_field Person_education person_id '{ "field": "person_id", "type": "integer", "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "hidden": true }, "schema": {} }'
add_field Person_education institution '{ "field": "institution", "type": "string", "meta": { "interface": "input", "note": "School / university.", "width": "half" }, "schema": {} }'
add_field Person_education degree '{ "field": "degree", "type": "string", "meta": { "interface": "input", "note": "e.g. BSc, MBA, PhD.", "width": "half" }, "schema": {} }'
add_field Person_education field '{ "field": "field", "type": "string", "meta": { "interface": "input", "note": "Field of study / major.", "width": "half" }, "schema": {} }'
add_field Person_education start_year '{ "field": "start_year", "type": "integer", "meta": { "interface": "input", "width": "half" }, "schema": {} }'
add_field Person_education end_year '{ "field": "end_year", "type": "integer", "meta": { "interface": "input", "note": "Blank = ongoing.", "width": "half" }, "schema": {} }'
add_field Person_education notes '{ "field": "notes", "type": "text", "meta": { "interface": "input-multiline" }, "schema": {} }'
add_field Person_education sort '{ "field": "sort", "type": "integer", "meta": { "interface": "input", "hidden": true }, "schema": {} }'
add_field Person_education date_created '{ "field": "date_created", "type": "timestamp", "meta": { "special": ["date-created"], "interface": "datetime", "readonly": true, "hidden": true }, "schema": {} }'
add_field Person_education date_updated '{ "field": "date_updated", "type": "timestamp", "meta": { "special": ["date-updated"], "interface": "datetime", "readonly": true, "hidden": true }, "schema": {} }'
ensure_relation Person_education person_id Person "CASCADE"

echo "▶ Person_language"
ensure_collection "Person_language" '{
  "collection": "Person_language",
  "schema": { "name": "Person_language" },
  "meta": { "icon": "translate", "sort_field": "sort",
    "note": "A language a person speaks, with proficiency.",
    "display_template": "{{language}} ({{proficiency}})" }
}'
add_field Person_language person_id '{ "field": "person_id", "type": "integer", "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "hidden": true }, "schema": {} }'
add_field Person_language language '{ "field": "language", "type": "string", "meta": { "interface": "input", "note": "e.g. Icelandic, English, Spanish.", "width": "half" }, "schema": {} }'
add_field Person_language proficiency '{ "field": "proficiency", "type": "string", "meta": { "interface": "select-dropdown", "width": "half",
    "options": { "choices": [
      { "text": "Native", "value": "native" },
      { "text": "Fluent", "value": "fluent" },
      { "text": "Professional", "value": "professional" },
      { "text": "Conversational", "value": "conversational" },
      { "text": "Basic", "value": "basic" } ] } }, "schema": {} }'
add_field Person_language sort '{ "field": "sort", "type": "integer", "meta": { "interface": "input", "hidden": true }, "schema": {} }'
add_field Person_language date_created '{ "field": "date_created", "type": "timestamp", "meta": { "special": ["date-created"], "interface": "datetime", "readonly": true, "hidden": true }, "schema": {} }'
ensure_relation Person_language person_id Person "CASCADE"

echo "Done."
