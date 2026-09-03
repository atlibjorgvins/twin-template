#!/usr/bin/env bash
# Person_email — additional email addresses for a Person.
#
# Why a child collection and not more columns:
#
#   Today a person can hold exactly two addresses — Person.email and the
#   work_email on one Person_organization role. 18 people are already at
#   that ceiling, and a third address simply cannot be recorded. Attendee
#   matching resolves by email, so an address we can't store is an
#   attendee that resolves to nobody and gets "created" as a duplicate.
#
# Why Person.email stays the primary:
#
#   1,210 of 1,582 people have one, and every read in the app expects it
#   there. Moving them into this table would mean backfilling all 1,210
#   and touching every Person.email reference for a feature about
#   matching. This collection holds the ADDITIONAL addresses; the primary
#   stays put. Promoting to a full one-to-many later is still open.
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
# Two things the generic helper in the older scripts gets wrong, both of which
# bit on the first run against production:
#
#   1. No `one_field`. Without it Directus does not know Person.emails is the
#      reverse side of this relation, so it treats the alias as a real column
#      and EVERY read that selects all Person fields 500s with
#      "column Person.emails does not exist".
#   2. No database constraint. Posting schema.on_delete after the column
#      already exists leaves schema: null — Directus metadata only — so the
#      cascade never fires and deleting a person leaves orphaned addresses.
#      The foreign key has to be declared on the FIELD, at creation.
#
# So the m2o field and its relation are created together, and both are
# verified rather than assumed.
ensure_m2o() {
  local coll="$1" field="$2" related="$3" ondel="$4" one_field="$5" field_meta="$6"
  local code; code=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/fields/$coll/$field")
  if [ "$code" != "200" ]; then
    echo "  adding m2o field $coll.$field (FK → $related.id)…"
    curl -fsS "${AUTH[@]}" "$URL/fields/$coll" -d "{
      \"field\": \"$field\", \"type\": \"integer\",
      \"schema\": { \"is_nullable\": false,
                    \"foreign_key_table\": \"$related\", \"foreign_key_column\": \"id\" },
      \"meta\": $field_meta
    }" >/dev/null
  else
    echo "  field $coll.$field exists — skipping."
  fi

  local have; have=$(curl -s "${AUTH[@]}" "$URL/relations/$coll/$field" | grep -o '"one_field":"'"$one_field"'"' | head -1 || true)
  if [ -n "$have" ]; then echo "  relation $coll.$field exists — skipping."; return; fi
  echo "  creating relation $coll.$field → $related ($ondel, one_field=$one_field)…"
  curl -fsS "${AUTH[@]}" "$URL/relations" -d "{
    \"collection\": \"$coll\",
    \"field\": \"$field\",
    \"related_collection\": \"$related\",
    \"meta\": { \"one_field\": \"$one_field\" },
    \"schema\": { \"on_delete\": \"$ondel\" }
  }" >/dev/null

  # Assert the constraint landed. A relation with schema: null looks fine in
  # the admin UI and silently drops the cascade.
  local sch; sch=$(curl -s "${AUTH[@]}" "$URL/relations/$coll/$field" | grep -o '"on_delete":"[A-Z ]*"' | head -1 || true)
  if [ -z "$sch" ]; then
    echo "  !! $coll.$field has no database foreign key — cascade will NOT fire." >&2
    echo "     Drop the field and re-run so it is created with the FK in place." >&2
    exit 1
  fi
  echo "  verified constraint: $sch"
}

echo "▶ Person_email collection"
ensure_collection "Person_email" '{
  "collection": "Person_email",
  "schema": { "name": "Person_email" },
  "meta": {
    "icon": "alternate_email",
    "hidden": false,
    "note": "Additional email addresses for a Person. The primary address stays on Person.email; these are the extras attendee matching also sweeps.",
    "display_template": "{{email}}",
    "sort_field": "sort",
    "archive_field": "status",
    "archive_value": "archived",
    "unarchive_value": "published"
  }
}'

echo "▶ Person_email fields"
add_field "Person_email" "status" '{
  "field": "status", "type": "string",
  "schema": { "default_value": "published" },
  "meta": {
    "width": "half", "interface": "select-dropdown", "display": "labels",
    "note": "Archive a dead address instead of deleting it — an old address is still worth matching an old invitation against.",
    "options": { "choices": [
      { "text": "Published", "value": "published" },
      { "text": "Archived", "value": "archived" }
    ] },
    "display_options": { "choices": [
      { "text": "Published", "value": "published", "foreground": "#FFFFFF", "background": "#2ECDA7" },
      { "text": "Archived", "value": "archived", "foreground": "#FFFFFF", "background": "#A2B5CD" }
    ] }
  }
}'
add_field "Person_email" "sort" '{ "field": "sort", "type": "integer", "meta": { "interface": "input", "hidden": true } }'
ensure_m2o "Person_email" "person_id" "Person" "CASCADE" "emails" '{
  "interface": "select-dropdown-m2o", "width": "half", "required": true,
  "options": { "template": "{{full_name}}" }
}'

add_field "Person_email" "email" '{
  "field": "email", "type": "string",
  "schema": { "is_nullable": false },
  "meta": { "interface": "input", "width": "half", "required": true,
            "options": { "placeholder": "name@company.is" },
            "note": "Stored as entered; matching lowercases both sides." }
}'
add_field "Person_email" "label" '{
  "field": "label", "type": "string",
  "schema": { "default_value": "other" },
  "meta": { "interface": "select-dropdown", "width": "half", "display": "labels",
    "options": { "choices": [
      { "text": "Personal", "value": "personal" },
      { "text": "Work", "value": "work" },
      { "text": "Old", "value": "old" },
      { "text": "Other", "value": "other" }
    ] } }
}'
add_field "Person_email" "source" '{
  "field": "source", "type": "string",
  "meta": { "interface": "input", "width": "half", "readonly": true,
            "note": "How it got here: manual, calendar_attendee, import. Matches the convention on Person.source." }
}'
add_field "Person_email" "date_created" '{
  "field": "date_created", "type": "timestamp",
  "meta": { "special": ["date-created"], "interface": "datetime", "readonly": true, "width": "half", "hidden": true }
}'

# Created AFTER the relation above, which declares one_field: "emails". In
# the other order Person.emails is a column Directus cannot resolve.
echo "▶ Person side of the relation (o2m)"
add_field "Person" "emails" '{
  "field": "emails", "type": "alias",
  "meta": { "interface": "list-o2m", "special": ["o2m"],
            "note": "Additional addresses. The primary one is the email field above.",
            "options": { "template": "{{email}}" } }
}'

echo "✓ Person_email ready."
