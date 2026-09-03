#!/usr/bin/env bash
# Photo navigator — let photo_link also tag Events (happenings).
#
# The collection field is a plain string (the DB doesn't enforce the
# choices), so this only widens the admin dropdown to include Event for
# self-documentation. The app already writes collection="event" through
# src/lib/photos/explore.ts.
#
# Idempotent — PATCHes the field to the full choice list every run.
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

echo "▶ photo_link.collection — add Event choice"
curl -fsS -X PATCH "${AUTH[@]}" "$URL/fields/photo_link/collection" -d '{
  "meta": { "interface": "select-dropdown",
    "options": { "choices": [
      { "text": "Organization", "value": "organization" },
      { "text": "Project", "value": "Project" },
      { "text": "Person", "value": "Person" },
      { "text": "Event", "value": "event" }
    ] } }
}' >/dev/null
echo "✓ done."
