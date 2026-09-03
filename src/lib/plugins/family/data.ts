// Family relations — data (the `family` build-time plugin, docs/phase4-plugins.md).
//
// Relocated from src/lib/data/familyRelations.ts; that path is now a re-export
// shim so every existing `from '$lib/directus'` import keeps working. Its only
// core dependency is personName (Person). Public surface unchanged.

import { repo } from '$lib/data/repo';
import type { FamilyRelation, Person } from '$lib/data/types';
import { personName } from '$lib/data/people';

// ── Family relations ────────────────────────────────────────────────────────
// Rows are stored from person_id's POV: relative_id IS the <relation> of person_id.
// Example: "John is Atli's father" → { person_id: Atli, relative_id: John, relation: 'father' }.
// When viewing Atli's page, we query *both* directions and invert labels for rows
// where Atli is the relative_id.

export const FAMILY_INVERSE: Record<string, string> = {
  father: 'child', mother: 'child', parent: 'child',
  son: 'parent', daughter: 'parent', child: 'parent',
  brother: 'sibling', sister: 'sibling', sibling: 'sibling',
  spouse: 'spouse', partner: 'partner', ex_partner: 'ex_partner',
  grandfather: 'grandchild', grandmother: 'grandchild', grandparent: 'grandchild',
  grandson: 'grandparent', granddaughter: 'grandparent', grandchild: 'grandparent',
  uncle: 'nephew_or_niece', aunt: 'nephew_or_niece',
  nephew: 'uncle_or_aunt', niece: 'uncle_or_aunt',
  cousin: 'cousin',
  stepfather: 'stepchild', stepmother: 'stepchild', stepchild: 'stepparent',
  father_in_law: 'child_in_law', mother_in_law: 'child_in_law',
  brother_in_law: 'sibling_in_law', sister_in_law: 'sibling_in_law',
  son_in_law: 'parent_in_law', daughter_in_law: 'parent_in_law', in_law: 'in_law',
  godparent: 'godchild', godchild: 'godparent', other: 'other'
};

/** Family relations as 3-tuples keyed by the *other* person's sex.
 *  Each row is the inverse: "if this is the relation FROM A's POV, and B
 *  (the other) has sex Y, what is the relation FROM B's POV?"  */
const SEX_AWARE_INVERSE: Record<string, { male: string; female: string; unknown: string }> = {
  father:        { male: 'son',         female: 'daughter',      unknown: 'child' },
  mother:        { male: 'son',         female: 'daughter',      unknown: 'child' },
  parent:        { male: 'son',         female: 'daughter',      unknown: 'child' },
  son:           { male: 'father',      female: 'mother',        unknown: 'parent' },
  daughter:      { male: 'father',      female: 'mother',        unknown: 'parent' },
  child:         { male: 'father',      female: 'mother',        unknown: 'parent' },
  brother:       { male: 'brother',     female: 'sister',        unknown: 'sibling' },
  sister:        { male: 'brother',     female: 'sister',        unknown: 'sibling' },
  sibling:       { male: 'brother',     female: 'sister',        unknown: 'sibling' },
  grandfather:   { male: 'grandson',    female: 'granddaughter', unknown: 'grandchild' },
  grandmother:   { male: 'grandson',    female: 'granddaughter', unknown: 'grandchild' },
  grandparent:   { male: 'grandson',    female: 'granddaughter', unknown: 'grandchild' },
  grandson:      { male: 'grandfather', female: 'grandmother',   unknown: 'grandparent' },
  granddaughter: { male: 'grandfather', female: 'grandmother',   unknown: 'grandparent' },
  grandchild:    { male: 'grandfather', female: 'grandmother',   unknown: 'grandparent' },
  uncle:         { male: 'nephew',      female: 'niece',         unknown: 'nephew_or_niece' },
  aunt:          { male: 'nephew',      female: 'niece',         unknown: 'nephew_or_niece' },
  uncle_or_aunt: { male: 'nephew',      female: 'niece',         unknown: 'nephew_or_niece' },
  nephew:        { male: 'uncle',       female: 'aunt',          unknown: 'uncle_or_aunt' },
  niece:         { male: 'uncle',       female: 'aunt',          unknown: 'uncle_or_aunt' },
  stepfather:    { male: 'stepchild',   female: 'stepchild',     unknown: 'stepchild' },
  stepmother:    { male: 'stepchild',   female: 'stepchild',     unknown: 'stepchild' },
  stepchild:     { male: 'stepfather',  female: 'stepmother',    unknown: 'stepparent' },
  father_in_law: { male: 'son_in_law',  female: 'daughter_in_law', unknown: 'child_in_law' },
  mother_in_law: { male: 'son_in_law',  female: 'daughter_in_law', unknown: 'child_in_law' },
  son_in_law:    { male: 'father_in_law', female: 'mother_in_law', unknown: 'parent_in_law' },
  daughter_in_law: { male: 'father_in_law', female: 'mother_in_law', unknown: 'parent_in_law' },
  brother_in_law: { male: 'brother_in_law', female: 'sister_in_law', unknown: 'sibling_in_law' },
  sister_in_law:  { male: 'brother_in_law', female: 'sister_in_law', unknown: 'sibling_in_law' }
};

