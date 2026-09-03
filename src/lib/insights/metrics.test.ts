// The dashboard's arithmetic. These are the mistakes a BI page makes silently:
// counting a returning mentor twice, redistributing unrecorded gender, and
// crediting a grant to a programme that was awarded before the org ever
// applied. Each has a test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMetrics,
  emptyFilters,
  availableYears,
  formatCompactMoney,
  cohortLabels,
  axisTicks,
  type InsightsBundle
} from './metrics.ts';

// ── Fixture ──────────────────────────────────────────────────────────────
// Shaped like the real "Startup SuperNova" programme: a parent row plus two
// cohorts. Kata is a returning mentor (both years). Acme joined in 2021 and
// took a grant in 2020 (before) and 2023 (after).
function bundle(): InsightsBundle {
  const cohort = (id: number, year: number) => ({
    id,
    name: `Programme ${year}`,
    year,
    startDate: `${year}-08-01`,
    endDate: `${year}-09-30`,
    participantCount: 10,
    applicationCount: year === 2021 ? 82 : null,
    isRoot: false
  });
  const person = (
    id: number,
    name: string,
    sex: 'male' | 'female' | 'unknown',
    genderRaw: string | null
  ) => ({
    id,
    name,
    sex,
    genderRaw,
    picture: null,
    focal: null,
    email: null,
    city: null,
    country: null
  });
  const org = (id: number, name: string, isActive = true) => ({
    id,
    name,
    logo: null,
    focal: null,
    website: null,
    industry: null,
    orgType: null,
    isActive,
    foundedYear: null
  });
  return {
    rootId: 5,
    rootName: 'Programme',
    cohorts: [
      cohort(52, 2021),
      cohort(77, 2023),
      {
        id: 5,
        name: 'Programme',
        year: null,
        startDate: null,
        endDate: null,
        participantCount: null,
        applicationCount: null,
        isRoot: true
      }
    ],
    personLinks: [
      { projectId: 52, role: 'participant', isCurrent: true, person: person(1, 'Ari', 'male', 'male') },
      { projectId: 52, role: 'mentor', isCurrent: true, person: person(2, 'Kata', 'female', 'kona') },
      { projectId: 77, role: 'mentor', isCurrent: true, person: person(2, 'Kata', 'female', 'kona') },
      { projectId: 77, role: 'participant', isCurrent: true, person: person(3, 'Bo', 'unknown', null) },
      // A former membership — excluded when includeFormerMembers is off.
      { projectId: 77, role: 'participant', isCurrent: false, person: person(4, 'Dís', 'female', 'female') }
    ],
    orgLinks: [
      { projectId: 52, role: 'cohort_member', org: org(100, 'Acme') },
      { projectId: 77, role: 'cohort_member', org: org(100, 'Acme') },
      { projectId: 77, role: 'cohort_member', org: org(200, 'Dead Co', false) },
      { projectId: 77, role: 'gold_sponsor', org: org(300, 'Sponsor Inc') }
    ],
    awards: [
      { id: 1, orgId: 100, orgName: 'Acme', fund: 'Sproti', year: 2020, amount: 5_000_000, currency: 'ISK', status: 'awarded' },
      { id: 2, orgId: 100, orgName: 'Acme', fund: 'Sproti', year: 2023, amount: 20_000_000, currency: 'ISK', status: 'awarded' },
      { id: 3, orgId: 200, orgName: 'Dead Co', fund: 'Fræ', year: null, amount: 1_000_000, currency: 'ISK', status: 'offered' }
    ]
  };
}

test('headline counts are distinct entities, not memberships', () => {
  const m = computeMetrics(bundle(), emptyFilters());
  // 5 person links, 4 distinct people — Kata appears in both cohorts.
  assert.equal(m.kpi.personLinks, 5);
  assert.equal(m.kpi.people, 4, 'a returning mentor is one person');
  assert.equal(m.kpi.orgLinks, 4);
  assert.equal(m.kpi.orgs, 3, 'Acme did two cohorts and is one org');
  assert.equal(m.kpi.returningPeople, 1);
});

test('the programme row is not plotted beside its own cohorts', () => {
  const m = computeMetrics(bundle(), emptyFilters());
  assert.deepEqual(
    m.cohorts.map((c) => c.year),
    [2021, 2023],
    'chronological, and the yearless parent is excluded'
  );
});

test('a childless project still gets one cohort row', () => {
  const b = bundle();
  b.cohorts = [b.cohorts[2]]; // the root alone
  b.personLinks = [{ ...b.personLinks[0], projectId: 5 }];
  b.orgLinks = [{ ...b.orgLinks[0], projectId: 5 }];
  const m = computeMetrics(b, emptyFilters());
  assert.equal(m.cohorts.length, 1, 'a plain project charts as itself');
  assert.equal(m.cohorts[0].people, 1);
});

