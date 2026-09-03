#!/usr/bin/env bash
# Habit tracker.
#
#   habit        A thing you want to do daily — "Pushups" (count, target 50)
#                or "Meditate" (check). Carries its glyph/colour + sort.
#   habit_entry  One row per habit per day: value = 1 for a ticked check,
#                or the running count for a count habit. Upserted on
#                (habit_id, entry_date) so a day never duplicates.
#
# Streaks are derived from entries at read time — nothing stored, nothing
# to drift. v1 is daily-cadence only.
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
    \"collection\": \"$coll\", \"field\": \"$field\", \"related_collection\": \"$related\",
    \"schema\": { \"on_delete\": \"$ondel\" }
  }" >/dev/null
}

echo "▶ habit collection"
ensure_collection "habit" '{
  "collection": "habit",
  "schema": { "name": "habit" },
  "meta": { "icon": "check_circle", "note": "Daily habits — pushups, glasses of water, meditate." }
}'

add_field habit name '{
  "field": "name", "type": "string",
  "meta": { "interface": "input", "note": "Pushups, Glass of water, Meditate…" }, "schema": {}
}'
add_field habit kind '{
  "field": "kind", "type": "string",
  "schema": { "default_value": "check" },
  "meta": {
    "interface": "select-dropdown",
    "note": "check = done/not-done · count = tally toward a target.",
    "options": { "choices": [
      { "text": "Check", "value": "check" },
      { "text": "Count", "value": "count" }
    ] }
  }
}'
add_field habit target '{
  "field": "target", "type": "integer",
  "schema": { "is_nullable": true },
  "meta": { "interface": "input", "note": "Daily target for count habits (50 pushups, 8 glasses). Null for checks." }
}'
add_field habit unit '{
  "field": "unit", "type": "string",
  "schema": { "is_nullable": true },
  "meta": { "interface": "input", "note": "reps, glasses, minutes…" }
}'
# How much one tap adds — a set of 20 pushups is one tap, water stays 1.
add_field habit step '{
  "field": "step", "type": "integer",
  "schema": { "is_nullable": true, "default_value": 1 },
  "meta": { "interface": "input", "note": "Amount added per tap for count habits (pushups 20, water 1)." }
}'
add_field habit icon '{
  "field": "icon", "type": "string",
  "schema": { "is_nullable": true },
  "meta": { "interface": "input", "note": "Icon name from the app glyph catalogue." }
}'
add_field habit color '{
  "field": "color", "type": "string",
  "schema": { "is_nullable": true, "max_length": 9 },
  "meta": { "interface": "select-color", "note": "Accent colour for the progress fill." }
}'
add_field habit sort '{
  "field": "sort", "type": "integer",
  "schema": { "is_nullable": true },
  "meta": { "interface": "input", "hidden": true, "note": "Manual order on the Today card." }
}'
add_field habit scope '{
  "field": "scope", "type": "string",
  "schema": { "default_value": "private" },
  "meta": {
    "interface": "select-dropdown",
    "note": "Respects the app Work/Private toggle.",
    "options": { "choices": [
      { "text": "Work", "value": "work" },
      { "text": "Private", "value": "private" },
      { "text": "Both", "value": "both" }
    ] }
  }
}'
add_field habit status '{
  "field": "status", "type": "string",
  "schema": { "default_value": "published" },
  "meta": {
    "interface": "select-dropdown",
    "options": { "choices": [
      { "text": "Published", "value": "published" },
      { "text": "Archived", "value": "archived" }
    ] }
  }
}'
add_field habit date_created '{
  "field": "date_created", "type": "timestamp",
  "meta": { "special": ["date-created"], "interface": "datetime", "readonly": true, "hidden": true },
  "schema": {}
}'

echo "▶ habit_entry collection"
ensure_collection "habit_entry" '{
  "collection": "habit_entry",
  "schema": { "name": "habit_entry" },
  "meta": { "icon": "event_available", "note": "One row per habit per day — value = count (or 1 for a ticked check)." }
}'

add_field habit_entry habit_id '{
  "field": "habit_id", "type": "integer",
  "schema": { "is_nullable": true },
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "options": { "template": "{{name}}" } }
}'
# CASCADE: deleting a habit should take its history with it — an orphaned
# entry has no meaning (unlike an inherited membership row).
ensure_relation habit_entry habit_id habit "CASCADE"

add_field habit_entry entry_date '{
  "field": "entry_date", "type": "date",
  "meta": { "interface": "datetime", "note": "The day this entry belongs to (local date)." }, "schema": {}
}'
add_field habit_entry value '{
  "field": "value", "type": "integer",
  "schema": { "default_value": 0 },
  "meta": { "interface": "input", "note": "Count for the day; 1 = ticked for check habits." }
}'
# Snapshot of the habit target on the day it was logged, so history stays
# answerable ("did I hit it on 3 July?") after the target later changes.
add_field habit_entry target '{
  "field": "target", "type": "integer",
  "schema": { "is_nullable": true },
  "meta": { "interface": "input", "note": "The target that applied on this day (snapshot — do not backfill)." }
}'
add_field habit_entry date_created '{
  "field": "date_created", "type": "timestamp",
  "meta": { "special": ["date-created"], "interface": "datetime", "readonly": true, "hidden": true },
  "schema": {}
}'

echo "Done."
