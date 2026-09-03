#!/usr/bin/env bash
#
# Idempotent migration that introduces a dynamic, user-managed
# `ActivityKind` collection alongside the existing `Activity` collection,
# adds an `Activity_tag` junction so activities can reuse the shared
# `Tag` pool, and backfills existing rows.
#
# Safe to run repeatedly — every step checks whether the target already
# exists before creating it.
#
# Requirements: bash, curl, python3, and a `.env` with PUBLIC_DIRECTUS_URL
# + PUBLIC_DIRECTUS_TOKEN (admin token).

set -euo pipefail

if [ -f .env ]; then
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
fi
: "${PUBLIC_DIRECTUS_URL:?PUBLIC_DIRECTUS_URL not set}"
: "${PUBLIC_DIRECTUS_TOKEN:?PUBLIC_DIRECTUS_TOKEN not set}"

AUTH=(-H "Authorization: Bearer ${PUBLIC_DIRECTUS_TOKEN}" -H "Content-Type: application/json")

# Probe a Directus resource. Returns 0 if it exists (HTTP 200), 1 otherwise.
# We treat 4xx as "doesn't exist" — Directus returns 403 for collections it
# can't introspect, which for our admin token means the same as 404.
exists() {
  local path="$1"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" "${PUBLIC_DIRECTUS_URL}${path}" "${AUTH[@]}")
  [ "$code" = "200" ]
}

post() {
  local path="$1"; local body="$2"
  curl -s -X POST "${PUBLIC_DIRECTUS_URL}${path}" "${AUTH[@]}" -d "$body"
}

patch() {
  local path="$1"; local body="$2"
  curl -s -X PATCH "${PUBLIC_DIRECTUS_URL}${path}" "${AUTH[@]}" -d "$body"
}

echo "▶ Migrating into ${PUBLIC_DIRECTUS_URL}"

# ─── 1. Create ActivityKind collection ─────────────────────────────────
if exists "/collections/ActivityKind"; then
  echo "  ✓ ActivityKind collection already exists"
else
  echo "  + Creating ActivityKind collection"
  post "/collections" '{
    "collection": "ActivityKind",
    "meta": {
      "icon": "label",
      "note": "Dynamic kinds for Activity (coffee, ran into, mentored, etc).",
      "sort_field": "sort",
      "archive_field": "status",
      "archive_value": "archived",
      "unarchive_value": "published"
    },
    "schema": {},
    "fields": [
      {"field": "id", "type": "integer",
        "meta": {"hidden": true, "interface": "input", "readonly": true},
        "schema": {"is_primary_key": true, "has_auto_increment": true}},
      {"field": "status", "type": "string",
        "meta": {"width": "half", "interface": "select-dropdown", "options": {"choices": [
          {"text": "Published", "value": "published"},
          {"text": "Archived",  "value": "archived"}
        ]}}, "schema": {"default_value": "published"}},
      {"field": "sort", "type": "integer",
        "meta": {"width": "half", "interface": "input", "hidden": true},
        "schema": {"default_value": 0}},
      {"field": "key", "type": "string",
        "meta": {"interface": "input", "required": true, "note": "Stable slug; do not rename."},
        "schema": {"is_unique": true, "is_nullable": false}},
      {"field": "label", "type": "string",
        "meta": {"interface": "input", "required": true},
        "schema": {"is_nullable": false}},
      {"field": "emoji", "type": "string",
        "meta": {"width": "half", "interface": "input", "note": "Single character; preferred over icon."}},
      {"field": "icon", "type": "string",
        "meta": {"width": "half", "interface": "input", "note": "Fallback IconName when emoji is empty."}},
      {"field": "color", "type": "string",
        "meta": {"width": "half", "interface": "select-color"}},
      {"field": "default_significance", "type": "string",
        "meta": {"width": "half", "interface": "select-dropdown", "options": {"choices": [
          {"text": "Minor",  "value": "minor"},
          {"text": "Normal", "value": "normal"},
          {"text": "Major",  "value": "major"}
        ]}}},
      {"field": "scope", "type": "string",
        "meta": {"width": "half", "interface": "select-dropdown", "options": {"choices": [
          {"text": "Work",    "value": "work"},
          {"text": "Private", "value": "private"},
          {"text": "Both",    "value": "both"}
        ]}}}
    ]
  }' > /dev/null
  echo "    ok"
