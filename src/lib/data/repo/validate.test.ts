import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyStatus, connCheckMessage } from './validate.ts';

test('classifyStatus: only a gateway key rejection is bad-key', () => {
  assert.equal(classifyStatus(401), 'bad-key');
  assert.equal(classifyStatus(403), 'bad-key');
  // Any answered request proves the key was accepted — including "no such
  // route" (404 on /rest/v1/ root variants) and server errors.
  assert.equal(classifyStatus(200), 'ok');
  assert.equal(classifyStatus(404), 'ok');
  assert.equal(classifyStatus(500), 'ok');
});

test('connCheckMessage names the actual fix for each failure', () => {
  assert.match(connCheckMessage('bad-key'), /Legacy API keys/);
  assert.match(connCheckMessage('bad-key'), /sb_publishable/);
  assert.match(connCheckMessage('unreachable'), /project URL/);
});
