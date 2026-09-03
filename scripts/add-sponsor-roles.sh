#!/usr/bin/env bash
# Sponsors and other org→project connections, as tiers with their own wording.
#
# Extends what already exists rather than adding a parallel sponsor table:
# Project_organization already carries host and cohort_member, and ProjectRole
# is already the curated catalogue those pick from. A sponsor is one more kind
# of connection, so it becomes a role with a tier and a phrase.
#
#   ProjectRole   + tier          gold | silver | bronze | null
#                 + is_sponsor    group sponsors together in the UI
#                 + phrase_is     Icelandic template, {org} / {org_dative}
#                 + phrase_en     English template, {org}
#
#   organization  + name_dative_is
#                 Icelandic dative. "Með stuðningi frá Grósku" declines the
#                 name — Gróska becomes Grósku — so a {org} template would
#                 produce wrong Icelandic. Stored once per org and reused by
#                 every project; falls back to `name` when empty.
#
#   Project_organization + phrase_is / phrase_en
#                 Per-link override for wording the template cannot reach.
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

# Seed a catalogue row by its stable key, never by id.
ensure_role() {
  local key="$1" payload="$2"
  local n; n=$(curl -s "${AUTH[@]}" "$URL/items/ProjectRole?filter%5Bkey%5D%5B_eq%5D=$key&aggregate%5Bcount%5D=id" | grep -oE '[0-9]+' | head -1)
  if [ "${n:-0}" != "0" ]; then echo "  role $key exists — skipping."; return; fi
  echo "  seeding role $key…"
  curl -fsS "${AUTH[@]}" "$URL/items/ProjectRole" -d "$payload" >/dev/null
}

echo "ProjectRole — tiers and wording"
add_field ProjectRole tier '{
  "field": "tier", "type": "string",
  "meta": { "interface": "select-dropdown", "width": "half",
            "note": "Sponsor level. Ordering and grouping come from this, not from sort.",
            "options": { "choices": [
              { "text": "Gold", "value": "gold" },
              { "text": "Silver", "value": "silver" },
              { "text": "Bronze", "value": "bronze" } ] } },
  "schema": {}
}'
add_field ProjectRole is_sponsor '{
  "field": "is_sponsor", "type": "boolean",
  "meta": { "interface": "boolean", "width": "half",
            "note": "Show under Sponsors rather than with plain connections." },
  "schema": { "default_value": false }
}'
add_field ProjectRole phrase_is '{
  "field": "phrase_is", "type": "string",
  "meta": { "interface": "input",
            "note": "Icelandic wording. {org} = name, {org_dative} = declined form (Grósku). E.g. Með stuðningi frá {org_dative}" },
  "schema": {}
}'
add_field ProjectRole phrase_en '{
  "field": "phrase_en", "type": "string",
  "meta": { "interface": "input",
            "note": "English wording. {org} = name. E.g. With support from {org}" },
  "schema": {}
}'

echo "organization — Icelandic dative"
add_field organization name_dative_is '{
  "field": "name_dative_is", "type": "string",
  "meta": { "interface": "input", "width": "half",
            "note": "Icelandic dative of the name — Gróska → Grósku. Used by phrases like \"Með stuðningi frá …\". Leave empty to use the plain name." },
  "schema": {}
}'

echo "Project_organization — per-link wording override"
add_field Project_organization phrase_is '{
  "field": "phrase_is", "type": "string",
  "meta": { "interface": "input",
            "note": "Overrides the role template for this link only. Full sentence, no placeholders." },
  "schema": {}
}'
add_field Project_organization phrase_en '{
  "field": "phrase_en", "type": "string",
  "meta": { "interface": "input", "note": "English override for this link only." },
  "schema": {}
}'

echo "Seeding roles"
ensure_role gold_sponsor '{
  "key": "gold_sponsor", "label": "Gold sponsor", "applies_to": "org",
  "tier": "gold", "is_sponsor": true, "color": "#C8A227",
  "phrase_is": "Í samstarfi við {org}", "phrase_en": "In partnership with {org}", "sort": 1
}'
ensure_role silver_sponsor '{
  "key": "silver_sponsor", "label": "Silver sponsor", "applies_to": "org",
  "tier": "silver", "is_sponsor": true, "color": "#9AA3AD",
  "phrase_is": "Í samstarfi við {org}", "phrase_en": "In partnership with {org}", "sort": 2
}'
ensure_role bronze_sponsor '{
  "key": "bronze_sponsor", "label": "Bronze sponsor", "applies_to": "org",
  "tier": "bronze", "is_sponsor": true, "color": "#A9722E",
  "phrase_is": "Með stuðningi frá {org_dative}", "phrase_en": "With support from {org}", "sort": 3
}'
# "Other" rather than a named level: this bucket is where everything that is
# not a gold/silver/bronze sponsor lands — support, a venue, an advisory seat —
# so the label must not promise one particular kind of relationship.
ensure_role other '{
  "key": "other", "label": "Other", "applies_to": "org",
  "is_sponsor": true, "color": "#5F6B7A",
  "phrase_is": "Með stuðningi frá {org_dative}", "phrase_en": "With support from {org}", "sort": 4
}'
ensure_role advisory_board '{
  "key": "advisory_board", "label": "Advisory board", "applies_to": "both",
  "color": "#6B5ADB", "sort": 5
}'
ensure_role owner '{
  "key": "owner", "label": "Owner", "applies_to": "org",
  "color": "#1D6BFE", "sort": 6
}'

echo
echo "Done. Sponsors appear on a project once you add an org with one of these roles."
