// The record shapes
import type { ProjectBrandColor } from '$lib/data/projectBrand';
import type { Tag } from '$lib/data/tags';
//
// Every entity type in twin, and nothing else — no queries, no constants, no
// functions. These are the shapes the 44 modules in this directory read and
// write, and they are deliberately free of anything Directus-specific: not one
// of them names a collection, a filter or an SDK type. That is what makes them
// reusable if the backend ever changes.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module.


// Schema mirrors the actual Directus collections (verified 2026-04-21).
export type Person = {
  id: number;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  /** What this person actually goes by — "Dóri" for Halldór,
   *  "Bibba" for Hólmfríður, etc. Shown next to the name on the
   *  detail page and surfaced in search. */
  nickname?: string | null;
  email?: string | null;
  phone?: string | null;
  phone_secondary?: string | null;
  website?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state_province?: string | null;
  postal_code?: string | null;
  country?: string | null;
  birthday?: string | null;
  gender?: string | null;
  type?: string | null;
  tags?: string[] | string | null;
  preferred_language?: string | null;
  source?: string | null;
  Linkedin?: string | null;
  Facebook?: string | null;
  status?: string;
  scope?: 'work' | 'private' | 'both' | null;
  organization?: number | Organization | null;
  person_picture?: string | null;
  image_focal?: string | null;
  date_created?: string | null;
  date_updated?: string | null;
};

export type OrgSizeBucket =
  | '1' | '2-10' | '11-50' | '51-200' | '201-500'
  | '501-1000' | '1001-5000' | '5001-10000' | '10001+';

/** Real-world lifecycle states for an organisation. Curated set —
 *  matches the dropdown choices on the Directus column. Colour is
 *  used by the UI pill (background tinted, white text). */
export type OrgLifecycleStatus =
  | 'active'
  | 'pre_launch'
  | 'pivoting'
  | 'dormant'
  | 'acquired'
  | 'merged'
  | 'rebranded'
  | 'dissolved'
  | 'bankrupt';

export type Organization = {
  id: number;
  name?: string | null;
  /** Icelandic dative of the name — Gróska → Grósku. Phrases like "Með
   *  stuðningi frá …" decline the name, so a template using the nominative
   *  produces wrong Icelandic. Written once here, reused by every project. */
  name_dative_is?: string | null;
  legal_name?: string | null;
  /** Free-form description of what the org does — ICELANDIC (primary).
   *  Surfaces under the hero on the detail page. */
  description?: string | null;
  /** English description. The plain `description` is the Icelandic one. */
  description_en?: string | null;
  email?: string | null;
  website?: string | null;
  phone?: string | null;
  industry?: string | null;
  /** Top-level domain (Yfirflokkur). Foreign key into Domain — replaces
   *  the free-form `industry` field for orgs that have been classified
   *  through the Rannís taxonomy. Both are kept in parallel. */
  domain_id?: number | unknown | null;
  /** Sub-domain (Undirflokkur). FK into Subdomain. */
  subdomain_id?: number | unknown | null;
  /** Landshluti — Icelandic region acronym (HB, RN, VL, …). */
  region?: string | null;
  status?: string;
  is_active?: boolean | null;
  scope?: 'work' | 'private' | 'both' | null;
  /** Richer lifecycle than `is_active` — tracks where the real-world
   *  org sits in its life (active, dormant, dissolved, acquired,
   *  merged, …). Optional; null means unknown. */
  lifecycle_status?: OrgLifecycleStatus | string | null;
  logo?: string | null;
  image_focal?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  postal_code?: string | null;
  city?: string | null;
  state_province?: string | null;
  country?: string | null;
  // Size + enrichment
  size_bucket?: OrgSizeBucket | string | null;
  employee_count?: number | null;
  employee_count_source?: string | null;
  employee_count_as_of?: string | null;
  kennitala?: string | null;
  /** Mirror-only: every social URL and handle for this org joined into one
   *  string, written by syncOfflineMirror. Not a Directus column — it exists
   *  so the offline index can match a handle without caching relations. */
  social_search?: string | null;
  founded_year?: number | null;
  org_type?: string | null;
  revenue_band_isk?: string | null;
  annual_revenue_isk?: number | null;
  last_enriched_at?: string | null;
  enrichment_notes?: string | null;
  /** Comma-separated former names — e.g. "Borgun hf., Salt Pay". Surfaces in search. */
  previous_names?: string | null;
  /** When this row was merged into another, points at the survivor. */
  successor_id?: number | Organization | null;
  date_created?: string | null;
  date_updated?: string | null;
  // Brand roles, mirroring Project — added so one BrandCard and one brand
  // book can serve either owner. See scripts/add-org-brand.sh.
  brand_logo?: string | null;
  brand_logo_inverted?: string | null;
  brand_logo_black?: string | null;
  brand_logo_landscape?: string | null;
  brand_logo_vertical?: string | null;
  brand_logo_simple?: string | null;
  brand_primary?: string | null;
  brand_action?: string | null;
  brand_text?: string | null;
  brand_text_muted?: string | null;
  brand_text_inverse?: string | null;
  brand_headline?: string | null;
  brand_bg_light?: string | null;
  brand_bg_dark?: string | null;
  brand_font?: string | null;
  brand_colors?: ProjectBrandColor[] | null;
  parent_organization?: number | Organization | null;
};

