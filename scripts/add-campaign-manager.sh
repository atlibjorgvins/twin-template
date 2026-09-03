#!/usr/bin/env bash
# Campaign manager — collections backing /tools/campaigns.
#
#   mk_campaign        Umbrella client campaign: client org, project,
#                      budget, dates, brief. Evergreen/Studio/reporting
#                      attach here later.
#   mk_campaign_tag    Tag junction — same shared Tag pool as
#                      Person_tag / organization_tag / Project_tag.
#   mk_meta_campaign   Meta (Facebook Ads) campaign level under the
#                      umbrella: objective, buying type, budget.
#   mk_ad_set          Ad set level: optimization goal, billing event,
#                      schedule, targeting JSON.
#   mk_ad              Ad level: creative text, link, CTA, image.
#   mk_metric          Daily performance rows (spend, impressions,
#                      clicks, results) imported from Ads Manager
#                      reports or entered manually. Upsert key:
#                      (mk_campaign_id, level, ref_name, date).
#
# The `mk_` prefix avoids colliding with the Evergreen machine's
# existing `campaign` / `campaign_post` collections.
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
# Standard date_created/date_updated pair.
add_timestamps() {
  local coll="$1"
  add_field "$coll" date_created '{
    "field": "date_created", "type": "timestamp",
    "meta": { "interface": "datetime", "readonly": true, "hidden": true, "special": ["date-created"], "width": "half" },
    "schema": {}
  }'
  add_field "$coll" date_updated '{
    "field": "date_updated", "type": "timestamp",
    "meta": { "interface": "datetime", "readonly": true, "hidden": true, "special": ["date-updated"], "width": "half" },
    "schema": {}
  }'
}

# ── mk_campaign ──────────────────────────────────────────────────────
echo "▶ mk_campaign collection"
ensure_collection "mk_campaign" '{
  "collection": "mk_campaign",
  "schema": { "name": "mk_campaign" },
  "meta": {
    "icon": "rocket_launch",
    "hidden": false,
    "note": "Campaign manager — umbrella client campaigns (Meta ads structure + metrics nest under these).",
    "display_template": "{{name}}",
    "archive_field": "status",
    "archive_value": "archived",
    "unarchive_value": "planning",
    "archive_app_filter": true
  }
}'
add_field mk_campaign name '{
  "field": "name", "type": "string",
  "meta": { "interface": "input", "required": true, "width": "half" },
  "schema": {}
}'
add_field mk_campaign status '{
  "field": "status", "type": "string",
  "meta": {
    "interface": "select-dropdown", "width": "half",
    "options": { "choices": [
      { "text": "Planning",  "value": "planning" },
      { "text": "Live",      "value": "live" },
      { "text": "Paused",    "value": "paused" },
      { "text": "Completed", "value": "completed" },
      { "text": "Archived",  "value": "archived" }
    ] }
  },
  "schema": { "default_value": "planning" }
}'
add_field mk_campaign client_org_id '{
  "field": "client_org_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half",
    "note": "The client this campaign is run for.",
    "display": "related-values", "display_options": { "template": "{{name}}" } },
  "schema": {}
}'
add_field mk_campaign project_id '{
  "field": "project_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half",
    "note": "Optional twin project this campaign belongs to.",
    "display": "related-values", "display_options": { "template": "{{name}}" } },
  "schema": {}
}'
add_field mk_campaign brief '{
  "field": "brief", "type": "text",
  "meta": { "interface": "input-multiline", "note": "Goal, audience, key messages — the working brief." },
  "schema": {}
}'
add_field mk_campaign objective_summary '{
  "field": "objective_summary", "type": "string",
  "meta": { "interface": "input", "width": "half", "note": "One-liner: what success looks like." },
  "schema": {}
}'
add_field mk_campaign budget_total '{
  "field": "budget_total", "type": "decimal",
  "meta": { "interface": "input", "width": "half" },
  "schema": { "numeric_precision": 12, "numeric_scale": 2 }
}'
add_field mk_campaign currency '{
  "field": "currency", "type": "string",
  "meta": { "interface": "input", "width": "half" },
  "schema": { "default_value": "ISK" }
}'
add_field mk_campaign date_start '{
  "field": "date_start", "type": "date",
  "meta": { "interface": "datetime", "width": "half" },
  "schema": {}
}'
add_field mk_campaign date_end '{
  "field": "date_end", "type": "date",
  "meta": { "interface": "datetime", "width": "half" },
  "schema": {}
}'
add_timestamps mk_campaign
ensure_relation mk_campaign client_org_id organization "SET NULL"
ensure_relation mk_campaign project_id Project "SET NULL"

