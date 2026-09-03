#!/usr/bin/env bash
# Adds a self-referencing `parent_id` field to Project so projects can
# nest into arbitrarily deep hierarchies.
#
#   University of Reykjavík   ← top-level
#     └ IB700 Strategy        ← child
#         └ 2026 cohort       ← grandchild
#
# Soft FK with on_delete = SET NULL — deleting a parent leaves its
# children intact (they just become top-level rows you can re-parent
# from the UI).
#
# Idempotent: skips field + relation creation if they already exist.
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

relation_exists() {
  local coll="$1" field="$2"
  local have
  have=$(curl -s "${AUTH[@]}" "$URL/relations/$coll/$field" | grep -o "\"collection\":\"$coll\"" | head -1 || true)
  [ -n "$have" ]
}

echo "▶ Adding Project.parent_id (M2O → Project)…"

if field_exists "Project" "parent_id"; then
  echo "  field Project.parent_id already exists — skipping field create."
else
  curl -fsS "${AUTH[@]}" "$URL/fields/Project" -d '{
    "field": "parent_id",
    "type": "integer",
    "schema": { "is_nullable": true },
    "meta": {
      "interface": "select-dropdown-m2o",
      "special": ["m2o"],
      "options": {
        "template": "{{name}}",
        "enableCreate": false
      },
      "display": "related-values",
      "display_options": { "template": "{{name}}" },
      "note": "Parent project — leave empty for top-level rows (e.g. University of Reykjavík). Deleting a parent leaves children intact.",
      "sort": 12
    }
  }' >/dev/null
  echo "  Project.parent_id created."
fi

if relation_exists "Project" "parent_id"; then
  echo "  relation Project.parent_id → Project exists — skipping relation create."
else
  curl -fsS "${AUTH[@]}" "$URL/relations" -d '{
    "collection": "Project",
    "field": "parent_id",
    "related_collection": "Project",
    "schema": { "on_delete": "SET NULL" }
  }' >/dev/null
  echo "  relation Project.parent_id → Project created."
fi

echo "✓ Done."
