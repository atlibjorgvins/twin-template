#!/usr/bin/env bash
# Bilingual descriptions — Icelandic + English.
#
# Convention: the EXISTING fields hold the Icelandic text (they always
# have), the new *_en fields hold the English version.
#
#   organization.description     → Icelandic   (existing, note updated)
#   organization.description_en  → English     (new)
#   Project.summary              → Icelandic   (existing, note updated)
#   Project.summary_en           → English     (new)
#   campaign.language            → which language Evergreen {description}
#                                  resolves to ('is' default, 'en'),
#                                  falling back to the other when empty.
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
note_field() {
  local coll="$1" name="$2" note="$3"
  echo "  noting $coll.$name…"
  curl -fsS -X PATCH "${AUTH[@]}" "$URL/fields/$coll/$name" \
    -d "{\"meta\": {\"note\": \"$note\"}}" >/dev/null
}

echo "▶ organization"
add_field organization description_en '{
  "field": "description_en", "type": "text",
  "meta": { "interface": "input-multiline", "note": "English description. The plain description field is the Icelandic one." },
  "schema": {}
}'
note_field organization description "Icelandic description (primary). English lives in description_en."

echo "▶ Project"
add_field Project summary_en '{
  "field": "summary_en", "type": "text",
  "meta": { "interface": "input-multiline", "note": "English summary. The plain summary field is the Icelandic one." },
  "schema": {}
}'
note_field Project summary "Icelandic summary (primary). English lives in summary_en."

echo "▶ campaign"
add_field campaign language '{
  "field": "language", "type": "string",
  "meta": {
    "interface": "select-dropdown", "width": "half",
    "note": "Which language {description} resolves to. Falls back to the other language when empty.",
    "options": { "choices": [
      { "text": "Íslenska", "value": "is" },
      { "text": "English",  "value": "en" }
    ] }
  },
  "schema": { "default_value": "is" }
}'

echo "✓ done."
