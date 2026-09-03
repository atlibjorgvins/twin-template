#!/usr/bin/env bash
# Passphrase vault metadata for AI key encryption. A single row holds the
# shared PBKDF2 salt + a verifier ciphertext (to validate the passphrase).
# The passphrase itself is NEVER stored — only on your devices, in your head.
#   ai_vault  salt(b64) verifier(enc payload)
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
echo "▶ ai_vault"
ensure_collection "ai_vault" '{ "collection": "ai_vault", "schema": { "name": "ai_vault" }, "meta": { "icon": "lock", "singleton": true, "note": "Passphrase vault metadata (salt + verifier) for AI key encryption." } }'
add_field ai_vault salt '{ "field": "salt", "type": "text", "meta": { "interface": "input", "readonly": true, "note": "PBKDF2 salt (base64, not secret)." }, "schema": {} }'
add_field ai_vault verifier '{ "field": "verifier", "type": "text", "meta": { "interface": "input", "readonly": true, "note": "Ciphertext of a known string — validates the passphrase." }, "schema": {} }'
add_field ai_vault date_created '{ "field": "date_created", "type": "timestamp", "meta": { "special": ["date-created"], "interface": "datetime", "readonly": true, "hidden": true }, "schema": {} }'
echo "Done."
