#!/usr/bin/env bash
# Evergreen machine — collections backing /tools/evergreen.
#
#   campaign       The reusable "bucket": which records to feature
#                  (source collection + filters), which platforms,
#                  and the post template (base + per-platform
#                  overrides). Duplicate a row to clone a campaign.
#   campaign_post  One generated post: the rendered text + image for
#                  one item on one platform. Carries used/skipped
#                  status so the picker can rotate through alumni
#                  without repeats.
#   Project_tag    Tag junction for Project — same shared Tag pool as
#                  Person_tag / organization_tag so thematic filters
#                  ("larger themes") work across all three sources.
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

# ── campaign ─────────────────────────────────────────────────────────
echo "▶ campaign collection"
ensure_collection "campaign" '{
  "collection": "campaign",
  "schema": { "name": "campaign" },
  "meta": {
    "icon": "campaign",
    "hidden": false,
    "note": "Evergreen content campaigns — reusable filter + template buckets that generate social posts from Directus records.",
    "display_template": "{{name}}",
    "archive_field": "status",
    "archive_value": "archived",
    "unarchive_value": "draft",
    "archive_app_filter": true
  }
}'
add_field campaign name '{
  "field": "name", "type": "string",
  "meta": { "interface": "input", "required": true, "width": "half" },
  "schema": {}
}'
add_field campaign status '{
  "field": "status", "type": "string",
  "meta": {
    "interface": "select-dropdown", "width": "half",
    "options": { "choices": [
      { "text": "Draft",    "value": "draft" },
      { "text": "Active",   "value": "active" },
      { "text": "Archived", "value": "archived" }
    ] }
  },
  "schema": { "default_value": "draft" }
}'
add_field campaign description '{
  "field": "description", "type": "text",
  "meta": { "interface": "input-multiline", "note": "Internal note — what this campaign is for." },
  "schema": {}
}'
add_field campaign source_collection '{
  "field": "source_collection", "type": "string",
  "meta": {
    "interface": "select-dropdown", "width": "half",
    "note": "Which records the dynamic content pulls from.",
    "options": { "choices": [
      { "text": "Organizations", "value": "organization" },
      { "text": "People",        "value": "Person" },
      { "text": "Projects",      "value": "Project" }
    ] }
  },
  "schema": { "default_value": "organization" }
}'
add_field campaign platforms '{
  "field": "platforms", "type": "json",
  "meta": { "interface": "select-multiple-checkbox", "width": "half",
    "options": { "choices": [
      { "text": "Facebook",  "value": "facebook" },
      { "text": "Instagram", "value": "instagram" },
      { "text": "LinkedIn",  "value": "linkedin" },
      { "text": "General",   "value": "general" }
    ] }
  },
  "schema": {}
}'
add_field campaign base_template '{
  "field": "base_template", "type": "text",
  "meta": { "interface": "input-multiline",
    "note": "Post text with {tokens}: {name} {description} {website} {project} {nickname}." },
  "schema": {}
}'
add_field campaign platform_overrides '{
  "field": "platform_overrides", "type": "json",
  "meta": { "interface": "input-code", "options": { "language": "json" },
    "note": "Optional per-platform template overrides, e.g. {\"instagram\": \"…\"}. Falls back to base_template." },
  "schema": {}
}'
add_field campaign filters '{
  "field": "filters", "type": "json",
  "meta": { "interface": "input-code", "options": { "language": "json" },
    "note": "Candidate filters: { projectIds: [], tagIds: [], search, requireImage, requireDescription, dateFrom, dateTo }." },
  "schema": {}
}'
add_field campaign date_created '{
  "field": "date_created", "type": "timestamp",
  "meta": { "interface": "datetime", "readonly": true, "hidden": true, "special": ["date-created"], "width": "half" },
  "schema": {}
}'
add_field campaign date_updated '{
  "field": "date_updated", "type": "timestamp",
  "meta": { "interface": "datetime", "readonly": true, "hidden": true, "special": ["date-updated"], "width": "half" },
  "schema": {}
}'

