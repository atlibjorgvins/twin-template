// Types + pure aggregation for the /insights dashboard.
//
// NO $lib imports, deliberately — same constraint as eventTime.ts and
// receiptParser.ts, so bare `node --test` can run metrics.test.ts. data.ts is
// the side of the wall that talks to Directus; it imports these types and maps
// rows into them. Everything here is structural and side-effect free.
//
// Two rules this file exists to enforce:
//
//  1. **Dedupe before counting.** A person who did three cohorts is ONE person
//     and three memberships. Headline counts are of distinct entities; the
//     per-cohort series counts memberships. Conflating them is how a dashboard
//     ends up claiming 413 participants when 205 people took part.
//
//  2. **Never invent a category.** Unknown gender is shown as Unknown, not
//     dropped and not redistributed. A dashboard that hides its own gaps is
//     worse than one that admits them.

// ── Input shapes (produced by data.ts) ───────────────────────────────────

/** One cohort (or the programme row itself) in the analysed tree. */
export type InsightsCohort = {
  id: number;
  name: string;
  year: number | null;
  startDate: string | null;
  endDate: string | null;
  /** Planned intake, straight off the Project row — the denominator the
   *  programme itself claims, useful next to the memberships we counted. */
  participantCount: number | null;
  applicationCount: number | null;
  /** True for the programme row; its own direct links are counted but it is
   *  not a cohort in the "one per year" sense. */
  isRoot: boolean;
};

export type InsightsPersonLink = {
  projectId: number;
  role: string | null;
  isCurrent: boolean;
  person: {
    id: number;
    name: string;
    sex: 'male' | 'female' | 'unknown';
    /** Raw stored value, kept for the export so we never launder the source. */
    genderRaw: string | null;
    picture: string | null;
    focal: string | null;
    email: string | null;
    city: string | null;
    country: string | null;
  };
};

export type InsightsOrgLink = {
  projectId: number;
  role: string | null;
  org: {
    id: number;
    name: string;
    logo: string | null;
    focal: string | null;
    website: string | null;
    industry: string | null;
    orgType: string | null;
    isActive: boolean;
    foundedYear: number | null;
  };
};

/** A grant award, already flattened out of Directus's relational shape. */
export type InsightsAward = {
  id: number;
  orgId: number | null;
  orgName: string;
  fund: string;
  year: number | null;
  amount: number;
  currency: string;
  status: string;
};

export type InsightsBundle = {
  rootId: number;
  rootName: string;
  /** The programme row plus every descendant, most recent year first. */
  cohorts: InsightsCohort[];
  personLinks: InsightsPersonLink[];
  orgLinks: InsightsOrgLink[];
  /** All-time awards for every org in the tree — not clipped to the cohort
   *  window. computeMetrics splits them before/after participation. */
  awards: InsightsAward[];
};

// ── Filters ─────────────────────────────────────────────────────────────

export type Filters = {
  /** Cohort years to include. Empty = every year. */
  years: Set<number>;
  /** `role_in_project` on Project_people. 'all' = no filter. */
  personRole: string | 'all';
  /** `role_in_project` on Project_organization. 'all' = no filter. */
  orgRole: string | 'all';
  /** false = only the programme row's own direct links, no cohorts. */
  includeCohorts: boolean;
  /** false = drop memberships explicitly flagged not-current. */
  includeFormerMembers: boolean;
};

export function emptyFilters(): Filters {
  return {
    years: new Set(),
    personRole: 'all',
    orgRole: 'all',
    includeCohorts: true,
    includeFormerMembers: true
  };
}

// ── Output shapes ───────────────────────────────────────────────────────

export type PersonRow = InsightsPersonLink['person'] & {
  roles: string[];
  cohortIds: number[];
  years: number[];
  /** How many cohorts this person appears in — the "returning mentor" signal. */
  cohortCount: number;
};

export type OrgRow = {
  id: number;
  name: string;
  logo: string | null;
  focal: string | null;
  website: string | null;
  industry: string | null;
  isActive: boolean;
  roles: string[];
  cohortIds: number[];
  years: number[];
  /** Earliest cohort year the org appears in — the participation baseline
   *  that splits its grants into before/after. */
  firstYear: number | null;
  grantTotal: number;
  grantCount: number;
};

