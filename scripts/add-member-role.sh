#!/usr/bin/env bash
# The `member` role and policy — session mode's non-owner tenant.
# Design: docs/phase2-auth.md §2–§3.
#
# The rule, in one line: members read and write the shared ecosystem graph, and
# see only their own rows in the personal layer.
#
# SAFETY MODEL — default-deny. A Directus policy grants nothing until a
# permission row says otherwise, so a collection this script forgets is
# INVISIBLE to members. That is the safe failure: the worst case of an omission
# is "a member can't see something", never "a member can see someone's private
# data". Every collection is therefore assigned explicitly below; anything new
# added to the schema later is denied to members until someone lists it.
#
# The personal layer is filtered by `user_created = $CURRENT_USER` — combined
# with the NULL-is-owner-only fact (add-ownership-fields.sh), existing rows stay
# private with no backfill.
#
# Idempotent — safe to re-run. Creates the policy/role and their permission
# rows; touches no existing policy and no data.
set -eo pipefail

ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/${TWIN_ENV_FILE:-.env}"
eval "$(grep -E '^(PUBLIC_DIRECTUS_URL|PUBLIC_DIRECTUS_TOKEN|DIRECTUS_ADMIN_URL)=' "$ENV_FILE" | sed 's/^/export /')"
URL="${DIRECTUS_ADMIN_URL:-$PUBLIC_DIRECTUS_URL}"; URL="${URL%/}"
TOKEN="$PUBLIC_DIRECTUS_TOKEN"
AUTH=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

# ── Shared: every authenticated user reads and writes, no row filter. ────────
# The ecosystem graph and everything that hangs off it. Curation is collective.
SHARED=(
  organization organization_tag organization_social organization_photo
  organization_location organization_accounts org_suggestion
  Person Person_tag Person_organization Person_accounts Person_education
  Person_language Person_relations Person_email person_social person_location
  Project Project_people Project_organization Project_tag ProjectRole
  project_brand_asset
  Grant GrantAward GrantAwardPayment grants
  Tag Domain Subdomain location PhotoType ActivityKind type
  event event_date event_org event_person event_photo event_platform_link
  CalendarMapping Dates_Person Dates_attachments Dates_attendees Dates_files
  Dates_shared_with
  EmailGroup EmailGroup_Person
  photo_link photo_person
  posting_identity buffer_channel meta_channel screencloud_channel
  brand_element brand_font_face brand_logo_asset brand_palette_color
  campaign campaign_post
  mk_ad mk_ad_account mk_ad_set mk_budget mk_campaign mk_campaign_tag
  mk_manual_spend mk_medium mk_meta_campaign mk_meta_campaign_event
  mk_metric mk_metric_breakdown mk_template
  asana_project_link entity_link hashtags notes_hashtags notes_linked_notes
  notes_related_to notes_tag awards service_key
  ecosystem_benchmark ecosystem_dimension
  Bifrost bifrost bifrost_campaign_ads bifrost_campaign_metrics bifrost_campaigns
  bifrost_departments bifrost_programs
  generated_image image_template receipt_merchant_alias
  plugin_sync
)

# ── Personal: read+write filtered to the current user's own rows. ────────────
PERSONAL=(
  Dates notes
  finance_txn finance_budget finance_rule finance_settlement finance_receipt
  focus_task focus_session
  habit habit_entry food_order
  ai_vault ai_key ai_task_binding ai_usage
  shopping_list shopping_line
  Person_family
  Activity Activity_Person Activity_organization Activity_tag
  prompt prompt_tag prompt_project
  weekly_summary
)

# ── Explicitly NOT granted (documented so the omission is a decision, not a
#    gap). Members never touch these; they stay owner-only.
#      account_members accounts   — the owner's linked external accounts
#
# directus_files IS granted below (see the "System" block). It is the one system
# collection the app can't work without: every image upload — org logos, person
# avatars, receipts, ad creatives — is POST /files. When daily use moved off the
# admin static token onto the owner role, files had no permission on that policy
# and every upload 403'd. Other directus_* system collections stay out of scope.

get_id() { # collection, filter → first id or empty
  curl -s -g "${AUTH[@]}" "$URL/$1?filter$2&limit=1&fields=id" \
    | python3 -c "import sys,json; d=json.load(sys.stdin).get('data',[]); print(d[0]['id'] if d else '')"
}

echo "▶ Policy"
POLICY_ID=$(get_id policies '[name][_eq]=member')
if [ -z "$POLICY_ID" ]; then
  POLICY_ID=$(curl -fsS "${AUTH[@]}" "$URL/policies" -d '{
    "name": "member",
    "icon": "person",
    "description": "Signed-in non-owner: reads/writes the shared graph, owns only their own personal rows.",
    "admin_access": false,
    "app_access": true
  }' | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")
  echo "  created policy member ($POLICY_ID)"
else
  echo "  policy member exists ($POLICY_ID) — reusing"
fi

