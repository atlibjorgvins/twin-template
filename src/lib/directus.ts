import {
  readItems,
  readItem,
  createItem,
  createItems,
  updateItem,
  updateItems,
  deleteItem,
  deleteItems,
  aggregate,
  importFile,
  deleteFile,
  readFiles
} from '@directus/sdk';
import { PUBLIC_DIRECTUS_URL } from '$env/static/public';

// Names still used by code left in this file. `export * from` below makes them
// available to importers of $lib/directus, but not to this module itself.
import { listFinanceTxns } from '$lib/data/finances';
import type { FinanceTxn } from '$lib/data/finances';
import type { FocusTask } from '$lib/data/focus';
import type { PostingIdentity } from '$lib/data/postingIdentities';
// Transitive project membership — reconcile inherited rows after any
// direct-membership mutation. (Runtime-only use, so the circular import
// with project-inheritance.ts is safe.)
import {
  reconcilePersonProjectInheritance,
  reconcileOrgProjectInheritance
} from '$lib/project-inheritance';
import {
  markOnline,
  markOffline,
  isNetworkError,
  saveMirror,
  loadMirrorPeople,
  loadMirrorOrgs,
  filterPeopleLocal,
  filterOrgsLocal,
  lastSyncAt,
  upsertMirror,
  patchMirror,
  getMirrorRecord,
  nextTempId,
  isTempId
} from './offline';
import { enqueueWrite } from './writeQueue';
import type { MetaChannel } from '$lib/data/meta';
import type { MkAd, MkAdAccount, MkAdSet, MkBudgetRow, MkCampaign, MkCampaignTag, MkManualSpend, MkMediumRow, MkMetaCampaign, MkMetric, MkMetricBreakdownRow, MkMetricInput, MkTargeting } from '$lib/data/marketing';
import type { OrganizationTag, PersonTag, Tag } from '$lib/data/tags';
import type { OrganizationPhoto, PhotoType } from '$lib/data/orgPhotos';
import type { ProjectBrandAsset, ProjectBrandColor } from '$lib/data/projectBrand';
import { createMkAd, createMkAdSet, createMkMetaCampaign, getMkStructure, upsertMkMetrics } from '$lib/data/marketing';
import { fetchMetaAdReport, metaGraph, metaGraphAll, metaQuery } from '$lib/data/meta';
import { getOrgIdsForProjects } from '$lib/data/projectMembers';
import { listProjectDescendantIds } from '$lib/data/projects';
import { uploadFile, uploadFromUrl } from '$lib/data/batch';
import type { Filter } from '$lib/data/client';
import { createOrg, updateOrg } from '$lib/data/orgs';
import { personName, updatePerson } from '$lib/data/people';
import type { BufferChannel } from '$lib/data/buffer';
import type { OrgSuggestion } from '$lib/data/orgSuggestions';
import type { MkTemplate } from '$lib/data/asana';
import type { Campaign, CampaignPost, ProjectTag } from '$lib/data/evergreen';

// Regions live in ./regions.ts so they can be tested without pulling in the
// SDK and $env. Re-exported here because callers already import them from
// this module; REGION_CHOICES stays Rannís-only on purpose — a grant award
// cannot be "Evrópa".
export {
  REGION_CHOICES,
  FOREIGN_REGION_CHOICES,
  ALL_REGION_CHOICES,
  isForeignRegion,
  regionLabel,
  type RegionChoice
} from './regions';

// ── The Directus client ──────────────────────────────────────────────────
// Moved to $lib/data/client.ts (with the request-coalescing fetch). Imported
// here so the rest of this file keeps using `directus` unchanged, and
// re-exported so external callers do too.
import { directus } from '$lib/data/client';
export { directus };

export type { Filter };

