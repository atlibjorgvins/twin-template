#!/usr/bin/env bash
# Destinations: one content selection, many places to publish.
#
# THE MODEL, and why it is this small:
#
#   Content    which records — already source_collection + filters
#   Format     which shape   — already TemplateVariant (Story 1080x1920,
#                              Feed square 1080x1080, Portrait 1080x1350,
#                              Wide 1920x1080). A destination NAMES a variant;
#                              it never owns a template. That is what makes one
#                              look serve social, screens and the website.
#   Destination where it goes — this script.
#
# campaign_post is already one row per record per platform, with status,
# multi-select, queueing and failure reporting built around it. So a destination
# is a GENERALISATION of the platform column ('social:instagram_story',
# 'screens:lobby', 'website:alumni') rather than a parallel system — every fix
# already made to the queue path carries over untouched.
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
URL="${DIRECTUS_ADMIN_URL:-$PUBLIC_DIRECTUS_URL}"; URL="${URL%/}"; TOKEN="$PUBLIC_DIRECTUS_TOKEN"
AUTH=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

ensure_collection() { local n="$1" p="$2" c; c=$(curl -sg -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/collections/$n"); if [ "$c" = "200" ]; then echo "  collection $n exists — skipping."; return; fi; echo "  creating $n…"; curl -fsS "${AUTH[@]}" "$URL/collections" -d "$p" >/dev/null; }
add_field() { local co="$1" na="$2" pa="$3" c; c=$(curl -sg -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/fields/$co/$na"); if [ "$c" = "200" ]; then echo "  field $co.$na exists — skipping."; return; fi; echo "  adding $co.$na…"; curl -fsS "${AUTH[@]}" "$URL/fields/$co" -d "$pa" >/dev/null; }

echo "▶ campaign.destinations"
# Shape: { social: {on, targets[], formats{}}, screens: {...}, website: {...} }
# Held as one json blob rather than a table: it is configuration for THIS
# campaign, always read and written whole, and never queried across campaigns.
add_field campaign destinations '{"field":"destinations","type":"json","meta":{"interface":"input-code","note":"Where this campaign publishes: per medium, which targets and which format variant. Absent format = the medium recommended size.","options":{"language":"json"}},"schema":{}}'

echo "▶ campaign_post.format_key"
# Which TemplateVariant this row was rendered at. Without it a row cannot say
# whether the image it holds is the 9:16 or the 16:9 cut of the same design.
add_field campaign_post format_key '{"field":"format_key","type":"string","meta":{"interface":"input","note":"TemplateVariant key this post was rendered at (story / square / portrait / wide). Empty = the template base size.","width":"half"},"schema":{}}'

echo "▶ screencloud_channel"
# Mirrors buffer_channel deliberately: a local, syncable copy of the remote
# targets so the picker works offline and a disconnected target stays visible
# instead of vanishing. ORIENTATION is the load-bearing column — it is what
# lets a 9:16 playlist default to the Story variant with no input from you.
ensure_collection screencloud_channel '{
  "collection": "screencloud_channel",
  "schema": { "name": "screencloud_channel" },
  "meta": { "icon": "tv", "note": "ScreenCloud channels/playlists twin can publish to. Synced through the ScreenCloud proxy flow.", "display_template": "{{name}} ({{orientation}})" }
}'
add_field screencloud_channel id '{"field":"id","type":"string","meta":{"interface":"input","readonly":true,"hidden":false,"note":"ScreenCloud id."},"schema":{"is_primary_key":true,"length":64}}'
add_field screencloud_channel name '{"field":"name","type":"string","meta":{"interface":"input"},"schema":{}}'
add_field screencloud_channel orientation '{"field":"orientation","type":"string","meta":{"interface":"select-dropdown","note":"Drives the default format: portrait -> Story 9:16, landscape -> Wide 16:9.","options":{"choices":[{"text":"Portrait (9:16)","value":"portrait"},{"text":"Landscape (16:9)","value":"landscape"}]}},"schema":{}}'
add_field screencloud_channel width '{"field":"width","type":"integer","meta":{"interface":"input"},"schema":{}}'
add_field screencloud_channel height '{"field":"height","type":"integer","meta":{"interface":"input"},"schema":{}}'
add_field screencloud_channel is_disconnected '{"field":"is_disconnected","type":"boolean","meta":{"interface":"boolean","note":"Kept rather than deleted, so a target that disappears upstream is visible instead of silently missing."},"schema":{"default_value":false}}'
add_field screencloud_channel date_updated '{"field":"date_updated","type":"timestamp","meta":{"special":["date-updated"],"interface":"datetime","readonly":true},"schema":{}}'

echo "✔ done — campaign.destinations, campaign_post.format_key, screencloud_channel."
