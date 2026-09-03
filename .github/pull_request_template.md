<!-- AGENTS.md §6. Delete any section that genuinely doesn't apply —
     except "Not verified", which is the point of the template. -->

## What and why

<!-- What changes for the person using it, and what problem that solves.
     Numbers if you measured any — "0 of 4,208 orgs had size data" is worth
     more than "most orgs lack size data". -->

## Verified

<!-- What you actually ran and actually looked at. -->

- [ ] `node --test --experimental-strip-types "src/**/*.test.ts"` — _n_ tests pass
- [ ] `npm run build`
- [ ] `bash scripts/deploy.sh --target klak --build-only`
- [ ] `npm run check` — no new errors in the files this PR touches
- [ ] Looked at it in a real browser (which page, which viewport)

## Not verified

<!-- Required. The gap gets found in production if it isn't found here.
     "Nothing — all of the above was observed" is a valid answer, but write it.
     Things that usually belong here: touch interactions tested with synthetic
     mouse events, anything asserted from source rather than seen rendered,
     a stack that isn't stood up yet, a device you couldn't reach. -->

## Schema / data

<!-- Delete if this PR touches neither. -->

- [ ] Change is an idempotent script in `scripts/`, and its assertions pass
- [ ] Runs against a second instance via `TWIN_ENV_FILE`
- [ ] Backup taken before any data migration — code rollback is not data rollback

## Deploy notes

<!-- Anything that has to happen in a particular order, or that can't be undone
     by reverting the commit. -->
