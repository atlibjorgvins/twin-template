#!/usr/bin/env bash
# One-off: add size + enrichment fields to the `organization` collection.
# Idempotent: only adds fields that don't already exist.
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
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/fields/$coll/$name")
  if [ "$code" = "200" ]; then
    echo "  field $coll.$name exists — skipping."
    return
  fi
  echo "  adding field $coll.$name…"
  curl -fsS "${AUTH[@]}" "$URL/fields/$coll" -d "$payload" >/dev/null
}

COLL="organization"

echo "Adding size + enrichment fields to $COLL…"

# ── Size ────────────────────────────────────────────────────────────────────
# Bucketed size — what humans actually know. Maps cleanly to LinkedIn buckets.
add_field "$COLL" "size_bucket" '{
  "field": "size_bucket", "type": "string",
  "meta": {
    "interface": "select-dropdown", "width": "half",
    "note": "LinkedIn-style headcount band. Use this when exact count is unknown.",
    "options": { "choices": [
      {"text":"Solo (1)","value":"1"},
      {"text":"2–10","value":"2-10"},
      {"text":"11–50","value":"11-50"},
      {"text":"51–200","value":"51-200"},
      {"text":"201–500","value":"201-500"},
      {"text":"501–1,000","value":"501-1000"},
      {"text":"1,001–5,000","value":"1001-5000"},
      {"text":"5,001–10,000","value":"5001-10000"},
      {"text":"10,001+","value":"10001+"}
    ] }
  }
}'

# Exact employee count when we have it (overrides bucket display).
add_field "$COLL" "employee_count" '{
  "field": "employee_count", "type": "integer",
  "meta": { "interface": "input", "width": "half", "note": "Exact headcount if known. Otherwise leave empty and use size_bucket." }
}'

add_field "$COLL" "employee_count_source" '{
  "field": "employee_count_source", "type": "string",
  "meta": {
    "interface": "select-dropdown", "width": "half",
    "options": { "allowOther": true, "choices": [
      {"text":"Manual","value":"manual"},
      {"text":"LinkedIn","value":"linkedin"},
      {"text":"ja.is","value":"ja_is"},
      {"text":"RSK / fyrirtækjaskrá","value":"rsk"},
      {"text":"Crunchbase","value":"crunchbase"},
      {"text":"Wikidata","value":"wikidata"},
      {"text":"Company website","value":"website"}
    ] }
  }
}'

add_field "$COLL" "employee_count_as_of" '{
  "field": "employee_count_as_of", "type": "date",
  "meta": { "interface": "datetime", "width": "half", "note": "When this headcount was sourced." }
}'

# ── Identity / enrichment hooks ─────────────────────────────────────────────
add_field "$COLL" "kennitala" '{
  "field": "kennitala", "type": "string",
  "meta": { "interface": "input", "width": "half", "note": "Icelandic company registry number (10 digits). Unlocks RSK + ja.is lookups." }
}'

add_field "$COLL" "linkedin_url" '{
  "field": "linkedin_url", "type": "string",
  "meta": { "interface": "input", "width": "half", "options": { "iconLeft": "link" } }
}'

add_field "$COLL" "founded_year" '{
  "field": "founded_year", "type": "integer",
  "meta": { "interface": "input", "width": "half" }
}'

add_field "$COLL" "org_type" '{
  "field": "org_type", "type": "string",
  "meta": {
    "interface": "select-dropdown", "width": "half",
    "options": { "choices": [
      {"text":"Private company","value":"private"},
      {"text":"Public company","value":"public"},
      {"text":"Nonprofit","value":"nonprofit"},
      {"text":"Government / public sector","value":"government"},
      {"text":"University","value":"university"},
      {"text":"School","value":"school"},
      {"text":"Association","value":"association"},
      {"text":"Other","value":"other"}
    ] }
  }
}'

# ── Revenue (optional, ISK-friendly) ────────────────────────────────────────
add_field "$COLL" "revenue_band_isk" '{
  "field": "revenue_band_isk", "type": "string",
  "meta": {
    "interface": "select-dropdown", "width": "half",
    "note": "Annual turnover in ISK. Iceland-relevant bands.",
    "options": { "choices": [
      {"text":"< 100m ISK","value":"<100m"},
      {"text":"100m – 1b ISK","value":"100m-1b"},
      {"text":"1b – 10b ISK","value":"1b-10b"},
      {"text":"10b+ ISK","value":"10b+"}
    ] }
  }
}'

add_field "$COLL" "annual_revenue_isk" '{
  "field": "annual_revenue_isk", "type": "bigInteger",
  "meta": { "interface": "input", "width": "half", "note": "Exact annual revenue in ISK if known." }
}'

# ── Provenance ──────────────────────────────────────────────────────────────
add_field "$COLL" "last_enriched_at" '{
  "field": "last_enriched_at", "type": "timestamp",
  "meta": { "interface": "datetime", "readonly": true, "width": "half", "note": "Set by the enrichment worker. Re-run if older than ~6 months." }
}'

add_field "$COLL" "enrichment_notes" '{
  "field": "enrichment_notes", "type": "text",
  "meta": { "interface": "input-multiline", "note": "Free-form: source URLs, gotchas, manual overrides." }
}'

echo "Done."
