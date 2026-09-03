#!/usr/bin/env bash
# Places: turn the town taxonomy into a place graph that can suggest.
#
# What already exists (untouched by this script):
#   location                71 Icelandic towns, 16 of them with coordinates
#   organization_location   105 rows linking orgs to those towns
#
# What that cannot do is the thing we actually want. A town centroid cannot
# answer "leave in 20 minutes", and "KLAK is in Reykjavík" cannot answer
# "which of KLAK's offices did you mean". So this adds the venue level on top
# of the towns rather than beside them:
#
#   location.place_type     municipality | venue | address | area | region
#   location.parent_id      a venue sits IN a town, so "orgs in Reykjavík"
#                           still works by rollup once venues exist
#   location.address        the full string a geocoder can resolve
#   location.osm_id         the resolved answer, so we stop re-asking
#   location.geocoded_at    when we last asked
#
#   organization_location.role / is_primary   office vs hq vs mailing
#   person_location                           home / work, the people half
#   Dates.location_id                         THE ONE THAT MATTERS
#
# Why Dates.location_id carries the feature: "suggest KLAK's offices, most
# used first" is a COUNT over past events. Today an event's location is 476
# rows of free text, and free text cannot be counted — "KLAK Office",
# "Klak, Bjargargata 1" and "Gróska" are three strings and one place. A
# reference makes the ranking a group-by, makes the map a lookup instead of
# a Nominatim round-trip, and makes "I'm here → what is this" a reverse
# lookup on the same rows.
#
# Safety: every field is nullable and additive. No existing field is altered
# and no existing row is rewritten — the free-text location fields stay
# exactly as they are and keep rendering, so nothing breaks if the reference
# is never filled in. Backfilling is a separate, later, reversible step.
#
# Additive and idempotent — safe to re-run. Same style as add-finances.sh.
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

ensure_collection() {
  local name="$1" payload="$2"
  local code; code=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/collections/$name")
  if [ "$code" = "200" ]; then echo "  collection $name exists — skipping."; return; fi
  echo "  creating collection $name…"; curl -fsS "${AUTH[@]}" "$URL/collections" -d "$payload" >/dev/null
}

add_field() {
  local coll="$1" name="$2" payload="$3"
  local code; code=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/fields/$coll/$name")
  if [ "$code" = "200" ]; then echo "  field $coll.$name exists — skipping."; return; fi
  echo "  adding field $coll.$name…"; curl -fsS "${AUTH[@]}" "$URL/fields/$coll" -d "$payload" >/dev/null
}

ensure_relation() {
  local coll="$1" field="$2" related="$3" on_delete="${4:-SET NULL}"
  local existing
  existing=$(curl -s "${AUTH[@]}" "$URL/relations/$coll/$field" -o /dev/null -w "%{http_code}")
  if [ "$existing" = "200" ]; then echo "  relation $coll.$field exists — skipping."; return; fi
  echo "  creating relation $coll.$field → $related…"
  curl -fsS "${AUTH[@]}" "$URL/relations" -d "{
    \"collection\": \"$coll\",
    \"field\": \"$field\",
    \"related_collection\": \"$related\",
    \"schema\": { \"on_delete\": \"$on_delete\" }
  }" >/dev/null
}

# ── location: the venue level ────────────────────────────────────────────
echo "▶ location.place_type"
# The existing 71 rows are all municipalities, but this stays NULL for them
# rather than being backfilled here: a schema migration that also rewrites
# rows is two changes wearing one coat. Reading code treats NULL as
# 'municipality', and a backfill can run later once that is proven.
add_field location place_type '{
  "field": "place_type", "type": "string",
  "schema": { "is_nullable": true },
  "meta": {
    "interface": "select-dropdown",
    "options": { "choices": [
      { "text": "Municipality", "value": "municipality" },
      { "text": "Region",       "value": "region" },
      { "text": "Venue",        "value": "venue" },
      { "text": "Address",      "value": "address" },
      { "text": "Area",         "value": "area" }
    ] },
    "note": "Granularity. NULL on the original 71 rows, which are all municipalities."
  }
}'

