#!/usr/bin/env bash
# Make mk_meta_campaign reportable on its own: give every imported Meta
# campaign a sub-project link (for roll-up reporting) and a denormalised
# ad-account link (so the "All Meta campaigns" browse view can filter by
# account without walking up through the umbrella).
#
#   mk_meta_campaign.project_id      → Project (SET NULL) — the sub-project
#                                      this campaign is attributed to.
#   mk_meta_campaign.ad_account_id   → mk_ad_account (SET NULL) — the
#                                      account it ran in (set at import).
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

echo "Meta campaign attribution fields…"

add_field mk_meta_campaign project_id '{
  "field": "project_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half",
    "note": "Sub-project this Meta campaign is attributed to (for reporting).",
    "display": "related-values", "display_options": { "template": "{{name}}" } },
  "schema": {}
}'
add_field mk_meta_campaign ad_account_id '{
  "field": "ad_account_id", "type": "string",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half",
    "note": "Ad account this campaign ran in (set at import).",
    "display": "related-values", "display_options": { "template": "{{name}}" } },
  "schema": {}
}'

ensure_relation mk_meta_campaign project_id Project "SET NULL"
ensure_relation mk_meta_campaign ad_account_id mk_ad_account "SET NULL"

echo "Done."
