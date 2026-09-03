#!/usr/bin/env bash
# One-off: create the Person_family collection + fields + relations in Directus.
# Idempotent: skips creation if the collection already exists.
set -eo pipefail

# Load env
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

exists=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/collections/Person_family")
if [ "$exists" = "200" ]; then
  echo "Person_family already exists — skipping collection create."
else
  echo "Creating collection Person_family…"
  curl -fsS "${AUTH[@]}" "$URL/collections" -d @- <<'JSON' >/dev/null
{
  "collection": "Person_family",
  "schema": { "name": "Person_family" },
  "meta": {
    "icon": "family_restroom",
    "note": "Family relationships between people. Stored from person_id's POV: relative_id IS the <relation> of person_id.",
    "display_template": "{{person_id.full_name}} — {{relation}} — {{relative_id.full_name}}",
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
    { "field": "date_created", "type": "timestamp","meta": { "special": ["date-created"], "interface": "datetime", "readonly": true, "hidden": true, "width": "half" } },
    { "field": "date_updated", "type": "timestamp","meta": { "special": ["date-updated"], "interface": "datetime", "readonly": true, "hidden": true, "width": "half" } }
  ]
}
JSON
  echo "  collection created."
fi

add_field() {
  local name="$1" payload="$2"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/fields/Person_family/$name")
  if [ "$code" = "200" ]; then
    echo "  field $name exists — skipping."
    return
  fi
  echo "  adding field $name…"
  curl -fsS "${AUTH[@]}" "$URL/fields/Person_family" -d "$payload" >/dev/null
}

echo "Ensuring fields…"

add_field "person_id" '{
  "field": "person_id",
  "type": "integer",
  "meta": {
    "interface": "select-dropdown-m2o",
    "special": ["m2o"],
    "options": { "template": "{{full_name}}" },
    "width": "half",
    "required": true,
    "display": "related-values",
    "display_options": { "template": "{{full_name}}" }
  },
  "schema": { "is_nullable": false }
}'

add_field "relative_id" '{
  "field": "relative_id",
  "type": "integer",
  "meta": {
    "interface": "select-dropdown-m2o",
    "special": ["m2o"],
    "options": { "template": "{{full_name}}" },
    "width": "half",
    "required": true,
    "display": "related-values",
    "display_options": { "template": "{{full_name}}" }
  },
  "schema": { "is_nullable": false }
}'

add_field "relation" '{
  "field": "relation",
  "type": "string",
  "meta": {
    "interface": "select-dropdown",
    "options": {
      "allowOther": true,
      "choices": [
        {"text":"Father","value":"father"},
        {"text":"Mother","value":"mother"},
        {"text":"Parent","value":"parent"},
        {"text":"Son","value":"son"},
        {"text":"Daughter","value":"daughter"},
        {"text":"Child","value":"child"},
        {"text":"Brother","value":"brother"},
        {"text":"Sister","value":"sister"},
        {"text":"Sibling","value":"sibling"},
        {"text":"Spouse","value":"spouse"},
        {"text":"Partner","value":"partner"},
        {"text":"Ex-partner","value":"ex_partner"},
        {"text":"Grandfather","value":"grandfather"},
        {"text":"Grandmother","value":"grandmother"},
        {"text":"Grandparent","value":"grandparent"},
        {"text":"Grandson","value":"grandson"},
        {"text":"Granddaughter","value":"granddaughter"},
        {"text":"Grandchild","value":"grandchild"},
        {"text":"Uncle","value":"uncle"},
        {"text":"Aunt","value":"aunt"},
        {"text":"Nephew","value":"nephew"},
        {"text":"Niece","value":"niece"},
        {"text":"Cousin","value":"cousin"},
        {"text":"Stepfather","value":"stepfather"},
        {"text":"Stepmother","value":"stepmother"},
        {"text":"Stepchild","value":"stepchild"},
        {"text":"Father-in-law","value":"father_in_law"},
        {"text":"Mother-in-law","value":"mother_in_law"},
        {"text":"Brother-in-law","value":"brother_in_law"},
        {"text":"Sister-in-law","value":"sister_in_law"},
        {"text":"Son-in-law","value":"son_in_law"},
        {"text":"Daughter-in-law","value":"daughter_in_law"},
        {"text":"In-law","value":"in_law"},
        {"text":"Godparent","value":"godparent"},
        {"text":"Godchild","value":"godchild"},
        {"text":"Other","value":"other"}
      ]
    },
    "width": "half",
    "required": true
  },
  "schema": { "is_nullable": false }
}'

add_field "since" '{
  "field": "since",
  "type": "date",
  "meta": { "interface": "datetime", "width": "half" }
}'

add_field "notes" '{
  "field": "notes",
  "type": "text",
  "meta": { "interface": "input-multiline" }
}'

ensure_relation() {
  local field="$1" related="$2"
  local have
  have=$(curl -s "${AUTH[@]}" "$URL/relations/Person_family/$field" | grep -o '"collection":"Person_family"' | head -1 || true)
  if [ -n "$have" ]; then
    echo "  relation Person_family.$field exists — skipping."
    return
  fi
  echo "  creating relation Person_family.$field → $related…"
  curl -fsS "${AUTH[@]}" "$URL/relations" -d "{
    \"collection\": \"Person_family\",
    \"field\": \"$field\",
    \"related_collection\": \"$related\",
    \"schema\": { \"on_delete\": \"CASCADE\" },
    \"meta\": { \"sort_field\": null }
  }" >/dev/null
}

echo "Ensuring relations…"
ensure_relation "person_id"   "Person"
ensure_relation "relative_id" "Person"

echo "Done."
