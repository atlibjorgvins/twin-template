#!/usr/bin/env bash
# Personal finances tool. Three collections:
#   finance_txn         one transaction (imported bank row or manual entry)
#   finance_settlement  a balancing payment between me and my ex
#   finance_rule        keyword → category auto-categorization rule
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

ensure_collection() {
  local name="$1" payload="$2"
  local code; code=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/collections/$name")
  if [ "$code" = "200" ]; then echo "  collection $name exists — skipping."; return; fi
  echo "  creating collection $name…"
  curl -fsS "${AUTH[@]}" "$URL/collections" -d "$payload" >/dev/null
}
add_field() {
  local coll="$1" name="$2" payload="$3"
  local code; code=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/fields/$coll/$name")
  if [ "$code" = "200" ]; then echo "  field $coll.$name exists — skipping."; return; fi
  echo "  adding field $coll.$name…"
  curl -fsS "${AUTH[@]}" "$URL/fields/$coll" -d "$payload" >/dev/null
}

# ── finance_txn ──────────────────────────────────────────────────────────
echo "▶ finance_txn"
ensure_collection "finance_txn" '{
  "collection": "finance_txn",
  "schema": { "name": "finance_txn" },
  "meta": { "icon": "account_balance_wallet", "note": "Personal finance transaction (bank import or manual)." }
}'
add_field finance_txn txn_date '{ "field": "txn_date", "type": "date",
  "meta": { "interface": "datetime", "width": "half", "note": "Transaction date." }, "schema": {} }'
add_field finance_txn amount '{ "field": "amount", "type": "float",
  "meta": { "interface": "input", "width": "half", "note": "ISK. Negative = expense, positive = income." }, "schema": {} }'
add_field finance_txn description '{ "field": "description", "type": "string",
  "meta": { "interface": "input", "note": "Merchant / text." }, "schema": {} }'
add_field finance_txn detail '{ "field": "detail", "type": "string",
  "meta": { "interface": "input", "note": "Payment type / explanation." }, "schema": {} }'
add_field finance_txn counterparty_kt '{ "field": "counterparty_kt", "type": "string",
  "meta": { "interface": "input", "width": "half", "note": "Counterparty kennitala." }, "schema": {} }'
add_field finance_txn balance '{ "field": "balance", "type": "float",
  "meta": { "interface": "input", "width": "half", "note": "Account balance after txn (informational)." }, "schema": {} }'
add_field finance_txn category '{ "field": "category", "type": "string",
  "meta": { "interface": "select-dropdown", "width": "half",
    "options": { "allowOther": true, "choices": [
      {"text":"Groceries","value":"groceries"},
      {"text":"Dining out","value":"dining"},
      {"text":"Transport","value":"transport"},
      {"text":"Fuel","value":"fuel"},
      {"text":"Utilities","value":"utilities"},
      {"text":"Housing","value":"housing"},
      {"text":"Subscriptions","value":"subscriptions"},
      {"text":"Kids","value":"kids"},
      {"text":"Health","value":"health"},
      {"text":"Shopping","value":"shopping"},
      {"text":"Entertainment","value":"entertainment"},
      {"text":"Bank / Fees","value":"fees"},
      {"text":"Loan","value":"loan"},
      {"text":"Income","value":"income"},
      {"text":"Transfer","value":"transfer"},
      {"text":"Other","value":"other"}
    ] } }, "schema": {} }'
add_field finance_txn account '{ "field": "account", "type": "string",
  "meta": { "interface": "input", "width": "half", "note": "Source account number." }, "schema": {} }'
add_field finance_txn source '{ "field": "source", "type": "string",
  "meta": { "interface": "select-dropdown", "width": "half",
    "options": { "choices": [
      {"text":"Import","value":"import"},
      {"text":"Manual","value":"manual"},
      {"text":"Recurring","value":"recurring"}
    ] } },
  "schema": { "default_value": "import" } }'