export type DateEventKind =
  | 'event'
  | 'meeting'
  | 'birthday'
  | 'family_day'
  | 'travel'
  | 'holiday'
  | 'reminder'
  | 'project_span'
  | 'other';

export type DateEvent = {
  id: number;
  title?: string | null;
  description?: string | null;
  /** Free-form kind label — e.g. 'event', 'meeting', 'birthday', 'family_day'. */
  event_type?: DateEventKind | string | null;
  start?: string | null;
  end?: string | null;
  all_day?: boolean | null;
  color?: string | null;
  location?: string | null;
  location_name?: string | null;
  location_address?: string | null;
  is_virtual?: boolean | null;
  virtual_link?: string | null;
  is_recurring?: boolean | null;
  recurrence_rule?: string | null;
  recurrence_end_date?: string | null;
  /** Sync provenance: 'manual' (default) | 'google' | 'asana' | 'slack' | … */
  source?: string | null;
  /** External id for dedup on re-sync. */
  source_ref?: string | null;
  /** Apple/Google/etc. external event UID — preferred dedup key for synced events. */
  external_id?: string | null;
  /** Name of the upstream calendar (e.g. "you@work.example", "Work"). Lets the
   *  UI offer a per-source-calendar filter without juggling labels by hand. */
  external_calendar?: string | null;
  scope?: 'work' | 'private' | 'both' | null;
  project_id?: number | Project | null;
  organization?: number | Organization | null;
  status?: string;
};

export type DatePerson = {
  id: number;
  Dates_id?: number | DateEvent | null;
  Person_id?: number | Person | null;
};

/** Derived event used by the Calendar — covers stored Dates rows AND
 *  in-memory derivations (birthdays from Person.birthday, project spans
 *  from Project.start_date/end_date). The shape is identical so the renderer
 *  doesn't care where each event came from. */
export type CalendarEvent = {
  /** Stable id used as Svelte key. Real Dates rows: `dates:<id>`. Derived
   *  birthdays: `birthday:<personId>:<year>`. Project spans: `project:<id>`. */
  key: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  kind: DateEventKind | string;
  source: 'manual' | 'birthday_derived' | 'project_derived' | string;
  color?: string | null;
  scope?: 'work' | 'private' | 'both' | null;
  /** When this event came from a stored row, the original id (so we can edit). */
  datesId?: number;
  href?: string;
  meta?: Record<string, unknown>;
};

export type Note = {
  id: number;
  title?: string | null;
  content?: string | null;
  agenda?: string | null;
  action_items?: string | null;
  next_steps?: string | null;
  note_type?: string | null;
  note_date?: string | null;
  follow_up_date?: string | null;
  priority?: string | null;
  is_done?: boolean | null;
  is_pinned?: boolean | null;
  visibility?: string | null;
  scope?: 'work' | 'private' | 'both' | null;
  status?: string;
  date_created?: string | null;
  date_updated?: string | null;
};

export type Role = {
  id: number;
  person_id?: number | Person | null;
  organization_id?: number | Organization | null;
  role?: string | null;
  department?: string | null;
  employment_type?: string | null;
  seniority?: string | null;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  is_current?: boolean | null;
  description?: string | null;
  reporting_to?: number | Person | null;
  work_email?: string | null;
  work_phone?: string | null;
};