fi

# ─── 2. Seed default kinds (skip any whose `key` already exists) ───────
SEED=$(cat <<'JSON'
[
  {"key":"meeting",    "label":"Meeting",     "emoji":"🤝", "color":"#2C8C99", "default_significance":"normal", "sort":10},
  {"key":"call",       "label":"Call",        "emoji":"📞", "color":"#1D6BFE", "default_significance":"normal", "sort":20},
  {"key":"email",      "label":"Email",       "emoji":"✉️", "color":"#1D6BFE", "default_significance":"minor",  "sort":30},
  {"key":"message",    "label":"Message",     "emoji":"💬", "color":"#1D6BFE", "default_significance":"minor",  "sort":40},
  {"key":"coffee",     "label":"Coffee",      "emoji":"☕", "color":"#C6762A", "default_significance":"normal", "sort":50},
  {"key":"lunch",      "label":"Lunch",       "emoji":"🍽️", "color":"#C6762A", "default_significance":"normal", "sort":60},
  {"key":"dinner",     "label":"Dinner",      "emoji":"🍷", "color":"#C6762A", "default_significance":"normal", "sort":70},
  {"key":"drinks",     "label":"Drinks",      "emoji":"🍻", "color":"#C6762A", "default_significance":"normal", "sort":80},
  {"key":"walk",       "label":"Walk",        "emoji":"🚶", "color":"#22C55E", "default_significance":"normal", "sort":90},
  {"key":"social",     "label":"Social",      "emoji":"🎉", "color":"#6B5ADB", "default_significance":"normal", "sort":100},
  {"key":"ran_into",   "label":"Ran into",    "emoji":"👋", "color":"#6B5ADB", "default_significance":"minor",  "sort":110},
  {"key":"intro",      "label":"Intro",       "emoji":"🪪", "color":"#6B5ADB", "default_significance":"normal", "sort":120},
  {"key":"mentoring",  "label":"Mentoring",   "emoji":"🎓", "color":"#22C55E", "default_significance":"normal", "sort":130},
  {"key":"teaching",   "label":"Teaching",    "emoji":"📚", "color":"#22C55E", "default_significance":"normal", "sort":140},
  {"key":"talk",       "label":"Talk",        "emoji":"🎤", "color":"#22C55E", "default_significance":"normal", "sort":150},
  {"key":"event",      "label":"Event",       "emoji":"📅", "color":"#2C8C99", "default_significance":"normal", "sort":160},
  {"key":"check_in",   "label":"Check-in",    "emoji":"✅", "color":"#22C55E", "default_significance":"minor",  "sort":170},
  {"key":"follow_up",  "label":"Follow-up",   "emoji":"⏰", "color":"#F59E0B", "default_significance":"normal", "sort":180},
  {"key":"favor",      "label":"Favor",       "emoji":"🤲", "color":"#F59E0B", "default_significance":"normal", "sort":190},
  {"key":"gift",       "label":"Gift",        "emoji":"🎁", "color":"#F59E0B", "default_significance":"normal", "sort":200},
  {"key":"milestone",  "label":"Milestone",   "emoji":"🏁", "color":"#F87171", "default_significance":"major",  "sort":210},
  {"key":"note",       "label":"Note",        "emoji":"📝", "color":"#A3A3A3", "default_significance":"minor",  "sort":220},
  {"key":"other",      "label":"Other",       "emoji":"✨", "color":"#A3A3A3", "default_significance":"normal", "sort":230}
]
JSON
)

