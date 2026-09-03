#!/usr/bin/env bash
# Adds a `color` field to Project — a curated palette swatch the UI
# binds to. Stored as a hex string ("#2C8C99") so it round-trips into
# inline style attributes without translation, and is forward-compat
# if we ever decide to drop the curated palette and accept any hex.
#
# Idempotent: skips creation if the field already exists.
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

field_exists() {
  local coll="$1" field="$2"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/fields/$coll/$field")
  [ "$code" = "200" ]
}

echo "▶ Adding Project.color (varchar)…"

if field_exists "Project" "color"; then
  echo "  field Project.color already exists — skipping."
else
  curl -fsS "${AUTH[@]}" "$URL/fields/Project" -d '{
    "field": "color",
    "type": "string",
    "schema": { "max_length": 16, "is_nullable": true },
    "meta": {
      "interface": "select-color",
      "display": "color",
      "note": "Optional accent colour for the project hero and breadcrumbs. Suggested for top-level projects; children can inherit from their ancestor.",
      "sort": 13
    }
  }' >/dev/null
  echo "  Project.color created."
fi

echo "✓ Done."
