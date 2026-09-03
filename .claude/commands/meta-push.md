# /meta-push — publish a twin campaign to Meta via the Ads MCP

Push the Meta structure of a campaign-manager campaign (`mk_campaign` → `mk_meta_campaign` → `mk_ad_set` → `mk_ad`) into the linked Meta ad account using the **Meta Ads MCP connector** (tools named `ads_*`, e.g. `ads_create_campaign`, `ads_create_ad_set`, `ads_create_creative`, `ads_create_ad`). Load their schemas with ToolSearch first.

Argument: the twin campaign id or name — `$ARGUMENTS`. If missing, list campaigns (`/items/mk_campaign`) and ask which one.

## Hard guardrails — check before anything else

1. **Ad account gate**: the campaign's `ad_account_id` must be set AND that `mk_ad_account` row must have `organization_id` linked and `is_enabled = true`. If not → stop and tell the user to link it at `/tools/campaigns/accounts` and pick it in the workbench. Never push into an account that fails this.
2. **Everything lands PAUSED.** Never create ACTIVE entities, never call `ads_activate_entity`, even if a twin status says ACTIVE. Activation is a deliberate human act in Ads Manager.
3. **No duplicates**: skip any entity whose `meta_id` is already set (it was pushed before). Tell the user what was skipped. To re-push something, they clear the `meta_id` in Directus first.
4. Confirm with the user (show a one-screen summary of what will be created, in which account, with which budgets) before the first create call.

## Data access

Directus REST, base URL + token from `.env` (`PUBLIC_DIRECTUS_URL`, `PUBLIC_DIRECTUS_TOKEN`), self-signed cert → `curl -sk`. Fetch the tree:
- `/items/mk_campaign/{id}?fields=*,ad_account_id.*,client_org_id.name`
- `/items/mk_meta_campaign?filter[mk_campaign_id][_eq]={id}`
- `/items/mk_ad_set?filter[mk_meta_campaign_id][mk_campaign_id][_eq]={id}`
- `/items/mk_ad?filter[mk_ad_set_id][mk_meta_campaign_id][mk_campaign_id][_eq]={id}`

## Field mapping (twin → MCP)

- `ads_create_campaign`: ad_account_id (numeric, no `act_` prefix), campaign_name ← name, objective ← objective (already ODAX `OUTCOME_*`), buying_type ← buying_type. Budgets are in **cents** (ISK × 100): budget_mode `daily` → campaign_daily_budget, `lifetime` → campaign_lifetime_budget, `adset` → no campaign budget (ABO: budget goes on the ad sets).
- `ads_create_ad_set`: name, optimization_goal, billing_event, start/end times (ISO), budgets only when parent budget_mode = `adset`. Targeting from the `targeting` JSON: countries, age min/max, genders; `interests` is free text — resolve via the MCP's targeting search if available, otherwise omit and note it to the user.
- Creative: upload/reference the ad's image (Directus asset URL is public via `publicAssetUrl(image_id)` on port 10000) with `ads_create_creative` (page id required — ask the user which Facebook Page to use if not obvious from the account; consider `ads_get_ad_account_pages`). Then `ads_create_ad` with name + creative id.

## Write-back (the part that makes pull work later)

After each successful create, immediately PATCH the twin row's `meta_id`:
- `/items/mk_meta_campaign/{id}` ← Meta campaign id
- `/items/mk_ad_set/{id}` ← ad set id
- `/items/mk_ad/{id}` ← ad id

Finish with a summary: what was created (names + Meta ids), what was skipped, and a reminder that everything is PAUSED in Ads Manager pending review.
