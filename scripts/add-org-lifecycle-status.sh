#!/usr/bin/env bash
# Adds `lifecycle_status` to organization — a richer lifecycle field
# than the existing boolean `is_active`. Tracks where a real-world
# org is in its life-cycle (active, dormant, dissolved, acquired,
# merged, etc.) which matters when you follow startups across years.
#
# Existing `is_active` is left in place — it stays the canonical
# yes/no "currently operating" flag (and the /orgs index toggle still
# uses it). `lifecycle_status` is the more nuanced overlay.
#
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
TOKEN="$PUBLIC_DIRECTUS_TOKEN"
AUTH=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

field_exists() {
  local coll="$1" field="$2"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/fields/$coll/$field")
  [ "$code" = "200" ]
}

if field_exists "organization" "lifecycle_status"; then
  echo "  organization.lifecycle_status exists — skipping."
else
  echo "▶ Adding organization.lifecycle_status…"
  curl -fsS "${AUTH[@]}" "$URL/fields/organization" -d '{
    "field": "lifecycle_status",
    "type": "string",
    "schema": { "max_length": 32, "is_nullable": true },
    "meta": {
      "interface": "select-dropdown",
      "display": "labels",
      "options": {
        "choices": [
          { "text": "Active",        "value": "active",      "foreground": "#FFFFFF", "background": "#3F8A5F" },
          { "text": "Pre-launch",    "value": "pre_launch",  "foreground": "#FFFFFF", "background": "#6B5ADB" },
          { "text": "Pivoting",      "value": "pivoting",    "foreground": "#FFFFFF", "background": "#C6762A" },
          { "text": "Dormant",       "value": "dormant",     "foreground": "#FFFFFF", "background": "#7A8593" },
          { "text": "Acquired",      "value": "acquired",    "foreground": "#FFFFFF", "background": "#1D6BFE" },
          { "text": "Merged",        "value": "merged",      "foreground": "#FFFFFF", "background": "#9C4DCC" },
          { "text": "Dissolved",     "value": "dissolved",   "foreground": "#FFFFFF", "background": "#5C6B7A" },
          { "text": "Bankrupt",      "value": "bankrupt",    "foreground": "#FFFFFF", "background": "#D44A6B" }
        ]
      },
      "note": "Real-world lifecycle of the org (richer than is_active). Leave blank for unknown.",
      "sort": 17
    }
  }' >/dev/null
  echo "  organization.lifecycle_status created."
fi

echo "✓ Done."