# ── mk_campaign_tag ──────────────────────────────────────────────────
echo "▶ mk_campaign_tag junction"
ensure_collection "mk_campaign_tag" '{
  "collection": "mk_campaign_tag",
  "schema": { "name": "mk_campaign_tag" },
  "meta": {
    "icon": "sell",
    "hidden": true,
    "note": "Junction mk_campaign ↔ Tag — same shared Tag pool as Person_tag / organization_tag / Project_tag."
  }
}'
add_field mk_campaign_tag mk_campaign_id '{
  "field": "mk_campaign_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half" },
  "schema": {}
}'
add_field mk_campaign_tag tag_id '{
  "field": "tag_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half" },
  "schema": {}
}'
ensure_relation mk_campaign_tag mk_campaign_id mk_campaign "CASCADE"
ensure_relation mk_campaign_tag tag_id Tag "CASCADE"

# ── mk_meta_campaign ─────────────────────────────────────────────────
echo "▶ mk_meta_campaign collection"
ensure_collection "mk_meta_campaign" '{
  "collection": "mk_meta_campaign",
  "schema": { "name": "mk_meta_campaign" },
  "meta": {
    "icon": "campaign",
    "hidden": false,
    "note": "Meta (Facebook Ads) campaign level under an mk_campaign umbrella.",
    "display_template": "{{name}}"
  }
}'
add_field mk_meta_campaign mk_campaign_id '{
  "field": "mk_campaign_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half",
    "display": "related-values", "display_options": { "template": "{{name}}" } },
  "schema": {}
}'
add_field mk_meta_campaign name '{
  "field": "name", "type": "string",
  "meta": { "interface": "input", "required": true, "width": "half" },
  "schema": {}
}'
add_field mk_meta_campaign objective '{
  "field": "objective", "type": "string",
  "meta": {
    "interface": "select-dropdown", "width": "half",
    "note": "Meta campaign objective (ODAX enum).",
    "options": { "choices": [
      { "text": "Awareness",  "value": "OUTCOME_AWARENESS" },
      { "text": "Traffic",    "value": "OUTCOME_TRAFFIC" },
      { "text": "Engagement", "value": "OUTCOME_ENGAGEMENT" },
      { "text": "Leads",      "value": "OUTCOME_LEADS" },
      { "text": "App promotion", "value": "OUTCOME_APP_PROMOTION" },
      { "text": "Sales",      "value": "OUTCOME_SALES" }
    ] }
  },
  "schema": { "default_value": "OUTCOME_TRAFFIC" }
}'
add_field mk_meta_campaign buying_type '{
  "field": "buying_type", "type": "string",
  "meta": { "interface": "input", "width": "half" },
  "schema": { "default_value": "AUCTION" }
}'
add_field mk_meta_campaign status '{
  "field": "status", "type": "string",
  "meta": {
    "interface": "select-dropdown", "width": "half",
    "note": "Import as PAUSED so nothing spends until reviewed in Ads Manager.",
    "options": { "choices": [
      { "text": "Paused", "value": "PAUSED" },
      { "text": "Active", "value": "ACTIVE" }
    ] }
  },
  "schema": { "default_value": "PAUSED" }
}'
add_field mk_meta_campaign budget_mode '{
  "field": "budget_mode", "type": "string",
  "meta": {
    "interface": "select-dropdown", "width": "half",
    "options": { "choices": [
      { "text": "Daily (campaign budget)",    "value": "daily" },
      { "text": "Lifetime (campaign budget)", "value": "lifetime" },
      { "text": "Per ad set",                 "value": "adset" }
    ] }
  },
  "schema": { "default_value": "daily" }
}'
add_field mk_meta_campaign budget_amount '{
  "field": "budget_amount", "type": "decimal",
  "meta": { "interface": "input", "width": "half" },
  "schema": { "numeric_precision": 12, "numeric_scale": 2 }
}'
add_field mk_meta_campaign meta_id '{
  "field": "meta_id", "type": "string",
  "meta": { "interface": "input", "width": "half",
    "note": "The real Meta campaign id once created in Ads Manager (filled manually for now; the API phase fills it automatically)." },
  "schema": {}
}'
add_timestamps mk_meta_campaign
ensure_relation mk_meta_campaign mk_campaign_id mk_campaign "CASCADE"

