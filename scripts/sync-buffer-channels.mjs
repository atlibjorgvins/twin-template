#!/usr/bin/env node
// Sync the buffer_channel snapshot from Buffer itself, through the
// "Buffer post proxy" Directus Flow (which holds the API key). Run
// whenever channels are added/removed/reconnected in Buffer:
//
//   node scripts/sync-buffer-channels.mjs
//
// Upserts every channel and reports what changed.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const env = Object.fromEntries(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', process.env.TWIN_ENV_FILE || '.env'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const URL_BASE = (env.DIRECTUS_ADMIN_URL || env.PUBLIC_DIRECTUS_URL || '').replace(/\/$/, '');
const TOKEN = env.PUBLIC_DIRECTUS_TOKEN;
const FLOW = 'f3c405b7-25df-4563-bb36-ad8c0a0ab658';
// Self-signed tailnet certs are fine here.
const agent = new https.Agent({ rejectUnauthorized: false });

async function api(path, opts = {}) {
  const res = await fetch(`${URL_BASE}${path}`, {
    ...opts,
    // @ts-expect-error node fetch dispatcher
    agent,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(opts.headers ?? {})
    }
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}

// 1. Account → organization id (via proxy)
const acct = await api(`/flows/trigger/${FLOW}`, {
  method: 'POST',
  headers: { Authorization: '' },
  body: JSON.stringify({ query: '{ account { id organizations { id name } } }' })
});
const org = acct?.data?.data?.account?.organizations?.[0];
if (!org) throw new Error(`No organization in account response: ${JSON.stringify(acct).slice(0, 200)}`);
console.log(`organization: ${org.name} (${org.id})`);

// 2. Channels (via proxy)
const chRes = await api(`/flows/trigger/${FLOW}`, {
  method: 'POST',
  headers: { Authorization: '' },
  body: JSON.stringify({
    query: `query Channels($input: ChannelsInput!) {
      channels(input: $input) { id name displayName service type avatar isDisconnected }
    }`,
    variables: { input: { organizationId: org.id } }
  })
});
const channels = chRes?.data?.data?.channels;
if (!Array.isArray(channels)) {
  throw new Error(`Unexpected channels response: ${JSON.stringify(chRes).slice(0, 300)}`);
}
console.log(`Buffer reports ${channels.length} channels.`);

// 3. Upsert against the snapshot
const existing = (await api('/items/buffer_channel?limit=-1&fields=id,display_name,service,is_disconnected')).data;
const existingById = new Map(existing.map((c) => [c.id, c]));

let created = 0;
let updated = 0;
for (const ch of channels) {
  const row = {
    id: ch.id,
    name: ch.name ?? null,
    display_name: ch.displayName ?? ch.name ?? null,
    service: ch.service ?? null,
    channel_type: ch.type ?? null,
    avatar: ch.avatar ?? null,
    is_disconnected: !!ch.isDisconnected
  };
  if (existingById.has(ch.id)) {
    await api(`/items/buffer_channel/${ch.id}`, { method: 'PATCH', body: JSON.stringify(row) });
    updated++;
  } else {
    await api('/items/buffer_channel', { method: 'POST', body: JSON.stringify(row) });
    created++;
    console.log(`  + new channel: ${row.display_name} (${row.service})`);
  }
  existingById.delete(ch.id);
}
// Channels gone from Buffer
for (const [id, row] of existingById) {
  await api(`/items/buffer_channel/${id}`, { method: 'DELETE' });
  console.log(`  - removed stale channel: ${row.display_name} (${row.service})`);
}
console.log(`✓ synced: ${created} new, ${updated} updated, ${existingById.size} removed.`);
