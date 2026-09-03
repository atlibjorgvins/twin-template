#!/usr/bin/env bash
# AI "brains" foundation: stored provider keys, per-task key/model
# bindings, and a usage log for the dashboard. No active AI calls yet —
# this is the scaffolding the app resolves against.
#   ai_key           label provider api_key base_url last4 status
#   ai_task_binding  task key_id model enabled
#   ai_usage         provider task model tokens_in tokens_out cost_usd ok detail
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

ensure_collection() {
  local name="$1" payload="$2"
  local code; code=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/collections/$name")
  if [ "$code" = "200" ]; then echo "  collection $name exists — skipping."; return; fi
  echo "  creating collection $name…"; curl -fsS "${AUTH[@]}" "$URL/collections" -d "$payload" >/dev/null
}
add_field() {
  local coll="$1" name="$2" payload="$3"
  local code; code=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/fields/$coll/$name")
  if [ "$code" = "200" ]; then echo "  field $coll.$name exists — skipping."; return; fi
  echo "  adding field $coll.$name…"; curl -fsS "${AUTH[@]}" "$URL/fields/$coll" -d "$payload" >/dev/null
}
provider_choices='{ "choices": [
  { "text": "Anthropic (Claude)", "value": "anthropic" },
  { "text": "OpenAI", "value": "openai" },
  { "text": "Google (Gemini)", "value": "google" },
  { "text": "Custom", "value": "custom" }
] }'

echo "▶ ai_key"
ensure_collection "ai_key" '{
  "collection": "ai_key",
  "schema": { "name": "ai_key" },
  "meta": { "icon": "key", "note": "Stored AI provider API keys." }
}'
add_field ai_key label '{ "field": "label", "type": "string", "meta": { "interface": "input", "note": "Friendly name." }, "schema": {} }'
add_field ai_key provider "{ \"field\": \"provider\", \"type\": \"string\", \"meta\": { \"interface\": \"select-dropdown\", \"width\": \"half\", \"options\": $provider_choices }, \"schema\": {} }"
add_field ai_key api_key '{ "field": "api_key", "type": "text", "meta": { "interface": "input", "note": "Secret. Readable via the app token — personal/tailnet only.", "options": { "masked": true } }, "schema": {} }'
add_field ai_key base_url '{ "field": "base_url", "type": "string", "meta": { "interface": "input", "note": "For Custom provider (OpenAI-compatible base URL)." }, "schema": {} }'
add_field ai_key last4 '{ "field": "last4", "type": "string", "meta": { "interface": "input", "readonly": true, "note": "Last 4 chars, for display." }, "schema": {} }'
add_field ai_key status '{ "field": "status", "type": "string", "meta": { "interface": "select-dropdown", "width": "half", "options": { "choices": [ { "text": "Active", "value": "active" }, { "text": "Disabled", "value": "disabled" } ] } }, "schema": { "default_value": "active" } }'
add_field ai_key date_created '{ "field": "date_created", "type": "timestamp", "meta": { "special": ["date-created"], "interface": "datetime", "readonly": true, "hidden": true }, "schema": {} }'

echo "▶ ai_task_binding"
ensure_collection "ai_task_binding" '{
  "collection": "ai_task_binding",
  "schema": { "name": "ai_task_binding" },
  "meta": { "icon": "hub", "note": "Which key + model each AI task/process uses." }
}'
add_field ai_task_binding task '{ "field": "task", "type": "string", "meta": { "interface": "input", "note": "Task slug (matches the code AI_TASKS registry)." }, "schema": {} }'
add_field ai_task_binding key_id '{ "field": "key_id", "type": "integer", "meta": { "interface": "input", "note": "ai_key id used for this task." }, "schema": {} }'
add_field ai_task_binding model '{ "field": "model", "type": "string", "meta": { "interface": "input", "note": "Model id, e.g. claude-opus-4-8." }, "schema": {} }'
add_field ai_task_binding enabled '{ "field": "enabled", "type": "boolean", "meta": { "interface": "boolean" }, "schema": { "default_value": true } }'
add_field ai_task_binding date_updated '{ "field": "date_updated", "type": "timestamp", "meta": { "special": ["date-updated"], "interface": "datetime", "readonly": true, "hidden": true }, "schema": {} }'

echo "▶ ai_usage"
ensure_collection "ai_usage" '{
  "collection": "ai_usage",
  "schema": { "name": "ai_usage" },
  "meta": { "icon": "monitoring", "note": "Per-call AI usage log (tokens + cost) for the dashboard." }
}'
add_field ai_usage provider '{ "field": "provider", "type": "string", "meta": { "interface": "input" }, "schema": {} }'
add_field ai_usage task '{ "field": "task", "type": "string", "meta": { "interface": "input" }, "schema": {} }'
add_field ai_usage model '{ "field": "model", "type": "string", "meta": { "interface": "input" }, "schema": {} }'
add_field ai_usage tokens_in '{ "field": "tokens_in", "type": "integer", "meta": { "interface": "input" }, "schema": { "default_value": 0 } }'
add_field ai_usage tokens_out '{ "field": "tokens_out", "type": "integer", "meta": { "interface": "input" }, "schema": { "default_value": 0 } }'
add_field ai_usage cost_usd '{ "field": "cost_usd", "type": "float", "meta": { "interface": "input" }, "schema": { "default_value": 0 } }'
add_field ai_usage ok '{ "field": "ok", "type": "boolean", "meta": { "interface": "boolean" }, "schema": { "default_value": true } }'
add_field ai_usage detail '{ "field": "detail", "type": "string", "meta": { "interface": "input", "note": "Optional note / error." }, "schema": {} }'
add_field ai_usage date_created '{ "field": "date_created", "type": "timestamp", "meta": { "special": ["date-created"], "interface": "datetime", "readonly": true, "hidden": true }, "schema": {} }'

echo "Done."
