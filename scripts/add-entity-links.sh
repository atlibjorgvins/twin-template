#!/usr/bin/env bash
# Generic "links & resources" attached to any entity (Project first, but
# polymorphic like notes_related_to so it reuses on org/person later).
# Each row is a labelled value — a URL (auto-linkified) or plain text —
# with an optional note for context ("shared image library, read-only").
#   entity_link  collection item label value note sort
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
URL="${DIRECTUS_ADMIN_URL:-$PUBLIC_DIRECTUS_URL}"; URL="${URL%/}"; TOKEN="$PUBLIC_DIRECTUS_TOKEN"
AUTH=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")
ensure_collection() { local n="$1" p="$2"; local c; c=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/collections/$n"); if [ "$c" = "200" ]; then echo "  collection $n exists — skipping."; return; fi; echo "  creating $n…"; curl -fsS "${AUTH[@]}" "$URL/collections" -d "$p" >/dev/null; }
add_field() { local co="$1" na="$2" pa="$3"; local c; c=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/fields/$co/$na"); if [ "$c" = "200" ]; then echo "  field $co.$na exists — skipping."; return; fi; echo "  adding $co.$na…"; curl -fsS "${AUTH[@]}" "$URL/fields/$co" -d "$pa" >/dev/null; }
echo "▶ entity_link"
ensure_collection "entity_link" '{ "collection": "entity_link", "schema": { "name": "entity_link" }, "meta": { "icon": "link", "note": "Labelled links / dynamic info attached to any entity." } }'
add_field entity_link collection '{ "field": "collection", "type": "string", "meta": { "interface": "input", "note": "Owner entity collection, e.g. Project." }, "schema": {} }'
add_field entity_link item '{ "field": "item", "type": "string", "meta": { "interface": "input", "note": "Owner entity id (string)." }, "schema": {} }'
add_field entity_link label '{ "field": "label", "type": "string", "meta": { "interface": "input", "note": "e.g. Shared image library." }, "schema": {} }'
add_field entity_link value '{ "field": "value", "type": "text", "meta": { "interface": "input", "note": "A URL (auto-linkified) or plain text." }, "schema": {} }'
add_field entity_link note '{ "field": "note", "type": "text", "meta": { "interface": "input-multiline", "note": "Optional context." }, "schema": {} }'
add_field entity_link sort '{ "field": "sort", "type": "integer", "meta": { "interface": "input", "hidden": true }, "schema": {} }'
add_field entity_link date_created '{ "field": "date_created", "type": "timestamp", "meta": { "special": ["date-created"], "interface": "datetime", "readonly": true, "hidden": true }, "schema": {} }'
add_field entity_link date_updated '{ "field": "date_updated", "type": "timestamp", "meta": { "special": ["date-updated"], "interface": "datetime", "readonly": true, "hidden": true }, "schema": {} }'
echo "Done."
