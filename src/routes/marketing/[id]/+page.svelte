<script lang="ts">
  // Campaign workbench — three sections, top to bottom:
  //   1. Overview   client, project, dates, budget, brief, tags
  //   2. Structure  Meta campaign → ad set → ad builder + bulk export
  //   3. Metrics    report import, totals, daily table
  // Fields save on blur/change; no global save button.
  import Icon from '$lib/Icon.svelte';
  import {
    assetUrl,
    createMkAd,
    createMkAdSet,
    createMkMetaCampaign,
    createMkTemplate,
    deleteMkTemplate,
    instantiateMkAd,
    instantiateMkAdSet,
    instantiateMkMetaCampaign,
    instantiateMkStructure,
    snapshotMkAd,
    snapshotMkAdSet,
    snapshotMkMetaCampaign,
    deleteMkAd,
    deleteMkAdSet,
    deleteMkMetaCampaign,
    deleteMkMetric,
    metaConfigured,
    syncMkCampaignFromMeta,
    importMetaStructure,
    formatError,
    formatMoney,
    MK_CTA_OPTIONS,
    MK_OBJECTIVES,
    MK_OPTIMIZATION_GOALS,
    MK_STATUS_LABELS,
    searchOrgs,
    setMkCampaignTags,
    updateMkAd,
    updateMkAdSet,
    updateMkCampaign,
    updateMkMetaCampaign,
    upsertMkMetrics,
    uploadFile,
    type MkAd,
    type MkAdSet,
    type MkCampaign,
    type MkMetaCampaign,
    type MkAdAccount,
    type MkMetric,
    type MkTargeting,
    type MkTemplate,
    type MkTemplateLevel,
    type MkAdSnapshot,
    type MkAdSetSnapshot,
    type MkMetaCampaignSnapshot,
    type MkStructureSnapshot,
    type Organization,
    type Project,
    type Tag
  } from '$lib/directus';
  import { adImageFileName, downloadMetaBulkXlsx } from '$lib/campaigns/metaBulk';
  import { parseAdsReport, toMetricInputs, type ReportPreview } from '$lib/campaigns/metricsImport';
  import MetricsChart from '$lib/campaigns/MetricsChart.svelte';

  let {
    data
  }: {
    data: {
      campaign: MkCampaign;
      structure: { metaCampaigns: MkMetaCampaign[]; adSets: MkAdSet[]; ads: MkAd[] };
      metrics: MkMetric[];
      campaignTags: Tag[];
      projects: Pick<Project, 'id' | 'name' | 'parent_id' | 'kind' | 'color' | 'status'>[];
      tags: Tag[];
      templates: MkTemplate[];
      adAccounts: MkAdAccount[];
      organic: Array<{ id: number; name?: string | null; status?: string | null; platforms?: string[] | null; counts: { total: number; used: number } }>;
      error: string | null;
    };
  } = $props();

  const campaignId = data.campaign.id;
  let errorMsg = $state<string | null>(null);
  let savedTick = $state(false);
  let savedTimer: ReturnType<typeof setTimeout> | null = null;

  // ── overview state ─────────────────────────────────────────────────
  let name = $state(data.campaign.name ?? '');
  let status = $state(data.campaign.status ?? 'planning');
  let brief = $state(data.campaign.brief ?? '');
  let objectiveSummary = $state(data.campaign.objective_summary ?? '');
  let budgetTotal = $state(data.campaign.budget_total != null ? String(data.campaign.budget_total) : '');
  let currency = $state(data.campaign.currency ?? 'ISK');
  let dateStart = $state(data.campaign.date_start?.slice(0, 10) ?? '');
  let dateEnd = $state(data.campaign.date_end?.slice(0, 10) ?? '');
  let clientOrg = $state<{ id: number; name: string } | null>(
    typeof data.campaign.client_org_id === 'object' && data.campaign.client_org_id
      ? { id: data.campaign.client_org_id.id, name: data.campaign.client_org_id.name ?? '' }
      : null
  );
  let projectId = $state<number | ''>(
    typeof data.campaign.project_id === 'object'
      ? (data.campaign.project_id?.id ?? '')
      : (data.campaign.project_id ?? '')
  );
  let adAccountId = $state<string>(
    typeof data.campaign.ad_account_id === 'object'
      ? (data.campaign.ad_account_id?.id ?? '')
      : (data.campaign.ad_account_id ?? '')
  );

  // Only project-linked, MCP-enabled accounts are selectable — the
  // organize-first gate. Unlinked ones get linked on the accounts page.
  const linkedAccounts = $derived(
    data.adAccounts.filter((a) => a.is_enabled !== false && a.project_id)
  );
  function accountLabel(a: MkAdAccount): string {
    const proj = typeof a.project_id === 'object' ? a.project_id?.name : null;
    return proj ? `${a.name} — ${proj}` : (a.name ?? a.id);
  }

  // ── structure state (local copies, saved on blur) ──────────────────
  let metaCampaigns = $state<MkMetaCampaign[]>([...data.structure.metaCampaigns]);
  let adSets = $state<MkAdSet[]>([...data.structure.adSets]);
  let ads = $state<MkAd[]>([...data.structure.ads]);

  // ── metrics state ──────────────────────────────────────────────────
  let metrics = $state<MkMetric[]>([...data.metrics]);

  // ── templates ──────────────────────────────────────────────────────
  // Snapshots of structures (or subtrees) saved for reuse across
  // campaigns. "Save" bookmarks a card; "From template" menus insert.
  let templates = $state<MkTemplate[]>([...data.templates]);
  /** Which "From template" menu is open: level + the parent to insert under. */
  let tplMenu = $state<{ level: MkTemplateLevel; parentId: number } | null>(null);

  function templatesFor(level: MkTemplateLevel): MkTemplate[] {
    return templates.filter((t) => t.level === level);
  }
  function toggleTplMenu(level: MkTemplateLevel, parentId: number) {
    tplMenu =
      tplMenu && tplMenu.level === level && tplMenu.parentId === parentId
        ? null
        : { level, parentId };
  }

  async function saveTemplate(level: MkTemplateLevel, suggested: string, payload: unknown) {
    const name = prompt('Template name:', suggested);
    if (!name?.trim()) return;
    const t = await save(() =>
      createMkTemplate({ name: name.trim(), level, payload: payload as MkTemplate['payload'] })
    );
    if (t) templates = [...templates, t].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  }

  function saveStructureTemplate() {
    const payload: MkStructureSnapshot = {
      metaCampaigns: metaCampaigns.map((mc) => snapshotMkMetaCampaign(mc, adSets, ads))
    };
    void saveTemplate('structure', `${name || 'Campaign'} structure`, payload);
  }
  function saveMetaCampaignTemplate(mc: MkMetaCampaign) {
    void saveTemplate('meta_campaign', mc.name ?? 'Meta campaign', snapshotMkMetaCampaign(mc, adSets, ads));
  }
  function saveAdSetTemplate(as: MkAdSet) {
    void saveTemplate('ad_set', as.name ?? 'Ad set', snapshotMkAdSet(as, ads));
  }
  function saveAdTemplate(ad: MkAd) {
    void saveTemplate('ad', ad.name ?? 'Ad', snapshotMkAd(ad));
  }

  async function insertTemplate(t: MkTemplate, parentId: number) {
    tplMenu = null;
    const r = await save(async () => {
      if (t.level === 'structure') {
        return instantiateMkStructure(t.payload as MkStructureSnapshot, campaignId);
      }
      if (t.level === 'meta_campaign') {
        const x = await instantiateMkMetaCampaign(t.payload as MkMetaCampaignSnapshot, campaignId);
        return { metaCampaigns: [x.metaCampaign], adSets: x.adSets, ads: x.ads };
      }
      if (t.level === 'ad_set') {
        const x = await instantiateMkAdSet(t.payload as MkAdSetSnapshot, parentId);
        return { metaCampaigns: [], adSets: [x.adSet], ads: x.ads };
      }
      const ad = await instantiateMkAd(t.payload as MkAdSnapshot, parentId);
      return { metaCampaigns: [], adSets: [], ads: [ad] };
    });
    if (r) {
      metaCampaigns = [...metaCampaigns, ...r.metaCampaigns];
      adSets = [...adSets, ...r.adSets];
      ads = [...ads, ...r.ads];
    }
  }

  async function removeTemplate(t: MkTemplate) {
    if (!confirm(`Delete template "${t.name}"?`)) return;
    const ok = await save(() => deleteMkTemplate(t.id));
    if (ok !== null) templates = templates.filter((x) => x.id !== t.id);
  }

  function flashSaved() {
    savedTick = true;
    if (savedTimer) clearTimeout(savedTimer);
    savedTimer = setTimeout(() => (savedTick = false), 1500);
  }

  // Saves send the whole record, so two quick blurs (tabbing through
  // fields) can race and let a stale payload land last — serialize
  // them instead.
  let saveQueue: Promise<unknown> = Promise.resolve();
  async function save<T>(fn: () => Promise<T>): Promise<T | null> {
    errorMsg = null;
    const run = saveQueue.then(fn);
    saveQueue = run.catch(() => {});
    try {
      const r = await run;
      flashSaved();
      return r;
    } catch (e) {
      errorMsg = formatError(e);
      return null;
    }
  }

  function saveOverview() {
    void save(() =>
      updateMkCampaign(campaignId, {
        name: name.trim() || null,
        status,
        brief: brief.trim() || null,
        objective_summary: objectiveSummary.trim() || null,
        budget_total: budgetTotal.trim() ? Number(budgetTotal) : null,
        currency: currency.trim() || 'ISK',
        date_start: dateStart || null,
        date_end: dateEnd || null,
        client_org_id: clientOrg?.id ?? null,
        project_id: projectId === '' ? null : Number(projectId),
        ad_account_id: adAccountId || null
      })
    );
  }

  // ── client org picker ──────────────────────────────────────────────
  let orgQuery = $state('');
  let orgMatches = $state<Organization[]>([]);
  let orgSearchTimer: ReturnType<typeof setTimeout> | null = null;
  function onOrgInput() {
    if (orgSearchTimer) clearTimeout(orgSearchTimer);
    const q = orgQuery.trim();
    if (q.length < 2) {
      orgMatches = [];
      return;
    }
    orgSearchTimer = setTimeout(async () => {
      try {
        orgMatches = await searchOrgs(q, 8);
      } catch {
        orgMatches = [];
      }
    }, 250);
  }
  function pickOrg(o: Organization) {
    clientOrg = { id: o.id, name: o.name ?? '' };
    orgQuery = '';
    orgMatches = [];
    saveOverview();
  }
  function clearOrg() {
    clientOrg = null;
    saveOverview();
  }

  // ── project options (indented tree) ────────────────────────────────
  const projectOptions = $derived.by(() => {
    const byParent = new Map<number | null, typeof data.projects>();
    for (const p of data.projects) {
      const parent = p.parent_id;
      const k = parent == null ? null : typeof parent === 'object' ? parent.id : Number(parent);
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k)!.push(p);
    }
    const out: { id: number; label: string }[] = [];
    const walk = (parent: number | null, depth: number) => {
      for (const p of byParent.get(parent) ?? []) {
        out.push({ id: p.id, label: `${'  '.repeat(depth)}${p.name ?? `#${p.id}`}` });
        walk(p.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  });

  // ── tags ───────────────────────────────────────────────────────────
  let selectedTags = $state<Tag[]>([...data.campaignTags]);
  let tagQuery = $state('');
  const tagMatches = $derived.by(() => {
    const q = tagQuery.trim().toLowerCase();
    if (!q) return [];
    const have = new Set(selectedTags.map((t) => t.id));
    return data.tags.filter((t) => !have.has(t.id) && (t.name ?? '').toLowerCase().includes(q)).slice(0, 8);
  });
  function addTag(t: Tag) {
    selectedTags = [...selectedTags, t];
    tagQuery = '';
    void save(() => setMkCampaignTags(campaignId, selectedTags.map((x) => x.id)));
  }
  function removeTag(t: Tag) {
    selectedTags = selectedTags.filter((x) => x.id !== t.id);
    void save(() => setMkCampaignTags(campaignId, selectedTags.map((x) => x.id)));
  }

  // ── structure CRUD ─────────────────────────────────────────────────
  async function addMetaCampaign() {
    const mc = await save(() =>
      createMkMetaCampaign({
        mk_campaign_id: campaignId,
        name: `${name || 'Campaign'} — Meta`,
        objective: 'OUTCOME_TRAFFIC',
        buying_type: 'AUCTION',
        status: 'PAUSED',
        budget_mode: 'daily'
      })
    );
    if (mc) metaCampaigns = [...metaCampaigns, mc];
  }
  function saveMetaCampaign(mc: MkMetaCampaign) {
    void save(() =>
      updateMkMetaCampaign(mc.id, {
        name: mc.name,
        objective: mc.objective,
        status: mc.status,
        budget_mode: mc.budget_mode,
        budget_amount:
          mc.budget_amount != null && String(mc.budget_amount).trim() !== ''
            ? Number(mc.budget_amount)
            : null
      })
    );
  }
  async function removeMetaCampaign(mc: MkMetaCampaign) {
    if (!confirm(`Delete Meta campaign "${mc.name}" and everything under it?`)) return;
    const ok = await save(() => deleteMkMetaCampaign(mc.id));
    if (ok !== null) {
      const setIds = new Set(adSets.filter((a) => Number(a.mk_meta_campaign_id) === mc.id).map((a) => a.id));
      metaCampaigns = metaCampaigns.filter((x) => x.id !== mc.id);
      adSets = adSets.filter((a) => !setIds.has(a.id));
      ads = ads.filter((a) => !setIds.has(Number(a.mk_ad_set_id)));
    }
  }

  async function addAdSet(mc: MkMetaCampaign) {
    const as = await save(() =>
      createMkAdSet({
        mk_meta_campaign_id: mc.id,
        name: `Ad set ${adSets.filter((a) => Number(a.mk_meta_campaign_id) === mc.id).length + 1}`,
        status: 'PAUSED',
        optimization_goal: 'LINK_CLICKS',
        billing_event: 'IMPRESSIONS',
        budget_mode: 'daily',
        targeting: { countries: ['IS'], placements: 'automatic' }
      })
    );
    if (as) adSets = [...adSets, as];
  }
  function saveAdSet(as: MkAdSet) {
    void save(() =>
      updateMkAdSet(as.id, {
        name: as.name,
        status: as.status,
        optimization_goal: as.optimization_goal,
        budget_mode: as.budget_mode,
        budget_amount:
          as.budget_amount != null && String(as.budget_amount).trim() !== ''
            ? Number(as.budget_amount)
            : null,
        start_time: as.start_time || null,
        end_time: as.end_time || null,
        targeting: as.targeting
      })
    );
  }
  async function removeAdSet(as: MkAdSet) {
    if (!confirm(`Delete ad set "${as.name}" and its ads?`)) return;
    const ok = await save(() => deleteMkAdSet(as.id));
    if (ok !== null) {
      adSets = adSets.filter((x) => x.id !== as.id);
      ads = ads.filter((a) => Number(a.mk_ad_set_id) !== as.id);
    }
  }

  async function addAd(as: MkAdSet) {
    const ad = await save(() =>
      createMkAd({
        mk_ad_set_id: as.id,
        name: `Ad ${ads.filter((a) => Number(a.mk_ad_set_id) === as.id).length + 1}`,
        status: 'PAUSED',
        call_to_action: 'LEARN_MORE'
      })
    );
    if (ad) ads = [...ads, ad];
  }
  function saveAd(ad: MkAd) {
    void save(() =>
      updateMkAd(ad.id, {
        name: ad.name,
        status: ad.status,
        body: ad.body,
        title: ad.title,
        description: ad.description,
        link_url: ad.link_url,
        call_to_action: ad.call_to_action,
        image_id: ad.image_id
      })
    );
  }
  async function removeAd(ad: MkAd) {
    if (!confirm(`Delete ad "${ad.name}"?`)) return;
    const ok = await save(() => deleteMkAd(ad.id));
    if (ok !== null) ads = ads.filter((x) => x.id !== ad.id);
  }

  async function onAdImagePicked(ad: MkAd, ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const fileId = await save(() => uploadFile(file, { title: `${ad.name ?? 'ad'} creative` }));
    if (fileId) {
      ad.image_id = fileId;
      saveAd(ad);
    }
    (ev.target as HTMLInputElement).value = '';
  }

  // targeting helpers — bind through strings, save structured
  function targetingOf(as: MkAdSet): MkTargeting {
    if (!as.targeting) as.targeting = { countries: ['IS'], placements: 'automatic' };
    return as.targeting;
  }

  // ── bulk export ────────────────────────────────────────────────────
  const imageFileNames = $derived.by(() => {
    const m = new Map<number, string>();
    for (const ad of ads) if (ad.image_id) m.set(ad.id, adImageFileName(ad));
    return m;
  });

  function exportBulkFile() {
    if (metaCampaigns.length === 0) {
      errorMsg = 'Add at least one Meta campaign before exporting.';
      return;
    }
    const slug = (name || 'campaign').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    void downloadMetaBulkXlsx(
      { campaign: data.campaign, metaCampaigns, adSets, ads, imageFileNames },
      `${slug || 'campaign'}-meta-import.xlsx`
    );
  }

  async function downloadAdImage(ad: MkAd) {
    if (!ad.image_id) return;
    errorMsg = null;
    try {
      // Fetch as blob so the saved file gets the exact name the bulk
      // file references — a plain <a download> can't rename
      // cross-origin assets.
      const res = await fetch(assetUrl(ad.image_id));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = adImageFileName(ad);
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      errorMsg = formatError(e);
    }
  }

  const adsWithImages = $derived(ads.filter((a) => a.image_id));

  // ── metrics ────────────────────────────────────────────────────────
  let reportText = $state('');
  let reportPreview = $state<ReportPreview | null>(null);
  let importing = $state(false);
  let importSummary = $state<string | null>(null);

  function previewReport() {
    importSummary = null;
    reportPreview = reportText.trim() ? parseAdsReport(reportText) : null;
  }
  async function onReportFile(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    reportText = await file.text();
    previewReport();
    (ev.target as HTMLInputElement).value = '';
  }
  async function commitImport() {
    if (!reportPreview || reportPreview.rows.length === 0) return;
    importing = true;
    errorMsg = null;
    try {
      const { metrics: inputs, unmatched } = toMetricInputs(
        reportPreview.rows,
        metaCampaigns.map((m) => m.name ?? '')
      );
      const { created, updated } = await upsertMkMetrics(campaignId, inputs);
      importSummary =
        `${created} new, ${updated} updated.` +
        (unmatched.length ? ` Stored at umbrella level (name not in structure): ${unmatched.join(', ')}.` : '');
      metrics = await import('$lib/directus').then((m) => m.listMkMetrics(campaignId));
      reportText = '';
      reportPreview = null;
      flashSaved();
    } catch (e) {
      errorMsg = formatError(e);
    } finally {
      importing = false;
    }
  }

  // ── live sync from Meta ────────────────────────────────────────────
  // Pulls daily insights for the linked ad account straight from the
  // Graph API (read-only) and upserts them as Meta-sourced rows.
  const metaReady = metaConfigured();
  function isoToday(): string {
    return new Date().toISOString().slice(0, 10);
  }
  function isoDaysAgo(n: number): string {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  }
  let syncSince = $state(dateStart || isoDaysAgo(30));
  let syncUntil = $state(dateEnd && dateEnd <= isoToday() ? dateEnd : isoToday());
  let syncing = $state(false);
  let syncSummary = $state<string | null>(null);

  // Pull the live campaign → ad set → ad tree out of the linked account
  // into this umbrella, then immediately sync the imported campaigns'
  // metrics — the "I already run these in Ads Manager" path.
  let importingMeta = $state(false);
  let metaImportSummary = $state<string | null>(null);
  function accountCurrency(): string {
    const a = data.adAccounts.find((x) => x.id === adAccountId);
    return a?.currency ?? currency;
  }
  async function fetchFromMeta() {
    if (!adAccountId) {
      errorMsg = 'Link a Meta ad account in Overview before fetching.';
      return;
    }
    importingMeta = true;
    errorMsg = null;
    metaImportSummary = null;
    try {
      const { created, result } = await importMetaStructure(campaignId, {
        accountId: adAccountId,
        currency: accountCurrency()
      });
      metaCampaigns = [...metaCampaigns, ...created.metaCampaigns];
      adSets = [...adSets, ...created.adSets];
      ads = [...ads, ...created.ads];
      // Now that the structure carries meta_ids, pull their numbers.
      const sync = await syncMkCampaignFromMeta(campaignId, {
        accountId: adAccountId,
        since: syncSince || undefined,
        until: syncUntil || undefined
      });
      metrics = await import('$lib/directus').then((m) => m.listMkMetrics(campaignId));
      metaImportSummary =
        (result.fetched === 0
          ? 'No active campaigns in this account.'
          : `Imported ${result.campaignsCreated} campaign${result.campaignsCreated === 1 ? '' : 's'}, ${result.adSetsCreated} ad set${result.adSetsCreated === 1 ? '' : 's'}, ${result.adsCreated} ad${result.adsCreated === 1 ? '' : 's'}` +
            (result.skipped ? ` (${result.skipped} already here)` : '') +
            '.') +
        (result.fetched > 0
          ? ` Pulled ${sync.created + sync.updated} metric row${sync.created + sync.updated === 1 ? '' : 's'}.`
          : '');
      flashSaved();
    } catch (e) {
      errorMsg = formatError(e);
    } finally {
      importingMeta = false;
    }
  }

  async function syncFromMeta() {
    if (!adAccountId) {
      errorMsg = 'Link a Meta ad account in Overview before syncing.';
      return;
    }
    syncing = true;
    errorMsg = null;
    syncSummary = null;
    try {
      const res = await syncMkCampaignFromMeta(campaignId, {
        accountId: adAccountId,
        since: syncSince || undefined,
        until: syncUntil || undefined
      });
      metrics = await import('$lib/directus').then((m) => m.listMkMetrics(campaignId));
      if (res.matched.length === 0) {
        syncSummary =
          res.rows === 0
            ? 'Meta returned no rows for this range.'
            : `Pulled ${res.rows} rows but none matched this campaign. Make sure a Meta campaign name here matches Ads Manager. Unmatched: ${res.unmatched.join(', ')}.`;
      } else {
        syncSummary =
          `${res.created} new, ${res.updated} updated for ${res.matched.join(', ')}.` +
          (res.linkedIds ? ` Linked ${res.linkedIds} Meta id${res.linkedIds === 1 ? '' : 's'}.` : '') +
          (res.unmatched.length ? ` Skipped (not in this campaign): ${res.unmatched.join(', ')}.` : '');
      }
      flashSaved();
    } catch (e) {
      errorMsg = formatError(e);
    } finally {
      syncing = false;
    }
  }

  // manual metric row
  let mDate = $state('');
  let mName = $state('');
  let mSpend = $state('');
  let mImpr = $state('');
  let mClicks = $state('');
  let mResults = $state('');
  async function addManualMetric() {
    if (!mDate || !mName.trim()) {
      errorMsg = 'Manual row needs at least a date and a name.';
      return;
    }
    const r = await save(() =>
      upsertMkMetrics(campaignId, [
        {
          level: 'meta_campaign',
          ref_name: mName.trim(),
          date: mDate,
          spend: mSpend.trim() ? Number(mSpend) : null,
          impressions: mImpr.trim() ? Number(mImpr) : null,
          reach: null,
          clicks: mClicks.trim() ? Number(mClicks) : null,
          results: mResults.trim() ? Number(mResults) : null,
          result_type: null,
          source: 'manual'
        }
      ])
    );
    if (r) {
      metrics = await import('$lib/directus').then((m) => m.listMkMetrics(campaignId));
      mDate = mName = mSpend = mImpr = mClicks = mResults = '';
    }
  }
  async function removeMetric(m: MkMetric) {
    const ok = await save(() => deleteMkMetric(m.id));
    if (ok !== null) metrics = metrics.filter((x) => x.id !== m.id);
  }

  // ── reporting: period filter ───────────────────────────────────────
  // 'all' or a trailing window in days. Drives totals, the trend chart,
  // the per-campaign breakdown and the daily table together.
  let period = $state<'7' | '30' | '90' | 'all'>('all');
  const PERIODS: { value: typeof period; label: string }[] = [
    { value: '7', label: '7d' },
    { value: '30', label: '30d' },
    { value: '90', label: '90d' },
    { value: 'all', label: 'All' }
  ];
  const periodCutoff = $derived.by(() => {
    if (period === 'all') return null;
    const d = new Date();
    d.setDate(d.getDate() - Number(period));
    return d.toISOString().slice(0, 10);
  });
  const filteredMetrics = $derived.by(() => {
    const cut = periodCutoff;
    if (!cut) return metrics;
    return metrics.filter((m) => (m.date ?? '').slice(0, 10) >= cut);
  });

  const totals = $derived.by(() => {
    let spend = 0,
      impressions = 0,
      clicks = 0,
      results = 0;
    for (const m of filteredMetrics) {
      spend += Number(m.spend ?? 0) || 0;
      impressions += m.impressions ?? 0;
      clicks += m.clicks ?? 0;
      results += m.results ?? 0;
    }
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
    const cpc = clicks > 0 ? spend / clicks : 0;
    return { spend, impressions, clicks, results, ctr, cpc };
  });

  const metricsByDate = $derived.by(() =>
    [...filteredMetrics].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  );

  // Daily aggregate (summed across campaigns) for the trend chart,
  // oldest → newest.
  const dailySeries = $derived.by(() => {
    const byDate = new Map<string, { spend: number; results: number }>();
    for (const m of filteredMetrics) {
      const d = (m.date ?? '').slice(0, 10);
      if (!d) continue;
      const cur = byDate.get(d) ?? { spend: 0, results: 0 };
      cur.spend += Number(m.spend ?? 0) || 0;
      cur.results += m.results ?? 0;
      byDate.set(d, cur);
    }
    const labels = [...byDate.keys()].sort();
    return {
      labels: labels.map((d) => d.slice(5)), // MM-DD
      spend: labels.map((d) => byDate.get(d)!.spend),
      results: labels.map((d) => byDate.get(d)!.results)
    };
  });

  // Per-campaign rollup (by ref_name) for the breakdown bars.
  const breakdown = $derived.by(() => {
    const by = new Map<string, { spend: number; clicks: number; results: number }>();
    for (const m of filteredMetrics) {
      const name = m.ref_name ?? '(unnamed)';
      const cur = by.get(name) ?? { spend: 0, clicks: 0, results: 0 };
      cur.spend += Number(m.spend ?? 0) || 0;
      cur.clicks += m.clicks ?? 0;
      cur.results += m.results ?? 0;
      by.set(name, cur);
    }
    const rows = [...by.entries()].map(([name, v]) => ({ name, ...v }));
    rows.sort((a, b) => b.spend - a.spend);
    const maxSpend = Math.max(1, ...rows.map((r) => r.spend));
    return { rows, maxSpend };
  });

  function exportMetricsCsv() {
    const head = ['Date', 'Campaign', 'Source', 'Spend', 'Impressions', 'Reach', 'Clicks', 'Results', 'Result type'];
    const lines = [head.join(',')];
    for (const m of metricsByDate) {
      const cells = [
        m.date?.slice(0, 10) ?? '',
        m.ref_name ?? '',
        m.source ?? '',
        m.spend ?? '',
        m.impressions ?? '',
        m.reach ?? '',
        m.clicks ?? '',
        m.results ?? '',
        m.result_type ?? ''
      ].map((c) => {
        const s = String(c);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      });
      lines.push(cells.join(','));
    }
    const slug = (name || 'campaign').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug || 'campaign'}-metrics${period === 'all' ? '' : `-${period}d`}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function num(v: number | null | undefined): string {
    return v != null ? v.toLocaleString('is-IS') : '–';
  }
</script>

{#snippet tplDropdown(levels: MkTemplateLevel[], parentId: number)}
  {@const available = levels.flatMap((l) => templatesFor(l))}
  <span class="relative">
    <button class="btn-ghost text-xs" onclick={() => toggleTplMenu(levels[0], parentId)}>
      From template ▾
    </button>
    {#if tplMenu && tplMenu.parentId === parentId && levels.includes(tplMenu.level)}
      <ul
        class="absolute right-0 z-20 mt-1 w-60 overflow-hidden rounded-[10px] border border-surface-border bg-surface-card shadow-lg"
      >
        {#if available.length === 0}
          <li class="px-3 py-2 text-xs text-ink-400">
            No templates yet — save one with the <Icon name="bookmark" size={11} class="inline" /> button on a card.
          </li>
        {/if}
        {#each available as t (t.id)}
          <li class="flex items-center">
            <button
              class="min-w-0 flex-1 px-3 py-2 text-left text-xs hover:bg-surface-hover"
              onclick={() => insertTemplate(t, parentId)}
            >
              <span class="block truncate text-ink-900">{t.name}</span>
              {#if levels.length > 1}
                <span class="text-[10px] text-ink-400">{t.level === 'structure' ? 'whole structure' : 'Meta campaign'}</span>
              {/if}
            </button>
            <button
              class="shrink-0 px-2 text-ink-300 hover:text-ink-700"
              onclick={() => removeTemplate(t)}
              aria-label={`Delete template ${t.name}`}
            >
              <Icon name="x" size={11} />
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </span>
{/snippet}

<svelte:head><title>{name || 'Campaign'} · Marketing</title></svelte:head>

<section class="mx-auto max-w-4xl space-y-5 pb-24">
  <header class="flex items-start justify-between gap-3">
    <div class="min-w-0 flex-1">
      <div class="hero-eyebrow">
        <a href="/marketing" class="hover:underline">Marketing</a>
      </div>
      <input
        class="input w-full max-w-md font-display text-xl font-bold"
        bind:value={name}
        onblur={saveOverview}
        placeholder="Campaign name"
      />
    </div>
    <div class="flex shrink-0 items-center gap-2">
      {#if savedTick}<span class="text-xs" style="color: #2F855A;">Saved</span>{/if}
      <select class="input !w-auto text-xs" bind:value={status} onchange={saveOverview}>
        {#each Object.entries(MK_STATUS_LABELS) as [v, l] (v)}
          <option value={v}>{l}</option>
        {/each}
      </select>
    </div>
  </header>

  {#if errorMsg}
    <div class="rounded-[14px] border border-surface-border bg-surface-card p-4 text-sm" style="color: #C0392B;">
      {errorMsg}
    </div>
  {/if}

  <!-- ── 1 · Overview ─────────────────────────────────────────────── -->
  <div class="rounded-[14px] border border-surface-border bg-surface-card p-4 space-y-4">
    <div class="font-display text-[10px] uppercase tracking-wider text-ink-400" style="letter-spacing: 0.12em;">
      1 · Overview
    </div>

    <div class="grid gap-4 sm:grid-cols-2">
      <div>
        <label class="mb-1 block text-xs text-ink-500" for="mk-client">Client</label>
        {#if clientOrg}
          <div class="flex items-center gap-2">
            <a href={`/orgs/${clientOrg.id}`} class="text-sm font-medium text-ink-900 hover:underline">
              {clientOrg.name}
            </a>
            <button class="btn-ghost !px-1.5 !py-0.5 text-xs" onclick={clearOrg} aria-label="Remove client">
              <Icon name="x" size={12} />
            </button>
          </div>
        {:else}
          <div class="relative">
            <input
              id="mk-client"
              class="input w-full text-sm"
              placeholder="Search organizations…"
              bind:value={orgQuery}
              oninput={onOrgInput}
            />
            {#if orgMatches.length > 0}
              <ul
                class="absolute z-20 mt-1 w-full overflow-hidden rounded-[10px] border border-surface-border bg-surface-card shadow-lg"
              >
                {#each orgMatches as o (o.id)}
                  <li>
                    <button
                      class="w-full px-3 py-2 text-left text-sm hover:bg-surface-hover"
                      onclick={() => pickOrg(o)}
                    >{o.name}</button>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}
      </div>

      <div>
        <label class="mb-1 block text-xs text-ink-500" for="mk-project">Project</label>
        <select id="mk-project" class="input w-full text-sm" bind:value={projectId} onchange={saveOverview}>
          <option value="">— none —</option>
          {#each projectOptions as p (p.id)}
            <option value={p.id}>{p.label}</option>
          {/each}
        </select>
      </div>

      <div class="sm:col-span-2">
        <label class="mb-1 block text-xs text-ink-500" for="mk-adaccount">
          Meta ad account <span class="text-ink-400">— where this campaign publishes</span>
        </label>
        <select id="mk-adaccount" class="input w-full text-sm" bind:value={adAccountId} onchange={saveOverview}>
          <option value="">— not set (required before pushing to Meta) —</option>
          {#each linkedAccounts as a (a.id)}
            <option value={a.id}>{accountLabel(a)}</option>
          {/each}
        </select>
        <p class="mt-1 text-[11px] text-ink-400">
          Only accounts linked to a client show here —
          <a href="/marketing/setup" class="underline">manage ad accounts</a>.
        </p>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="mb-1 block text-xs text-ink-500" for="mk-start">Start</label>
          <input id="mk-start" type="date" class="input w-full text-sm" bind:value={dateStart} onchange={saveOverview} />
        </div>
        <div>
          <label class="mb-1 block text-xs text-ink-500" for="mk-end">End</label>
          <input id="mk-end" type="date" class="input w-full text-sm" bind:value={dateEnd} onchange={saveOverview} />
        </div>
      </div>

      <div class="grid grid-cols-[1fr_5rem] gap-3">
        <div>
          <label class="mb-1 block text-xs text-ink-500" for="mk-budget">Total budget</label>
          <input
            id="mk-budget"
            type="number"
            class="input w-full text-sm"
            bind:value={budgetTotal}
            onblur={saveOverview}
            placeholder="0"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs text-ink-500" for="mk-currency">Currency</label>
          <input id="mk-currency" class="input w-full text-sm" bind:value={currency} onblur={saveOverview} />
        </div>
      </div>
    </div>

    <div>
      <label class="mb-1 block text-xs text-ink-500" for="mk-objective">Objective (one-liner)</label>
      <input
        id="mk-objective"
        class="input w-full text-sm"
        bind:value={objectiveSummary}
        onblur={saveOverview}
        placeholder="What does success look like?"
      />
    </div>

    <div>
      <label class="mb-1 block text-xs text-ink-500" for="mk-brief">Brief</label>
      <textarea
        id="mk-brief"
        class="input w-full text-sm"
        rows="3"
        bind:value={brief}
        onblur={saveOverview}
        placeholder="Goal, audience, key messages…"
      ></textarea>
    </div>

    <div>
      <span class="mb-1 block text-xs text-ink-500">Tags</span>
      <div class="flex flex-wrap items-center gap-1.5">
        {#each selectedTags as t (t.id)}
          <span
            class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
            style="background: var(--bg-tertiary); color: var(--text-secondary);"
          >
            {t.name}
            <button class="text-ink-400 hover:text-ink-700" onclick={() => removeTag(t)} aria-label={`Remove tag ${t.name}`}>
              <Icon name="x" size={11} />
            </button>
          </span>
        {/each}
        <span class="relative">
          <input
            class="input !w-36 !py-1 text-xs"
            placeholder="Add tag…"
            bind:value={tagQuery}
          />
          {#if tagMatches.length > 0}
            <ul
              class="absolute z-20 mt-1 w-44 overflow-hidden rounded-[10px] border border-surface-border bg-surface-card shadow-lg"
            >
              {#each tagMatches as t (t.id)}
                <li>
                  <button class="w-full px-3 py-1.5 text-left text-xs hover:bg-surface-hover" onclick={() => addTag(t)}>
                    {t.name}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </span>
      </div>
    </div>
  </div>

  <!-- ── 2 · Meta structure ───────────────────────────────────────── -->
  <div class="rounded-[14px] border border-surface-border bg-surface-card p-4 space-y-4">
    <div class="flex items-center justify-between">
      <div class="font-display text-[10px] uppercase tracking-wider text-ink-400" style="letter-spacing: 0.12em;">
        2 · Meta ads structure
      </div>
      <div class="flex items-center gap-1">
        {#if metaCampaigns.length > 0}
          <button
            class="btn-ghost !px-2 text-xs"
            title="Save whole structure as template"
            aria-label="Save whole structure as template"
            onclick={saveStructureTemplate}
          >
            <Icon name="bookmark" size={13} />
          </button>
        {/if}
        {@render tplDropdown(['structure', 'meta_campaign'], campaignId)}
        {#if metaReady && adAccountId}
          <button
            class="btn-ghost text-xs"
            disabled={importingMeta}
            onclick={fetchFromMeta}
            title="Import every active campaign (with ad sets + ads) from the linked account, then pull their metrics"
          >
            <span class="inline-flex items-center gap-1">
              <Icon name="facebook" size={12} /> {importingMeta ? 'Fetching…' : 'Fetch from Meta'}
            </span>
          </button>
        {/if}
        <button class="btn-ghost text-xs" onclick={addMetaCampaign}>+ Meta campaign</button>
      </div>
    </div>

    {#if metaImportSummary}
      <p class="text-xs" style="color: #2F855A;">{metaImportSummary}</p>
    {/if}
    {#if metaReady && !adAccountId}
      <p class="text-[11px] text-ink-400">
        Tip: link a Meta ad account in <span class="font-medium">Overview</span> to pull your
        existing Ads Manager campaigns in with <span class="font-medium">Fetch from Meta</span>.
      </p>
    {/if}

    {#if metaCampaigns.length === 0}
      <p class="text-sm text-ink-500">
        No Meta campaigns yet. Build one here, or <span class="font-medium">Fetch from Meta</span> to
        import the ones already running in your ad account — then export, or just track their numbers.
      </p>
    {/if}

    {#each metaCampaigns as mc (mc.id)}
      <div class="rounded-[12px] border border-surface-border p-3 space-y-3" style="background: var(--bg-secondary);">
        <div class="flex flex-wrap items-center gap-2">
          <input class="input flex-1 min-w-40 text-sm font-medium" bind:value={mc.name} onblur={() => saveMetaCampaign(mc)} />
          <select class="input !w-auto text-xs" bind:value={mc.objective} onchange={() => saveMetaCampaign(mc)}>
            {#each MK_OBJECTIVES as o (o.value)}
              <option value={o.value}>{o.label}</option>
            {/each}
          </select>
          <select class="input !w-auto text-xs" bind:value={mc.status} onchange={() => saveMetaCampaign(mc)}>
            <option value="PAUSED">Paused</option>
            <option value="ACTIVE">Active</option>
          </select>
          <button
            class="btn-ghost !px-2 text-xs"
            title="Save Meta campaign as template"
            aria-label="Save Meta campaign as template"
            onclick={() => saveMetaCampaignTemplate(mc)}
          >
            <Icon name="bookmark" size={13} />
          </button>
          <button class="btn-ghost !px-2 text-xs" onclick={() => removeMetaCampaign(mc)} aria-label="Delete Meta campaign">
            <Icon name="x" size={13} />
          </button>
        </div>
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <span class="text-ink-500">Budget</span>
          <select class="input !w-auto !py-1 text-xs" bind:value={mc.budget_mode} onchange={() => saveMetaCampaign(mc)}>
            <option value="daily">Daily (campaign)</option>
            <option value="lifetime">Lifetime (campaign)</option>
            <option value="adset">Per ad set</option>
          </select>
          {#if mc.budget_mode !== 'adset'}
            <input
              type="number"
              class="input !w-28 !py-1 text-xs"
              bind:value={mc.budget_amount}
              onblur={() => saveMetaCampaign(mc)}
              placeholder="Amount"
            />
            <span class="text-ink-400">{currency}</span>
          {/if}
        </div>

        {#each adSets.filter((a) => Number(a.mk_meta_campaign_id) === mc.id) as as_ (as_.id)}
          {@const t = targetingOf(as_)}
          <div class="ml-3 rounded-[10px] border border-surface-border bg-surface-card p-3 space-y-3">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-[10px] font-semibold uppercase text-ink-400">Ad set</span>
              <input class="input flex-1 min-w-36 text-sm" bind:value={as_.name} onblur={() => saveAdSet(as_)} />
              <select class="input !w-auto text-xs" bind:value={as_.optimization_goal} onchange={() => saveAdSet(as_)}>
                {#each MK_OPTIMIZATION_GOALS as o (o.value)}
                  <option value={o.value}>{o.label}</option>
                {/each}
              </select>
              <button
                class="btn-ghost !px-2 text-xs"
                title="Save ad set as template"
                aria-label="Save ad set as template"
                onclick={() => saveAdSetTemplate(as_)}
              >
                <Icon name="bookmark" size={13} />
              </button>
              <button class="btn-ghost !px-2 text-xs" onclick={() => removeAdSet(as_)} aria-label="Delete ad set">
                <Icon name="x" size={13} />
              </button>
            </div>
            <div class="grid gap-2 text-xs sm:grid-cols-2">
              <label class="flex items-center gap-2">
                <span class="w-16 shrink-0 text-ink-500">Schedule</span>
                <input type="datetime-local" class="input !py-1 flex-1 text-xs" bind:value={as_.start_time} onchange={() => saveAdSet(as_)} />
                <input type="datetime-local" class="input !py-1 flex-1 text-xs" bind:value={as_.end_time} onchange={() => saveAdSet(as_)} />
              </label>
              {#if mc.budget_mode === 'adset'}
                <label class="flex items-center gap-2">
                  <span class="w-16 shrink-0 text-ink-500">Budget</span>
                  <select class="input !w-auto !py-1 text-xs" bind:value={as_.budget_mode} onchange={() => saveAdSet(as_)}>
                    <option value="daily">Daily</option>
                    <option value="lifetime">Lifetime</option>
                  </select>
                  <input type="number" class="input !w-24 !py-1 text-xs" bind:value={as_.budget_amount} onblur={() => saveAdSet(as_)} />
                </label>
              {/if}
              <label class="flex items-center gap-2">
                <span class="w-16 shrink-0 text-ink-500">Countries</span>
                <input
                  class="input !py-1 flex-1 text-xs"
                  value={(t.countries ?? []).join(', ')}
                  onchange={(e) => {
                    t.countries = (e.currentTarget as HTMLInputElement).value
                      .split(',')
                      .map((s) => s.trim().toUpperCase())
                      .filter(Boolean);
                    saveAdSet(as_);
                  }}
                  placeholder="IS"
                />
              </label>
              <label class="flex items-center gap-2">
                <span class="w-16 shrink-0 text-ink-500">Age</span>
                <input
                  type="number" class="input !w-16 !py-1 text-xs" placeholder="18"
                  value={t.ageMin ?? ''}
                  onchange={(e) => { const v = (e.currentTarget as HTMLInputElement).value; t.ageMin = v ? Number(v) : null; saveAdSet(as_); }}
                />
                <span class="text-ink-400">–</span>
                <input
                  type="number" class="input !w-16 !py-1 text-xs" placeholder="65"
                  value={t.ageMax ?? ''}
                  onchange={(e) => { const v = (e.currentTarget as HTMLInputElement).value; t.ageMax = v ? Number(v) : null; saveAdSet(as_); }}
                />
                <select
                  class="input !w-auto !py-1 text-xs"
                  value={t.genders ?? 'all'}
                  onchange={(e) => { t.genders = (e.currentTarget as HTMLSelectElement).value; saveAdSet(as_); }}
                >
                  <option value="all">All</option>
                  <option value="female">Women</option>
                  <option value="male">Men</option>
                </select>
              </label>
              <label class="flex items-center gap-2 sm:col-span-2">
                <span class="w-16 shrink-0 text-ink-500">Interests</span>
                <input
                  class="input !py-1 flex-1 text-xs"
                  value={t.interests ?? ''}
                  onchange={(e) => { t.interests = (e.currentTarget as HTMLInputElement).value || null; saveAdSet(as_); }}
                  placeholder="Entrepreneurship, Startups…"
                />
              </label>
            </div>

            {#each ads.filter((a) => Number(a.mk_ad_set_id) === as_.id) as ad (ad.id)}
              <div class="ml-3 rounded-[10px] border border-surface-border p-3 space-y-2" style="background: var(--bg-secondary);">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-[10px] font-semibold uppercase text-ink-400">Ad</span>
                  <input class="input flex-1 min-w-32 text-sm" bind:value={ad.name} onblur={() => saveAd(ad)} />
                  <select class="input !w-auto text-xs" bind:value={ad.call_to_action} onchange={() => saveAd(ad)}>
                    {#each MK_CTA_OPTIONS as o (o.value)}
                      <option value={o.value}>{o.label}</option>
                    {/each}
                  </select>
                  <button
                    class="btn-ghost !px-2 text-xs"
                    title="Save ad as template"
                    aria-label="Save ad as template"
                    onclick={() => saveAdTemplate(ad)}
                  >
                    <Icon name="bookmark" size={13} />
                  </button>
                  <button class="btn-ghost !px-2 text-xs" onclick={() => removeAd(ad)} aria-label="Delete ad">
                    <Icon name="x" size={13} />
                  </button>
                </div>
                <div class="flex gap-3">
                  <div class="flex-1 space-y-2">
                    <input class="input w-full text-xs" bind:value={ad.title} onblur={() => saveAd(ad)} placeholder="Headline (Title)" />
                    <textarea class="input w-full text-xs" rows="2" bind:value={ad.body} onblur={() => saveAd(ad)} placeholder="Primary text (Body)"></textarea>
                    <div class="grid gap-2 sm:grid-cols-2">
                      <input class="input w-full text-xs" bind:value={ad.link_url} onblur={() => saveAd(ad)} placeholder="https://destination…" />
                      <input class="input w-full text-xs" bind:value={ad.description} onblur={() => saveAd(ad)} placeholder="Link description" />
                    </div>
                  </div>
                  <div class="w-24 shrink-0">
                    {#if ad.image_id}
                      <img
                        src={assetUrl(ad.image_id, { width: 160, height: 160, fit: 'cover' })}
                        alt={ad.name ?? 'Ad creative'}
                        class="h-20 w-20 rounded-[8px] object-cover"
                      />
                    {:else}
                      <div class="flex h-20 w-20 items-center justify-center rounded-[8px] border border-dashed border-surface-border text-ink-300">
                        <Icon name="image" size={18} />
                      </div>
                    {/if}
                    <label class="btn-ghost mt-1 block cursor-pointer text-center !px-1 text-[10px]">
                      {ad.image_id ? 'Replace' : 'Add image'}
                      <input type="file" accept="image/*" class="hidden" onchange={(e) => onAdImagePicked(ad, e)} />
                    </label>
                  </div>
                </div>
              </div>
            {/each}
            <span class="ml-3 inline-flex items-center gap-1">
              <button class="btn-ghost text-xs" onclick={() => addAd(as_)}>+ Ad</button>
              {@render tplDropdown(['ad'], as_.id)}
            </span>
          </div>
        {/each}
        <span class="ml-3 inline-flex items-center gap-1">
          <button class="btn-ghost text-xs" onclick={() => addAdSet(mc)}>+ Ad set</button>
          {@render tplDropdown(['ad_set'], mc.id)}
        </span>
      </div>
    {/each}

    {#if metaCampaigns.length > 0}
      <div class="flex flex-wrap items-center gap-2 border-t border-surface-divider pt-3">
        <button class="btn-primary text-sm" onclick={exportBulkFile}>
          <span class="inline-flex items-center gap-1.5"><Icon name="download" size={14} /> Meta import file (.xlsx)</span>
        </button>
        {#if adsWithImages.length > 0}
          {#each adsWithImages as ad (ad.id)}
            <button class="btn-ghost text-xs" onclick={() => downloadAdImage(ad)} title={`Download ${adImageFileName(ad)}`}>
              <span class="inline-flex items-center gap-1"><Icon name="image" size={12} /> {adImageFileName(ad)}</span>
            </button>
          {/each}
        {/if}
        <p class="w-full text-[11px] text-ink-400">
          In Ads Manager: Import/Export → Import ads in bulk → upload this file (and the
          images, matching the file names above). Everything imports PAUSED — review, then
          activate there.
        </p>
      </div>
    {/if}
  </div>

  <!-- ── 3 · Metrics ──────────────────────────────────────────────── -->
  <div class="rounded-[14px] border border-surface-border bg-surface-card p-4 space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="font-display text-[10px] uppercase tracking-wider text-ink-400" style="letter-spacing: 0.12em;">
        3 · Performance
      </div>
      {#if metrics.length > 0}
        <div class="flex items-center gap-2">
          <div class="inline-flex overflow-hidden rounded-[8px] border border-surface-border text-xs">
            {#each PERIODS as p (p.value)}
              <button
                class="px-2 py-1 transition"
                style={period === p.value
                  ? 'background: var(--bg-tertiary); color: var(--text-primary); font-weight: 600;'
                  : 'color: var(--text-tertiary);'}
                onclick={() => (period = p.value)}
              >{p.label}</button>
            {/each}
          </div>
          <button class="btn-ghost text-xs" onclick={exportMetricsCsv} title="Download metrics as CSV">
            <span class="inline-flex items-center gap-1"><Icon name="download" size={12} /> CSV</span>
          </button>
        </div>
      {/if}
    </div>

    {#if metrics.length > 0}
      <div class="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {#each [
          ['Spend', formatMoney(totals.spend, currency)],
          ['Impressions', totals.impressions.toLocaleString('is-IS')],
          ['Clicks', totals.clicks.toLocaleString('is-IS')],
          ['Results', totals.results.toLocaleString('is-IS')],
          ['CTR', `${totals.ctr.toFixed(2)}%`],
          ['CPC', formatMoney(Math.round(totals.cpc), currency)]
        ] as [label, value] (label)}
          <div class="rounded-[10px] p-2 text-center" style="background: var(--bg-tertiary);">
            <div class="text-[10px] uppercase tracking-wide text-ink-400">{label}</div>
            <div class="text-sm font-semibold text-ink-900">{value}</div>
          </div>
        {/each}
      </div>

      {#if dailySeries.labels.length > 1}
        <div class="rounded-[10px] border border-surface-border p-3" style="background: var(--bg-secondary);">
          <div class="mb-1 text-[10px] uppercase tracking-wide text-ink-400">Daily trend</div>
          <MetricsChart
            labels={dailySeries.labels}
            series={[
              { label: 'Spend', color: 'var(--accent-electric)', values: dailySeries.spend },
              { label: 'Results', color: '#2F855A', values: dailySeries.results }
            ]}
          />
        </div>
      {/if}

      {#if breakdown.rows.length > 1}
        <div class="space-y-1.5">
          <div class="text-[10px] uppercase tracking-wide text-ink-400">By campaign</div>
          {#each breakdown.rows as r (r.name)}
            <div class="flex items-center gap-2 text-xs">
              <span class="w-32 shrink-0 truncate text-ink-700" title={r.name}>{r.name}</span>
              <span class="relative h-4 flex-1 overflow-hidden rounded-[4px]" style="background: var(--bg-tertiary);">
                <span
                  class="absolute inset-y-0 left-0 rounded-[4px]"
                  style={`width:${Math.max(2, (r.spend / breakdown.maxSpend) * 100)}%; background: var(--accent-electric); opacity:0.7;`}
                ></span>
              </span>
              <span class="w-24 shrink-0 text-right text-ink-700">{formatMoney(r.spend, currency)}</span>
              <span class="w-16 shrink-0 text-right text-ink-400">{r.results.toLocaleString('is-IS')} res</span>
            </div>
          {/each}
        </div>
      {/if}
    {/if}

    <!-- live sync from Meta -->
    {#if metaReady}
      <div class="rounded-[10px] border border-surface-border p-3 space-y-2" style="background: var(--bg-secondary);">
        <div class="flex flex-wrap items-center gap-2">
          <span class="inline-flex items-center gap-1.5 text-xs font-medium text-ink-700">
            <Icon name="facebook" size={13} /> Sync from Meta
          </span>
          {#if adAccountId}
            <label class="flex items-center gap-1 text-[11px] text-ink-500">
              from
              <input type="date" class="input !py-1 text-xs" bind:value={syncSince} aria-label="Sync from date" />
            </label>
            <label class="flex items-center gap-1 text-[11px] text-ink-500">
              to
              <input type="date" class="input !py-1 text-xs" bind:value={syncUntil} aria-label="Sync to date" />
            </label>
            <button class="btn-primary text-xs" disabled={syncing} onclick={syncFromMeta}>
              {syncing ? 'Syncing…' : 'Sync'}
            </button>
          {:else}
            <span class="text-[11px] text-ink-400">
              Link a Meta ad account in <span class="font-medium">Overview</span> to pull live numbers.
            </span>
          {/if}
        </div>
        {#if adAccountId}
          <p class="text-[11px] text-ink-400">
            Reads daily insights for each Meta campaign by name — no changes are made on Meta.
          </p>
        {/if}
        {#if syncSummary}
          <p class="text-xs" style="color: #2F855A;">{syncSummary}</p>
        {/if}
      </div>
    {/if}

    <!-- import -->
    <div class="space-y-2">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-xs font-medium text-ink-700">Import Ads Manager report</span>
        <label class="btn-ghost cursor-pointer text-xs">
          Choose CSV…
          <input type="file" accept=".csv,.txt,.tsv" class="hidden" onchange={onReportFile} />
        </label>
        <span class="text-[11px] text-ink-400">or paste the exported table below (needs a day breakdown)</span>
      </div>
      <textarea
        class="input w-full font-mono text-xs"
        rows="3"
        bind:value={reportText}
        oninput={previewReport}
        placeholder="Campaign name,Day,Amount spent (ISK),Impressions,Link clicks,Results…"
      ></textarea>
      {#if reportPreview}
        <div class="rounded-[10px] border border-surface-border p-3 text-xs" style="background: var(--bg-secondary);">
          {#if reportPreview.warnings.length > 0}
            <ul class="mb-1 space-y-0.5" style="color: #B7791F;">
              {#each reportPreview.warnings as w (w)}<li>⚠ {w}</li>{/each}
            </ul>
          {/if}
          <p class="text-ink-700">
            {reportPreview.rows.length} daily rows across {reportPreview.names.length}
            campaign{reportPreview.names.length === 1 ? '' : 's'}:
            {reportPreview.names.join(', ')}
          </p>
          <button
            class="btn-primary mt-2 text-xs"
            disabled={importing || reportPreview.rows.length === 0}
            onclick={commitImport}
          >{importing ? 'Importing…' : `Import ${reportPreview.rows.length} rows`}</button>
        </div>
      {/if}
      {#if importSummary}
        <p class="text-xs" style="color: #2F855A;">{importSummary}</p>
      {/if}
    </div>

    <!-- manual entry -->
    <details>
      <summary class="cursor-pointer text-xs text-ink-500">Add a row manually</summary>
      <div class="mt-2 flex flex-wrap items-end gap-2 text-xs">
        <input type="date" class="input !py-1 text-xs" bind:value={mDate} aria-label="Date" />
        <input class="input !w-40 !py-1 text-xs" bind:value={mName} placeholder="Campaign name" aria-label="Campaign name" />
        <input type="number" class="input !w-24 !py-1 text-xs" bind:value={mSpend} placeholder="Spend" aria-label="Spend" />
        <input type="number" class="input !w-24 !py-1 text-xs" bind:value={mImpr} placeholder="Impressions" aria-label="Impressions" />
        <input type="number" class="input !w-20 !py-1 text-xs" bind:value={mClicks} placeholder="Clicks" aria-label="Clicks" />
        <input type="number" class="input !w-20 !py-1 text-xs" bind:value={mResults} placeholder="Results" aria-label="Results" />
        <button class="btn-ghost text-xs" onclick={addManualMetric}>Add</button>
      </div>
    </details>

    <!-- table -->
    {#if metricsByDate.length > 0}
      <div class="overflow-x-auto">
        <table class="w-full text-xs">
          <thead>
            <tr class="border-b border-surface-divider text-left text-[10px] uppercase tracking-wide text-ink-400">
              <th class="py-1.5 pr-2">Date</th>
              <th class="py-1.5 pr-2">Campaign</th>
              <th class="py-1.5 pr-2 text-right">Spend</th>
              <th class="py-1.5 pr-2 text-right">Impr.</th>
              <th class="py-1.5 pr-2 text-right">Clicks</th>
              <th class="py-1.5 pr-2 text-right">Results</th>
              <th class="py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {#each metricsByDate as m (m.id)}
              <tr class="border-b border-surface-divider/50">
                <td class="py-1.5 pr-2 whitespace-nowrap text-ink-700">{m.date?.slice(0, 10)}</td>
                <td class="py-1.5 pr-2 text-ink-900">
                  {m.ref_name}
                  {#if m.source === 'manual'}<span class="ml-1 text-[10px] text-ink-400">(manual)</span>
                  {:else if m.source === 'meta'}<span class="ml-1 text-[10px]" style="color: var(--accent-electric);">(Meta)</span>{/if}
                </td>
                <td class="py-1.5 pr-2 text-right text-ink-700">{m.spend != null ? formatMoney(m.spend, currency) : '–'}</td>
                <td class="py-1.5 pr-2 text-right text-ink-700">{num(m.impressions)}</td>
                <td class="py-1.5 pr-2 text-right text-ink-700">{num(m.clicks)}</td>
                <td class="py-1.5 pr-2 text-right text-ink-700">{num(m.results)}</td>
                <td class="py-1.5 text-right">
                  <button class="text-ink-300 hover:text-ink-700" onclick={() => removeMetric(m)} aria-label="Delete row">
                    <Icon name="x" size={12} />
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <p class="text-sm text-ink-500">No performance data yet — import a report or add a row manually.</p>
    {/if}
  </div>

  <!-- ── 4 · Organic content ──────────────────────────────────────── -->
  <div class="rounded-[14px] border border-surface-border bg-surface-card p-4 space-y-3">
    <div class="font-display text-[10px] uppercase tracking-wider text-ink-400" style="letter-spacing: 0.12em;">
      4 · Organic content
    </div>
    {#if data.organic.length === 0}
      <p class="text-sm text-ink-500">
        No organic content tied yet. Open an <a href="/tools/evergreen" class="underline">Evergreen</a> campaign and set
        its “Part of marketing campaign” to <span class="font-medium">{name || 'this campaign'}</span> to see its posts here.
      </p>
    {:else}
      <ul class="divide-y divide-surface-divider">
        {#each data.organic as o (o.id)}
          <li class="flex items-center gap-3 py-2">
            <span class="flex h-8 w-8 shrink-0 items-center justify-center" style="background: var(--bg-tertiary); color: var(--text-secondary); border-radius: var(--radius-md);">
              <Icon name="bolt" size={14} />
            </span>
            <a href={`/tools/evergreen/${o.id}`} class="min-w-0 flex-1">
              <span class="block truncate font-medium text-ink-900">{o.name ?? '(untitled)'}</span>
              <span class="text-[11px] text-ink-500">
                {(o.platforms ?? []).join(', ') || 'no platforms'}
                · {o.counts.total} post{o.counts.total === 1 ? '' : 's'}{o.counts.used ? ` · ${o.counts.used} published` : ''}
              </span>
            </a>
            {#if o.status && o.status !== 'active'}
              <span class="rounded-full px-1.5 py-0.5 text-[10px] uppercase" style="background: var(--bg-tertiary); color: var(--text-tertiary);">{o.status}</span>
            {/if}
            <a href={`/tools/evergreen/${o.id}`} class="shrink-0 text-ink-300" aria-label="Open Evergreen campaign"><Icon name="chevron-right" size={14} /></a>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>
