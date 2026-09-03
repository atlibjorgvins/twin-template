# twin

**A local-first contact system for people and organizations — yours, on your
terms.** twin keeps the people you know, the organizations they belong to, and
everything that connects them. It runs entirely on your device out of the box,
and grows into a team workspace when you want it to.

There is no twin company server. Every byte of your data lives where **you**
decide:

| Where | What it is | Good for |
|---|---|---|
| **This device** | IndexedDB inside the app — no server, works offline | The default. Private, free, zero setup |
| **Supabase** | A free cloud Postgres you own | Your data on every device you sign in on |
| **Directus** | A server you (or your team) run — `docker-compose.yml` included | Self-hosters and team workspaces |

You choose during onboarding and can change your mind later (Settings →
Storage) — or hold several at once as **vaults** (Settings → Vaults): your
personal vault on the device, a team's server, a project's Supabase, switchable
from the sidebar.

## Get it

**Desktop app (macOS):** download the `.dmg` from Releases, open it, drag to
Applications. First launch on an unsigned build: right-click → Open. ⌘K then
works from anywhere on your Mac — a Spotlight-style search over your people
and organizations, even with the window closed.

**Run from source:**

```bash
git clone https://github.com/atlibjorgvins/twin && cd twin
npm install
npm run dev
```

That's the whole setup — no database, no `.env`, no tokens. The app opens at
<http://localhost:3030>, walks you through onboarding, and stores everything
on your device until you say otherwise.

**Static hosting:** `npm run build` produces a `build/` directory any static
host serves (GitHub Pages, Netlify, your nginx). It's a PWA — installable,
offline-capable.

**Your own desktop build:** `npm run dmg` (needs Rust + Xcode CLT).

## Everything is a plugin

The core is contacts: People and Organizations. Everything else — notes,
calendar, projects, habits, photos, integrations — is a plugin you switch on
per device under **Settings → Plugins**, no rebuild needed. Plugins compiled
into the build toggle instantly; brand-new code is added at build time from a
GitHub repo (see [docs/plugin-authoring.md](docs/plugin-authoring.md), and the
[plugin template](https://github.com/atlibjorgvins/twin-plugin-template) to
write your own).

The strip build ships everything **off** except contacts
(`PUBLIC_ENABLED_FEATURES=core` — an allow-list, so a plugin added next month
stays off until you turn it on).

## Self-hosting with Directus

For a server-backed twin (teams, multi-device without Supabase):

```bash
docker compose up -d          # Directus + Postgres, from the repo root
bash scripts/…                # idempotent schema scripts (see docs/)
```

Set `PUBLIC_DIRECTUS_URL` (and optionally a static token) in `.env`, or just
paste the server URL into the onboarding wizard's "External database" option —
a shipped build connects at runtime, no rebuild.

Session-based login (`PUBLIC_AUTH_MODE=session`) with per-user row ownership
is available for same-origin deployments — see
[docs/phase2-auth.md](docs/phase2-auth.md).

## Your data stays yours

- **Export everything** (Settings → Storage): one JSON file with every
  collection and every image stored on the device.
- **Media offload**: even with a cloud backend, images can stay on this
  device only.
- Removing a vault forgets the connection — it never deletes data.

## Development

```bash
npm run dev                     # dev server on :3030
node --test --experimental-strip-types "src/**/*.test.ts"   # every suite
npm run build                   # static production build
npm run check                   # svelte-check (a known baseline of errors exists)
```

The architecture is documented in [docs/opening-up-twin.md](docs/opening-up-twin.md)
(the roadmap), [docs/phase3-data-port.md](docs/phase3-data-port.md) (the
storage port every backend implements), and
[docs/phase4-plugins.md](docs/phase4-plugins.md) (the plugin system).