/** Normalise free-form gender values (incl. Icelandic). */
export function sexOf(gender?: string | null): 'male' | 'female' | 'unknown' {
  const v = (gender ?? '').trim().toLowerCase();
  if (['male', 'm', 'man', 'boy', 'karl', 'masculine'].includes(v)) return 'male';
  if (['female', 'f', 'woman', 'girl', 'kona', 'feminine'].includes(v)) return 'female';
  return 'unknown';
}

/** When a relation implies the *subject's* sex, return that sex. The
 *  subject is whoever the relation describes — e.g. 'father' implies the
 *  relative is male; 'son' implies the relative is male; 'daughter' implies
 *  female. Used to back-fill `Person.gender` when the user picks a
 *  sex-specific relation. */
export function sexFromRelation(rel: string): 'male' | 'female' | null {
  const male = ['father', 'son', 'brother', 'grandfather', 'grandson', 'uncle', 'nephew', 'father_in_law', 'son_in_law', 'brother_in_law', 'stepfather', 'godparent'];
  const female = ['mother', 'daughter', 'sister', 'grandmother', 'granddaughter', 'aunt', 'niece', 'mother_in_law', 'daughter_in_law', 'sister_in_law', 'stepmother'];
  if (male.includes(rel)) return 'male';
  if (female.includes(rel)) return 'female';
  return null;
}

/**
 * Sex-aware inverse: given `relation` (from A's POV about B, where B is the
 * "other" person) and B's sex, return the relation FROM B's POV about A.
 * Falls back to the sex-lossy `FAMILY_INVERSE` table for relations not in
 * the sex-aware map (spouse, cousin, generic in-laws, godparents, other).
 *
 * Example: `smartInverseRelation('father', 'male')` → `'son'` (A's father B
 * has a son A iff A is male).
 */
export function smartInverseRelation(relation: string, otherSex: 'male' | 'female' | 'unknown'): string {
  const m = SEX_AWARE_INVERSE[relation];
  if (m) return m[otherSex];
  return FAMILY_INVERSE[relation] ?? 'other';
}

export const FAMILY_LABEL: Record<string, string> = {
  father: 'Father', mother: 'Mother', parent: 'Parent',
  son: 'Son', daughter: 'Daughter', child: 'Child',
  brother: 'Brother', sister: 'Sister', sibling: 'Sibling',
  spouse: 'Spouse', partner: 'Partner', ex_partner: 'Ex-partner',
  grandfather: 'Grandfather', grandmother: 'Grandmother', grandparent: 'Grandparent',
  grandson: 'Grandson', granddaughter: 'Granddaughter', grandchild: 'Grandchild',
  uncle: 'Uncle', aunt: 'Aunt', nephew: 'Nephew', niece: 'Niece', cousin: 'Cousin',
  stepfather: 'Stepfather', stepmother: 'Stepmother', stepchild: 'Stepchild', stepparent: 'Stepparent',
  father_in_law: 'Father-in-law', mother_in_law: 'Mother-in-law',
  brother_in_law: 'Brother-in-law', sister_in_law: 'Sister-in-law',
  son_in_law: 'Son-in-law', daughter_in_law: 'Daughter-in-law',
  child_in_law: 'Child-in-law', parent_in_law: 'Parent-in-law', sibling_in_law: 'Sibling-in-law',
  in_law: 'In-law',
  nephew_or_niece: 'Nephew / Niece', uncle_or_aunt: 'Uncle / Aunt',
  godparent: 'Godparent', godchild: 'Godchild', other: 'Other'
};

