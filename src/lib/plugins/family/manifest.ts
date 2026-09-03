// Family relations — the reference build-time plugin (docs/phase4-plugins.md §5).
//
// The cleanest first extraction: it touches only the core `Person` entity, owns
// one collection (Person_family), has no route of its own (it renders as a
// section inside the Person detail page), and its data lives in ./data.ts.
import type { PluginManifest } from '../types';

export const family: PluginManifest = {
  id: 'family',
  category: 'People & CRM',
  label: 'Family relations',
  description:
    'Relationship edges between people — parent, sibling, partner — shown as a section on each person. The reference plugin.',
  tier: 'public',
  dependsOn: ['contacts'],
  collections: ['Person_family'],
  settings: [
    {
      key: 'owner_email',
      label: 'Your email',
      type: 'text',
      placeholder: 'you@example.com',
      description: "Marks your own card as 'You' in the family tree."
    }
  ],
  // No `routes`: family is a section on /people/[id], gated there by featureOn.
  // No `nav`/`tiles`.
};
