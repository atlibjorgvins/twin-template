# Phase 2 — identity, and more than one person

**Goal:** replace the static token with a login; the self-hosted operator is
always admin; other users are always on offer.

Every number below was measured against the running instance on 2026-08-20.
This is the design; it has since been **implemented and deployed**.

---

## STATUS: LIVE on the personal instance (2026-08-22)

This design is now running in production, verified end-to-end in a real browser.
Full deploy record and PR list is in [STATUS.md](../STATUS.md#phase-2-identity--ownership--live-on-the-personal-instance-2026-08-22). In short:

- **Session auth is on** (`PUBLIC_AUTH_MODE=session`), deployed with
  `deploy.sh --target personal-session`. Login, sign-out (`/settings`), and the
  route guard all verified.
- **Roles applied:** a `member` policy (94 shared collections read+write; 27
  personal collections filtered to `user_created = $CURRENT_USER`) and an `owner`
  role that shares it. Verified: a member sees the shared graph but zero personal
  rows.
- **Two operator accounts, as designed below (§2):** `owner@example.com`
  (role `owner`) for daily use, Administrator for schema/setup only. All existing
  personal rows were backfilled to the owner so the owner sees its own history.
- **Offline write queue** pauses on a dead session and replays on re-login;
  `openDb()` is version-resilient so a redeploy/rollback never bricks the DB.
- **Rollback:** `deploy.sh --target personal` (static-token), ~1 min.

Not yet done: nothing blocking for the personal instance. Multi-user onboarding
UI (inviting real members, first-run password set) is the natural follow-on when
a second real user actually needs an account.

---

## 1. Why this is the gate

`src/lib/data/client.ts` ships a token in the bundle:

```ts
client.with(staticToken(PUBLIC_DIRECTUS_TOKEN))
```

The `twin-app` policy that token holds has **`admin_access = true`**. Probed
directly against production:

| Probe | Result |
|---|---|
| `POST /permissions` | `400` — authorised (a `403` would mean denied) |
| `POST /users` | `200` — authorised, and it created a row |
| `GET /settings`, `/roles`, `/policies` | `200` |

So anyone who can load the personal twin can extract an administrator token for
that Directus. The blast radius today is the tailnet, which is why this has been
survivable — and why it stops being survivable the moment a second person has an
account or the repo goes public.

The KLAK instance is **not** in this state: its bundled token returns `403` on
`POST /permissions`. The staff-facing instance is the properly scoped one; the
personal instance is the exposed one. Worth knowing before assuming the worse
case everywhere.

## 2. Three identities, because two of them are the same person

| Role | Access | Used for |
|---|---|---|
| `owner-admin` | `admin_access` | Setup, schema promotion, user management. **Not** for daily use. |
| `owner` | app access, same policy as `member` | Atli, day to day. |
| `member` | app access | Everyone else. |

The operator is always admin — they own the machine. But `admin_access` in
Directus **bypasses the permission layer entirely**, so an admin sees every row
including other people's private ones. Since the rule we want is *nobody* sees
another user's private rows, the owner needs a normal account for normal work
and an admin account for administration.

That is not a workaround; it is the same reason you do not browse the web as
root. It also means the privacy rule has exactly one form for everyone, with no
"unless you're the owner" branch to get wrong.

**The limit, stated plainly:** on a self-hosted box the operator has Postgres
access, and `pg_dump` does not consult Directus permissions. "Private" here means
private from peers through the app and the API. It does not mean private from
someone with a shell on the NAS, and nothing in this design can make it so.

## 3. What is shared and what is not

Measured row counts, and they decide the split:

**Shared — every authenticated user reads and writes.** ~17,000 rows.

`organization` 4,214 · `Project_people` 3,364 · `GrantAward` 2,256 ·
`Person_organization` 1,618 · `Person` 1,601 · `Project_organization` 1,220 ·
`org_suggestion` 925 · `organization_social` 449 · plus `Project`, `Grant`,
`Tag`, `location`, `ActivityKind`, the `event_*` and `mk_*` families, photos.

This is a database about the Icelandic startup ecosystem, much of it imported
from public sources (`import-rannis-grants.mjs`,
`import-icelandic-holidays.mjs`). Partitioning it per user would hand every new
account an empty app and destroy the only thing that makes twin useful on day
one.

**Personal — each user sees only their own.** ~2,000 rows.

`Dates` 1,501 · `finance_txn` 371 · `focus_task` 53 · `Person_family` 21 ·
`notes` 18 · `finance_settlement` 9 · `Activity` 7 · `habit_entry` 3 ·
`prompt` 2 · `finance_rule` 2 · `habit` 1 · `focus_session` 1 ·
`ai_vault` 0 · `ai_key` 0 · `food_order` 0 · `shopping_list` 0 ·
`finance_receipt` 0 · `finance_budget` 0

One rule, for everyone:

```json
{ "user_created": { "_eq": "$CURRENT_USER" } }
```

`$CURRENT_USER` filters are native to Directus 11.15.4 and already in use here —
277 explicit permission rows exist, 12 carrying filters, including
`{"user_created":{"_eq":"$CURRENT_USER"}}` on `directus_comments`. **No Postgres
RLS is needed.**

### The fail-safe that avoids a migration

`Dates.scope` is **NULL on 1,452 of 1,501 rows**, and `notes.scope` is NULL on
all 18. `Dates.owner` exists and is **NULL on all 1,501**. So `scope` cannot be
the boundary: default-allow would expose 1,452 calendar rows including private
appointments, and default-deny would hide the KLAK events members need.

Ownership does not have that problem, because **a NULL owner means owner-only**.
Existing rows have no `user_created`, so they stay invisible to members with no
backfill at all. The failure mode becomes "a member cannot see something they
should" — which they will say out loud — rather than "a member can read your
calendar", which nobody notices.

Anything that should be shared gets moved deliberately, one collection at a
time, with a person deciding.

### Schema work

`user_created` already exists on `Dates`, `notes`, `Person`, `organization`,
`Person_organization`, `grants`. It needs adding — as a Directus special field,
auto-populated, **no backfill** — to: `habit`, `habit_entry`, `focus_task`,
`focus_session`, `finance_txn`, `finance_budget`, `finance_rule`,
`finance_settlement`, `finance_receipt`, `food_order`, `ai_vault`, `ai_key`,
`ai_task_binding`, `ai_usage`, `shopping_list`, `shopping_line`,
`Person_family`, `Activity`, `prompt`.

One additive, idempotent script, same shape as every other in `scripts/`.

## 4. The login itself

`@directus/sdk` 18.0.3 exports `authentication`, `login`, `logout`, `refresh`,
`readMe`. The mechanism is not the hard part. These four things are.

### It is not one call site, it is thirteen

`client.ts` is the obvious one. But **seven files build the header by hand**
across about twelve `fetch` calls: `orgEnrich.ts`, `studio/data.ts`,
`data/aiVault.ts`, `data/batch.ts`, `data/receipts.ts`, `asana.ts`, and
`directus.ts` itself:

```ts
headers: { Authorization: `Bearer ${PUBLIC_DIRECTUS_TOKEN}` }
```

Every one needs the *live session* token, not a build-time constant. The fix is
a single `authHeader()` in `client.ts` that reads the current session, and no
file importing `PUBLIC_DIRECTUS_TOKEN` ever again. Leaving even one behind means
a feature that works until the session rotates.

### A 401 is not "offline"

`writeQueue.flushQueue()` treats a failed request as a lost network:

```ts
if (isNetworkError(e)) { markOffline(); break; }
```

After session expiry every queued write returns 401, which is not a network
error — so it either stalls forever or gets misread as offline while the device
is plainly online. The queue needs a third state: **needs re-authentication**,
surfaced in the UI, holding the writes rather than dropping or retrying them.
This is the part most likely to lose data if it is done carelessly, because the
queue is the only copy of an offline edit.

### Where the token lives — decided, by `<img>`

`assetUrl()` in `data/batch.ts` puts the credential in a **query string**:

```
/assets/<id>?access_token=<token>
```

That URL is the `src` of every avatar, logo and photo in the app. So the token
is not only in the bundle — it is in the DOM of every page with an image, in
browser history, and in any referrer. Today that credential is an admin token,
which makes this the widest exposure of the three.

It also settles the question below. An `<img>` tag **cannot send an
Authorization header**, so a bearer token cannot authenticate an image request;
a cookie can, because the browser attaches it automatically. Directus supports
cookie-mode sessions for exactly this reason.

**So: cookie-based session, not a bearer token in localStorage.** The
alternatives are worse — per-URL signed asset tokens mean minting one for every
image, and proxying assets through the app means putting a byte-pusher in front
of 1,976 files.

The cost is that cookies need same-origin or correct `SameSite`/CORS handling,
and the two instances differ: KLAK is same-origin (`/api`), the personal
instance is a different origin (absolute URL). The personal instance should move
to a `/api` path like KLAK's before this lands, which the multi-instance work
already made possible.

Directus offers cookie-based sessions and JSON tokens. The app is a static SPA
served by nginx from a different path than the API on the personal instance
(absolute URL) and the same origin on KLAK (`/api`). A cookie needs same-origin
or correct `SameSite`/CORS handling, and the two instances differ — so **JSON
mode with the refresh token in memory and a deliberate persistence choice** is
the simpler thing to get right on both. `localStorage` survives a reload and is
readable by any script on the origin; in-memory does not survive a reload. The
PWA is installed and expected to stay logged in, so this is a real trade rather
than an obvious one, and it is the one decision here still open.

### First-run

A fresh instance has no users and cannot be logged into. Setup needs to either
create the owner from `.env` on first boot, or expose a one-time setup route
that refuses to run once any user exists. The second is safer: an env-var
password ends up in `.env.example`, shell history and backups.

## 5a. The member role is two scripts (built, not yet applied)

`scripts/add-ownership-fields.sh` adds `user_created` (Directus special
`user-created`, auto-stamped, no backfill) to the 24 personal-layer collections
that lack it. `Dates` and `notes` already have it.

`scripts/add-member-role.sh` creates the `member` policy + role and their
permission rows from an explicit two-list manifest: 94 shared collections
(read+write, no filter) and 27 personal (create unfiltered; read/update/delete
filtered to `user_created = $CURRENT_USER`). Default-deny: the only collections
in neither list are `account_members` and `accounts` (the owner's external
accounts), verified by diffing both lists against the live collection set.

Both are idempotent and additive. **Neither has been run** — they create a
policy and 400+ permission rows on production Directus, which is a deliberate
apply gated on turning the flag on, not something to land with the code. Apply
order: ownership fields first (the filter references the column), then the role.

## 5. Order

1. **Scope the `twin-app` policy down from admin.** Independent of everything
   else, removes admin from the bundle immediately, and reversible. It will break
   whatever the app does that exceeds the new scope, so it needs the permission
   matrix written first and a browser pass after.
2. **`authHeader()`** — route all thirteen call sites through one function while
   it still returns the static token. Pure refactor, no behaviour change, and it
   makes step 4 a one-line change instead of a thirteen-file change.
3. **`user_created` script** — additive, idempotent, no backfill.
4. **Login** — `/login` route, `authentication()` with refresh, `+layout.ts`
   guard, and the queue's re-auth state.
5. **Member role and policy** — the matrix from §3, applied.
6. **Invite flow** — owner adds a member from within twin rather than the
   Directus admin UI.

Steps 1 and 2 are worth doing on their own even if the rest waits: one removes
an admin token from a shipped bundle, the other is a refactor with no risk.

## 6. What not to rely on

- **Do not treat `scope` as a permission.** It is a per-device view filter today,
  it is NULL on the rows that matter most, and repurposing it silently would
  change what a toggle means.
- **Do not make the repo public until step 4 lands.** Until then the bundle
  contains a working admin token.
- **Do not assume the owner cannot see members' rows.** They can, via admin or
  via Postgres. The design makes it require intent; it cannot make it impossible.
- **Do not ship step 1 without a browser pass.** Scoping a policy down is exactly
  the change that type-checks, builds, passes every test, and then 403s on a page
  nobody opened.
