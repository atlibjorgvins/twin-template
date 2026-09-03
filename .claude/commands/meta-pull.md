# /meta-pull — ingest Meta insights into twin metrics via the Ads MCP

Pull daily performance for campaign-manager campaigns from the **Meta Ads MCP connector** (`ads_get_ad_entities`) and upsert into twin's `mk_metric`. Load tool schemas with ToolSearch first.

Argument: a twin campaign id/name and optionally a date range — `$ARGUMENTS`. Default range: last 30 days. With no argument, offer to pull every campaign that passes the gate.

## Hard guardrails

1. **Only organized campaigns**: pull only for `mk_campaign` rows whose `ad_account_id` is set, whose `mk_ad_account` has `organization_id` linked, and whose `mk_meta_campaign` rows have `meta_id` set (pushed or manually linked). Never pull account-wide data, and never pull for unlinked accounts — that's how unorganized data creeps in.
2. **Read-only on Meta**: a pull makes no create/update/activate calls.
3. Metrics land in `mk_metric` with `ref_id` = Meta entity id (the upsert key), `ref_name` = entity name, `source` = `import`. Re-pulls update, never duplicate.

## Procedure

1. From Directus (`.env` creds, `curl -sk`): get the campaign, its ad account, and its `mk_meta_campaign` rows with `meta_id`.
2. Call `ads_get_ad_entities` with: `ad_account_id` (numeric), `level: "campaign"`, `fields: ["id","name","spend","impressions","reach","clicks","results"]`, `time_range: {"since":"YYYY-MM-DD","until":"YYYY-MM-DD"}`, `time_increment: "1"` (daily rows), and `filtering` on `campaign.id IN [the meta_ids]`. Verify field names with `ads_get_field_context` if the call errors.
3. Normalize the response (verified against the live connector): `ad_entities` is a JSON **string** — parse it. Spend arrives as `amount_spent` with a currency prefix (`"ISK12345"`) — strip non-digits. Fields may be `"Not available"` → store null, and if everything is unavailable retry with a narrower `time_range` or per-entity `filtering`. `results` is `{value:[{indicator}]}`-shaped; take the numeric value when present and put the indicator in `result_type`.
4. Convert each daily row to an `mk_metric` upsert keyed on (level `meta_campaign`, `ref_id`, date):
   - GET `/items/mk_metric?filter[mk_campaign_id][_eq]={twinId}&limit=-1` once, build the key set, then POST new rows / PATCH existing ones.
   - Fields: `mk_campaign_id`, `level: "meta_campaign"`, `ref_id`, `ref_name`, `date`, `spend`, `impressions`, `reach`, `clicks`, `results`, `source: "import"`.
   - `spend` comes back in account currency units (ISK) — store as-is, no cent conversion.
5. Optional deeper levels: repeat with `level: "adset"` / `"ad"` filtered to the pushed ids, storing `level: "ad_set"` / `"ad"` — only when the user asks for that granularity.
6. Summarize: campaigns pulled, date range, rows created/updated, total spend in the range — and anything that was skipped because it failed the gate (with why).
