#!/usr/bin/env bash
# Adds a `nickname` field to Person. Short label for what someone
# actually goes by ("Dóri" for Halldór, "Bibba" for Hólmfríður, etc.),
# distinct from preferred_name which we don't track yet. Idempotent.
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

code=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/fields/Person/nickname")
if [ "$code" = "200" ]; then
  echo "  Person.nickname already exists — skipping."
  exit 0
fi

echo "▶ Adding Person.nickname…"
curl -fsS "${AUTH[@]}" "$URL/fields/Person" -d '{
  "field": "nickname",
  "type": "string",
  "schema": { "max_length": 64, "is_nullable": true },
  "meta": {
    "interface": "input",
    "note": "Short label for what this person actually goes by — \"Dóri\" for Halldór, \"Bibba\" for Hólmfríður, etc. Shown next to the name in search results and on the detail page.",
    "sort": 6
  }
}' >/dev/null
echo "✓ Done."