export type AwardRow = InsightsAward & {
  /** Relative to the org's first cohort year in this programme. 'unknown'
   *  when either year is missing — counted in the total, excluded from the
   *  before/after split rather than guessed at. */
  timing: 'before' | 'after' | 'unknown';
};

export type CohortRow = {
  id: number;
  name: string;
  year: number | null;
  startDate: string | null;
  endDate: string | null;
  /** Distinct orgs / people linked to this cohort. */
  orgs: number;
  people: number;
  participants: number;
  mentors: number;
  participantCount: number | null;
  applicationCount: number | null;
};

export type Split = { key: string; label: string; value: number };

export type Metrics = {
  cohorts: CohortRow[];
  people: PersonRow[];
  orgs: OrgRow[];
  awards: AwardRow[];
  kpi: {
    orgs: number;
    people: number;
    cohorts: number;
    participants: number;
    mentors: number;
    /** Memberships, not distinct entities — the "seats filled" number. */
    personLinks: number;
    orgLinks: number;
    grantTotal: number;
    grantTotalAfter: number;
    grantCount: number;
    fundedOrgs: number;
    activeOrgs: number;
    returningPeople: number;
  };
  gender: {
    all: Split[];
    byRole: Array<{ role: string; label: string; splits: Split[]; total: number }>;
    /** Share of people whose gender is recorded — the honesty caveat that
     *  every gender figure on the page is footnoted with. */
    knownShare: number;
  };
  grantsByYear: Array<{ year: number; before: number; after: number; unknown: number }>;
  grantsByFund: Array<{ fund: string; amount: number; count: number }>;
  topRecipients: Array<{ orgId: number; name: string; amount: number; count: number }>;
  currencies: string[];
};

const ROLE_LABELS: Record<string, string> = {
  participant: 'Participants',
  mentor: 'Mentors',
  organizer: 'Organisers',
  teacher: 'Teachers',
  co_founder: 'Co-founders',
  connection: 'Connections',
  advisory_board: 'Advisory board',
  cohort_member: 'Cohort members',
  gold_sponsor: 'Gold sponsors',
  silver_sponsor: 'Silver sponsors',
  bronze_sponsor: 'Bronze sponsors',
  host: 'Hosts',
  owner: 'Owners',
  other: 'Other'
};

