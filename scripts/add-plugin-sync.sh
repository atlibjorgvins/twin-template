#!/usr/bin/env bash
# Plugin config sync — one row holding this instance's per-plugin UI state so it
# follows you across devices instead of living only in each browser's
# localStorage:
#   plugin_sync  disabled_plugins(json) plugin_settings(json)
# The app reads the first row on load and writes it back on change; localStorage
# stays the offline cache and the fallback when this collection is absent.
# Idempotent — safe to re-run. After this, run scripts/add-member-role.sh to
# grant the member/owner policy read+write on plugin_sync.
set -eo pipefail
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/${TWIN_ENV_FILE:-.env}"
eval "$(grep -E '^(PUBLIC_DIRECTUS_URL|PUBLIC_DIRECTUS_TOKEN|DIRECTUS_ADMIN_URL)=' "$ENV_FILE" | sed 's/^/export /')"
URL="${DIRECTUS_ADMIN_URL:-$PUBLIC_DIRECTUS_URL}"; URL="${URL%/}"; TOKEN="$PUBLIC_DIRECTUS_TOKEN"
AUTH=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")
ensure_collection() { local n="$1" p="$2"; local c; c=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/collections/$n"); if [ "$c" = "200" ]; then echo "  collection $n exists — skipping."; return; fi; echo "  creating $n…"; curl -fsS "${AUTH[@]}" "$URL/collections" -d "$p" >/dev/null; }
add_field() { local co="$1" na="$2" pa="$3"; local c; c=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/fields/$co/$na"); if [ "$c" = "200" ]; then echo "  field $co.$na exists — skipping."; return; fi; echo "  adding $co.$na…"; curl -fsS "${AUTH[@]}" "$URL/fields/$co" -d "$pa" >/dev/null; }
echo "▶ plugin_sync"
ensure_collection "plugin_sync" '{ "collection": "plugin_sync", "schema": { "name": "plugin_sync" }, "meta": { "icon": "extension", "note": "Per-plugin UI state (enabled set + inline settings) synced across a person'"'"'s devices." } }'
add_field plugin_sync disabled_plugins '{ "field": "disabled_plugins", "type": "json", "meta": { "interface": "input-code", "note": "Plugin ids switched off, as a JSON array." }, "schema": {} }'
add_field plugin_sync enabled_plugins '{ "field": "enabled_plugins", "type": "json", "meta": { "interface": "input-code", "note": "Default-off plugin ids switched ON (allow-list builds), as a JSON array." }, "schema": {} }'
add_field plugin_sync plugin_settings '{ "field": "plugin_settings", "type": "json", "meta": { "interface": "input-code", "note": "Inline per-plugin settings, as {pluginId:{key:value}}." }, "schema": {} }'
add_field plugin_sync date_updated '{ "field": "date_updated", "type": "timestamp", "meta": { "special": ["date-updated"], "interface": "datetime", "readonly": true, "hidden": true }, "schema": {} }'
echo "Done. Now run: bash scripts/add-member-role.sh   (grants read+write on plugin_sync)"