export type FamilyRelationKind =
  | 'father' | 'mother' | 'parent'
  | 'son' | 'daughter' | 'child'
  | 'brother' | 'sister' | 'sibling'
  | 'spouse' | 'partner' | 'ex_partner'
  | 'grandfather' | 'grandmother' | 'grandparent'
  | 'grandson' | 'granddaughter' | 'grandchild'
  | 'uncle' | 'aunt' | 'nephew' | 'niece' | 'cousin'
  | 'stepfather' | 'stepmother' | 'stepchild'
  | 'father_in_law' | 'mother_in_law'
  | 'brother_in_law' | 'sister_in_law'
  | 'son_in_law' | 'daughter_in_law' | 'in_law'
  | 'godparent' | 'godchild' | 'other';

export type FamilyRelation = {
  id: number;
  person_id?: number | Person | null;
  relative_id?: number | Person | null;
  relation?: FamilyRelationKind | string | null;
  since?: string | null;
  notes?: string | null;
  status?: string;
};

export type Project = {
  id: number;
  name?: string | null;
  kind?: 'project' | 'course' | 'program' | 'campaign' | 'theme' | 'other' | string | null;
  /** Icelandic summary (primary). English lives in summary_en. */
  summary?: string | null;
  summary_en?: string | null;
  /** Programme year. It exists in the live Project collection and
   *  getPersonProjects() queries it, but it was missing from this type — the
   *  `as never` cast on the collection name had been hiding the mismatch. */
  year?: number | string | null;
  scope?: 'work' | 'private' | 'both' | null;
  status?: string;
  owner_org_id?: number | Organization | null;
  /** Parent project — supports a multi-level hierarchy
   *  (e.g. "University of Reykjavík" → "IB700 Strategy" → "2026 cohort").
   *  null for top-level rows. */
  parent_id?: number | Project | null;
  /** Optional accent colour. Set from PROJECT_COLORS so the UI stays
   *  on-palette. Stored as hex so it can drop into style attrs. */
  color?: string | null;
  /** Optional brand segment — palette swatches + logo file. Distinct
   *  from `color` (the UI accent): this is the project's real-world
   *  brand identity, consumed by the image studio / Evergreen. */
  brand_colors?: ProjectBrandColor[] | null;
  brand_logo?: string | null;
  /** Structured logo roles — Original is `brand_logo` above.
   *  Colour treatments: inverted / flat black. Orientation lockups:
   *  landscape (headers), vertical (stacked), simple (mark only). */
  brand_logo_inverted?: string | null;
  brand_logo_black?: string | null;
  brand_logo_landscape?: string | null;
  brand_logo_vertical?: string | null;
  brand_logo_simple?: string | null;
  /** Structured colour roles (hex). Text colours are derived app-side
   *  from the background's luminance. UI names these by function:
   *  bg_light = "Main background" (Original logo lives here),
   *  bg_dark = "Inverse background" (Inverted logo) — a brand's main
   *  surface can itself be dark, so avoid light/dark-mode language. */
  brand_primary?: string | null;
  brand_action?: string | null;
  brand_text?: string | null;
  brand_text_muted?: string | null;
  brand_text_inverse?: string | null;
  brand_headline?: string | null;
  brand_bg_light?: string | null;
  brand_bg_dark?: string | null;
  brand_font?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  date_created?: string | null;
  date_updated?: string | null;
};

export type ProjectPerson = {
  id: number;
  project_id?: number | Project | null;
  person_id?: number | Person | null;
  role_in_project?: string | null;
  notes?: string | null;
  status?: string;
  /** Tenure — when this person was active in the project. null
   *  is_current is treated as current (pre-tenure rows). */
  start_date?: string | null;
  end_date?: string | null;
  is_current?: boolean | null;
  /** Set on system-managed *inherited* rows — points at a descendant
   *  subproject whose direct membership rolled this link up the parent
   *  chain. null = a direct membership. See project-inheritance.ts. */
  inherited_from_project_id?: number | Project | null;
};

/** Curated role catalogue for Project_people.role_in_project and
 *  Project_organization.role_in_project. Each row's `key` is what
 *  actually gets stored on the junction; `label` is the display name
 *  and `applies_to` filters the picker so person-only roles don't
 *  show up on the org card and vice-versa. */
/** Grant programme — Tækniþróunarsjóður, Rannsóknasjóður, EU Horizon, etc.
 *  Carries the metadata about the programme itself; the individual
 *  awards live in `GrantAward` and their staged payouts in
 *  `GrantAwardPayment`. */