EXISTING_KEYS=$(curl -s "${PUBLIC_DIRECTUS_URL}/items/ActivityKind?limit=-1&fields=key" "${AUTH[@]}" \
  | python3 -c 'import json,sys
d=json.load(sys.stdin).get("data") or []
print(" ".join(r.get("key") or "" for r in d))')

echo "  · Existing kind keys: ${EXISTING_KEYS:-<none>}"

export EXISTING_KEYS SEED
python3 - <<'PY'
import json, os, subprocess
url = os.environ["PUBLIC_DIRECTUS_URL"]
tok = os.environ["PUBLIC_DIRECTUS_TOKEN"]
existing = set((os.environ.get("EXISTING_KEYS") or "").split())
data = json.loads(os.environ["SEED"])
for row in data:
    if row["key"] in existing:
        continue
    print(f"  + Seeding kind: {row['key']}")
    subprocess.run([
        "curl", "-s", "-X", "POST", f"{url}/items/ActivityKind",
        "-H", f"Authorization: Bearer {tok}",
        "-H", "Content-Type: application/json",
        "-d", json.dumps({**row, "status": "published"})
    ], check=True, stdout=subprocess.DEVNULL)
PY

# ─── 3. Add Activity.kind_id field + relation ──────────────────────────
if exists "/fields/Activity/kind_id"; then
  echo "  ✓ Activity.kind_id field already exists"
else
  echo "  + Adding Activity.kind_id field"
  post "/fields/Activity" '{
    "field": "kind_id",
    "type": "integer",
    "meta": {
      "interface": "select-dropdown-m2o",
      "options": {"template": "{{emoji}} {{label}}"},
      "special": ["m2o"],
      "note": "Dynamic kind from ActivityKind collection."
    },
    "schema": {}
  }' > /dev/null
fi

# Look up whether the FK relation already exists.
RELATIONS=$(curl -s "${PUBLIC_DIRECTUS_URL}/relations" "${AUTH[@]}")
HAVE_KIND_REL=$(echo "$RELATIONS" | python3 -c '
import json, sys
d = json.load(sys.stdin).get("data") or []
for r in d:
    if r.get("collection") == "Activity" and r.get("field") == "kind_id":
        print("yes"); break
')
if [ "$HAVE_KIND_REL" = "yes" ]; then
  echo "  ✓ Activity.kind_id relation already exists"
else
  echo "  + Wiring relation Activity.kind_id → ActivityKind"
  post "/relations" '{
    "collection": "Activity",
    "field": "kind_id",
    "related_collection": "ActivityKind",
    "schema": {"on_delete": "SET NULL"},
    "meta": {"sort_field": null}
  }' > /dev/null
fi

# ─── 4. Backfill kind_id from the legacy kind string ───────────────────
echo "  · Backfilling Activity.kind_id from legacy kind string"
KIND_MAP_JSON=$(curl -s "${PUBLIC_DIRECTUS_URL}/items/ActivityKind?limit=-1&fields=id,key" "${AUTH[@]}")
ACTIVITIES_JSON=$(curl -s "${PUBLIC_DIRECTUS_URL}/items/Activity?limit=-1&fields=id,kind,kind_id&filter%5Bkind_id%5D%5B_null%5D=true" "${AUTH[@]}")
export KIND_MAP_JSON ACTIVITIES_JSON

python3 - <<'PY'
import json, os, subprocess
url = os.environ["PUBLIC_DIRECTUS_URL"]
tok = os.environ["PUBLIC_DIRECTUS_TOKEN"]
kind_map = {r["key"]: r["id"] for r in json.loads(os.environ["KIND_MAP_JSON"]).get("data", []) if r.get("key")}
acts = json.loads(os.environ["ACTIVITIES_JSON"]).get("data", []) or []
patched = 0
skipped = 0
for a in acts:
    kid = kind_map.get(a.get("kind"))
    if kid is None:
        skipped += 1
        continue
    subprocess.run([
        "curl", "-s", "-X", "PATCH", f"{url}/items/Activity/{a['id']}",
        "-H", f"Authorization: Bearer {tok}",
        "-H", "Content-Type: application/json",
        "-d", json.dumps({"kind_id": kid})
    ], check=True, stdout=subprocess.DEVNULL)
    patched += 1
print(f"    backfilled {patched} activity row(s); {skipped} row(s) skipped (no kind match)")
PY

