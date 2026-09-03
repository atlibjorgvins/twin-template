#!/usr/bin/env bash
# Time sessions, and the twin-Project → Clockify-project link.
#
#   focus_session   task_id started_at ended_at seconds description
#                   clockify_entry_id push_status push_error pushed_at
#   Project.clockify_project_id
#
# WHY A SESSION TABLE, when focus_task already has seconds_spent:
#
# `seconds_spent` is CUMULATIVE and `started_at` is cleared on every pause, so
# a task worked in three stretches has one number and no record of when those
# stretches were. Clockify entries need a real start and end. Pushing "on done"
# from focus_task alone would mean inventing an interval — one fake block of
# time whose timestamps never happened.
#
# A row per stretch keeps the true boundaries, gives twin a local time history
# it does not have today, and makes a failed push a visible retryable row
# rather than silently missing hours in Clockify.
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
URL="${DIRECTUS_ADMIN_URL:-$PUBLIC_DIRECTUS_URL}"; URL="${URL%/}"; TOKEN="$PUBLIC_DIRECTUS_TOKEN"
AUTH=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

ensure_collection() { local n="$1" p="$2" c; c=$(curl -sg -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/collections/$n"); if [ "$c" = "200" ]; then echo "  collection $n exists — skipping."; return; fi; echo "  creating $n…"; curl -fsS "${AUTH[@]}" "$URL/collections" -d "$p" >/dev/null; }
add_field() { local co="$1" na="$2" pa="$3" c; c=$(curl -sg -o /dev/null -w "%{http_code}" "${AUTH[@]}" "$URL/fields/$co/$na"); if [ "$c" = "200" ]; then echo "  field $co.$na exists — skipping."; return; fi; echo "  adding $co.$na…"; curl -fsS "${AUTH[@]}" "$URL/fields/$co" -d "$pa" >/dev/null; }
ensure_relation() {
  local coll="$1" field="$2" related="$3" ondel="${4:-SET NULL}" have
  have=$(curl -sg "${AUTH[@]}" "$URL/relations/$coll/$field" | grep -o "\"collection\":\"$coll\"" | head -1 || true)
  if [ -n "$have" ]; then echo "  relation $coll.$field exists — skipping."; return; fi
  echo "  creating relation $coll.$field → $related ($ondel)…"
  curl -fsS "${AUTH[@]}" "$URL/relations" -d "{\"collection\":\"$coll\",\"field\":\"$field\",\"related_collection\":\"$related\",\"schema\":{\"on_delete\":\"$ondel\"}}" >/dev/null
}

echo "▶ focus_session"
ensure_collection focus_session '{
  "collection": "focus_session",
  "schema": { "name": "focus_session" },
  "meta": { "icon": "timer", "sort_field": "-started_at",
    "note": "One stretch of work on a task. The unit that becomes a Clockify time entry.",
    "display_template": "{{started_at}} — {{seconds}}s" }
}'
add_field focus_session task_id '{"field":"task_id","type":"integer","meta":{"interface":"select-dropdown-m2o","special":["m2o"]},"schema":{}}'
add_field focus_session started_at '{"field":"started_at","type":"timestamp","meta":{"interface":"datetime","note":"When this stretch began. Real, not derived."},"schema":{}}'
add_field focus_session ended_at '{"field":"ended_at","type":"timestamp","meta":{"interface":"datetime"},"schema":{}}'
add_field focus_session seconds '{"field":"seconds","type":"integer","meta":{"interface":"input","note":"Duration of this stretch only, not the task total."},"schema":{"default_value":0}}'
add_field focus_session description '{"field":"description","type":"text","meta":{"interface":"input","note":"What Clockify shows. Defaults to the task title, snapshotted so a later rename does not rewrite history."},"schema":{}}'
add_field focus_session clockify_entry_id '{"field":"clockify_entry_id","type":"string","meta":{"interface":"input","readonly":true,"note":"Set once pushed. Presence of this is what makes the push idempotent."},"schema":{}}'
add_field focus_session push_status '{"field":"push_status","type":"string","meta":{"interface":"select-dropdown","note":"pending = not yet in Clockify. failed = tried and did not land; retryable and COUNTABLE, which is the point.","options":{"choices":[{"text":"Pending","value":"pending"},{"text":"Pushed","value":"pushed"},{"text":"Failed","value":"failed"},{"text":"Skipped","value":"skipped"}]}},"schema":{"default_value":"pending"}}'
add_field focus_session push_error '{"field":"push_error","type":"text","meta":{"interface":"input-multiline","readonly":true},"schema":{}}'
add_field focus_session pushed_at '{"field":"pushed_at","type":"timestamp","meta":{"interface":"datetime","readonly":true},"schema":{}}'
add_field focus_session date_created '{"field":"date_created","type":"timestamp","meta":{"special":["date-created"],"interface":"datetime","readonly":true,"hidden":true},"schema":{}}'
ensure_relation focus_session task_id focus_task "CASCADE"

echo "▶ Project.clockify_project_id"
# A LINK, not name matching: twin has 112 projects to Clockify's 27, and
# Clockify already contains both "DAFNA" and "dafna" as separate projects.
add_field Project clockify_project_id '{"field":"clockify_project_id","type":"string","meta":{"interface":"input","note":"Clockify project id. Set it in twin under Settings → Clockify; sessions on this project push there.","width":"half"},"schema":{}}'

echo "✔ done — focus_session + Project.clockify_project_id."

echo "▶ Project.clockify_fallback"
# WHERE UNASSIGNED WORK GOES.
#
# KLAK's Clockify workspace has forceProjects on: it refuses any entry without
# a project. 26 of 37 focus tasks have no project at all, so without a catch-all
# most sessions would fail to push and the hours would sit in the retry queue
# forever. One twin project is flagged as the fallback; whatever it maps to
# receives work that resolves nowhere else.
add_field Project clockify_fallback '{"field":"clockify_fallback","type":"boolean","meta":{"interface":"boolean","note":"Catch-all for Clockify: sessions whose project maps nowhere are pushed to this project mapping. Exactly one project should have this.","width":"half"},"schema":{"default_value":false}}'

echo "▶ focus_session.project_id"
# A PER-SESSION OVERRIDE, not a duplicate of the task's project.
#
# Most tasks carry no project, and Clockify refuses an entry without one. The
# fix cannot always be "set it on the task": a stretch of work often belongs to
# a different project than the task it was logged under, and past sessions must
# stay attributable to what they actually were. So a session may name its own
# project; resolution prefers it over the task's, then inherits, then falls back.
add_field focus_session project_id '{"field":"project_id","type":"integer","meta":{"interface":"select-dropdown-m2o","special":["m2o"],"note":"Overrides the task project for this stretch only. Set it from Tools → Time."},"schema":{}}'
ensure_relation focus_session project_id Project "SET NULL"