export function roleLabel(role: string | null): string {
  if (!role) return 'Unspecified';
  return ROLE_LABELS[role] ?? role.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export const SEX_LABELS: Record<'male' | 'female' | 'unknown', string> = {
  female: 'Women',
  male: 'Men',
  unknown: 'Not recorded'
};

/** Which cohort ids the filters admit, plus a year lookup for them. */
function selectCohorts(bundle: InsightsBundle, f: Filters) {
  const byId = new Map<number, InsightsCohort>();
  for (const c of bundle.cohorts) byId.set(c.id, c);
  const selected = bundle.cohorts.filter((c) => {
    if (!f.includeCohorts && !c.isRoot) return false;
    // A yearless row (the programme itself, an undated sub-project) survives a
    // year filter: excluding it would silently drop its direct memberships.
    if (f.years.size > 0 && c.year != null && !f.years.has(c.year)) return false;
    return true;
  });
  return { byId, selected, selectedIds: new Set(selected.map((c) => c.id)) };
}

export function computeMetrics(bundle: InsightsBundle, f: Filters): Metrics {
  const { byId, selected, selectedIds } = selectCohorts(bundle, f);

  const personLinks = bundle.personLinks.filter(
    (l) =>
      selectedIds.has(l.projectId) &&
      (f.personRole === 'all' || (l.role ?? '') === f.personRole) &&
      (f.includeFormerMembers || l.isCurrent)
  );
  const orgLinks = bundle.orgLinks.filter(
    (l) => selectedIds.has(l.projectId) && (f.orgRole === 'all' || (l.role ?? '') === f.orgRole)
  );

  // ── Distinct people, with their roles/cohorts folded in ────────────────
  const peopleById = new Map<number, PersonRow>();
  for (const l of personLinks) {
    const year = byId.get(l.projectId)?.year ?? null;
    const existing = peopleById.get(l.person.id);
    if (existing) {
      if (l.role && !existing.roles.includes(l.role)) existing.roles.push(l.role);
      if (!existing.cohortIds.includes(l.projectId)) existing.cohortIds.push(l.projectId);
      if (year != null && !existing.years.includes(year)) existing.years.push(year);
    } else {
      peopleById.set(l.person.id, {
        ...l.person,
        roles: l.role ? [l.role] : [],
        cohortIds: [l.projectId],
        years: year != null ? [year] : [],
        cohortCount: 0
      });
    }
  }
  const people = [...peopleById.values()].map((p) => ({
    ...p,
    years: p.years.sort((a, b) => b - a),
    cohortCount: p.cohortIds.length
  }));

  // ── Distinct orgs ──────────────────────────────────────────────────────
  const orgsById = new Map<number, OrgRow>();
  for (const l of orgLinks) {
    const year = byId.get(l.projectId)?.year ?? null;
    const existing = orgsById.get(l.org.id);
    if (existing) {
      if (l.role && !existing.roles.includes(l.role)) existing.roles.push(l.role);
      if (!existing.cohortIds.includes(l.projectId)) existing.cohortIds.push(l.projectId);
      if (year != null && !existing.years.includes(year)) existing.years.push(year);
    } else {
      orgsById.set(l.org.id, {
        id: l.org.id,
        name: l.org.name,
        logo: l.org.logo,
        focal: l.org.focal,
        website: l.org.website,
        industry: l.org.industry,
        isActive: l.org.isActive,
        roles: l.role ? [l.role] : [],
        cohortIds: [l.projectId],
        years: year != null ? [year] : [],
        firstYear: year,
        grantTotal: 0,
        grantCount: 0
      });
    }
  }
  for (const o of orgsById.values()) {
    o.years.sort((a, b) => b - a);
    o.firstYear = o.years.length ? o.years[o.years.length - 1] : null;
  }

  // ── Awards, attributed relative to the org's first cohort year ─────────
  const awards: AwardRow[] = [];
  for (const a of bundle.awards) {
    // An award only belongs on this dashboard if its org survived the org
    // filters — otherwise "grants" and "orgs" would describe different sets.
    if (a.orgId == null) continue;
    const org = orgsById.get(a.orgId);
    if (!org) continue;
    const base = org.firstYear;
    const timing: AwardRow['timing'] =
      a.year == null || base == null ? 'unknown' : a.year >= base ? 'after' : 'before';
    org.grantTotal += a.amount;
    org.grantCount += 1;
    awards.push({ ...a, timing });
  }
  const orgs = [...orgsById.values()];

  // ── Per-cohort series ─────────────────────────────────────────────────
  // The programme row is excluded: it is the container, and plotting it beside
  // its own children double-counts. A childless project is its own only row.
  const cohortRows: CohortRow[] = selected
    .filter((c) => !c.isRoot || bundle.cohorts.length === 1)
    .map((c) => {
      const cPeople = personLinks.filter((l) => l.projectId === c.id);
      const cOrgs = orgLinks.filter((l) => l.projectId === c.id);
      return {
        id: c.id,
        name: c.name,
        year: c.year,
        startDate: c.startDate,
        endDate: c.endDate,
        orgs: new Set(cOrgs.map((l) => l.org.id)).size,
        people: new Set(cPeople.map((l) => l.person.id)).size,
        participants: new Set(
          cPeople.filter((l) => l.role === 'participant').map((l) => l.person.id)
        ).size,
        mentors: new Set(cPeople.filter((l) => l.role === 'mentor').map((l) => l.person.id)).size,
        participantCount: c.participantCount,
        applicationCount: c.applicationCount
      };
    })
    // Chronological left-to-right: a time axis reads forward.
    .sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || a.name.localeCompare(b.name));

  // ── Gender ────────────────────────────────────────────────────────────
  const splitOf = (rows: PersonRow[]): Split[] => {
    const counts: Record<'female' | 'male' | 'unknown', number> = { female: 0, male: 0, unknown: 0 };
    for (const p of rows) counts[p.sex] += 1;
    return (['female', 'male', 'unknown'] as const).map((k) => ({
      key: k,
      label: SEX_LABELS[k],
      value: counts[k]
    }));
  };
  const rolesPresent = [...new Set(personLinks.map((l) => l.role ?? ''))]
    .filter(Boolean)
    .sort((a, b) => roleLabel(a).localeCompare(roleLabel(b)));
  const genderByRole = rolesPresent.map((role) => {
    const rows = people.filter((p) => p.roles.includes(role));
    return { role, label: roleLabel(role), splits: splitOf(rows), total: rows.length };
  });
  const known = people.filter((p) => p.sex !== 'unknown').length;

  // ── Grants rollups ────────────────────────────────────────────────────
  const yearMap = new Map<number, { year: number; before: number; after: number; unknown: number }>();
  for (const a of awards) {
    if (a.year == null) continue;
    const row = yearMap.get(a.year) ?? { year: a.year, before: 0, after: 0, unknown: 0 };
    row[a.timing] += a.amount;
    yearMap.set(a.year, row);
  }
  const grantsByYear = [...yearMap.values()].sort((a, b) => a.year - b.year);

  const fundMap = new Map<string, { fund: string; amount: number; count: number }>();
  for (const a of awards) {
    const row = fundMap.get(a.fund) ?? { fund: a.fund, amount: 0, count: 0 };
    row.amount += a.amount;
    row.count += 1;
    fundMap.set(a.fund, row);
  }
  const grantsByFund = [...fundMap.values()].sort((a, b) => b.amount - a.amount);

  const topRecipients = orgs
    .filter((o) => o.grantTotal > 0)
    .sort((a, b) => b.grantTotal - a.grantTotal)
    .map((o) => ({ orgId: o.id, name: o.name, amount: o.grantTotal, count: o.grantCount }));

  const grantTotal = awards.reduce((s, a) => s + a.amount, 0);
  const grantTotalAfter = awards
    .filter((a) => a.timing === 'after')
    .reduce((s, a) => s + a.amount, 0);

  return {
    cohorts: cohortRows,
    people: people.sort((a, b) => a.name.localeCompare(b.name)),
    orgs: orgs.sort((a, b) => a.name.localeCompare(b.name)),
    awards: awards.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || b.amount - a.amount),
    kpi: {
      orgs: orgs.length,
      people: people.length,
      cohorts: cohortRows.length,
      participants: people.filter((p) => p.roles.includes('participant')).length,
      mentors: people.filter((p) => p.roles.includes('mentor')).length,
      personLinks: personLinks.length,
      orgLinks: orgLinks.length,
      grantTotal,
      grantTotalAfter,
      grantCount: awards.length,
      fundedOrgs: orgs.filter((o) => o.grantCount > 0).length,
      activeOrgs: orgs.filter((o) => o.isActive).length,
      returningPeople: people.filter((p) => p.cohortCount > 1).length
    },
    gender: {
      all: splitOf(people),
      byRole: genderByRole,
      knownShare: people.length ? known / people.length : 0
    },
    grantsByYear,
    grantsByFund,
    topRecipients,
    currencies: [...new Set(awards.map((a) => a.currency))].sort()
  };
}

