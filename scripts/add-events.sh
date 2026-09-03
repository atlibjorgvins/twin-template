#!/usr/bin/env bash
# Events (happenings) — the overview feature at /events. A real-world
# event you run or attend (demo day, hackathon, conference, ceremony),
# documented after the fact and connected widely. Distinct from the
# calendar (Dates): an event can OPTIONALLY reference calendar dates.
#
#   event            name, kind, dates, location, status, project, cover
#   event_person     roled junction → Person (speaker/judge/attendee/…)
#   event_org        roled junction → organization (host/sponsor/finalist/…)
#   event_photo      photo gallery (multi-upload, captions)
#   event_date       link → Dates (the calendar entry that was the event)
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
    \"collection\": \"$coll\", \"field\": \"$field\",
    \"related_collection\": \"$related\", \"schema\": { \"on_delete\": \"$ondel\" }
  }" >/dev/null
}

# ── event ────────────────────────────────────────────────────────────
echo "▶ event collection"
ensure_collection "event" '{
  "collection": "event",
  "schema": { "name": "event" },
  "meta": {
    "icon": "celebration",
    "hidden": false,
    "note": "Happenings — real-world events (demo days, hackathons, ceremonies) connected to projects, people, orgs and photos. Distinct from the calendar.",
    "display_template": "{{name}}",
    "archive_field": "status",
    "archive_value": "archived",
    "unarchive_value": "upcoming",
    "archive_app_filter": true,
    "sort_field": "start"
  }
}'
add_field event name '{ "field": "name", "type": "string",
  "meta": { "interface": "input", "required": true }, "schema": {} }'
add_field event kind '{ "field": "kind", "type": "string",
  "meta": { "interface": "select-dropdown", "width": "half",
    "options": { "choices": [
      { "text": "Demo day", "value": "demo_day" },
      { "text": "Hackathon", "value": "hackathon" },
      { "text": "Conference", "value": "conference" },
      { "text": "Ceremony", "value": "ceremony" },
      { "text": "Workshop", "value": "workshop" },
      { "text": "Meetup", "value": "meetup" },
      { "text": "Other", "value": "other" }
    ] } },
  "schema": { "default_value": "other" } }'
add_field event status '{ "field": "status", "type": "string",
  "meta": { "interface": "select-dropdown", "width": "half",
    "options": { "choices": [
      { "text": "Idea",     "value": "idea" },
      { "text": "Planning", "value": "planning" },
      { "text": "Upcoming", "value": "upcoming" },
      { "text": "Past",     "value": "past" },
      { "text": "Archived", "value": "archived" }
    ] } },
  "schema": { "default_value": "upcoming" } }'
add_field event start '{ "field": "start", "type": "timestamp",
  "meta": { "interface": "datetime", "width": "half", "note": "When it happens / happened." },
  "schema": {} }'
add_field event end '{ "field": "end", "type": "timestamp",
  "meta": { "interface": "datetime", "width": "half", "note": "Optional — multi-day events." },
  "schema": {} }'
add_field event location_name '{ "field": "location_name", "type": "string",
  "meta": { "interface": "input", "width": "half", "note": "Venue — e.g. Harpa, Gróska." }, "schema": {} }'
add_field event project_id '{ "field": "project_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half",
    "display": "related-values", "display_options": { "template": "{{name}}" },
    "note": "The project/program this event belongs to. Drives brand context." },
  "schema": {} }'
add_field event summary '{ "field": "summary", "type": "text",
  "meta": { "interface": "input-multiline", "note": "What happened / what it is about." }, "schema": {} }'
add_field event cover '{ "field": "cover", "type": "uuid",
  "meta": { "interface": "file-image", "special": ["file"], "width": "half",
    "note": "Hero image for the event." }, "schema": {} }'
add_field event external_ref '{ "field": "external_ref", "type": "string",
  "meta": { "interface": "input", "width": "half", "note": "Import provenance + dedup key, e.g. klak:226272." }, "schema": {} }'
add_field event source_url '{ "field": "source_url", "type": "string",
  "meta": { "interface": "input", "width": "half", "note": "Original source link (klak.is, Facebook event)." }, "schema": {} }'
add_field event date_created '{ "field": "date_created", "type": "timestamp",
  "meta": { "interface": "datetime", "readonly": true, "hidden": true, "special": ["date-created"], "width": "half" }, "schema": {} }'
