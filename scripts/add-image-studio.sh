#!/usr/bin/env bash
# Image Studio — batch image composer (docs/image-studio-plan.md).
#
#   image_template    A layered design: canvas size + ordered layers
#                     JSON (base photo slot, PNG overlays, dynamic
#                     {token} text, scrim rects) + the record source
#                     and filters it applies to.
#   generated_image   One rendered output: template × record × the
#                     Directus file it produced, with a snapshot of
#                     the token values used. Audit trail + the hook
#                     Evergreen can query later.
#
# Rendering happens fully client-side (Canvas 2D) — these collections
# only store configuration and results. A "Studio" folder is created
# for the rendered files.
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
    \"collection\": \"$coll\",
    \"field\": \"$field\",
    \"related_collection\": \"$related\",
    \"schema\": { \"on_delete\": \"$ondel\" }
  }" >/dev/null
}

echo "▶ image_template collection"
ensure_collection "image_template" '{
  "collection": "image_template",
  "schema": { "name": "image_template" },
  "meta": {
    "icon": "wallpaper",
    "hidden": false,
    "note": "Image Studio templates — layered designs rendered per record in the browser.",
    "display_template": "{{name}}"
  }
}'
add_field image_template name '{
  "field": "name", "type": "string",
  "meta": { "interface": "input", "required": true, "width": "half" },
  "schema": {}
}'
add_field image_template status '{
  "field": "status", "type": "string",
  "meta": { "interface": "select-dropdown", "width": "half",
    "options": { "choices": [
      { "text": "Draft", "value": "draft" },
      { "text": "Active", "value": "active" },
      { "text": "Archived", "value": "archived" }
    ] } },
  "schema": { "default_value": "draft" }
}'
add_field image_template width '{
  "field": "width", "type": "integer",
  "meta": { "interface": "input", "width": "half", "note": "Output width in px." },
  "schema": { "default_value": 1080 }
}'
add_field image_template height '{
  "field": "height", "type": "integer",
  "meta": { "interface": "input", "width": "half", "note": "Output height in px." },
  "schema": { "default_value": 1080 }
}'
add_field image_template background '{
  "field": "background", "type": "string",
  "meta": { "interface": "select-color", "width": "half",
    "note": "Canvas background. Empty = transparent (PNG output)." },
  "schema": {}
}'
add_field image_template source_collection '{
  "field": "source_collection", "type": "string",
  "meta": { "interface": "select-dropdown", "width": "half",
    "options": { "choices": [
      { "text": "Organizations", "value": "organization" },
      { "text": "People", "value": "Person" },
      { "text": "Projects", "value": "Project" }
    ] } },
  "schema": { "default_value": "organization" }
}'
add_field image_template filters '{
  "field": "filters", "type": "json",
  "meta": { "interface": "input-code", "options": { "language": "json" },
    "note": "Same shape as campaign filters — projectIds, tagIds, search, requirements, date window." },
  "schema": {}
}'
add_field image_template layers '{
  "field": "layers", "type": "json",
  "meta": { "interface": "input-code", "options": { "language": "json" },
    "note": "Ordered bottom→top. Geometry is fractional (0–1 of canvas). Types: base | image | text | rect." },
  "schema": {}
}'
add_field image_template project_id '{
  "field": "project_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half",
    "display": "related-values", "display_options": { "template": "{{name}}" },
    "note": "Project context — feeds {project}, the dynamic project color and partner-logo layers." },
  "schema": {}
}'
add_field image_template kind '{
  "field": "kind", "type": "string",
  "meta": { "interface": "select-dropdown", "width": "half",
    "options": { "choices": [
      { "text": "Reusable template", "value": "template" },
      { "text": "One-off batch", "value": "oneoff" }
    ] },
    "note": "One-offs keep their config + outputs but are not offered as reusable templates (hidden from Evergreen)." },
  "schema": { "default_value": "template" }
}'
add_field image_template variants '{
  "field": "variants", "type": "json",
  "meta": { "interface": "input-code", "options": { "language": "json" },
    "note": "Extra placement sizes rendered alongside the base, e.g. Story 1080×1920. Each may override per-layer geometry: [{key,label,width,height,overrides:{<layerId>:{x,y,w,h}}}]." },
  "schema": {}
}'
add_field image_template notes '{
  "field": "notes", "type": "text",
  "meta": { "interface": "input-multiline" },
  "schema": {}
}'
add_field image_template date_created '{
  "field": "date_created", "type": "timestamp",
  "meta": { "interface": "datetime", "readonly": true, "hidden": true, "special": ["date-created"], "width": "half" },
  "schema": {}
}'
add_field image_template date_updated '{
  "field": "date_updated", "type": "timestamp",
  "meta": { "interface": "datetime", "readonly": true, "hidden": true, "special": ["date-updated"], "width": "half" },
  "schema": {}
}'

echo "▶ generated_image collection"
ensure_collection "generated_image" '{
  "collection": "generated_image",
  "schema": { "name": "generated_image" },
  "meta": {
    "icon": "image",
    "hidden": false,
    "note": "Rendered Image Studio outputs — template × record × file.",
    "display_template": "{{item_label}}"
  }
}'
add_field generated_image template_id '{
  "field": "template_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half",
    "display": "related-values", "display_options": { "template": "{{name}}" } },
  "schema": {}
}'
add_field generated_image item_collection '{
  "field": "item_collection", "type": "string",
  "meta": { "interface": "input", "width": "half", "note": "organization | Person | Project | csv" },
  "schema": {}
}'
add_field generated_image item_id '{
  "field": "item_id", "type": "string",
  "meta": { "interface": "input", "width": "half" },
  "schema": {}
}'
add_field generated_image item_label '{
  "field": "item_label", "type": "string",
  "meta": { "interface": "input", "width": "half" },
  "schema": {}
}'
add_field generated_image file_id '{
  "field": "file_id", "type": "uuid",
  "meta": { "interface": "file-image", "special": ["file"], "note": "The rendered output in Files → Studio." },
  "schema": {}
}'
add_field generated_image variant '{
  "field": "variant", "type": "string",
  "meta": { "interface": "input", "width": "half",
    "note": "Placement size label (Story, Feed, …). Empty = the base size." },
  "schema": {}
}'
add_field generated_image tokens '{
  "field": "tokens", "type": "json",
  "meta": { "interface": "input-code", "options": { "language": "json" },
    "note": "Snapshot of the token values used in the render." },
  "schema": {}
}'
add_field generated_image date_created '{
  "field": "date_created", "type": "timestamp",
  "meta": { "interface": "datetime", "readonly": true, "hidden": true, "special": ["date-created"], "width": "half" },
  "schema": {}
}'
ensure_relation image_template project_id Project "SET NULL"
ensure_relation generated_image template_id image_template "SET NULL"
ensure_relation generated_image file_id directus_files "SET NULL"

echo "▶ Studio files folder"
HAVE_FOLDER=$(curl -s "${AUTH[@]}" "$URL/folders?filter%5Bname%5D%5B_eq%5D=Studio&limit=1" | grep -o '"name":"Studio"' || true)
if [ -n "$HAVE_FOLDER" ]; then
  echo "  folder Studio exists — skipping."
else
  echo "  creating folder Studio…"
  curl -fsS "${AUTH[@]}" "$URL/folders" -d '{ "name": "Studio" }' >/dev/null
fi

echo "✓ done."