test('unrecorded gender is its own category, never redistributed', () => {
  const m = computeMetrics(bundle(), emptyFilters());
  const byKey = Object.fromEntries(m.gender.all.map((s) => [s.key, s.value]));
  assert.deepEqual(byKey, { female: 2, male: 1, unknown: 1 });
  assert.equal(
    m.gender.all.reduce((s, x) => s + x.value, 0),
    m.kpi.people,
    'the split must sum to the people count'
  );
  assert.equal(m.gender.knownShare, 0.75);
});

test('gender by role uses distinct people per role', () => {
  const m = computeMetrics(bundle(), emptyFilters());
  const mentors = m.gender.byRole.find((r) => r.role === 'mentor');
  assert.equal(mentors?.total, 1, 'Kata mentored twice, counted once');
  const participants = m.gender.byRole.find((r) => r.role === 'participant');
  assert.equal(participants?.total, 3);
});

test('grants split on the org first cohort year, not the programme year', () => {
  const m = computeMetrics(bundle(), emptyFilters());
  // Acme's first cohort is 2021 → the 2020 award is "before", 2023 "after".
  const before = m.awards.find((a) => a.year === 2020);
  const after = m.awards.find((a) => a.year === 2023);
  assert.equal(before?.timing, 'before');
  assert.equal(after?.timing, 'after');
  assert.equal(m.kpi.grantTotal, 26_000_000, 'all-time total includes every award');
  assert.equal(m.kpi.grantTotalAfter, 20_000_000, 'only post-participation money');
});

test('an award with no year counts in the total but not the split', () => {
  const m = computeMetrics(bundle(), emptyFilters());
  const unknown = m.awards.find((a) => a.id === 3);
  assert.equal(unknown?.timing, 'unknown');
  const plotted = m.grantsByYear.reduce((s, r) => s + r.before + r.after + r.unknown, 0);
  assert.equal(plotted, 25_000_000, 'the yearless award is not on the year axis');
  assert.equal(m.kpi.grantTotal, 26_000_000, 'but it is in the headline total');
});

test('an org filter also narrows the grants, so both cards describe one set', () => {
  const f = { ...emptyFilters(), orgRole: 'gold_sponsor' };
  const m = computeMetrics(bundle(), f);
  assert.equal(m.kpi.orgs, 1);
  assert.equal(m.kpi.grantCount, 0, 'Acme is filtered out, so its grants are too');
});

test('a year filter narrows every series at once', () => {
  const f = { ...emptyFilters(), years: new Set([2023]) };
  const m = computeMetrics(bundle(), f);
  assert.equal(m.cohorts.length, 1);
  assert.equal(m.kpi.people, 3, 'Ari only did 2021');
  assert.equal(m.kpi.orgs, 3);
  // Acme's earliest year within the FILTERED window is 2023, so its 2020
  // grant is "before" and its 2023 one is "after" — the baseline follows
  // the slice being described.
  assert.equal(m.kpi.grantTotalAfter, 20_000_000);
});

test('former members are excluded on request', () => {
  const f = { ...emptyFilters(), includeFormerMembers: false };
  const m = computeMetrics(bundle(), f);
  assert.equal(m.kpi.people, 3, 'Dís is a former member');
});

test('dropping cohorts leaves only the programme own links', () => {
  const f = { ...emptyFilters(), includeCohorts: false };
  const m = computeMetrics(bundle(), f);
  assert.equal(m.kpi.people, 0, 'every membership in the fixture is on a cohort');
  assert.equal(m.kpi.orgs, 0);
});

test('active-org count treats null as active, explicit false as gone', () => {
  const m = computeMetrics(bundle(), emptyFilters());
  assert.equal(m.kpi.orgs, 3);
  assert.equal(m.kpi.activeOrgs, 2);
});

test('funded-org count is distinct orgs, not awards', () => {
  const m = computeMetrics(bundle(), emptyFilters());
  assert.equal(m.kpi.grantCount, 3);
  assert.equal(m.kpi.fundedOrgs, 2, 'Acme has two awards and is one funded org');
});

test('funds and recipients roll up by amount, descending', () => {
  const m = computeMetrics(bundle(), emptyFilters());
  assert.deepEqual(
    m.grantsByFund.map((f) => [f.fund, f.amount, f.count]),
    [
      ['Sproti', 25_000_000, 2],
      ['Fræ', 1_000_000, 1]
    ]
  );
  assert.equal(m.topRecipients[0].name, 'Acme');
  assert.equal(m.topRecipients[0].amount, 25_000_000);
});

test('empty bundle produces zeros, not NaN', () => {
  const m = computeMetrics(
    { rootId: 1, rootName: 'x', cohorts: [], personLinks: [], orgLinks: [], awards: [] },
    emptyFilters()
  );
  assert.equal(m.kpi.people, 0);
  assert.equal(m.kpi.grantTotal, 0);
  assert.equal(m.gender.knownShare, 0);
  assert.deepEqual(m.grantsByYear, []);
});

