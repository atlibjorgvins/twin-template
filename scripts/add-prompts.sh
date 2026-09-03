#!/usr/bin/env bash
# Prompt library: reusable prompts with a purpose bio, shared-pool tags
# (search-by-purpose), project links, freeform "system" chips, plus
# favourite + usage tracking.
#   prompt          title body purpose systems(json) is_favorite times_used last_used_at status sort
#   prompt_tag      prompt_id tag_id
#   prompt_project  prompt_id project_id
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

echo "▶ prompt"
ensure_collection "prompt" '{ "collection": "prompt", "schema": { "name": "prompt" }, "meta": { "icon": "auto_awesome", "note": "Reusable prompt library." } }'
add_field prompt title '{ "field": "title", "type": "string", "meta": { "interface": "input" }, "schema": {} }'
add_field prompt body '{ "field": "body", "type": "text", "meta": { "interface": "input-multiline", "note": "The prompt text. {tokens} become fill-in fields." }, "schema": {} }'
add_field prompt purpose '{ "field": "purpose", "type": "text", "meta": { "interface": "input-multiline", "note": "Short bio — what this prompt is for." }, "schema": {} }'
add_field prompt systems '{ "field": "systems", "type": "json", "meta": { "interface": "tags", "note": "Freeform system chips, e.g. Claude Code, Evergreen." }, "schema": {} }'
add_field prompt is_favorite '{ "field": "is_favorite", "type": "boolean", "meta": { "interface": "boolean" }, "schema": { "default_value": false } }'
add_field prompt times_used '{ "field": "times_used", "type": "integer", "meta": { "interface": "input" }, "schema": { "default_value": 0 } }'
add_field prompt last_used_at '{ "field": "last_used_at", "type": "timestamp", "meta": { "interface": "datetime" }, "schema": {} }'
add_field prompt status '{ "field": "status", "type": "string", "meta": { "interface": "select-dropdown", "options": { "choices": [ {"text":"Published","value":"published"}, {"text":"Archived","value":"archived"} ] } }, "schema": { "default_value": "published" } }'
add_field prompt sort '{ "field": "sort", "type": "integer", "meta": { "interface": "input", "hidden": true }, "schema": {} }'
add_field prompt date_created '{ "field": "date_created", "type": "timestamp", "meta": { "special": ["date-created"], "interface": "datetime", "readonly": true, "hidden": true }, "schema": {} }'
add_field prompt date_updated '{ "field": "date_updated", "type": "timestamp", "meta": { "special": ["date-updated"], "interface": "datetime", "readonly": true, "hidden": true }, "schema": {} }'

echo "▶ prompt_tag"
ensure_collection "prompt_tag" '{ "collection": "prompt_tag", "schema": { "name": "prompt_tag" }, "meta": { "icon": "sell", "hidden": true, "note": "prompt ↔ shared Tag pool." } }'
add_field prompt_tag prompt_id '{ "field": "prompt_id", "type": "integer", "meta": { "interface": "input", "hidden": true }, "schema": {} }'
add_field prompt_tag tag_id '{ "field": "tag_id", "type": "integer", "meta": { "interface": "input", "hidden": true }, "schema": {} }'

echo "▶ prompt_project"
ensure_collection "prompt_project" '{ "collection": "prompt_project", "schema": { "name": "prompt_project" }, "meta": { "icon": "hub", "hidden": true, "note": "prompt ↔ Project." } }'
add_field prompt_project prompt_id '{ "field": "prompt_id", "type": "integer", "meta": { "interface": "input", "hidden": true }, "schema": {} }'
add_field prompt_project project_id '{ "field": "project_id", "type": "integer", "meta": { "interface": "input", "hidden": true }, "schema": {} }'
echo "Done."