echo "▶ Role"
ROLE_ID=$(get_id roles '[name][_eq]=member')
if [ -z "$ROLE_ID" ]; then
  ROLE_ID=$(curl -fsS "${AUTH[@]}" "$URL/roles" -d '{
    "name": "member",
    "icon": "group",
    "description": "twin member — see docs/phase2-auth.md."
  }' | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")
  echo "  created role member ($ROLE_ID)"
else
  echo "  role member exists ($ROLE_ID) — reusing"
fi
# attach the policy to the role (m2m directus_access), idempotently
ACCESS=$(curl -s -g "${AUTH[@]}" "$URL/access?filter[role][_eq]=$ROLE_ID&filter[policy][_eq]=$POLICY_ID&limit=1&fields=id" \
  | python3 -c "import sys,json; d=json.load(sys.stdin).get('data',[]); print(d[0]['id'] if d else '')")
if [ -z "$ACCESS" ]; then
  curl -fsS "${AUTH[@]}" "$URL/access" -d "{\"role\":\"$ROLE_ID\",\"policy\":\"$POLICY_ID\"}" >/dev/null
  echo "  linked policy → role"
else
  echo "  policy already linked to role"
fi

# The OWNER role — the operator's DAILY account, distinct from Administrator.
# It shares the member policy exactly: reads/writes the shared graph, owns only
# its own personal rows. The point (docs/phase2-auth.md §2) is that the operator
# does NOT browse as admin, because admin bypasses the permission layer and
# would see everyone's private rows. Same policy as member today; a separate
# role so it can diverge later (e.g. member-management rights) without touching
# what a member can do.
echo "▶ Owner role"
OWNER_ROLE_ID=$(get_id roles '[name][_eq]=owner')
if [ -z "$OWNER_ROLE_ID" ]; then
  OWNER_ROLE_ID=$(curl -fsS "${AUTH[@]}" "$URL/roles" -d '{
    "name": "owner",
    "icon": "shield_person",
    "description": "The operator, day-to-day. Same access as member; NOT admin — see docs/phase2-auth.md §2."
  }' | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")
  echo "  created role owner ($OWNER_ROLE_ID)"
else
  echo "  role owner exists ($OWNER_ROLE_ID) — reusing"
fi
OWNER_ACCESS=$(curl -s -g "${AUTH[@]}" "$URL/access?filter[role][_eq]=$OWNER_ROLE_ID&filter[policy][_eq]=$POLICY_ID&limit=1&fields=id"   | python3 -c "import sys,json; d=json.load(sys.stdin).get('data',[]); print(d[0]['id'] if d else '')")
if [ -z "$OWNER_ACCESS" ]; then
  curl -fsS "${AUTH[@]}" "$URL/access" -d "{\"role\":\"$OWNER_ROLE_ID\",\"policy\":\"$POLICY_ID\"}" >/dev/null
  echo "  linked policy → owner role"
else
  echo "  policy already linked to owner role"
fi

# One permission row per (collection, action). Idempotent: skip if a row for
# this policy+collection+action already exists.
grant() { # collection, action, permissions-json
  local coll="$1" action="$2" perms="$3"
  local existing
  existing=$(curl -s -g "${AUTH[@]}" \
    "$URL/permissions?filter[policy][_eq]=$POLICY_ID&filter[collection][_eq]=$coll&filter[action][_eq]=$action&limit=1&fields=id" \
    | python3 -c "import sys,json; d=json.load(sys.stdin).get('data',[]); print(d[0]['id'] if d else '')")
  [ -n "$existing" ] && return
  curl -fsS "${AUTH[@]}" "$URL/permissions" -d "{
    \"policy\": \"$POLICY_ID\", \"collection\": \"$coll\", \"action\": \"$action\",
    \"permissions\": $perms, \"fields\": [\"*\"]
  }" >/dev/null
}

echo "▶ Shared collections (read + write, no filter): ${#SHARED[@]}"
for coll in "${SHARED[@]}"; do
  for action in create read update delete; do grant "$coll" "$action" '{}'; done
done

echo "▶ Personal collections (own rows only): ${#PERSONAL[@]}"
OWN='{ "user_created": { "_eq": "$CURRENT_USER" } }'
for coll in "${PERSONAL[@]}"; do
  # create is unfiltered (Directus stamps user_created); read/update/delete are
  # scoped to the current user's rows.
  grant "$coll" create '{}'
  for action in read update delete; do grant "$coll" "$action" "$OWN"; done
done

# directus_files — the asset store. A system collection (outside the SHARED /
# PERSONAL data loops), but uploads are POST /files and the owner/member role
# must be allowed to create/read/update/delete files or every image upload 403s.
# Full access, no filter: files carry no user_created ownership and this is a
# single-operator instance. Mirrors the twin-app policy's file grants.
echo "▶ System: directus_files (asset uploads — org logos, avatars, receipts)"
for action in create read update delete; do grant directus_files "$action" '{}'; done

echo "✓ member role ready. Default-deny: any collection not listed above is invisible to members."
