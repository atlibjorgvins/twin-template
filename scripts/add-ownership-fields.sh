#!/usr/bin/env bash
# user_created on the personal-layer collections — the ownership boundary for
# the member role (docs/phase2-auth.md §3).
#
# Why this, and why now:
#
#   In session mode the member policy filters these collections by
#   `user_created = $CURRENT_USER`, so each user sees only their own rows. The
#   field is a Directus SPECIAL field ("user-created"): Directus stamps the
#   creating user automatically, so nothing in the app has to set it and there
#   is no backfill.
#
#   The fail-safe is that NULL means owner-only. Every existing row has no
#   user_created, so after this runs they are invisible to members until someone
#   deliberately shares them — the worst case is "a member can't see X", never
#   "a member can read your calendar". That is why this is safe to run before
#   the member policy exists and before the flag is on: with no member users and
#   static-token mode, the field is inert.
#
#   Dates and notes already have user_created (from earlier work), so they are
#   not listed here — this adds it to the 24 that lack it.
#
# Idempotent — safe to re-run. Additive only; touches no data.
set -eo pipefail

# TWIN_ENV_FILE picks the instance: `.env` (personal) or `.env.klak`.
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/${TWIN_ENV_FILE:-.env}"
eval "$(grep -E '^(PUBLIC_DIRECTUS_URL|PUBLIC_DIRECTUS_TOKEN|DIRECTUS_ADMIN_URL)=' "$ENV_FILE" | sed 's/^/export /')"
# Schema tooling talks to Directus directly; the app-facing URL may be a
# same-origin path (/api). DIRECTUS_ADMIN_URL is the absolute URL for
# out-of-browser callers; fall back to the public one when it is absolute.
URL="${DIRECTUS_ADMIN_URL:-$PUBLIC_DIRECTUS_URL}"; URL="${URL%/}"
TOKEN="$PUBLIC_DIRECTUS_TOKEN"
AUTH=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

add_owner_field() {
  local coll="$1"
  local code; code=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/fields/$coll/user_created")
  if [ "$code" = "200" ]; then echo "  $coll.user_created exists — skipping."; return; fi
  # Nullable uuid m2o to directus_users, stamped on create by the special.
  # on_delete SET NULL so deleting a user does not cascade-delete their rows —
  # NULL then reads as owner-only, which is the correct fallback.
  local code2; code2=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/fields/$coll" -d '{
    "field": "user_created",
    "type": "uuid",
    "meta": {
      "special": ["user-created"],
      "interface": "select-dropdown-m2o",
      "readonly": true,
      "hidden": true,
      "width": "half"
    },
    "schema": {
      "is_nullable": true,
      "foreign_key_table": "directus_users",
      "foreign_key_column": "id",
      "on_delete": "SET NULL"
    }
  }')
  if [ "$code2" = "200" ] || [ "$code2" = "204" ]; then
    echo "  $coll.user_created added."
  else
    echo "  ✗ $coll.user_created FAILED (HTTP $code2)"; exit 1
  fi
}

echo "▶ Adding user_created to the personal-layer collections"
for coll in \
  finance_txn finance_budget finance_rule finance_settlement finance_receipt \
  focus_task focus_session \
  habit habit_entry \
  food_order \
  ai_vault ai_key ai_task_binding ai_usage \
  shopping_list shopping_line \
  Person_family \
  Activity Activity_Person Activity_organization Activity_tag \
  prompt prompt_tag prompt_project \
  weekly_summary
do
  add_owner_field "$coll"
done

echo "✓ Ownership fields ready. NULL = owner-only until a row is deliberately shared."