echo "▶ location.parent_id"
add_field location parent_id '{
  "field": "parent_id", "type": "integer",
  "schema": { "is_nullable": true },
  "meta": {
    "interface": "select-dropdown-m2o", "special": ["m2o"],
    "options": { "template": "{{name}}" },
    "note": "The place this one sits inside — a venue points at its municipality."
  }
}'
# SET NULL: deleting a town must never cascade away the offices in it.
ensure_relation location parent_id location

echo "▶ location.address"
add_field location address '{
  "field": "address", "type": "text",
  "schema": { "is_nullable": true },
  "meta": {
    "interface": "input-multiline",
    "note": "Full street address, as a geocoder should receive it. \"Bjargargata 1, 102 Reykjavík, Iceland\"."
  }
}'

echo "▶ location.osm_id"
add_field location osm_id '{
  "field": "osm_id", "type": "string",
  "schema": { "is_nullable": true },
  "meta": {
    "interface": "input",
    "note": "OpenStreetMap id of the resolved place, so a taught answer is never re-guessed."
  }
}'

echo "▶ location.geocoded_at"
add_field location geocoded_at '{
  "field": "geocoded_at", "type": "timestamp",
  "schema": { "is_nullable": true },
  "meta": {
    "interface": "datetime", "readonly": true,
    "note": "When latitude/longitude were last resolved. NULL means never asked."
  }
}'

# ── organization_location: which KIND of place this is for the org ───────
echo "▶ organization_location.role"
# The 105 existing rows keep a NULL role and keep working; role only starts
# mattering once an org has more than one place.
add_field organization_location role '{
  "field": "role", "type": "string",
  "schema": { "is_nullable": true },
  "meta": {
    "interface": "select-dropdown",
    "options": { "choices": [
      { "text": "Office",     "value": "office" },
      { "text": "Headquarters", "value": "hq" },
      { "text": "Venue",      "value": "venue" },
      { "text": "Mailing",    "value": "mailing" }
    ] },
    "note": "What this place is to the org. NULL on the 105 pre-existing town links."
  }
}'

echo "▶ organization_location.is_primary"
add_field organization_location is_primary '{
  "field": "is_primary", "type": "boolean",
  "schema": { "is_nullable": true, "default_value": false },
  "meta": {
    "interface": "boolean",
    "note": "Seeds the suggestion order before there is any meeting history to count."
  }
}'

# ── person_location: the half that never existed ─────────────────────────
echo "▶ person_location"
ensure_collection person_location '{
  "collection": "person_location",
  "meta": {
    "icon": "person_pin_circle",
    "note": "Links a person to a place — home, work, or where you tend to meet them.",
    "hidden": true
  },
  "schema": {}
}'

add_field person_location person_id '{
  "field": "person_id", "type": "integer",
  "schema": { "is_nullable": false },
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "required": true }
}'
# CASCADE here, unlike everywhere else in this script: a junction row has no
# meaning once one of its two ends is gone.
ensure_relation person_location person_id Person CASCADE

add_field person_location location_id '{
  "field": "location_id", "type": "integer",
  "schema": { "is_nullable": false },
  "meta": {
    "interface": "select-dropdown-m2o", "special": ["m2o"],
    "options": { "template": "{{name}}" }, "required": true
  }
}'
ensure_relation person_location location_id location CASCADE

add_field person_location role '{
  "field": "role", "type": "string",
  "schema": { "is_nullable": true },
  "meta": {
    "interface": "select-dropdown",
    "options": { "choices": [
      { "text": "Home",    "value": "home" },
      { "text": "Work",    "value": "work" },
      { "text": "From",    "value": "from" },
      { "text": "Meet at", "value": "meet" }
    ] },
    "note": "How the person relates to the place."
  }
}'

# ── Dates.location_id: what makes ranking and ETA possible ───────────────
echo "▶ Dates.location_id"
# Additive alongside the three existing free-text fields, which stay. An
# event can carry both: the reference when we know the place, the text when
# it came in from a calendar feed and nobody has resolved it yet.
add_field Dates location_id '{
  "field": "location_id", "type": "integer",
  "schema": { "is_nullable": true },
  "meta": {
    "interface": "select-dropdown-m2o", "special": ["m2o"],
    "options": { "template": "{{name}}" },
    "note": "Structured place for this event. Makes \"most used\" countable and the ETA a lookup instead of a geocode."
  }
}'
# SET NULL: deleting a place must not delete the meetings that happened there.
ensure_relation Dates location_id location

echo "✔ places schema ready."
