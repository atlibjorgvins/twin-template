#!/usr/bin/env bash
# Project.brand_font — the one piece of a brand the card could not state.
#
# The Brand card already carries logo roles and colour roles, and both are
# inheritable down the project tree. Typography was missing entirely, so
# "what font is this brand" had no answer anywhere in twin — which is a
# problem the moment you try to hand the brand to someone else.
#
# One free-text field rather than a font picker: a brand's type is
# "Inter", or "Söhne / Inter fallback", or "Национальный" — a list would be
# wrong within a week, and the value's job is to be read by a person.
#
# Nullable and inheritable, exactly like brand_primary: a sub-project with
# no value falls back to the nearest ancestor that has one.
#
# Additive and idempotent — safe to re-run.
set -eo pipefail

# TWIN_ENV_FILE picks the instance: `.env` (personal) or `.env.klak`.
# A name relative to the repo root, so it reads the same from anywhere.
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/${TWIN_ENV_FILE:-.env}"
eval "$(grep -E '^(PUBLIC_DIRECTUS_URL|PUBLIC_DIRECTUS_TOKEN|DIRECTUS_ADMIN_URL)=' "$ENV_FILE" | sed 's/^/export /')"
# Schema tooling talks to Directus directly; the app-facing URL may be a
# same-origin path (/api) that only resolves in a browser. DIRECTUS_ADMIN_URL
# is the absolute URL for out-of-browser callers; fall back to the public one
# when it is absolute (KLAK, pre-/api setups).
URL="${DIRECTUS_ADMIN_URL:-$PUBLIC_DIRECTUS_URL}"; URL="${URL%/}"; TOKEN="$PUBLIC_DIRECTUS_TOKEN"
AUTH=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

add_field() {
  local coll="$1" name="$2" payload="$3"
  local code; code=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/fields/$coll/$name")
  if [ "$code" = "200" ]; then echo "  field $coll.$name exists — skipping."; return; fi
  echo "  adding field $coll.$name…"; curl -fsS "${AUTH[@]}" "$URL/fields/$coll" -d "$payload" >/dev/null
}

echo "▶ Project.brand_font"
add_field Project brand_font '{
  "field": "brand_font", "type": "string",
  "schema": { "is_nullable": true },
  "meta": {
    "interface": "input",
    "note": "Typeface name as a person would say it (e.g. \"Inter\", \"Söhne / Inter fallback\"). Inherits down the project tree like the colour roles."
  }
}'

echo "✔ brand font ready."
