#!/usr/bin/env bash
# brand_font_face — the actual typefaces a brand ships with.
#
# Project.brand_font (and organization.brand_font) hold the NAME of a
# typeface, which is enough to say "we use Inter" and not enough to do
# anything with. This collection holds the faces themselves, so the brand
# book can render a real specimen and a designer can download the file
# instead of guessing which Inter you meant.
#
# Two ways to carry a face, because brands really do work both ways:
#
#   file_id     an uploaded woff2/woff/ttf/otf. The authoritative copy for
#               a licensed or custom face that is not on the open web.
#   css_url     a stylesheet that defines the face (Google Fonts and
#               friends). The fallback when there is no file to host, and
#               the thing that makes a public face render without us
#               re-hosting a licensed binary.
#   source_url  where the face came from — foundry page, Google Fonts
#               listing, purchase record. Always useful, never used to
#               render.
#
# At least one of file_id / css_url makes the specimen live; source_url
# alone still documents the brand.
#
# Owner is (owner_kind, owner_id) rather than two FK columns: a face
# belongs to a project or an organization, and one polymorphic pair beats
# two nullable relations plus the branching that comes with them. The cost
# is no cascade on delete — a deleted owner leaves orphan rows, which is a
# tidy-up job, not a correctness problem.
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

echo "▶ brand_font_face"
ensure_collection brand_font_face '{
  "collection": "brand_font_face",
  "meta": {
    "icon": "text_fields",
    "note": "Typefaces belonging to a brand — uploaded files and/or links to a public source.",
    "display_template": "{{family}} {{weight}}",
    "sort_field": "sort"
  },
  "schema": {}
}'

add_field brand_font_face owner_kind '{
  "field": "owner_kind", "type": "string",
  "schema": { "is_nullable": false, "default_value": "project" },
  "meta": {
    "interface": "select-dropdown", "required": true,
    "options": { "choices": [
      { "text": "Project", "value": "project" },
      { "text": "Organization", "value": "organization" }
    ] },
    "note": "Which collection owner_id points at."
  }
}'

add_field brand_font_face owner_id '{
  "field": "owner_id", "type": "integer",
  "schema": { "is_nullable": false },
  "meta": { "interface": "input", "required": true, "note": "Project.id or organization.id, per owner_kind." }
}'

add_field brand_font_face family '{
  "field": "family", "type": "string",
  "schema": { "is_nullable": false },
  "meta": {
    "interface": "input", "required": true,
    "note": "CSS family name, exactly as it should be written: \"Inter\", \"Söhne\"."
  }
}'

add_field brand_font_face role '{
  "field": "role", "type": "string",
  "schema": { "is_nullable": true },
  "meta": {
    "interface": "select-dropdown",
    "options": { "choices": [
      { "text": "Display / headings", "value": "display" },
      { "text": "Body",               "value": "body" },
      { "text": "Mono",               "value": "mono" },
      { "text": "Accent",             "value": "accent" }
    ] },
    "note": "What this face is for. Drives the order and the specimen sizes in the brand book."
  }
}'

add_field brand_font_face weight '{
  "field": "weight", "type": "integer",
  "schema": { "is_nullable": true },
  "meta": { "interface": "input", "note": "400, 700… Leave empty for a variable font." }
}'

add_field brand_font_face style '{
  "field": "style", "type": "string",
  "schema": { "is_nullable": true, "default_value": "normal" },
  "meta": {
    "interface": "select-dropdown",
    "options": { "choices": [
      { "text": "Normal", "value": "normal" },
      { "text": "Italic", "value": "italic" }
    ] }
  }
}'

add_field brand_font_face file_id '{
  "field": "file_id", "type": "uuid",
  "schema": { "is_nullable": true },
  "meta": {
    "interface": "file", "special": ["file"],
    "note": "Uploaded woff2/woff/ttf/otf. The authoritative copy for a licensed or custom face."
  }
}'

add_field brand_font_face css_url '{
  "field": "css_url", "type": "string",
  "schema": { "is_nullable": true },
  "meta": {
    "interface": "input",
    "note": "Stylesheet that defines the face (e.g. a Google Fonts css2 URL). The fallback that makes a public face render without re-hosting it."
  }
}'

add_field brand_font_face source_url '{
  "field": "source_url", "type": "string",
  "schema": { "is_nullable": true },
  "meta": { "interface": "input", "note": "Where the face came from — foundry page, listing, purchase record." }
}'

add_field brand_font_face license '{
  "field": "license", "type": "string",
  "schema": { "is_nullable": true },
  "meta": { "interface": "input", "note": "e.g. \"SIL OFL 1.1\", \"Licensed — 5 seats\". Shown in the brand book so nobody has to ask." }
}'

add_field brand_font_face notes '{
  "field": "notes", "type": "text",
  "schema": { "is_nullable": true },
  "meta": { "interface": "input-multiline", "note": "Anything a person needs: fallback stack, tracking, when NOT to use it." }
}'

add_field brand_font_face sort '{
  "field": "sort", "type": "integer",
  "schema": { "is_nullable": true },
  "meta": { "interface": "input", "hidden": true }
}'

echo "✔ brand_font_face ready."
