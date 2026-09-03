// Run with:  npm run test:clockify-errors
//
// The strings here are the real ones Clockify returned against the KLAK
// workspace on 2026-08-10, captured from the live proxy rather than invented —
// a paraphrase would pass these tests and fail in production.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainPushFailure } from './clockifyErrors.ts';

const FORCE_PROJECTS =
  'Clockify POST workspaces/64a.../time-entries failed (400): {"message":"Time entry couldn\'t be created. Project is either required field or given project is archived. Please change your input or update your workspace settings.","code":501}';

test('the forceProjects rejection says what to click', () => {
  const out = explainPushFailure(new Error(FORCE_PROJECTS));
  assert.match(out, /Settings → Clockify/);
  assert.match(out, /requires a project/i);
  // The raw text must not survive — it names neither the twin project nor the fix.
  assert.doesNotMatch(out, /code":501/);
});

test('an archived project is diagnosed as archived, not as unmapped', () => {
  // Different fix: re-map, rather than map for the first time.
  const out = explainPushFailure(new Error('project is archived and cannot accept entries'));
  assert.match(out, /archived/i);
  assert.match(out, /Re-map/);
});

test('Clockify’s combined sentence is read as the missing-project case', () => {
  // "either required field or given project is archived" mentions archiving,
  // but it is what comes back when NO project was sent at all.
  const out = explainPushFailure(new Error(FORCE_PROJECTS));
  assert.match(out, /requires a project/i);
  assert.doesNotMatch(out, /Re-map/);
});

test('a rejected key points at the Flow, not at twin', () => {
  // The key is not in this app and never will be; sending someone to look for
  // it in twin wastes the whole debugging session.
  const out = explainPushFailure(new Error('Clockify GET user failed (401): {"message":"Api key missing"}'));
  assert.match(out, /Flow/);
  assert.match(out, /X-Api-Key/);
});

test('an unrecognised failure is passed through unchanged', () => {
  // Swallowing the detail of an unknown error is how a real outage gets
  // misdiagnosed as a mapping problem.
  const raw = 'NetworkError: Failed to fetch';
  assert.equal(explainPushFailure(new Error(raw)), raw);
});

test('a non-Error rejection is still readable', () => {
  assert.equal(explainPushFailure('plain string failure'), 'plain string failure');
});
