#!/usr/bin/env bash
# Evergreen batching — one Continue creates the whole batch (teams ×
# platforms), each platform can use its own Studio template, and the
# batch can be queued into Buffer in one click, spread across a
# timeframe.
#
#   campaign.image_templates    json {facebook: <image_template id>, …}
#                               Per-platform Studio template overrides;
#                               image_template_id stays the default.
#   campaign.schedule           json {from: "YYYY-MM-DD", to: "…"} —
#                               the spread window for queue-all.
#   campaign_post.scheduled_for The slot computed when queueing with a
#                               timeframe (sent to Buffer as dueAt).
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

echo "▶ campaign batching fields"
add_field campaign image_templates '{
  "field": "image_templates", "type": "json",
  "meta": { "interface": "input-code", "options": { "language": "json" },
    "note": "Per-platform Studio template ids, e.g. {\"instagram\": 5, \"linkedin\": 6}. image_template_id is the default." },
  "schema": {}
}'
add_field campaign schedule '{
  "field": "schedule", "type": "json",
  "meta": { "interface": "input-code", "options": { "language": "json" },
    "note": "Queue-all spread window: {\"from\": \"YYYY-MM-DD\", \"to\": \"YYYY-MM-DD\"}." },
  "schema": {}
}'
add_field campaign_post scheduled_for '{
  "field": "scheduled_for", "type": "timestamp",
  "meta": { "interface": "datetime", "readonly": true, "width": "half",
    "note": "Slot computed by queue-all — sent to Buffer as dueAt." },
  "schema": {}
}'

echo "✓ done."
