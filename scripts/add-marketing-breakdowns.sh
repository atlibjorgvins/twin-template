#!/usr/bin/env bash
# Stored Meta breakdowns — the piece that makes age/gender drillable
# outside the one page that fetches it live.
#
#   mk_metric_breakdown   One day × one dimension × one value, per Meta
#                         entity: spend, impressions, clicks, results.
#
# Today fetchCampaignBreakdown() hits the Graph API from the browser, one
# campaign at a time, only on /tools/campaigns/meta, and returns [] on any
# error. Nothing is kept — so a breakdown can't be trended, can't be rolled
# up across campaigns, and can't reach a project dashboard.
#
# These rows are a MIRROR, not a record: scripts/sync-meta-metrics.mjs
# replaces each (umbrella, dimension, date-window) slice wholesale on every
# run. Nothing here is hand-edited, so nothing here is precious.
#
# `reach` is deliberately absent — Meta does not return it alongside most
# breakdowns, and a column that is null nine times in ten invites wrong
# arithmetic. `project_id` and `medium` are denormalised at sync time so
# reporting by project or medium is one query with no joins.
#
# Idempotent — safe to re-run.
set -eo pipefail

# TWIN_ENV_FILE picks the instance: `.env` (personal) or `.env.klak`.
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

echo "▶ mk_metric_breakdown collection"
ensure_collection "mk_metric_breakdown" '{
  "collection": "mk_metric_breakdown",
  "schema": { "name": "mk_metric_breakdown" },
  "meta": { "icon": "pie_chart", "display_template": "{{dimension}} · {{dim_key}} · {{date}}",
    "note": "Daily Meta insights split by one dimension (age+gender, platform, placement, region). Mirrored by the sync — do not hand-edit." }
}'

add_field mk_metric_breakdown mk_campaign_id '{
  "field": "mk_campaign_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half",
    "note": "Umbrella campaign these rows hang under — the slice the sync replaces.",
    "display": "related-values", "display_options": { "template": "{{name}}" } },
  "schema": {}
}'
add_field mk_metric_breakdown level '{
  "field": "level", "type": "string",
  "meta": { "interface": "select-dropdown", "width": "half",
    "note": "Which Meta entity ref_id points at.",
    "options": { "choices": [
      {"text":"Meta campaign","value":"meta_campaign"},
      {"text":"Ad set","value":"ad_set"},
      {"text":"Ad","value":"ad"}
    ] } },
  "schema": { "default_value": "meta_campaign" }
}'
add_field mk_metric_breakdown ref_id '{
  "field": "ref_id", "type": "string",
  "meta": { "interface": "input", "width": "half",
    "note": "Meta entity id. Id-based matching beats name matching — names get edited." },
  "schema": {}
}'
add_field mk_metric_breakdown ref_name '{
  "field": "ref_name", "type": "string",
  "meta": { "interface": "input", "width": "half", "note": "Entity name at sync time, for reading rows raw." },
  "schema": {}
}'
add_field mk_metric_breakdown date '{
  "field": "date", "type": "date",
  "meta": { "interface": "datetime", "width": "half", "note": "The day this row covers (time_increment=1)." },
  "schema": {}
}'
add_field mk_metric_breakdown dimension '{
  "field": "dimension", "type": "string",
  "meta": { "interface": "select-dropdown", "width": "half",
    "note": "Which split this row belongs to.",
    "options": { "allowOther": true, "choices": [
      {"text":"Age + gender","value":"age_gender"},
      {"text":"Platform","value":"platform"},
      {"text":"Placement","value":"placement"},
      {"text":"Region","value":"region"},
      {"text":"Device","value":"device"}
    ] } },
  "schema": {}
}'
add_field mk_metric_breakdown dim_key '{
  "field": "dim_key", "type": "string",
  "meta": { "interface": "input",
    "note": "The value within the dimension, e.g. \"25-34 · female\", \"instagram · feed\", \"Reykjavík\"." },
  "schema": {}
}'
add_field mk_metric_breakdown medium '{
  "field": "medium", "type": "string",
  "meta": { "interface": "input", "width": "half", "readonly": true,
    "note": "Medium code denormalised at sync (platform/placement rows only). Plain string, not a relation: a publisher_platform Meta invents tomorrow must not fail the sync." },
  "schema": {}
}'
add_field mk_metric_breakdown project_id '{
  "field": "project_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half", "readonly": true,
    "note": "Attribution copied from the Meta campaign at sync, so project reporting needs no join.",
    "display": "related-values", "display_options": { "template": "{{name}}" } },
  "schema": {}
}'
add_field mk_metric_breakdown spend '{
  "field": "spend", "type": "float",
  "meta": { "interface": "input", "width": "half" }, "schema": {}
}'
add_field mk_metric_breakdown impressions '{
  "field": "impressions", "type": "integer",
  "meta": { "interface": "input", "width": "half" }, "schema": {}
}'
add_field mk_metric_breakdown clicks '{
  "field": "clicks", "type": "integer",
  "meta": { "interface": "input", "width": "half" }, "schema": {}
}'
add_field mk_metric_breakdown results '{
  "field": "results", "type": "integer",
  "meta": { "interface": "input", "width": "half" }, "schema": {}
}'
add_field mk_metric_breakdown result_type '{
  "field": "result_type", "type": "string",
  "meta": { "interface": "input", "width": "half", "note": "Which Meta action counted as a result." },
  "schema": {}
}'
add_field mk_metric_breakdown source '{
  "field": "source", "type": "string",
  "meta": { "interface": "input", "width": "half", "readonly": true, "hidden": true },
  "schema": { "default_value": "meta" }
}'
add_field mk_metric_breakdown date_created '{
  "field": "date_created", "type": "timestamp",
  "meta": { "special": ["date-created"], "interface": "datetime", "readonly": true, "hidden": true, "width": "half" },
  "schema": {}
}'

ensure_relation mk_metric_breakdown mk_campaign_id mk_campaign "CASCADE"
ensure_relation mk_metric_breakdown project_id Project "SET NULL"

echo "Done."
echo
echo "Next: node scripts/sync-meta-metrics.mjs --months 12   # backfill a year of breakdowns"
