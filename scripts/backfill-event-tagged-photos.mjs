// Backfill: materialize an event's Immich library tags (photo_link
// collection="event") into its Directus event_photo gallery — the same
// thing src/lib/events/data.ts importEventTaggedPhotos() does in-app, but
// runnable from the CLI for a one-time fill. Idempotent via source_asset_id.
//
//   node scripts/backfill-event-tagged-photos.mjs <eventId>
//
// Reads PUBLIC_DIRECTUS_URL / PUBLIC_DIRECTUS_TOKEN from .env. Immich is
// reached on port 8444 of the same host (the key-injecting proxy).
import { readFileSync } from 'node:fs';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => /^(PUBLIC_DIRECTUS_URL|PUBLIC_DIRECTUS_TOKEN)=/.test(l))
    .map((l) => l.split(/=(.*)/s).slice(0, 2))
);
const U = env.PUBLIC_DIRECTUS_URL.replace(/\/$/, '');
const TOKEN = env.PUBLIC_DIRECTUS_TOKEN;
const IMMICH = (() => {
  const u = new URL(U);
  u.port = '8444';
  u.pathname = '';
  return u.toString().replace(/\/$/, '');
})();
const H = { Authorization: `Bearer ${TOKEN}` };

const eventId = Number(process.argv[2] || 8);

async function dj(path) {
  const r = await fetch(`${U}${path}`, { headers: H });
  if (!r.ok) throw new Error(`Directus ${path} → ${r.status}`);
  return (await r.json()).data;
}

const links = await dj(`/items/photo_link?filter[collection][_eq]=event&filter[item_id][_eq]=${eventId}&fields=asset_id&limit=-1`);
const assetIds = [...new Set(links.map((l) => l.asset_id))];
console.log(`event ${eventId}: ${assetIds.length} tagged asset(s)`);
if (!assetIds.length) process.exit(0);

const existing = await dj(`/items/event_photo?filter[event_id][_eq]=${eventId}&fields=source_asset_id&limit=-1`);
const have = new Set(existing.map((r) => r.source_asset_id).filter(Boolean));
const todo = assetIds.filter((id) => !have.has(id));
console.log(`${have.size} already materialized · ${todo.length} to import`);

let imported = 0;
for (const id of todo) {
  try {
    const img = await fetch(`${IMMICH}/api/assets/${id}/thumbnail?size=preview`);
    if (!img.ok) throw new Error(`immich ${img.status}`);
    const buf = Buffer.from(await img.arrayBuffer());
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type: 'image/jpeg' }), `event-${eventId}-${id}.jpg`);
    const up = await fetch(`${U}/files`, { method: 'POST', headers: H, body: fd });
    if (!up.ok) throw new Error(`directus /files ${up.status}`);
    const fileId = (await up.json()).data.id;
    const cr = await fetch(`${U}/items/event_photo`, {
      method: 'POST',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_id: eventId, file_id: fileId, source_asset_id: id })
    });
    if (!cr.ok) throw new Error(`directus event_photo ${cr.status}`);
    imported++;
    console.log(`  ✓ ${id}`);
  } catch (e) {
    console.log(`  ✗ ${id} — ${e.message}`);
  }
}
console.log(`done — ${imported}/${todo.length} imported`);