# ── mk_ad_set ────────────────────────────────────────────────────────
echo "▶ mk_ad_set collection"
ensure_collection "mk_ad_set" '{
  "collection": "mk_ad_set",
  "schema": { "name": "mk_ad_set" },
  "meta": {
    "icon": "dataset",
    "hidden": false,
    "note": "Meta ad set level — optimization, schedule, targeting.",
    "display_template": "{{name}}"
  }
}'
add_field mk_ad_set mk_meta_campaign_id '{
  "field": "mk_meta_campaign_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half",
    "display": "related-values", "display_options": { "template": "{{name}}" } },
  "schema": {}
}'
add_field mk_ad_set name '{
  "field": "name", "type": "string",
  "meta": { "interface": "input", "required": true, "width": "half" },
  "schema": {}
}'
add_field mk_ad_set status '{
  "field": "status", "type": "string",
  "meta": { "interface": "select-dropdown", "width": "half",
    "options": { "choices": [
      { "text": "Paused", "value": "PAUSED" },
      { "text": "Active", "value": "ACTIVE" }
    ] } },
  "schema": { "default_value": "PAUSED" }
}'
add_field mk_ad_set optimization_goal '{
  "field": "optimization_goal", "type": "string",
  "meta": { "interface": "select-dropdown", "width": "half",
    "options": { "choices": [
      { "text": "Link clicks",         "value": "LINK_CLICKS" },
      { "text": "Landing page views",  "value": "LANDING_PAGE_VIEWS" },
      { "text": "Reach",               "value": "REACH" },
      { "text": "Impressions",         "value": "IMPRESSIONS" },
      { "text": "Conversions",         "value": "OFFSITE_CONVERSIONS" },
      { "text": "Lead generation",     "value": "LEAD_GENERATION" },
      { "text": "Post engagement",     "value": "POST_ENGAGEMENT" }
    ] } },
  "schema": { "default_value": "LINK_CLICKS" }
}'
add_field mk_ad_set billing_event '{
  "field": "billing_event", "type": "string",
  "meta": { "interface": "input", "width": "half" },
  "schema": { "default_value": "IMPRESSIONS" }
}'
add_field mk_ad_set budget_mode '{
  "field": "budget_mode", "type": "string",
  "meta": { "interface": "select-dropdown", "width": "half",
    "note": "Used when the parent campaign budget_mode is per-ad-set.",
    "options": { "choices": [
      { "text": "Daily",    "value": "daily" },
      { "text": "Lifetime", "value": "lifetime" }
    ] } },
  "schema": { "default_value": "daily" }
}'
add_field mk_ad_set budget_amount '{
  "field": "budget_amount", "type": "decimal",
  "meta": { "interface": "input", "width": "half" },
  "schema": { "numeric_precision": 12, "numeric_scale": 2 }
}'
add_field mk_ad_set start_time '{
  "field": "start_time", "type": "timestamp",
  "meta": { "interface": "datetime", "width": "half" },
  "schema": {}
}'
add_field mk_ad_set end_time '{
  "field": "end_time", "type": "timestamp",
  "meta": { "interface": "datetime", "width": "half" },
  "schema": {}
}'
add_field mk_ad_set targeting '{
  "field": "targeting", "type": "json",
  "meta": { "interface": "input-code", "options": { "language": "json" },
    "note": "{ countries: [\"IS\"], ageMin, ageMax, genders, interests, placements }" },
  "schema": {}
}'
add_field mk_ad_set meta_id '{
  "field": "meta_id", "type": "string",
  "meta": { "interface": "input", "width": "half" },
  "schema": {}
}'
add_timestamps mk_ad_set
ensure_relation mk_ad_set mk_meta_campaign_id mk_meta_campaign "CASCADE"

