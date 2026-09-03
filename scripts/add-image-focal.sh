#!/usr/bin/env bash
# Add image_focal (CSS object-position string, e.g. "50% 30%") to Person and
# organization. Lets the UI reposition crops without re-uploading.
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
  local coll="$1" name="$2" payload="$3"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/fields/$coll/$name")
  if [ "$code" = "200" ]; then
    echo "  field $coll.$name exists — skipping."
    return
  fi
  echo "  adding field $coll.$name…"
  curl -fsS "${AUTH[@]}" "$URL/fields/$coll" -d "$payload" >/dev/null
}

PAYLOAD='{
  "field": "image_focal", "type": "string",
  "meta": {
    "interface": "input", "width": "half",
    "note": "CSS object-position for the avatar/logo (e.g. 50% 30%). Set via the UI."
  }
}'

for COLL in Person organization; do
  echo "Adding image_focal to $COLL…"
  add_field "$COLL" "image_focal" "$PAYLOAD"
done

echo "Done."
