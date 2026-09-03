#!/usr/bin/env bash
# Office lunch orders, one row per meal per day.
#
#   food_order  order_date meal restaurant dish diet notes source_image
#               ocr_confidence
#
# Rows are created by the OCR tool under /tools/food, which reads the order
# confirmation screenshot from the canteen site. (order_date, meal, restaurant,
# dish) is treated as the identity of a row by the importer so re-uploading the
# same screenshot updates rather than duplicates.
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

echo "▶ food_order"
ensure_collection "food_order" '{
  "collection": "food_order",
  "schema": { "name": "food_order" },
  "meta": { "icon": "restaurant", "sort_field": "order_date",
    "note": "One ordered meal on one day, imported from an order screenshot.",
    "display_template": "{{order_date}} — {{restaurant}}: {{dish}}" }
}'
add_field food_order order_date '{ "field": "order_date", "type": "date", "meta": { "interface": "datetime", "note": "The day the meal is for.", "width": "half", "required": true }, "schema": {} }'
add_field food_order meal '{ "field": "meal", "type": "string", "meta": { "interface": "select-dropdown", "width": "half", "note": "Which sitting.", "options": { "choices": [ { "text": "Breakfast", "value": "breakfast" }, { "text": "Lunch", "value": "lunch" }, { "text": "Dinner", "value": "dinner" } ] } }, "schema": { "default_value": "lunch" } }'
add_field food_order restaurant '{ "field": "restaurant", "type": "string", "meta": { "interface": "input", "note": "Supplier as printed on the order.", "width": "half" }, "schema": {} }'
add_field food_order dish '{ "field": "dish", "type": "string", "meta": { "interface": "input", "note": "Dish name as printed.", "width": "half" }, "schema": {} }'
add_field food_order diet '{ "field": "diet", "type": "json", "meta": { "interface": "tags", "note": "Diet pills printed on the card, e.g. vegan.", "options": { "presets": ["vegan", "vegetarian", "gluten-free", "lactose-free", "fish"] } }, "schema": {} }'
add_field food_order notes '{ "field": "notes", "type": "text", "meta": { "interface": "input-multiline" }, "schema": {} }'
add_field food_order source_image '{ "field": "source_image", "type": "uuid", "meta": { "interface": "file-image", "special": ["file"], "note": "The screenshot this row was read from." }, "schema": {} }'
add_field food_order ocr_confidence '{ "field": "ocr_confidence", "type": "float", "meta": { "interface": "input", "readonly": true, "note": "Mean recogniser score for the lines behind this row.", "width": "half" }, "schema": {} }'
add_field food_order date_created '{ "field": "date_created", "type": "timestamp", "meta": { "special": ["date-created"], "interface": "datetime", "readonly": true, "hidden": true }, "schema": {} }'
add_field food_order date_updated '{ "field": "date_updated", "type": "timestamp", "meta": { "special": ["date-updated"], "interface": "datetime", "readonly": true, "hidden": true }, "schema": {} }'
ensure_relation food_order source_image directus_files "SET NULL"

echo "✔ done — food_order ready."