add_field finance_txn dedup_key '{ "field": "dedup_key", "type": "string",
  "meta": { "interface": "input", "hidden": true, "note": "Composite key to dedupe re-imports." }, "schema": {} }'
add_field finance_txn shared '{ "field": "shared", "type": "boolean",
  "meta": { "interface": "boolean", "width": "half", "note": "Shared expense with ex." },
  "schema": { "default_value": false } }'
add_field finance_txn paid_by '{ "field": "paid_by", "type": "string",
  "meta": { "interface": "select-dropdown", "width": "half",
    "options": { "choices": [ {"text":"Me","value":"me"}, {"text":"Ex","value":"ex"} ] } },
  "schema": { "default_value": "me" } }'
add_field finance_txn share_ex_pct '{ "field": "share_ex_pct", "type": "integer",
  "meta": { "interface": "input", "width": "half", "note": "Ex'\''s share of this expense (percent)." },
  "schema": { "default_value": 50 } }'
add_field finance_txn recurring_group '{ "field": "recurring_group", "type": "string",
  "meta": { "interface": "input", "hidden": true, "note": "Groups a generated recurring series." }, "schema": {} }'
add_field finance_txn notes '{ "field": "notes", "type": "text",
  "meta": { "interface": "input-multiline", "note": "Notes." }, "schema": {} }'
add_field finance_txn date_created '{ "field": "date_created", "type": "timestamp",
  "meta": { "special": ["date-created"], "interface": "datetime", "readonly": true, "hidden": true }, "schema": {} }'
add_field finance_txn date_updated '{ "field": "date_updated", "type": "timestamp",
  "meta": { "special": ["date-updated"], "interface": "datetime", "readonly": true, "hidden": true }, "schema": {} }'

# ── finance_settlement ───────────────────────────────────────────────────
echo "▶ finance_settlement"
ensure_collection "finance_settlement" '{
  "collection": "finance_settlement",
  "schema": { "name": "finance_settlement" },
  "meta": { "icon": "swap_horiz", "note": "A balancing payment between me and my ex." }
}'
add_field finance_settlement settle_date '{ "field": "settle_date", "type": "date",
  "meta": { "interface": "datetime", "width": "half" }, "schema": {} }'
add_field finance_settlement amount '{ "field": "amount", "type": "float",
  "meta": { "interface": "input", "width": "half", "note": "ISK, positive." }, "schema": {} }'
add_field finance_settlement direction '{ "field": "direction", "type": "string",
  "meta": { "interface": "select-dropdown",
    "options": { "choices": [
      {"text":"Ex paid me","value":"ex_to_me"},
      {"text":"I paid ex","value":"me_to_ex"}
    ] } },
  "schema": { "default_value": "ex_to_me" } }'
add_field finance_settlement notes '{ "field": "notes", "type": "string",
  "meta": { "interface": "input" }, "schema": {} }'
add_field finance_settlement date_created '{ "field": "date_created", "type": "timestamp",
  "meta": { "special": ["date-created"], "interface": "datetime", "readonly": true, "hidden": true }, "schema": {} }'

# ── finance_rule ─────────────────────────────────────────────────────────
echo "▶ finance_rule"
ensure_collection "finance_rule" '{
  "collection": "finance_rule",
  "schema": { "name": "finance_rule" },
  "meta": { "icon": "rule", "note": "Keyword → category auto-categorization rule." }
}'
add_field finance_rule match_text '{ "field": "match_text", "type": "string",
  "meta": { "interface": "input", "note": "Case-insensitive substring of the merchant text." }, "schema": {} }'
add_field finance_rule category '{ "field": "category", "type": "string",
  "meta": { "interface": "input", "width": "half" }, "schema": {} }'
add_field finance_rule sort '{ "field": "sort", "type": "integer",
  "meta": { "interface": "input", "hidden": true, "note": "Evaluation order." }, "schema": {} }'
add_field finance_rule date_created '{ "field": "date_created", "type": "timestamp",
  "meta": { "special": ["date-created"], "interface": "datetime", "readonly": true, "hidden": true }, "schema": {} }'

echo "Done."