export type Grant = {
  id: number;
  name: string;
  short_name?: string | null;
  funder_label?: string | null;
  funder_org_id?: number | Organization | null;
  category?: 'rnd' | 'research' | 'climate' | 'design' | 'culture' | 'infrastructure' | 'student' | 'export' | 'equity' | 'other' | string | null;
  country?: string | null;
  currency?: 'ISK' | 'EUR' | 'USD' | 'GBP' | string | null;
  is_recurring?: boolean | null;
  recurrence?: 'annual' | 'biannual' | 'quarterly' | 'ad_hoc' | string | null;
  typical_duration_years?: number | null;
  website?: string | null;
  summary?: string | null;
  color?: string | null;
  sort?: number | null;
  status?: string;
  date_created?: string | null;
  date_updated?: string | null;
};

/** One row per granted award. Points at a Grant programme + an
 *  org (recipient) and carries the total + currency + year. Multi-
 *  year staged payouts live in `GrantAwardPayment`. */
export type Domain = {
  id: number;
  name: string;
  color?: string | null;
  note?: string | null;
  sort?: number | null;
  status?: string;
};

export type Subdomain = {
  id: number;
  name: string;
  note?: string | null;
  sort?: number | null;
  status?: string;
};

export type GrantAward = {
  id: number;
  grant_id?: number | Grant | null;
  organization_id?: number | Organization | null;
  project_id?: number | Project | null;
  award_name?: string | null;
  awarded_year?: number | null;
  award_date?: string | null;
  total_amount?: number | string | null;
  currency?: 'ISK' | 'EUR' | 'USD' | 'GBP' | string | null;
  duration_years?: number | null;
  stage?: string | null;
  award_status?: 'applied' | 'awarded' | 'active' | 'completed' | 'cancelled' | 'rejected' | string | null;
  notes?: string | null;
  status?: string;
  date_created?: string | null;
  date_updated?: string | null;
  // Rannís import extensions.
  external_id?: string | null;
  external_source?: string | null;
  applicant_label?: string | null;
  contact_label?: string | null;
  contact_person_id?: number | Person | null;
  contact_org_id?: number | Organization | null;
  domain_id?: number | Domain | null;
  subdomain_id?: number | Subdomain | null;
  region_acronym?: string | null;
  fund_year?: number | null;
  booking_year?: number | null;
  description?: string | null;
};

export type GrantAwardPayment = {
  id: number;
  award_id?: number | GrantAward | null;
  installment_label?: string | null;
  installment_index?: number | null;
  planned_amount?: number | string | null;
  actual_amount?: number | string | null;
  planned_date?: string | null;
  actual_date?: string | null;
  payment_status?: 'planned' | 'paid' | 'withheld' | 'cancelled' | string | null;
  notes?: string | null;
  status?: string;
};

export type SponsorTier = 'gold' | 'silver' | 'bronze';

export type ProjectRole = {
  id: number;
  key: string;
  label: string;
  applies_to?: 'person' | 'org' | 'both' | null;
  color?: string | null;
  sort?: number | null;
  status?: string;
  /** Sponsor level. Grouping and ordering come from this, not from `sort`. */
  tier?: SponsorTier | null;
  /** Show under Sponsors rather than among plain connections. */
  is_sponsor?: boolean | null;
  /** Wording templates. `{org}` is the name; `{org_dative}` is the Icelandic
   *  declined form, because "Með stuðningi frá Grósku" changes the name and
   *  `{org}` alone would render "frá Gróska" — wrong Icelandic. */
  phrase_is?: string | null;
  phrase_en?: string | null;
};

/** Project ↔ Organisation junction. Project.owner_org_id remains the
 *  single primary "owner" pick — this collection is for everyone else
 *  involved (partners, sponsors, clients, hosts, venues, …). */
export type ProjectOrganization = {
  id: number;
  project_id?: number | Project | null;
  organization_id?: number | Organization | null;
  role_in_project?: string | null;
  notes?: string | null;
  status?: string;
  /** See ProjectPerson.inherited_from_project_id — same semantics for orgs. */
  inherited_from_project_id?: number | Project | null;
  /** Wording for THIS link only, overriding the role's template. For cases the
   *  template cannot reach — a joint credit, a specific legal form, a one-off
   *  form of words someone signed off. Full sentence, no placeholders. */
  phrase_is?: string | null;
  phrase_en?: string | null;
};

