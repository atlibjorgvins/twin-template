#!/usr/bin/env bash
# Project membership tenure — track WHEN a person was active in a
# project, mirroring Person_organization (Role) which already has
# start_date/end_date/is_current. Lets a cohort keep its alumni linked
# (history) while distinguishing who is currently active, so new
# members aren't lumped in with a past cohort and former members stay
# connected.
#
#   Project_people.start_date   When they joined / became active.
#   Project_people.end_date     When they left (null = still active).
#   Project_people.is_current   Active member now vs. former/alumnus.
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

echo "▶ Project_people tenure fields"
add_field Project_people start_date '{
  "field": "start_date", "type": "date",
  "meta": { "interface": "datetime", "width": "half",
    "note": "When this person became active in the project." },
  "schema": {}
}'
add_field Project_people end_date '{
  "field": "end_date", "type": "date",
  "meta": { "interface": "datetime", "width": "half",
    "note": "When they left — empty means still active." },
  "schema": {}
}'
add_field Project_people is_current '{
  "field": "is_current", "type": "boolean",
  "meta": { "interface": "boolean", "width": "half",
    "note": "Active member now vs. former/alumnus (kept linked either way)." },
  "schema": { "default_value": true }
}'

echo "✓ done."
