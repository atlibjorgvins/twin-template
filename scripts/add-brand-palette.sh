#!/usr/bin/env bash
# brand_palette_color — the brand's own colours, and the role that uses them.
#
# Modelled on how KLAK's designer actually draws the page:
#
#   Aðallitur 1 / 2      the two foundations — light surface, dark surface
#   Aukalitur 1 / 2 (+)  neutrals; greys with no identity of their own
#   Stoðlitur 1–5        "support colours" — the identity palette
#   Stoðlitur N (+)      the darkened variant of the same colour
#
# Two things that model gets right and a flat swatch list does not.
#
# First, nothing is called "primary". The pink is a SUPPORT colour, and
# calling it primary is what led to it being treated as an action colour it
# cannot be: #FF5E72 on #FDFDFA is 2.90:1, which fails WCAG AA outright.
#
# Second, the (+) variants are not separate colours — they are the usable
# version of the same one, and they exist precisely because the base fails
# on a light surface. So a palette entry is a PAIR: hex and hex_strong.
# Storing them as two unrelated swatches loses the relationship that makes
# the (+) meaningful.
#
# Also added: Project/organization.brand_action. "Brand" (the signature hue)
# and "Action" (the interactive colour) are different jobs, and one column
# doing both is the naming bug this whole exercise started from. brand_primary
# keeps its column name — renaming a live column earns nothing — but the UI
# stops calling it Primary.
#
# The legacy brand_colors JSON keeps working: eight projects hold labelled
# swatches there and resolvePalette reads them when there are no rows.
#
# Additive and idempotent — safe to re-run.
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

echo "▶ brand_palette_color"
ensure_collection brand_palette_color '{
  "collection": "brand_palette_color",
  "meta": {
    "icon": "palette",
    "note": "A brand colour and its darker usable variant. Roles pick from these.",
    "display_template": "{{name}} {{hex}}",
    "sort_field": "sort"
  },
  "schema": {}
}'

add_field brand_palette_color owner_kind '{
  "field": "owner_kind", "type": "string",
  "schema": { "is_nullable": false, "default_value": "project" },
  "meta": {
    "interface": "select-dropdown", "required": true,
    "options": { "choices": [
      { "text": "Project", "value": "project" },
      { "text": "Organization", "value": "organization" }
    ] }
  }
}'
add_field brand_palette_color owner_id '{
  "field": "owner_id", "type": "integer",
  "schema": { "is_nullable": false },
  "meta": { "interface": "input", "required": true }
}'
add_field brand_palette_color name '{
  "field": "name", "type": "string",
  "schema": { "is_nullable": false },
  "meta": { "interface": "input", "required": true, "note": "What the brand calls it — \"Stoðlitur 1\", \"KLAK Pink\"." }
}'
add_field brand_palette_color group '{
  "field": "group", "type": "string",
  "schema": { "is_nullable": true, "default_value": "support" },
  "meta": {
    "interface": "select-dropdown",
    "options": { "choices": [
      { "text": "Foundation — surfaces the brand sits on", "value": "foundation" },
      { "text": "Support — the identity colours",          "value": "support" },
      { "text": "Neutral — greys",                          "value": "neutral" }
    ] },
    "note": "Aðallitur / Stoðlitur / Aukalitur."
  }
}'
add_field brand_palette_color hex '{
  "field": "hex", "type": "string",
  "schema": { "is_nullable": false },
  "meta": { "interface": "select-color", "required": true, "note": "The base colour." }
}'
add_field brand_palette_color hex_strong '{
  "field": "hex_strong", "type": "string",
  "schema": { "is_nullable": true },
  "meta": {
    "interface": "select-color",
    "note": "The \"(+)\" variant — the darkened version that survives a light background."
  }
}'
add_field brand_palette_color notes '{
  "field": "notes", "type": "text",
  "schema": { "is_nullable": true },
  "meta": { "interface": "input-multiline", "note": "Where this one is meant to be used, or not." }
}'
add_field brand_palette_color sort '{
  "field": "sort", "type": "integer",
  "schema": { "is_nullable": true },
  "meta": { "interface": "input", "hidden": true }
}'

# Text colours are DERIVED from background luminance today, which is safe but
# off-brand: it yields #111111, and KLAK's actual ink is #2D2D2D. Derivation
# stays the default — an unset text colour can never be unreadable — but a
# brand that has specified its ink should be able to say so.
#
# Muted text is the one that cannot be derived at all. #5A5A5A on the light
# surface is 6.77:1 and fine; #CECECE is 1.54:1 and invisible. Both are
# plausible "grey", and only a person knows which was meant.
echo "▶ role colours on both owners"
role_field() {
  add_field "$1" "$2" "{
    \"field\": \"$2\", \"type\": \"string\",
    \"schema\": { \"is_nullable\": true },
    \"meta\": { \"interface\": \"select-color\", \"note\": \"$3\" }
  }"
}
for coll in Project organization; do
  role_field "$coll" brand_action       "Buttons and links. Must pass 4.5:1 on the main surface, which the signature hue often does not."
  role_field "$coll" brand_text         "Body text on the main surface. Blank derives it from the background."
  role_field "$coll" brand_text_muted   "Secondary text. Cannot be derived — too light and it disappears."
  role_field "$coll" brand_text_inverse "Body text on the inverse surface. Blank derives it."
  role_field "$coll" brand_headline     "Headlines, only if they differ from body text. Blank follows Text."
done

echo "✔ brand palette ready."