test('availableYears is newest-first and drops the yearless parent', () => {
  assert.deepEqual(availableYears(bundle()), [2023, 2021]);
});

test('compact money keeps one decimal below 100 units', () => {
  assert.equal(formatCompactMoney(297_282_000), '297M ISK');
  assert.equal(formatCompactMoney(20_871_000), '20.9M ISK');
  assert.equal(formatCompactMoney(1_200_000_000), '1.2bn ISK');
  assert.equal(formatCompactMoney(850_000), '850k ISK');
  assert.equal(formatCompactMoney(0), '0 ISK');
  // No trailing ".0": axis ticks must not mix "20.0M" with "100M".
  assert.equal(formatCompactMoney(20_000_000), '20M ISK');
  assert.equal(formatCompactMoney(120_000_000, ''), '120M');
});

test('two cohorts in one year get distinguishable axis labels', () => {
  // The real case: "Startup SuperNova 2026" and "Startup SuperNova 2026 -
  // Superclass" both sit in 2026, and two bars labelled "2026" is unreadable.
  const rows = [
    { id: 37, name: 'Startup SuperNova 2026', year: 2026 },
    { id: 17, name: 'Startup SuperNova 2026 - Superclass', year: 2026 },
    { id: 59, name: 'Startup SuperNova 2025', year: 2025 }
  ].map((r) => ({
    ...r,
    startDate: null, endDate: null, orgs: 0, people: 0, participants: 0,
    mentors: 0, participantCount: null, applicationCount: null
  }));
  // Both colliding rows are marked; the non-colliding 2025 stays bare.
  const labels = cohortLabels(rows, 'Startup SuperNova');
  assert.equal(labels[2], '2025');
  assert.notEqual(labels[0], labels[1], 'the two 2026 rows must not share a label');
  assert.equal(labels[1], '2026 Superclass');
  assert.equal(labels[0], '2026', 'the main cohort keeps a clean year — no database id on the axis');
});

test('a unique year is never cluttered with a disambiguator', () => {
  const rows = [2024, 2025].map((y, i) => ({
    id: i, name: `Programme ${y}`, year: y, startDate: null, endDate: null,
    orgs: 0, people: 0, participants: 0, mentors: 0,
    participantCount: null, applicationCount: null
  }));
  assert.deepEqual(cohortLabels(rows, 'Programme'), ['2024', '2025']);
});

test('a yearless cohort falls back to its name without the programme prefix', () => {
  const rows = [
    { id: 1, name: 'Programme Mentorafundir', year: null, startDate: null, endDate: null,
      orgs: 0, people: 0, participants: 0, mentors: 0, participantCount: null, applicationCount: null }
  ];
  assert.deepEqual(cohortLabels(rows, 'Programme'), ['Mentorafundir']);
});

test('two indistinguishable cohorts in one year still get unique labels', () => {
  // Nothing but the year to tell them apart, so the second falls back to its
  // id: identical axis labels would be worse than an ugly one.
  const rows = [101, 102].map((id) => ({
    id, name: 'Programme 2026', year: 2026, startDate: null, endDate: null,
    orgs: 0, people: 0, participants: 0, mentors: 0,
    participantCount: null, applicationCount: null
  }));
  assert.deepEqual(cohortLabels(rows, 'Programme'), ['2026', '2026 #102']);
});

test('axis steps are integers on count data', () => {
  // 44 people, the real SuperNova peak: 0–50 in tens, no "8.5 people" tick.
  assert.deepEqual(axisTicks(44).ticks, [0, 10, 20, 30, 40, 50]);
  assert.deepEqual(axisTicks(11).ticks, [0, 2, 4, 6, 8, 10, 12]);
  assert.deepEqual(axisTicks(1).ticks, [0, 1]);
  for (const max of [3, 7, 9, 23, 44, 205, 413]) {
    for (const t of axisTicks(max).ticks) {
      assert.equal(Number.isInteger(t), true, `tick ${t} for max ${max} must be a whole number`);
    }
  }
});

test('axis leaves little headroom and keeps 3-6 gridlines', () => {
  // The bug this replaced: a 117M maximum drew an axis of 0–200M with two
  // gridlines, so the tallest bar filled barely half the plot.
  const money = axisTicks(116_850_000);
  assert.equal(money.axisMax, 120_000_000);
  assert.equal(money.ticks.length, 7);
  for (const max of [3, 44, 205, 116_850_000, 297_282_000]) {
    const a = axisTicks(max);
    assert.ok(a.axisMax >= max, 'the axis must contain the data');
    assert.ok(a.axisMax <= max * 1.5 || max < 5, `axis ${a.axisMax} wastes room above ${max}`);
    assert.ok(a.ticks.length >= 3 && a.ticks.length <= 8, `${a.ticks.length} gridlines for ${max}`);
  }
});

test('an empty or zero series still gets a drawable axis', () => {
  assert.deepEqual(axisTicks(0).ticks, [0, 1]);
});