export const FAMILY_OPTIONS: { label: string; value: string }[] = Object.entries(FAMILY_LABEL)
  .filter(([v]) => !['child_in_law', 'parent_in_law', 'sibling_in_law', 'nephew_or_niece', 'uncle_or_aunt', 'stepparent'].includes(v))
  .map(([value, label]) => ({ value, label }));

export type FamilyEdge = {
  id: number;
  other: Person;
  /** Relation label as it applies to the *viewed* person (i.e., "other is my <relation>"). */
  relation: string;
  since?: string | null;
  notes?: string | null;
  status?: string;
  /** True if the row's person_id was the viewed person (direct). False if inverted. */
  direct: boolean;
  /** Set when this edge was inferred from a chain (e.g. grandparent via father).
   *  The UI renders "via <name>" and disables the remove button. */
  derivedVia?: { id: number; name: string; relation: string };
};

export async function getPersonFamily(personId: number): Promise<FamilyEdge[]> {
  const rows = await repo.list<FamilyRelation>('Person_family', {
    where: {
      and: [
        { field: 'status', op: 'neq', value: 'archived' },
        {
          or: [
            { field: 'person_id', op: 'eq', value: personId },
            { field: 'relative_id', op: 'eq', value: personId }
          ]
        }
      ]
    },
    fields: [
      'id', 'relation', 'since', 'notes', 'status',
      { person_id: ['id', 'full_name', 'first_name', 'last_name', 'person_picture', 'email', 'gender'] },
      { relative_id: ['id', 'full_name', 'first_name', 'last_name', 'person_picture', 'email', 'gender'] }
    ],
    sort: ['relation'],
    limit: 200
  });

  const edges: FamilyEdge[] = [];
  for (const r of rows) {
    const pid = typeof r.person_id === 'object' && r.person_id ? (r.person_id as Person).id : (r.person_id as number);
    const rid = typeof r.relative_id === 'object' && r.relative_id ? (r.relative_id as Person).id : (r.relative_id as number);
    const direct = pid === personId;
    const other = (direct ? r.relative_id : r.person_id) as Person | null;
    if (!other || typeof other !== 'object') continue;
    const rel = (r.relation as string) ?? 'other';
    // Sex-aware inverse: when reading an inverse edge, the OTHER person's
    // gender lets us choose father/mother/parent (vs the lossy 'child').
    const relFromViewer = direct ? rel : smartInverseRelation(rel, sexOf(other.gender));
    edges.push({
      id: r.id,
      other,
      relation: relFromViewer,
      since: r.since ?? null,
      notes: r.notes ?? null,
      status: r.status,
      direct
    });
    void rid; // referenced for typing above
  }
  return edges;
}

/**
 * Direct edges + edges inferred one hop further: grandparents (via parents),
 * grandchildren (via children), aunts/uncles (via parent's siblings), and
 * in-laws (via spouse's parents). Inferred edges are tagged with `derivedVia`
 * so the UI can render "via <name>" and skip the remove button.
 */
