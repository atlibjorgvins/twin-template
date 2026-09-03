#!/usr/bin/env bash
# `brand_standalone` on Project and organization — "this brand is its own".
#
# Brand inheritance is a walk: for each field, the first non-empty value found
# going up the parent chain wins. That has no way to express "we deliberately
# have no logo yet" — an empty field is indistinguishable from an unset one, so
# clearing everything to start a brand from scratch silently re-inherits the
# parent's. This flag stops the walk at depth 0.
#
# Set by the brand editor when you choose "Start from scratch" or "Start from
# <parent>'s" — both detach; the difference is only whether the parent's values
# are copied in first.
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
URL="${DIRECTUS_ADMIN_URL:-$PUBLIC_DIRECTUS_URL}"; URL="${URL%/}"; TOKEN="$PUBLIC_DIRECTUS_TOKEN"
AUTH=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

add_field() { local co="$1" na="$2" pa="$3"; local c; c=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/fields/$co/$na"); if [ "$c" = "200" ]; then echo "  field $co.$na exists — skipping."; return; fi; echo "  adding $co.$na…"; curl -fsS "${AUTH[@]}" "$URL/fields/$co" -d "$pa" >/dev/null; }

PAYLOAD='{
  "field": "brand_standalone",
  "type": "boolean",
  "meta": {
    "interface": "boolean",
    "special": ["cast-boolean"],
    "width": "half",
    "note": "This brand is its own — do not inherit anything from the parent. Set by the brand editor when you start a brand from scratch or take a copy."
  },
  "schema": { "default_value": false }
}'

for c in Project organization; do
  echo "▶ $c"
  add_field "$c" brand_standalone "$PAYLOAD"
done

echo "✔ done — brand_standalone ready on both collections."