/**
 * Y-axis steps for a bar chart. Lives here rather than in the chart component
 * so the arithmetic is testable.
 *
 * Two rules, both learned from getting it wrong on real data:
 *  • Steps are 1/2/5 × a power of ten and nothing else. Allowing 2.5 puts
 *    "2.5 people" on an axis that counts people.
 *  • Search starts one decade BELOW the maximum and accepts up to six
 *    intervals. Starting at the maximum's own decade gave a 117M chart an axis
 *    of 0–200M with two gridlines, so the tallest bar filled half the plot.
 */
export function axisTicks(max: number): { step: number; axisMax: number; ticks: number[] } {
  const safeMax = Math.max(1, max);
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(safeMax)) - 1) || 1;
  let step = 100 * magnitude;
  for (const m of [1, 2, 5, 10, 20, 50, 100]) {
    const candidate = m * magnitude;
    if (safeMax / candidate <= 6) {
      step = candidate;
      break;
    }
  }
  const axisMax = Math.max(step, Math.ceil(safeMax / step) * step);
  const ticks = Array.from({ length: Math.round(axisMax / step) + 1 }, (_, i) => i * step);
  return { step, axisMax, ticks };
}

/** Strip the programme name off a cohort's name: "Startup SuperNova 2026 -
 *  Superclass" inside the SuperNova dashboard is just "2026 - Superclass". */