export async function getInferredFamily(personId: number): Promise<FamilyEdge[]> {
  const direct = await getPersonFamily(personId);

  const PARENTS = new Set(['father', 'mother', 'parent', 'stepfather', 'stepmother']);
  const CHILDREN = new Set(['son', 'daughter', 'child', 'stepchild']);
  const SPOUSES = new Set(['spouse', 'partner']);
  const SIBLINGS = new Set(['brother', 'sister', 'sibling']);

  const seen = new Set<number>(direct.map((e) => e.other.id));
  seen.add(personId);
  const inferred: FamilyEdge[] = [];

  // Walk the parents to discover grandparents, aunts/uncles, in-laws (parent
  // of step-parent etc.) and the spouse to discover parent-in-laws.
  const parentEdges = direct.filter((e) => PARENTS.has(e.relation));
  const childEdges = direct.filter((e) => CHILDREN.has(e.relation));
  const spouseEdges = direct.filter((e) => SPOUSES.has(e.relation));

  await Promise.all([
    ...parentEdges.map(async (pe) => {
      const fam = await getPersonFamily(pe.other.id);
      for (const ge of fam) {
        if (seen.has(ge.other.id)) continue;
        // grandparent via parent
        if (PARENTS.has(ge.relation)) {
          seen.add(ge.other.id);
          inferred.push({
            ...ge,
            relation:
              ge.relation === 'father' ? 'grandfather' :
              ge.relation === 'mother' ? 'grandmother' : 'grandparent',
            derivedVia: { id: pe.other.id, name: personName(pe.other), relation: pe.relation }
          });
        }
        // aunt/uncle via parent's sibling
        else if (SIBLINGS.has(ge.relation)) {
          seen.add(ge.other.id);
          inferred.push({
            ...ge,
            relation:
              ge.relation === 'brother' ? 'uncle' :
              ge.relation === 'sister' ? 'aunt' : 'uncle_or_aunt',
            derivedVia: { id: pe.other.id, name: personName(pe.other), relation: pe.relation }
          });
        }
      }
    }),
    ...childEdges.map(async (ce) => {
      const fam = await getPersonFamily(ce.other.id);
      for (const ge of fam) {
        if (seen.has(ge.other.id)) continue;
        // grandchild via child
        if (CHILDREN.has(ge.relation)) {
          seen.add(ge.other.id);
          inferred.push({
            ...ge,
            relation:
              ge.relation === 'son' ? 'grandson' :
              ge.relation === 'daughter' ? 'granddaughter' : 'grandchild',
            derivedVia: { id: ce.other.id, name: personName(ce.other), relation: ce.relation }
          });
        }
      }
    }),
    ...spouseEdges.map(async (se) => {
      const fam = await getPersonFamily(se.other.id);
      for (const ge of fam) {
        if (seen.has(ge.other.id)) continue;
        // parent-in-law via spouse's parents
        if (PARENTS.has(ge.relation)) {
          seen.add(ge.other.id);
          inferred.push({
            ...ge,
            relation:
              ge.relation === 'father' ? 'father_in_law' :
              ge.relation === 'mother' ? 'mother_in_law' : 'in_law',
            derivedVia: { id: se.other.id, name: personName(se.other), relation: se.relation }
          });
        }
        // sibling-in-law via spouse's siblings
        else if (SIBLINGS.has(ge.relation)) {
          seen.add(ge.other.id);
          inferred.push({
            ...ge,
            relation:
              ge.relation === 'brother' ? 'brother_in_law' :
              ge.relation === 'sister' ? 'sister_in_law' : 'sibling_in_law',
            derivedVia: { id: se.other.id, name: personName(se.other), relation: se.relation }
          });
        }
      }
    })
  ]);

  return [...direct, ...inferred];
}

export async function createFamilyRelation(patch: {
  person_id: number;
  relative_id: number;
  relation: string;
  since?: string | null;
  notes?: string | null;
}) {
  return repo.create<FamilyRelation>('Person_family', patch as Record<string, unknown>);
}

export async function updateFamilyRelation(id: number, patch: Partial<FamilyRelation>) {
  return repo.update<FamilyRelation>('Person_family', id, patch as Record<string, unknown>);
}

export async function removeFamilyRelation(id: number) {
  return updateFamilyRelation(id, { status: 'archived' });
}

// Projects — moved to $lib/data/projects.ts, re-exported at the
// end of this file. See docs/opening-up-twin.md.
// Project members — direct vs inherited — moved to $lib/data/projectMembers.ts, re-exported at the
// end of this file. See docs/opening-up-twin.md.
