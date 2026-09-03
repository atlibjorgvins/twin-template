#!/usr/bin/env bash
# Add rebrand/merge tracking to the organization collection.
#   - previous_names  free-text list of former public names ("Borgun hf., Salt Pay")
#   - successor_id    M2O → organization, set on the *predecessor* row when a
#                     row is merged into another (kept on archived sources for
#                     traceability; current rows leave it null).
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

add_field() {
  local name="$1" payload="$2"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/fields/organization/$name")
  if [ "$code" = "200" ]; then
    echo "  field organization.$name exists — skipping."
    return
  fi
  echo "  adding field organization.$name…"
  curl -fsS "${AUTH[@]}" "$URL/fields/organization" -d "$payload" >/dev/null
}

ensure_relation() {
  local field="$1" related="$2" on_delete="${3:-SET NULL}"
  local have
  have=$(curl -s "${AUTH[@]}" "$URL/relations/organization/$field" | grep -o "\"collection\":\"organization\"" | head -1 || true)
  if [ -n "$have" ]; then
    echo "  relation organization.$field exists — skipping."
    return
  fi
  echo "  creating relation organization.$field → $related (on_delete=$on_delete)…"
  curl -fsS "${AUTH[@]}" "$URL/relations" -d "{
    \"collection\": \"organization\",
    \"field\": \"$field\",
    \"related_collection\": \"$related\",
    \"schema\": { \"on_delete\": \"$on_delete\" }
  }" >/dev/null
}

echo "Extending organization…"

add_field "previous_names" '{
  "field": "previous_names", "type": "text",
  "meta": {
    "interface": "input-multiline",
    "note": "Comma-separated list of former public names (e.g. \"Borgun hf., Salt Pay\"). Surfaces in search."
  }
}'

add_field "successor_id" '{
  "field": "successor_id", "type": "integer",
  "meta": {
    "interface": "select-dropdown-m2o", "special": ["m2o"],
    "options": { "template": "{{name}}" },
    "display": "related-values",
    "display_options": { "template": "{{name}}" },
    "note": "When this row was merged into another, points at the survivor. Otherwise null.",
    "width": "half"
  },
  "schema": { "is_nullable": true }
}'

ensure_relation "successor_id" "organization" "SET NULL"

echo "Done."