function withoutProgramme(name: string, programme: string): string {
  if (programme && name.toLowerCase().startsWith(programme.toLowerCase())) {
    const rest = name.slice(programme.length).replace(/^[\s–—-]+/, '').trim();
    if (rest) return rest;
  }
  return name;
}

/** X-axis labels for the cohort chart. The year is the label you want — but a
 *  programme can hold two cohorts in one year (a main cohort and a Superclass),
 *  and two bars both labelled "2026" is a chart that cannot be read. Only the
 *  colliding ones get a disambiguator, so the common case stays clean. */
export function cohortLabels(cohorts: CohortRow[], programmeName = ''): string[] {
  const base = cohorts.map((c) =>
    c.year != null ? String(c.year) : withoutProgramme(c.name, programmeName)
  );
  const collisions = new Map<string, number>();
  for (const b of base) collisions.set(b, (collisions.get(b) ?? 0) + 1);

  // "Startup SuperNova 2026" has nothing left once the programme name and the
  // year come off, while "…2026 - Superclass" has "Superclass". Marking only
  // the one that HAS something to say resolves the collision and leaves the
  // main cohort as a clean "2026" — labelling it "2026 #37" would push a
  // database id onto an axis a human reads.
  const bareUsed = new Set<string>();
  return cohorts.map((c, i) => {
    if ((collisions.get(base[i]) ?? 0) <= 1) return base[i];
    const extra = withoutProgramme(c.name, programmeName)
      .replace(String(c.year ?? ''), '')
      .replace(/^[\s–—-]+/, '')
      .trim()
      .slice(0, 12);
    if (extra) return `${base[i]} ${extra}`;
    // Nothing distinguishing: the first such row keeps the bare label, and any
    // further one falls back to its id so no two labels are ever identical.
    if (!bareUsed.has(base[i])) {
      bareUsed.add(base[i]);
      return base[i];
    }
    return `${base[i]} #${c.id}`;
  });
}

/** Years available for the filter row, newest first. */
export function availableYears(bundle: InsightsBundle): number[] {
  return [...new Set(bundle.cohorts.map((c) => c.year).filter((y): y is number => y != null))].sort(
    (a, b) => b - a
  );
}

/** Person roles actually used in this programme — the filter row shows only
 *  what exists, so it never offers a chip that yields zero rows. */
export function availablePersonRoles(bundle: InsightsBundle): string[] {
  return [...new Set(bundle.personLinks.map((l) => l.role ?? '').filter(Boolean))].sort((a, b) =>
    roleLabel(a).localeCompare(roleLabel(b))
  );
}

export function availableOrgRoles(bundle: InsightsBundle): string[] {
  return [...new Set(bundle.orgLinks.map((l) => l.role ?? '').filter(Boolean))].sort((a, b) =>
    roleLabel(a).localeCompare(roleLabel(b))
  );
}

/** Compact money for KPI tiles: 297.3M, 1.2bn, 850k. Full precision stays in
 *  the table view and the export. */
export function formatCompactMoney(n: number, currency = 'ISK'): string {
  const abs = Math.abs(n);
  const unit =
    abs >= 1e9
      ? { d: 1e9, s: 'bn' }
      : abs >= 1e6
        ? { d: 1e6, s: 'M' }
        : abs >= 1e3
          ? { d: 1e3, s: 'k' }
          : { d: 1, s: '' };
  const v = n / unit.d;
  const digits = unit.s && Math.abs(v) < 100 ? 1 : 0;
  // Drop a trailing ".0" — an axis reading "20.0M, 40.0M, 100M" mixes two
  // precisions in one column for no gain.
  const text = v.toFixed(digits).replace(/\.0$/, '');
  return `${text}${unit.s}${currency ? ` ${currency}` : ''}`;
}

export function formatMoney(n: number, currency = 'ISK'): string {
  return `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(n)}${currency ? ` ${currency}` : ''}`;
}

export function formatPercent(share: number, digits = 0): string {
  return `${(share * 100).toFixed(digits)}%`;
}
