#!/usr/bin/env bash
# Lock the organization.industry field in Directus to the canonical select
# list, so the admin UI can no longer accept free text.
#
# Run AFTER `node scripts/migrate-org-industries.mjs --apply`.
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

curl -fsS "${AUTH[@]}" -X PATCH "$URL/fields/organization/industry" -d '{
  "meta": {
    "interface": "select-dropdown",
    "display": "labels",
    "options": {
      "choices": [
        {"text":"Accommodation Services","value":"accommodation"},
        {"text":"Administrative & Support Services","value":"administrative"},
        {"text":"Construction","value":"construction"},
        {"text":"Consumer Services","value":"consumer_services"},
        {"text":"Education","value":"education"},
        {"text":"Entertainment Providers","value":"entertainment"},
        {"text":"Farming & Forestry","value":"farming_forestry"},
        {"text":"Financial Services","value":"financial_services"},
        {"text":"Fisheries & Aquaculture","value":"fisheries"},
        {"text":"Government Administration","value":"government"},
        {"text":"Hospitals & Health Care","value":"healthcare"},
        {"text":"Manufacturing","value":"manufacturing"},
        {"text":"Oil, Gas & Mining","value":"oil_gas_mining"},
        {"text":"Professional Services","value":"professional_services"},
        {"text":"Real Estate","value":"real_estate"},
        {"text":"Retail","value":"retail"},
        {"text":"Technology, Information & Media","value":"technology"},
        {"text":"Transportation & Logistics","value":"transportation"},
        {"text":"Utilities","value":"utilities"},
        {"text":"Wholesale","value":"wholesale"}
      ],
      "allowOther": false
    }
  }
}' >/dev/null

echo "✓ organization.industry is now a select-dropdown with 20 canonical options."
