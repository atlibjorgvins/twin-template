#!/usr/bin/env bash
# One-off: add `is_active` boolean to the organization collection.
# Default = true, so existing rows pass the default "hide inactive" filter.
# Idempotent.
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
AUTH=(-H "Authorization: Bearer $PUBLIC_DIRECTUS_TOKEN" -H "Content-Type: application/json")

# Skip if the field already exists.
code=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/fields/organization/is_active")
if [ "$code" = "200" ]; then
  echo "✓ organization.is_active already exists — skipping."
else
  echo "Creating organization.is_active…"
  curl -fsS "${AUTH[@]}" "$URL/fields/organization" -d '{
    "field": "is_active",
    "type": "boolean",
    "schema": { "default_value": true, "is_nullable": false },
    "meta": {
      "interface": "boolean",
      "special": ["cast-boolean"],
      "display": "boolean",
      "width": "half",
      "note": "Is this organization still operating? Inactive orgs are hidden from the default list view but kept in the database."
    }
  }' >/dev/null
  echo "  created."
fi

# Backfill any rows that have NULL is_active (shouldn't happen with the
# default, but be defensive in case the field was added without a default).
echo "Backfilling NULL is_active rows to true…"
# Use _null filter so we only touch the small NULL-population set.
backfill_count=$(curl -s "${AUTH[@]}" "$URL/items/organization?fields=id&filter[is_active][_null]=true&limit=-1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('data',[])))" 2>/dev/null || echo "0")
echo "  $backfill_count rows had NULL is_active."
if [ "$backfill_count" -gt 0 ]; then
  # Patch them all in one batch via the items endpoint with a query filter.
  curl -fsS "${AUTH[@]}" -X PATCH "$URL/items/organization?filter[is_active][_null]=true" \
    -d '{ "is_active": true }' >/dev/null
  echo "  backfilled."
fi

echo "Done."
