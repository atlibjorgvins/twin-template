#!/usr/bin/env bash
# Receipt captures for the finances tool. Each row is a photographed
# receipt stored in the "Receipts" file folder; OCR (added later) fills
# the amount/merchant/txn_date fields and links to a finance_txn.
#   finance_receipt  image(file) captured_at status note
#                    + OCR-ready: amount merchant txn_date txn_id
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

echo "▶ finance_receipt"
ensure_collection "finance_receipt" '{
  "collection": "finance_receipt",
  "schema": { "name": "finance_receipt" },
  "meta": { "icon": "receipt_long", "note": "Photographed purchase receipts (OCR-enriched later)." }
}'

add_field finance_receipt image '{ "field": "image", "type": "uuid",
  "meta": { "interface": "file-image", "special": ["file"], "note": "Receipt photo (stored in the Receipts folder)." },
  "schema": {} }'
add_field finance_receipt captured_at '{ "field": "captured_at", "type": "timestamp",
  "meta": { "interface": "datetime", "note": "When the photo was taken/uploaded." }, "schema": {} }'
add_field finance_receipt status '{ "field": "status", "type": "string",
  "meta": { "interface": "select-dropdown", "width": "half", "options": { "choices": [
    { "text": "New", "value": "new" },
    { "text": "Processed", "value": "processed" },
    { "text": "Linked", "value": "linked" }
  ] } },
  "schema": { "default_value": "new" } }'
add_field finance_receipt note '{ "field": "note", "type": "text",
  "meta": { "interface": "input-multiline", "note": "Optional note added at capture." }, "schema": {} }'

# OCR-ready fields — nullable now so the OCR step can just fill them.
add_field finance_receipt amount '{ "field": "amount", "type": "float",
  "meta": { "interface": "input", "note": "Total (ISK) — from OCR.", "width": "half" }, "schema": {} }'
add_field finance_receipt merchant '{ "field": "merchant", "type": "string",
  "meta": { "interface": "input", "note": "Merchant — from OCR." }, "schema": {} }'
add_field finance_receipt txn_date '{ "field": "txn_date", "type": "date",
  "meta": { "interface": "datetime", "note": "Purchase date — from OCR.", "width": "half" }, "schema": {} }'
add_field finance_receipt txn_id '{ "field": "txn_id", "type": "integer",
  "meta": { "interface": "input", "note": "Linked finance_txn id (set when reconciled)." }, "schema": {} }'

add_field finance_receipt date_created '{ "field": "date_created", "type": "timestamp",
  "meta": { "special": ["date-created"], "interface": "datetime", "readonly": true, "hidden": true }, "schema": {} }'

echo "Done."
