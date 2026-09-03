#!/usr/bin/env bash
# OCR fields on finance_receipt (docs/ocr-service-plan.md Phase 2).
#
# Additive only — the capture flow and every existing field are left alone.
#   ocr_text        raw OCR lines, kept for re-parsing and debugging
#   ocr_confidence  mean rec score of the OCR pass
#   ocr_attempts    consecutive failure counter (3 strikes → status 'failed')
#   status          gains the 'failed' choice
#
# Idempotent — safe to re-run. Same style as add-finance-receipts.sh.
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

add_field() {
  local coll="$1" name="$2" payload="$3"
  local code; code=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/fields/$coll/$name")
  if [ "$code" = "200" ]; then echo "  field $coll.$name exists — skipping."; return; fi
  echo "  adding field $coll.$name…"; curl -fsS "${AUTH[@]}" "$URL/fields/$coll" -d "$payload" >/dev/null
}

# The status field already exists, so add_field would skip it. Patch its
# choices instead — and only when 'failed' is genuinely absent, so a
# re-run neither duplicates the choice nor clobbers choices added later.
ensure_status_choice() {
  local coll="$1" value="$2" text="$3"
  local current
  current=$(curl -s "${AUTH[@]}" "$URL/fields/$coll/status")
  if printf '%s' "$current" | grep -q "\"value\":\"$value\""; then
    echo "  status choice '$value' exists — skipping."
    return
  fi
  echo "  adding status choice '$value'…"
  # Merge rather than replace: read existing choices, append, PATCH back.
  local merged
  merged=$(printf '%s' "$current" | python3 -c "
import json,sys
d = json.load(sys.stdin)['data']
meta = d.get('meta') or {}
opts = meta.get('options') or {}
choices = opts.get('choices') or []
choices.append({'text': '$text', 'value': '$value'})
opts['choices'] = choices
print(json.dumps({'meta': {'options': opts}}, ensure_ascii=False))
")
  curl -fsS -X PATCH "${AUTH[@]}" "$URL/fields/$coll/status" -d "$merged" >/dev/null
}

echo "▶ finance_receipt OCR fields"

add_field finance_receipt ocr_text '{
  "field": "ocr_text", "type": "text",
  "schema": { "is_nullable": true },
  "meta": {
    "interface": "input-multiline", "readonly": true,
    "note": "Raw OCR lines (newline-joined). Kept so the parser can be re-run without re-OCR."
  }
}'

add_field finance_receipt ocr_confidence '{
  "field": "ocr_confidence", "type": "float",
  "schema": { "is_nullable": true },
  "meta": {
    "interface": "input", "readonly": true,
    "note": "Mean recognition score of the OCR pass (0-1)."
  }
}'

add_field finance_receipt ocr_attempts '{
  "field": "ocr_attempts", "type": "integer",
  "schema": { "is_nullable": true, "default_value": 0 },
  "meta": {
    "interface": "input", "hidden": true,
    "note": "Consecutive OCR failures. The worker parks the row at status failed after 3."
  }
}'

add_field finance_receipt vsk_amount '{
  "field": "vsk_amount", "type": "float",
  "schema": { "is_nullable": true },
  "meta": {
    "interface": "input",
    "note": "VAT (VSK) on this receipt. Only auto-filled when the printed figure reconciles against the total at 24% or 11% — most VSK lines on an Icelandic receipt are the company VAT NUMBER, not an amount."
  }
}'

ensure_status_choice finance_receipt failed Failed

echo "Done."