// Batch operations — moved to $lib/data/batch.ts, re-exported at the
// end of this file. See docs/opening-up-twin.md.
// Family relations — moved to $lib/data/familyRelations.ts, re-exported at the
// end of this file. See docs/opening-up-twin.md.
// ProjectRole catalogue — moved to $lib/data/projectRoles.ts, re-exported at the
// end of this file. See docs/opening-up-twin.md.
// ── Note ↔ M2A relations ────────────────────────────────────────────────────
// Entity links — labelled links and dynamic info — moved to $lib/data/entityLinks.ts, re-exported at the
// end of this file. See docs/opening-up-twin.md.
// Activity junctions — orgs and tags on an interaction — moved to $lib/data/activityJunctions.ts, re-exported at the
// end of this file. See docs/opening-up-twin.md.
// Calendar / Dates — moved to $lib/data/dates.ts, re-exported at the
// end of this file. See docs/opening-up-twin.md.
// Org merge — repoint history from one row into another — moved to $lib/data/orgMerge.ts, re-exported at the
// end of this file. See docs/opening-up-twin.md.
// Org data suggestions — moved to $lib/data/orgSuggestions.ts, re-exported at the
// end of this file. See docs/opening-up-twin.md.
// Evergreen machine — moved to $lib/data/evergreen.ts, re-exported at the
// end of this file. See docs/opening-up-twin.md.
// Buffer integration — moved to $lib/data/buffer.ts, re-exported at the
// end of this file. See docs/opening-up-twin.md.
// Meta two-way controls — writes to live Meta — moved to $lib/data/metaWrites.ts, re-exported at the
// end of this file. See docs/opening-up-twin.md.
// Import existing Meta structure — moved to $lib/data/metaImport.ts, re-exported at the
// end of this file. See docs/opening-up-twin.md.
// Asana project ⇄ twin project links — moved to $lib/data/asana.ts, re-exported at the
// end of this file. See docs/opening-up-twin.md.
// Receipts — moved to $lib/data/receipts.ts, re-exported at the
// end of this file. See docs/opening-up-twin.md.
// Receipt → organization linking — moved to $lib/data/receiptOrgs.ts, re-exported at the
// end of this file. See docs/opening-up-twin.md.
// ── Habits ────────────────────────────────────────────────────────────────
// Moved to $lib/data/habits.ts. Re-exported below so every existing
// `from '$lib/directus'` import keeps working — see docs/opening-up-twin.md.



// Domain modules split out of this file. Re-exported so the public surface
// of $lib/directus is unchanged while the split proceeds.
export * from '$lib/data/habits';
export * from '$lib/data/places';
export * from '$lib/data/aiVault';
export * from '$lib/data/finances';
export * from '$lib/data/focus';
export * from '$lib/data/postingIdentities';
export * from '$lib/data/taskClosing';
export * from '$lib/data/photoLinks';
export * from '$lib/data/eventLookups';
export * from '$lib/data/groupAddresses';
export * from '$lib/data/activityKind';
export * from '$lib/data/notes';
export * from '$lib/data/grants';
export * from '$lib/data/projectBrand';
export * from '$lib/data/marketing';
export * from '$lib/data/photoPeople';
export * from '$lib/data/meta';
export * from '$lib/data/orgPhotos';
export * from '$lib/data/activities';
export * from '$lib/data/tags';
export * from '$lib/data/projectMembers';
export * from '$lib/data/projects';
export * from '$lib/data/batch';
export * from '$lib/data/promptLibrary';
export * from '$lib/data/metaCreatives';
export * from '$lib/data/activitySearch';
export * from '$lib/data/education';
export * from '$lib/data/calendarMapping';
export * from '$lib/data/people';
export * from '$lib/data/orgs';
export * from '$lib/data/roles';
export * from '$lib/data/connection';
export * from '$lib/data/receiptOrgs';
export * from '$lib/data/receipts';
export * from '$lib/data/asana';
export * from '$lib/data/metaImport';
export * from '$lib/data/metaWrites';
export * from '$lib/data/buffer';
export * from '$lib/data/evergreen';
export * from '$lib/data/orgSuggestions';
export * from '$lib/data/orgMerge';
export * from '$lib/data/dates';
export * from '$lib/data/activityJunctions';
export * from '$lib/data/entityLinks';
export * from '$lib/data/projectRoles';
export * from '$lib/data/familyRelations';
export * from '$lib/data/types';
export * from '$lib/data/vocabulary';
export * from '$lib/data/schema';