add_field campaign brand_name '{
  "field": "brand_name", "type": "string",
  "meta": { "interface": "input", "width": "half",
    "note": "Page/account name shown in post previews (e.g. KLAK - Icelandic Startups)." },
  "schema": {}
}'
add_field campaign brand_handle '{
  "field": "brand_handle", "type": "string",
  "meta": { "interface": "input", "width": "half",
    "note": "Handle shown in Instagram previews (e.g. klak.is)." },
  "schema": {}
}'
add_field campaign brand_avatar_url '{
  "field": "brand_avatar_url", "type": "string",
  "meta": { "interface": "input",
    "note": "Avatar image URL for previews — any URL, including a Directus asset URL." },
  "schema": {}
}'

# ── campaign_post ────────────────────────────────────────────────────
echo "▶ campaign_post collection"
ensure_collection "campaign_post" '{
  "collection": "campaign_post",
  "schema": { "name": "campaign_post" },
  "meta": {
    "icon": "post_add",
    "hidden": false,
    "note": "Generated evergreen posts — one row per item per platform, with used/skipped status for rotation.",
    "display_template": "{{item_label}} · {{platform}}"
  }
}'
add_field campaign_post campaign_id '{
  "field": "campaign_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half",
    "display": "related-values", "display_options": { "template": "{{name}}" } },
  "schema": {}
}'
add_field campaign_post item_collection '{
  "field": "item_collection", "type": "string",
  "meta": { "interface": "input", "width": "half", "note": "organization | Person | Project" },
  "schema": {}
}'
add_field campaign_post item_id '{
  "field": "item_id", "type": "string",
  "meta": { "interface": "input", "width": "half" },
  "schema": {}
}'
add_field campaign_post item_label '{
  "field": "item_label", "type": "string",
  "meta": { "interface": "input", "width": "half", "note": "Denormalized display name of the featured record." },
  "schema": {}
}'
add_field campaign_post platform '{
  "field": "platform", "type": "string",
  "meta": { "interface": "select-dropdown", "width": "half",
    "options": { "choices": [
      { "text": "Facebook",  "value": "facebook" },
      { "text": "Instagram", "value": "instagram" },
      { "text": "LinkedIn",  "value": "linkedin" },
      { "text": "General",   "value": "general" }
    ] }
  },
  "schema": {}
}'
add_field campaign_post status '{
  "field": "status", "type": "string",
  "meta": { "interface": "select-dropdown", "width": "half",
    "options": { "choices": [
      { "text": "Draft",   "value": "draft" },
      { "text": "Used",    "value": "used" },
      { "text": "Skipped", "value": "skipped" }
    ] }
  },
  "schema": { "default_value": "draft" }
}'
add_field campaign_post rendered_text '{
  "field": "rendered_text", "type": "text",
  "meta": { "interface": "input-multiline" },
  "schema": {}
}'
add_field campaign_post image_id '{
  "field": "image_id", "type": "uuid",
  "meta": { "interface": "file-image", "special": ["file"], "width": "half",
    "note": "The Directus file used for this post (org logo / person picture)." },
  "schema": {}
}'
add_field campaign_post used_at '{
  "field": "used_at", "type": "timestamp",
  "meta": { "interface": "datetime", "width": "half" },
  "schema": {}
}'
add_field campaign_post date_created '{
  "field": "date_created", "type": "timestamp",
  "meta": { "interface": "datetime", "readonly": true, "hidden": true, "special": ["date-created"], "width": "half" },
  "schema": {}
}'
add_field campaign_post date_updated '{
  "field": "date_updated", "type": "timestamp",
  "meta": { "interface": "datetime", "readonly": true, "hidden": true, "special": ["date-updated"], "width": "half" },
  "schema": {}
}'
ensure_relation campaign_post campaign_id campaign "CASCADE"
ensure_relation campaign_post image_id directus_files "SET NULL"

# ── Project_tag ──────────────────────────────────────────────────────
echo "▶ Project_tag junction"
ensure_collection "Project_tag" '{
  "collection": "Project_tag",
  "schema": { "name": "Project_tag" },
  "meta": {
    "icon": "sell",
    "hidden": true,
    "note": "Junction Project ↔ Tag — same shared Tag pool as Person_tag / organization_tag."
  }
}'
add_field Project_tag project_id '{
  "field": "project_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half" },
  "schema": {}
}'
add_field Project_tag tag_id '{
  "field": "tag_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half" },
  "schema": {}
}'
ensure_relation Project_tag project_id Project "CASCADE"
ensure_relation Project_tag tag_id Tag "CASCADE"

echo "✓ done."