# ─── 4b. Backfill `icon` on seeded kinds → Helga outline glyphs ────────
echo "  · Backfilling Helga outline icons on ActivityKind rows"
python3 - <<'PY'
import json, os, subprocess
url = os.environ["PUBLIC_DIRECTUS_URL"]
tok = os.environ["PUBLIC_DIRECTUS_TOKEN"]
icon_for = {
    'meeting':       'users',
    'call':          'phone',
    'email':         'mail',
    'message':       'message-square',
    'coffee':        'coffee',
    'lunch':         'utensils',
    'dinner':        'utensils',
    'drinks':        'wine',
    'walk':          'footprints',
    'social':        'users',
    'ran_into':      'hand-wave',
    'intro':         'users',
    'mentoring':     'graduation-cap',
    'teaching':      'book-open',
    'talk':          'mic',
    'event':         'calendar',
    'check_in':      'check',
    'follow_up':     'clock',
    'favor':         'sparkles',
    'gift':          'gift',
    'milestone':     'flag',
    'note':          'notebook',
    'other':         'tag',
}
rows = json.loads(subprocess.check_output([
    'curl', '-s', f'{url}/items/ActivityKind?limit=-1&fields=id,key,icon',
    '-H', f'Authorization: Bearer {tok}'
]))['data']
patched = 0
for r in rows:
    want = icon_for.get(r['key'])
    if not want or r.get('icon') == want:
        continue
    subprocess.run([
        'curl', '-s', '-X', 'PATCH', f"{url}/items/ActivityKind/{r['id']}",
        '-H', f'Authorization: Bearer {tok}',
        '-H', 'Content-Type: application/json',
        '-d', json.dumps({'icon': want})
    ], check=True, stdout=subprocess.DEVNULL)
    patched += 1
print(f"    patched {patched} icon(s)")
PY

# ─── 5. Create Activity_tag junction ───────────────────────────────────
if exists "/collections/Activity_tag"; then
  echo "  ✓ Activity_tag collection already exists"
else
  echo "  + Creating Activity_tag junction"
  post "/collections" '{
    "collection": "Activity_tag",
    "fields": [
      {"field": "id", "type": "integer",
        "meta": {"hidden": true, "interface": "input", "readonly": true},
        "schema": {"is_primary_key": true, "has_auto_increment": true}},
      {"field": "activity_id", "type": "integer",
        "meta": {"interface": "select-dropdown-m2o", "hidden": true},
        "schema": {}},
      {"field": "tag_id", "type": "integer",
        "meta": {"interface": "select-dropdown-m2o"},
        "schema": {}}
    ],
    "schema": {},
    "meta": {"icon": "tag", "hidden": true, "note": "Junction: Activity ↔ Tag (shared with Person/Org/Note tags)"}
  }' > /dev/null
fi

HAVE_ACT_REL=$(echo "$RELATIONS" | python3 -c '
import json, sys
d = json.load(sys.stdin).get("data") or []
found = False
for r in d:
    if r.get("collection") == "Activity_tag" and r.get("field") == "activity_id":
        found = True; break
print("yes" if found else "no")
')
if [ "$HAVE_ACT_REL" = "yes" ]; then
  echo "  ✓ Activity_tag.activity_id relation already exists"
else
  echo "  + Wiring Activity_tag.activity_id → Activity"
  post "/relations" '{
    "collection": "Activity_tag",
    "field": "activity_id",
    "related_collection": "Activity",
    "schema": {"on_delete": "CASCADE"},
    "meta": {"junction_field": "tag_id", "sort_field": null}
  }' > /dev/null
fi

HAVE_TAG_REL=$(curl -s "${PUBLIC_DIRECTUS_URL}/relations" "${AUTH[@]}" | python3 -c '
import json, sys
d = json.load(sys.stdin).get("data") or []
found = False
for r in d:
    if r.get("collection") == "Activity_tag" and r.get("field") == "tag_id":
        found = True; break
print("yes" if found else "no")
')
if [ "$HAVE_TAG_REL" = "yes" ]; then
  echo "  ✓ Activity_tag.tag_id relation already exists"
else
  echo "  + Wiring Activity_tag.tag_id → Tag"
  post "/relations" '{
    "collection": "Activity_tag",
    "field": "tag_id",
    "related_collection": "Tag",
    "schema": {"on_delete": "CASCADE"},
    "meta": {"junction_field": "activity_id", "sort_field": null}
  }' > /dev/null
fi

echo "✔ Migration complete."

# Export the JSON-encoded payloads the Python steps consumed so that
# downstream tooling can pick them up if re-run from CI.
export KIND_MAP ACTIVITIES
