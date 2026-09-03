#!/usr/bin/env bash
# Append "Rebranded" to the lifecycle_status dropdown choices on
# organization. Idempotent — uses PATCH on the field meta. Distinct
# from "Merged": same legal entity, new identity, old row stays
# around (with successor_id pointing at the new identity) so the
# history is preserved.
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

echo "▶ Updating organization.lifecycle_status choices…"
curl -fsS -X PATCH "${AUTH[@]}" "$URL/fields/organization/lifecycle_status" -d '{
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
        { "text": "Rebranded",     "value": "rebranded",   "foreground": "#FFFFFF", "background": "#0EA5A5" },
        { "text": "Dissolved",     "value": "dissolved",   "foreground": "#FFFFFF", "background": "#5C6B7A" },
        { "text": "Bankrupt",      "value": "bankrupt",    "foreground": "#FFFFFF", "background": "#D44A6B" }
      ]
    },
    "note": "Real-world lifecycle of the org (richer than is_active). Leave blank for unknown."
  }
}' >/dev/null
echo "✓ Done."
