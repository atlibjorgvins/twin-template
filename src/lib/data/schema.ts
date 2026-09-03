// The Directus collection index
//
// This is the one file in src/lib/data that is Directus-shaped. Schema maps a
// collection name to its row type, and the SDK client is generic over it — so
// `readItems('Person')` type-checks and `readItems('nonsense')` does not.
//
// It is on its own for that reason. A different backend would replace this file
// and leave types.ts, vocabulary.ts and the 44 domain modules untouched, which
// is the whole point of having pulled them apart. It is also why the 24
// collections reached with `'X' as never` are worth adding here: each one is a
// query the compiler currently cannot check.
//
// Split out of directus.ts — see docs/opening-up-twin.md. Public surface is
// unchanged: directus.ts re-exports this module.

import type { Activity, ActivityKind, ActivityPerson, ActivityTag, DateEvent, DatePerson, FamilyRelation, Grant, GrantAward, GrantAwardPayment, MetaCampaignEvent, Note, NotesRelatedTo, NotesTag, Organization, Person, PhotoLink, PhotoPerson, Project, ProjectPerson, ProjectRole, Role } from '$lib/data/types';
// The row types these collections hold. Type-only, so nothing here exists at
// runtime and the domain modules stay unaware of this file.
import type { EventPlatformLink } from '$lib/wordpress';
import type { EventDateLink, EventOrg, EventPerson, EventPhoto, EventRecord } from '$lib/events/data';
import type { FinanceBudget, FinanceRule, FinanceSettlement, FinanceTxn } from '$lib/data/finances';
import type { CalendarMapping } from '$lib/data/calendarMapping';
import type { ActivityOrg } from '$lib/data/activityJunctions';
import type { BrandElement, BrandFontFace, BrandLogoAsset } from '$lib/brand';
import type { AiKey, AiTaskBinding, AiUsage } from '$lib/data/aiVault';
import type { AsanaProjectLink } from '$lib/data/asana';
import type { PersonEmail } from '$lib/data/dates';
import type { PersonEducation, PersonLanguage } from '$lib/data/education';
import type { EntityLink } from '$lib/data/entityLinks';
import type { FocusTask } from '$lib/data/focus';
import type { EmailGroup } from '$lib/data/groupAddresses';
import type { Habit, HabitEntry } from '$lib/data/habits';
import type { Place } from '$lib/data/places';
import type { Prompt } from '$lib/data/promptLibrary';
import type { ReceiptMerchantAlias } from '$lib/data/receiptOrgs';
import type { FinanceReceipt } from '$lib/data/receipts';
import type { ProjectOrganization } from '$lib/data/types';
import type { FocusSession } from '$lib/focusSession';
import type { FoodOrder } from '$lib/food/data';
import type { GeneratedImage, ImageTemplate } from '$lib/studio/data';
import type { BufferChannel } from '$lib/data/buffer';
import type { Campaign, CampaignPost, ProjectTag } from '$lib/data/evergreen';
import type { MetaChannel } from '$lib/data/meta';
import type { MkAd, MkAdAccount, MkAdSet, MkBudgetRow, MkCampaign, MkCampaignTag, MkManualSpend, MkMediumRow, MkMetaCampaign, MkMetric, MkMetricBreakdownRow } from '$lib/data/marketing';
import type { MkTemplate } from '$lib/data/asana';
import type { OrgSuggestion } from '$lib/data/orgSuggestions';
import type { OrganizationPhoto, PhotoType } from '$lib/data/orgPhotos';
import type { OrganizationTag, PersonTag, Tag } from '$lib/data/tags';
import type { PostingIdentity } from '$lib/data/postingIdentities';
import type { ProjectBrandAsset } from '$lib/data/projectBrand';

export type Schema = {
  Person: Person[];
  organization: Organization[];
  Dates: DateEvent[];
  notes: Note[];
  Person_organization: Role[];
  Person_family: FamilyRelation[];
  Project: Project[];
  Project_people: ProjectPerson[];
  Activity: Activity[];
  Activity_Person: ActivityPerson[];
  ActivityKind: ActivityKind[];
  Activity_tag: ActivityTag[];
  Tag: Tag[];
  Person_tag: PersonTag[];
  organization_tag: OrganizationTag[];
  Dates_Person: DatePerson[];
  org_suggestion: OrgSuggestion[];
  campaign: Campaign[];
  campaign_post: CampaignPost[];
  Project_tag: ProjectTag[];
  PhotoType: PhotoType[];
  organization_photo: OrganizationPhoto[];
  posting_identity: PostingIdentity[];
  buffer_channel: BufferChannel[];
  project_brand_asset: ProjectBrandAsset[];
  photo_person: PhotoPerson[];
  photo_link: PhotoLink[];
  mk_campaign: MkCampaign[];
  mk_campaign_tag: MkCampaignTag[];
  mk_meta_campaign: MkMetaCampaign[];
  mk_ad_set: MkAdSet[];
  mk_ad: MkAd[];
  mk_metric: MkMetric[];
  mk_template: MkTemplate[];
  mk_ad_account: MkAdAccount[];
  mk_manual_spend: MkManualSpend[];
  mk_medium: MkMediumRow[];
  mk_budget: MkBudgetRow[];
  mk_metric_breakdown: MkMetricBreakdownRow[];
  meta_channel: MetaChannel[];
  // ── Added 2026-08-19 ─────────────────────────────────────────────────
  // Collections that were reached with `'X' as never` — 24 of them, across
  // 171 call sites. The cast made the collection name uncheckable and the
  // result `never`, which is why so many of those calls needed a second cast
  // on the way out. Named here, the compiler checks both.
  EmailGroup: EmailGroup[];
  Person_education: PersonEducation[];
  Person_email: PersonEmail[];
  Person_language: PersonLanguage[];
  Project_organization: ProjectOrganization[];
  ai_key: AiKey[];
  ai_task_binding: AiTaskBinding[];
  ai_usage: AiUsage[];
  asana_project_link: AsanaProjectLink[];
  brand_element: BrandElement[];
  brand_font_face: BrandFontFace[];
  brand_logo_asset: BrandLogoAsset[];
  entity_link: EntityLink[];
  finance_receipt: FinanceReceipt[];
  focus_session: FocusSession[];
  focus_task: FocusTask[];
  food_order: FoodOrder[];
  generated_image: GeneratedImage[];
  habit: Habit[];
  habit_entry: HabitEntry[];
  image_template: ImageTemplate[];
  location: Place[];
  prompt: Prompt[];
  receipt_merchant_alias: ReceiptMerchantAlias[];
  // A second pass: collections the compiler was already rejecting outright,
  // with no cast to hide them — 19 of them across 108 call sites.
  Activity_organization: ActivityOrg[];
  CalendarMapping: CalendarMapping[];
  Grant: Grant[];
  GrantAward: GrantAward[];
  GrantAwardPayment: GrantAwardPayment[];
  ProjectRole: ProjectRole[];
  event: EventRecord[];
  event_date: EventDateLink[];
  event_org: EventOrg[];
  event_person: EventPerson[];
  event_photo: EventPhoto[];
  event_platform_link: EventPlatformLink[];
  finance_budget: FinanceBudget[];
  finance_rule: FinanceRule[];
  finance_settlement: FinanceSettlement[];
  finance_txn: FinanceTxn[];
  mk_meta_campaign_event: MetaCampaignEvent[];
  notes_related_to: NotesRelatedTo[];
  notes_tag: NotesTag[];
};
