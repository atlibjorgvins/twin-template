#!/usr/bin/env bash
# EmailGroup — one shared address that stands for several people.
#
# Person_email is the wrong shape for this: an address there belongs to one
# person. "team@klak.is" belongs to nobody and means everybody, so an
# attendee on it should attach the whole team rather than resolve to a
# single contact or get created as a person called "team".
#
# Two ways to say who a group is, and a group can use both:
#
#   organization_id  the CURRENT roster of that org, resolved live from
#                    Person_organization.is_current. Nothing to maintain —
#                    somebody joining KLAK is in team@klak.is that day, and
#                    somebody leaving drops out of it.
#   members          an explicit list, via EmailGroup_Person, for groups
#                    that are not one org's roster (a steering committee, a
#                    cohort, a shared inbox two people watch).
#
# Idempotent — safe to re-run.
set -eo pipefail

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
# Creates the m2o column WITH its foreign key and the relation together, and
# asserts the constraint landed. Adding the relation after the column exists
# leaves schema: null — Directus metadata with no database FK — so the cascade
# silently never fires. Person_email shipped that way and had to be rebuilt.
# `one_field` matters just as much: without it Directus treats the o2m alias
# on the other side as a real column and every read selecting all fields 500s.
ensure_m2o() {
  local coll="$1" field="$2" related="$3" ondel="$4" one_field="$5" field_meta="$6"
  local code; code=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/fields/$coll/$field")
  if [ "$code" != "200" ]; then
    echo "  adding m2o field $coll.$field (FK → $related.id)…"
    curl -fsS "${AUTH[@]}" "$URL/fields/$coll" -d "{
      \"field\": \"$field\", \"type\": \"integer\",
      \"schema\": { \"foreign_key_table\": \"$related\", \"foreign_key_column\": \"id\" },
      \"meta\": $field_meta
    }" >/dev/null
  else
    echo "  field $coll.$field exists — skipping."
  fi
  local one_json='null'
  [ -n "$one_field" ] && one_json="{ \"one_field\": \"$one_field\" }"
  local have; have=$(curl -s "${AUTH[@]}" "$URL/relations/$coll/$field" | grep -o '"related_collection":"'"$related"'"' | head -1 || true)
  if [ -n "$have" ]; then echo "  relation $coll.$field exists — skipping."; return; fi
  echo "  creating relation $coll.$field → $related ($ondel)…"
  curl -fsS "${AUTH[@]}" "$URL/relations" -d "{
    \"collection\": \"$coll\",
    \"field\": \"$field\",
    \"related_collection\": \"$related\",
    \"meta\": $one_json,
    \"schema\": { \"on_delete\": \"$ondel\" }
  }" >/dev/null
  local sch; sch=$(curl -s "${AUTH[@]}" "$URL/relations/$coll/$field" | grep -o '"on_delete":"[A-Z ]*"' | head -1 || true)
  if [ -z "$sch" ]; then
    echo "  !! $coll.$field has no database foreign key — cascade will NOT fire." >&2
    echo "     Drop the field and re-run so it is created with the FK in place." >&2
    exit 1
  fi
  echo "  verified constraint: $sch"
}

echo "▶ EmailGroup collection"
ensure_collection "EmailGroup" '{
  "collection": "EmailGroup",
  "schema": { "name": "EmailGroup" },
  "meta": {
    "icon": "groups",
    "hidden": false,
    "note": "A shared address that stands for several people — team@klak.is tagging the whole KLAK roster. Attendee matching attaches every member instead of asking which one it is.",
    "display_template": "{{email}}",
    "sort_field": "sort",
    "archive_field": "status",
    "archive_value": "archived",
    "unarchive_value": "published"
  }
}'

echo "▶ EmailGroup fields"
add_field "EmailGroup" "status" '{
  "field": "status", "type": "string",
  "schema": { "default_value": "published" },
  "meta": { "width": "half", "interface": "select-dropdown", "display": "labels",
    "options": { "choices": [
      { "text": "Published", "value": "published" },
      { "text": "Archived", "value": "archived" }
    ] } }
}'
add_field "EmailGroup" "sort" '{ "field": "sort", "type": "integer", "meta": { "interface": "input", "hidden": true } }'
add_field "EmailGroup" "email" '{
  "field": "email", "type": "string",
  "schema": { "is_nullable": false, "is_unique": true },
  "meta": { "interface": "input", "width": "half", "required": true,
            "options": { "placeholder": "team@klak.is" },
            "note": "Unique. Matching lowercases both sides." }
}'
add_field "EmailGroup" "label" '{
  "field": "label", "type": "string",
  "meta": { "interface": "input", "width": "half",
            "options": { "placeholder": "KLAK team" },
            "note": "What to call this group in the UI." }
}'
add_field "EmailGroup" "current_only" '{
  "field": "current_only", "type": "boolean",
  "schema": { "default_value": true },
  "meta": { "interface": "boolean", "width": "half",
            "note": "Org-backed groups: only people whose role is current. Off includes former staff." }
}'
add_field "EmailGroup" "note" '{
  "field": "note", "type": "text",
  "meta": { "interface": "input-multiline", "note": "Why this group exists." }
}'

echo "▶ Org-backed membership (the roster resolves live)"
ensure_m2o "EmailGroup" "organization_id" "organization" "SET NULL" "email_groups" '{
  "interface": "select-dropdown-m2o", "width": "half",
  "options": { "template": "{{name}}" },
  "note": "Resolve to this org’s roster. Leave empty for an explicit-members-only group."
}'

echo "▶ EmailGroup_Person junction (explicit extra members)"
ensure_collection "EmailGroup_Person" '{
  "collection": "EmailGroup_Person",
  "schema": { "name": "EmailGroup_Person" },
  "meta": { "icon": "link", "hidden": true,
            "note": "Explicit members of an EmailGroup, added on top of any org roster." }
}'
ensure_m2o "EmailGroup_Person" "EmailGroup_id" "EmailGroup" "CASCADE" "members" '{
  "interface": "select-dropdown-m2o", "width": "half", "required": true,
  "options": { "template": "{{email}}" }
}'
ensure_m2o "EmailGroup_Person" "Person_id" "Person" "CASCADE" "" '{
  "interface": "select-dropdown-m2o", "width": "half", "required": true,
  "options": { "template": "{{full_name}}" }
}'

echo "✓ EmailGroup ready."
