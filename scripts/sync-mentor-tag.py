#!/usr/bin/env python3
"""Backfill + sync the `mentor` Tag on people. Idempotent — re-run any time.

1. Every Person with the legacy `type = 'mentor'` field gets the shared
   Tag ("mentor", Person_tag junction) so the People tag filter sees them.
2. The klak.is mentor directory (https://klak.is/feed/?post_type=mentors)
   is reconciled: mentors missing from Person are created (scope work,
   source 'import', type 'mentor') and everyone in the feed is tagged.

Env: PUBLIC_DIRECTUS_URL + PUBLIC_DIRECTUS_TOKEN (read from .env when unset).
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parent.parent


def env(name: str) -> str:
    if os.environ.get(name):
        return os.environ[name]
    for line in (ROOT / ".env").read_text().splitlines():
        if line.startswith(f"{name}="):
            return line.split("=", 1)[1].strip()
    sys.exit(f"missing {name}")


URL = env("PUBLIC_DIRECTUS_URL").rstrip("/")
TOKEN = env("PUBLIC_DIRECTUS_TOKEN")
FEED = "https://klak.is/feed/?post_type=mentors"


def api(path: str, method: str = "GET", body: object | None = None) -> dict:
    # curl instead of urllib: the system Python is missing its CA bundle.
    cmd = ["curl", "-sfg", "-X", method, f"{URL}{path}",
           "-H", f"Authorization: Bearer {TOKEN}", "-H", "Content-Type: application/json"]
    if body is not None:
        cmd += ["--data-binary", json.dumps(body)]
    out = subprocess.run(cmd, capture_output=True, check=True).stdout
    return json.loads(out or b"{}")


def norm(name: str) -> str:
    return re.sub(r"\s+", " ", name).strip().casefold()


# ── canonical tag ───────────────────────────────────────────────────────
tags = api("/items/Tag?filter[name][_eq]=mentor&fields=id,name")["data"]
if tags:
    tag_id = tags[0]["id"]
else:
    tag_id = api("/items/Tag", "POST", {"name": "mentor", "status": "published"})["data"]["id"]
print(f"mentor tag id: {tag_id}")

# ── current state ───────────────────────────────────────────────────────
people = api("/items/Person?fields=id,full_name,type,status&limit=-1")["data"]
by_name = {norm(p["full_name"] or ""): p for p in people if p.get("full_name")}
tagged = {
    row["person_id"] if isinstance(row["person_id"], int) else row["person_id"]["id"]
    for row in api(f"/items/Person_tag?filter[tag_id][_eq]={tag_id}&fields=person_id&limit=-1")["data"]
}
print(f"people: {len(people)}, already tagged: {len(tagged)}")

# ── 1. legacy type=mentor → Tag ────────────────────────────────────────
legacy = [p for p in people if p.get("type") == "mentor"]
missing = [p for p in legacy if p["id"] not in tagged]
if missing:
    api("/items/Person_tag", "POST", [{"person_id": p["id"], "tag_id": tag_id} for p in missing])
    tagged.update(p["id"] for p in missing)
print(f"legacy type=mentor: {len(legacy)}, newly tagged: {len(missing)}")

# ── 2. klak.is feed ────────────────────────────────────────────────────
feed = ElementTree.fromstring(subprocess.run(["curl", "-sf", FEED], capture_output=True, check=True).stdout)
feed_names = [t.text.strip() for t in feed.iter("title") if t.text and t.text.strip() != "KLAK"]
print(f"feed mentors: {len(feed_names)}")

created, feed_tagged = [], []
for name in feed_names:
    p = by_name.get(norm(name))
    if p is None:
        p = api(
            "/items/Person",
            "POST",
            {"full_name": name, "type": "mentor", "scope": "work", "source": "import", "status": "published"},
        )["data"]
        by_name[norm(name)] = p
        created.append(name)
    if p["id"] not in tagged:
        api("/items/Person_tag", "POST", {"person_id": p["id"], "tag_id": tag_id})
        tagged.add(p["id"])
        feed_tagged.append(name)

print(f"created people: {len(created)}" + (f" — {', '.join(created)}" if created else ""))
print(f"feed-tagged (existing people that only the feed knew as mentors): {len(feed_tagged)}")
print(f"total tagged now: {len(tagged)}")
