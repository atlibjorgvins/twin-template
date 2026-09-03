#!/usr/bin/env bash
# Transitive (upward) project membership.
#
# When a person/org is a direct member of a subproject, they are also
# materialised as *inherited* members of every ancestor project up the
# `parent_id` chain. `inherited_from_project_id` marks such rows and points
# at a descendant subproject that justifies the link (null = direct member).
#
#   Project_people.inherited_from_project_id        → Project (M2O, nullable)
#   Project_organization.inherited_from_project_id  → Project (M2O, nullable)
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
ensure_relation() {
  local coll="$1" field="$2" related="$3" ondel="${4:-SET NULL}"
  local have; have=$(curl -s "${AUTH[@]}" "$URL/relations/$coll/$field" | grep -o "\"collection\":\"$coll\"" | head -1 || true)
  if [ -n "$have" ]; then echo "  relation $coll.$field exists — skipping."; return; fi
  echo "  creating relation $coll.$field → $related ($ondel)…"
  curl -fsS "${AUTH[@]}" "$URL/relations" -d "{
    \"collection\": \"$coll\", \"field\": \"$field\", \"related_collection\": \"$related\",
    \"schema\": { \"on_delete\": \"$ondel\" }
  }" >/dev/null
}

FIELD_PAYLOAD='{
  "field": "inherited_from_project_id",
  "type": "integer",
  "schema": { "is_nullable": true },
  "meta": {
    "interface": "select-dropdown-m2o",
    "special": ["m2o"],
    "note": "Non-null = inherited membership rolled up from this descendant subproject. Null = direct member.",
    "options": { "template": "{{name}}" }
  }
}'

for COLL in Project_people Project_organization; do
  echo "$COLL:"
  add_field "$COLL" "inherited_from_project_id" "$FIELD_PAYLOAD"
  # on_delete SET NULL: if the source subproject is deleted the inherited
  # row survives as an orphan pointer; a reconcile/backfill run then removes
  # it. (CASCADE would be wrong — the row may be justified by siblings.)
  ensure_relation "$COLL" "inherited_from_project_id" "Project" "SET NULL"
done

echo "Done."
