#!/usr/bin/env bash
# One medium vocabulary for every kind of ad spend.
#
# Today Meta's `publisher_platform` ("instagram") and
# mk_manual_spend.channel ("billboard") are separate vocabularies, so
# "split the spend by medium" can't cross paid and manual. This makes the
# list a collection, so a new medium is a row rather than a deploy:
#
#   mk_medium                 code (PK) · label · kind · sort · is_enabled
#                             manual_entry — does hand-entered spend use it
#                             meta_platform — the publisher_platform it mirrors
#   mk_manual_spend.medium    → mk_medium (SET NULL)
#
# `channel` stays untouched so the existing /tools/campaigns/spend page
# keeps working; scripts/backfill-manual-medium.mjs fills `medium` from it.
#
# Meta rows deliberately get NO medium column: a campaign spans several
# platforms, so the honest split only exists on the publisher_platform
# breakdown rows (see add-marketing-breakdowns.sh), and campaign-level
# spend reports as `meta_unsplit` until a breakdown covers that day.
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
# seed <code> <label> <kind> <sort> <manual_entry> [meta_platform]
seed() {
  local code="$1" label="$2" kind="$3" sort="$4" manual="$5" platform="${6:-}"
  local http; http=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/items/mk_medium/$code")
  if [ "$http" = "200" ]; then echo "  medium $code exists — skipping."; return; fi
  local plat="null"; [ -n "$platform" ] && plat="\"$platform\""
  echo "  seeding medium $code…"
  curl -fsS "${AUTH[@]}" "$URL/items/mk_medium" -d "{
    \"code\": \"$code\", \"label\": \"$label\", \"kind\": \"$kind\",
    \"sort\": $sort, \"manual_entry\": $manual, \"meta_platform\": $plat
  }" >/dev/null
}

echo "▶ mk_medium collection"
# A string primary key: the code IS the value stored on spend rows, so
# nothing has to resolve an integer id to report by medium.
ensure_collection "mk_medium" '{
  "collection": "mk_medium",
  "schema": { "name": "mk_medium" },
  "meta": { "icon": "podcasts", "sort_field": "sort",
    "note": "The one medium vocabulary — every paid and manual spend row reports through this list." },
  "fields": [{
    "field": "code", "type": "string",
    "meta": { "interface": "input", "note": "Stable code, e.g. meta_instagram. Written onto spend rows." },
    "schema": { "is_primary_key": true, "length": 64, "has_auto_increment": false, "is_nullable": false }
  }]
}'

add_field mk_medium label '{
  "field": "label", "type": "string",
  "meta": { "interface": "input", "note": "How it reads in a report." },
  "schema": {}
}'
add_field mk_medium kind '{
  "field": "kind", "type": "string",
  "meta": { "interface": "select-dropdown", "width": "half",
    "note": "Coarse family, for grouping a long list.",
    "options": { "allowOther": true, "choices": [
      {"text":"Paid social","value":"paid_social"},
      {"text":"Search","value":"search"},
      {"text":"Display","value":"display"},
      {"text":"Video","value":"video"},
      {"text":"Out of home","value":"ooh"},
      {"text":"Broadcast","value":"broadcast"},
      {"text":"Print","value":"print"},
      {"text":"Sponsorship","value":"sponsorship"},
      {"text":"Owned","value":"owned"},
      {"text":"Other","value":"other"}
    ] } },
  "schema": { "default_value": "other" }
}'
add_field mk_medium sort '{
  "field": "sort", "type": "integer",
  "meta": { "interface": "input", "width": "half", "hidden": true },
  "schema": { "default_value": 900 }
}'
add_field mk_medium manual_entry '{
  "field": "manual_entry", "type": "boolean",
  "meta": { "interface": "boolean", "width": "half",
    "note": "Offer this medium when entering spend by hand. Off for the Meta platforms, which arrive from the sync." },
  "schema": { "default_value": true }
}'
add_field mk_medium meta_platform '{
  "field": "meta_platform", "type": "string",
  "meta": { "interface": "input", "width": "half",
    "note": "Meta publisher_platform this medium mirrors, so the breakdown sync can map onto it." },
  "schema": {}
}'
add_field mk_medium is_enabled '{
  "field": "is_enabled", "type": "boolean",
  "meta": { "interface": "boolean", "width": "half", "note": "Retire a medium without deleting its history." },
  "schema": { "default_value": true }
}'

echo "▶ seeding the vocabulary"
# Meta platforms — never hand-entered; the sync writes these codes.
seed meta_facebook         "Facebook (Meta)"              paid_social  10 false facebook
seed meta_instagram        "Instagram (Meta)"             paid_social  20 false instagram
seed meta_messenger        "Messenger (Meta)"             paid_social  30 false messenger
seed meta_audience_network "Audience Network (Meta)"      paid_social  40 false audience_network
seed meta_threads          "Threads (Meta)"               paid_social  50 false threads
seed meta_other            "Meta (other placement)"       paid_social  60 false
# Campaign-level Meta spend on days no platform breakdown covers.
seed meta_unsplit          "Meta (not split by platform)" paid_social  70 false
# Other paid channels — manual entry until twin connects them.
seed google_search         "Google Search"                search      100 true
seed google_display        "Google Display"               display     110 true
seed google_youtube        "YouTube"                      video       120 true
seed linkedin              "LinkedIn"                     paid_social 130 true
seed tiktok                "TikTok"                       paid_social 140 true
seed influencer            "Influencer"                   paid_social 150 true
# Offline and owned.
seed ooh                   "Billboard / OOH"              ooh         200 true
seed print                 "Print"                        print       210 true
seed radio                 "Radio"                        broadcast   220 true
seed tv                    "TV"                           broadcast   230 true
seed cinema                "Cinema"                       broadcast   240 true
seed sponsorship           "Sponsorship"                  sponsorship 250 true
seed email                 "Email"                        owned       260 true
seed organic_social        "Organic social"               owned       270 true
seed other                 "Other"                        other       900 true

echo "▶ mk_manual_spend.medium"
add_field mk_manual_spend medium '{
  "field": "medium", "type": "string",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half",
    "note": "Medium this spend reports under. Set from `channel` by scripts/backfill-manual-medium.mjs.",
    "display": "related-values", "display_options": { "template": "{{label}}" },
    "options": { "filter": { "manual_entry": { "_eq": true }, "is_enabled": { "_eq": true } } } },
  "schema": {}
}'
ensure_relation mk_manual_spend medium mk_medium "SET NULL"

echo "Done."