/**
 * Legacy string-key union for activity kinds. Pre-dates the user-managed
 * `ActivityKind` Directus collection. Kept for the `Activity.kind`
 * column which is still written for one transition release.
 */
export type ActivityKindKey =
  | 'meeting'
  | 'call'
  | 'email'
  | 'message'
  | 'mentoring'
  | 'teaching'
  | 'talk'
  | 'event'
  | 'intro'
  | 'milestone'
  | 'note'
  | 'other'
  // New kinds seeded by scripts/migrate-activity-kinds.sh — listed here so
  // the TypeScript surface knows about them even though the source of
  // truth is the `ActivityKind` Directus collection.
  | 'coffee'
  | 'lunch'
  | 'dinner'
  | 'drinks'
  | 'walk'
  | 'social'
  | 'ran_into'
  | 'check_in'
  | 'follow_up'
  | 'favor'
  | 'gift';

/**
 * Row in the `ActivityKind` Directus collection. Dynamic, user-managed
 * catalogue powering the activity kind picker, chips, and filters.
 */
export type ActivityKind = {
  id: number;
  key: string;
  label: string;
  emoji?: string | null;
  icon?: string | null;
  color?: string | null;
  default_significance?: 'minor' | 'normal' | 'major' | null;
  scope?: 'work' | 'private' | 'both' | null;
  sort?: number | null;
  status?: string;
};

export type ActivitySignificance = 'minor' | 'normal' | 'major';

export type Activity = {
  id: number;
  title?: string | null;
  /** Legacy string kind. Prefer `kind_id` (the resolved `ActivityKind` row). */
  kind?: ActivityKindKey | string | null;
  /** Foreign key to the `ActivityKind` collection (hydrated by `ACTIVITY_FIELDS`). */
  kind_id?: number | ActivityKind | null;
  significance?: ActivitySignificance | string | null;
  occurred_at?: string | null;
  end_at?: string | null;
  scope?: 'work' | 'private' | 'both' | null;
  location?: string | null;
  summary?: string | null;
  organization_id?: number | Organization | null;
  project_id?: number | Project | null;
  status?: string;
  date_created?: string | null;
  date_updated?: string | null;
};

export type ActivityTag = {
  id: number;
  activity_id?: number | Activity | null;
  tag_id: number | Tag;
};

export type ActivityPerson = {
  id: number;
  activity_id?: number | Activity | null;
  person_id?: number | Person | null;
  role?: string | null;
};

/** Per-photo tag: one Immich asset → one record. Complements the
 *  face-cluster mapping (photo_person) with deliberate curation —
 *  org team shots, project event coverage, faces recognition missed. */
export type PhotoLinkCollection = 'organization' | 'Project' | 'Person' | 'event';

export type PhotoLink = {
  id: number;
  asset_id: string;
  collection: PhotoLinkCollection;
  item_id: number;
  date_created: string | null;
};

// ── Photo navigator (Immich) ─────────────────────────────────────────
// Mapping between an Immich face cluster and a Person record. Photos
// themselves never enter Directus — see src/lib/immich.ts.
export type PhotoPerson = {
  /** Immich person (face cluster) uuid — primary key. */
  id: string;
  person_id: number | null;
  immich_name: string | null;
  face_count: number;
  hidden: boolean;
  mapped_at: string | null;
};

// ── Pure junctions ──────────────────────────────────────────────────────
// Three link tables that carry no behaviour and so never earned a module of
// their own. They were the last collections the compiler could not check,
// which is the only reason they are written down at all.

export type NotesRelatedTo = {
  id: number;
  notes_id?: number | Note | null;
  /** The M2A target collection — 'Person', 'organization', 'Project'… */
  collection?: string | null;
  item?: string | number | null;
};

export type NotesTag = {
  id: number;
  notes_id?: number | Note | null;
  /** A relation, not a bare id — getNoteTags() expands it to the full Tag.
   *  Modelled as a number first and it was wrong: the field selector rejected
   *  `{ tag_id: ['id', 'name', …] }`. */
  tag_id?: number | Tag | null;
};

export type MetaCampaignEvent = {
  id: number;
  mk_meta_campaign_id?: number | null;
  event_type?: string | null;
  occurred_at?: string | null;
  payload?: Record<string, unknown> | null;
};