# ── mk_ad ────────────────────────────────────────────────────────────
echo "▶ mk_ad collection"
ensure_collection "mk_ad" '{
  "collection": "mk_ad",
  "schema": { "name": "mk_ad" },
  "meta": {
    "icon": "ads_click",
    "hidden": false,
    "note": "Meta ad level — creative text, destination link, CTA, image.",
    "display_template": "{{name}}"
  }
}'
add_field mk_ad mk_ad_set_id '{
  "field": "mk_ad_set_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half",
    "display": "related-values", "display_options": { "template": "{{name}}" } },
  "schema": {}
}'
add_field mk_ad name '{
  "field": "name", "type": "string",
  "meta": { "interface": "input", "required": true, "width": "half" },
  "schema": {}
}'
add_field mk_ad status '{
  "field": "status", "type": "string",
  "meta": { "interface": "select-dropdown", "width": "half",
    "options": { "choices": [
      { "text": "Paused", "value": "PAUSED" },
      { "text": "Active", "value": "ACTIVE" }
    ] } },
  "schema": { "default_value": "PAUSED" }
}'
add_field mk_ad body '{
  "field": "body", "type": "text",
  "meta": { "interface": "input-multiline", "note": "Primary text (Meta bulk column: Body)." },
  "schema": {}
}'
add_field mk_ad title '{
  "field": "title", "type": "string",
  "meta": { "interface": "input", "width": "half", "note": "Headline (Meta bulk column: Title)." },
  "schema": {}
}'
add_field mk_ad description '{
  "field": "description", "type": "string",
  "meta": { "interface": "input", "width": "half", "note": "Link description." },
  "schema": {}
}'
add_field mk_ad link_url '{
  "field": "link_url", "type": "string",
  "meta": { "interface": "input", "note": "Destination URL." },
  "schema": {}
}'
add_field mk_ad call_to_action '{
  "field": "call_to_action", "type": "string",
  "meta": { "interface": "select-dropdown", "width": "half",
    "options": { "choices": [
      { "text": "Learn more",   "value": "LEARN_MORE" },
      { "text": "Sign up",      "value": "SIGN_UP" },
      { "text": "Shop now",     "value": "SHOP_NOW" },
      { "text": "Apply now",    "value": "APPLY_NOW" },
      { "text": "Contact us",   "value": "CONTACT_US" },
      { "text": "Download",     "value": "DOWNLOAD" },
      { "text": "Get offer",    "value": "GET_OFFER" },
      { "text": "Book now",     "value": "BOOK_TRAVEL" },
      { "text": "Subscribe",    "value": "SUBSCRIBE" },
      { "text": "No button",    "value": "NO_BUTTON" }
    ] } },
  "schema": { "default_value": "LEARN_MORE" }
}'
add_field mk_ad image_id '{
  "field": "image_id", "type": "uuid",
  "meta": { "interface": "file-image", "special": ["file"], "width": "half",
    "note": "Creative image — referenced by file name in the bulk import." },
  "schema": {}
}'
add_field mk_ad meta_id '{
  "field": "meta_id", "type": "string",
  "meta": { "interface": "input", "width": "half" },
  "schema": {}
}'
add_timestamps mk_ad
ensure_relation mk_ad mk_ad_set_id mk_ad_set "CASCADE"
ensure_relation mk_ad image_id directus_files "SET NULL"

# ── mk_metric ────────────────────────────────────────────────────────
echo "▶ mk_metric collection"
ensure_collection "mk_metric" '{
  "collection": "mk_metric",
  "schema": { "name": "mk_metric" },
  "meta": {
    "icon": "monitoring",
    "hidden": false,
    "note": "Daily performance rows per campaign — imported from Ads Manager report CSVs or entered manually. Upsert key: (mk_campaign_id, level, ref_name, date).",
    "display_template": "{{ref_name}} · {{date}}"
  }
}'
add_field mk_metric mk_campaign_id '{
  "field": "mk_campaign_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half",
    "display": "related-values", "display_options": { "template": "{{name}}" } },
  "schema": {}
}'
add_field mk_metric level '{
  "field": "level", "type": "string",
  "meta": { "interface": "select-dropdown", "width": "half",
    "options": { "choices": [
      { "text": "Umbrella campaign", "value": "campaign" },
      { "text": "Meta campaign",     "value": "meta_campaign" },
      { "text": "Ad set",            "value": "ad_set" },
      { "text": "Ad",                "value": "ad" }
    ] } },
  "schema": { "default_value": "meta_campaign" }
}'
add_field mk_metric ref_name '{
  "field": "ref_name", "type": "string",
  "meta": { "interface": "input", "width": "half", "note": "The name matched from the Ads Manager report." },
  "schema": {}
}'
add_field mk_metric date '{
  "field": "date", "type": "date",
  "meta": { "interface": "datetime", "width": "half" },
  "schema": {}
}'
add_field mk_metric spend '{
  "field": "spend", "type": "decimal",
  "meta": { "interface": "input", "width": "half" },
  "schema": { "numeric_precision": 12, "numeric_scale": 2 }
}'
add_field mk_metric impressions '{
  "field": "impressions", "type": "integer",
  "meta": { "interface": "input", "width": "half" },
  "schema": {}
}'
add_field mk_metric reach '{
  "field": "reach", "type": "integer",
  "meta": { "interface": "input", "width": "half" },
  "schema": {}
}'
add_field mk_metric clicks '{
  "field": "clicks", "type": "integer",
  "meta": { "interface": "input", "width": "half" },
  "schema": {}
}'
add_field mk_metric results '{
  "field": "results", "type": "integer",
  "meta": { "interface": "input", "width": "half" },
  "schema": {}
}'
add_field mk_metric result_type '{
  "field": "result_type", "type": "string",
  "meta": { "interface": "input", "width": "half", "note": "Result indicator from the report (e.g. link clicks, leads)." },
  "schema": {}
}'
add_field mk_metric source '{
  "field": "source", "type": "string",
  "meta": { "interface": "select-dropdown", "width": "half",
    "options": { "choices": [
      { "text": "Report import", "value": "import" },
      { "text": "Manual",        "value": "manual" }
    ] } },
  "schema": { "default_value": "import" }
}'
add_timestamps mk_metric
ensure_relation mk_metric mk_campaign_id mk_campaign "CASCADE"

echo "✓ done."