add_field event date_updated '{ "field": "date_updated", "type": "timestamp",
  "meta": { "interface": "datetime", "readonly": true, "hidden": true, "special": ["date-updated"], "width": "half" }, "schema": {} }'
ensure_relation event project_id Project "SET NULL"
ensure_relation event cover directus_files "SET NULL"

# ── event_person (roled) ─────────────────────────────────────────────
echo "▶ event_person junction"
ensure_collection "event_person" '{
  "collection": "event_person",
  "schema": { "name": "event_person" },
  "meta": { "icon": "person", "hidden": true, "note": "Event ↔ Person with a role.", "display_template": "{{role}}" }
}'
add_field event_person event_id '{ "field": "event_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half" }, "schema": {} }'
add_field event_person person_id '{ "field": "person_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half" }, "schema": {} }'
add_field event_person role '{ "field": "role", "type": "string",
  "meta": { "interface": "input", "width": "half", "note": "speaker | judge | attendee | organizer | mentor | winner | …" }, "schema": {} }'
add_field event_person sort '{ "field": "sort", "type": "integer", "meta": { "interface": "input", "hidden": true }, "schema": {} }'
ensure_relation event_person event_id event "CASCADE"
ensure_relation event_person person_id Person "CASCADE"

# ── event_org (roled) ────────────────────────────────────────────────
echo "▶ event_org junction"
ensure_collection "event_org" '{
  "collection": "event_org",
  "schema": { "name": "event_org" },
  "meta": { "icon": "domain", "hidden": true, "note": "Event ↔ organization with a role.", "display_template": "{{role}}" }
}'
add_field event_org event_id '{ "field": "event_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half" }, "schema": {} }'
add_field event_org organization_id '{ "field": "organization_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half" }, "schema": {} }'
add_field event_org role '{ "field": "role", "type": "string",
  "meta": { "interface": "input", "width": "half", "note": "host | sponsor | partner | finalist | winner | exhibitor | …" }, "schema": {} }'
add_field event_org sort '{ "field": "sort", "type": "integer", "meta": { "interface": "input", "hidden": true }, "schema": {} }'
ensure_relation event_org event_id event "CASCADE"
ensure_relation event_org organization_id organization "CASCADE"

# ── event_photo (gallery) ────────────────────────────────────────────
echo "▶ event_photo gallery"
ensure_collection "event_photo" '{
  "collection": "event_photo",
  "schema": { "name": "event_photo" },
  "meta": { "icon": "photo_library", "hidden": true, "note": "Photo gallery per event.", "display_template": "{{caption}}", "sort_field": "sort" }
}'
add_field event_photo event_id '{ "field": "event_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half" }, "schema": {} }'
add_field event_photo file_id '{ "field": "file_id", "type": "uuid",
  "meta": { "interface": "file-image", "special": ["file"], "width": "half" }, "schema": {} }'
add_field event_photo caption '{ "field": "caption", "type": "string", "meta": { "interface": "input" }, "schema": {} }'
add_field event_photo sort '{ "field": "sort", "type": "integer", "meta": { "interface": "input", "hidden": true }, "schema": {} }'
add_field event_photo date_created '{ "field": "date_created", "type": "timestamp",
  "meta": { "interface": "datetime", "readonly": true, "hidden": true, "special": ["date-created"], "width": "half" }, "schema": {} }'
ensure_relation event_photo event_id event "CASCADE"
ensure_relation event_photo file_id directus_files "CASCADE"

# ── event_date (link to calendar Dates) ──────────────────────────────
echo "▶ event_date link"
ensure_collection "event_date" '{
  "collection": "event_date",
  "schema": { "name": "event_date" },
  "meta": { "icon": "event", "hidden": true, "note": "Links an event to calendar Dates entries it corresponds to." }
}'
add_field event_date event_id '{ "field": "event_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half" }, "schema": {} }'
add_field event_date dates_id '{ "field": "dates_id", "type": "integer",
  "meta": { "interface": "select-dropdown-m2o", "special": ["m2o"], "width": "half" }, "schema": {} }'
ensure_relation event_date event_id event "CASCADE"
ensure_relation event_date dates_id Dates "CASCADE"

echo "✓ done."
