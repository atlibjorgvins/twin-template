import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConferencing, extractProvenance } from './conferencing.ts';

// Fixtures are real rows from the Dates collection, shortened only in length.

const GOOGLE = [
  '-::~:~::~:~:~:~:~::~:~::-',
  'Join with Google Meet: https://meet.google.com/nnc-etnz-gya',
  'Or dial: (IS) +354 539 0680 PIN: 7723645902601#',
  'More phone numbers: https://tel.meet/nnc-etnz-gya?pin=7723645902601&hs=7',
  '',
  'Please do not edit this section.',
  '-::~:~::~:~:~:~:~::~:~::-'
].join('\n');

const TEAMS = [
  '________________________________________________________________________________',
  'Microsoft Teams Need help?<https://aka.ms/JoinTeamsMeeting?omkt=en-GB>',
  'Join the meeting now<https://teams.microsoft.com/l/meetup-join/19%3ameeting_ZTEy%40thread.v2/0?context=%7b%22Tid%22%3a%22x%22%7d>',
  'Meeting ID: 380 238 149 439',
  'Passcode: PuA4o8',
  '________________________________'
].join('\n');

test('Google Meet: join URL, dial-in, PIN and more-numbers page all extracted', () => {
  const c = parseConferencing(GOOGLE);
  assert.ok(c);
  assert.equal(c.provider, 'google_meet');
  assert.equal(c.label, 'Join Google Meet');
  assert.equal(c.joinUrl, 'https://meet.google.com/nnc-etnz-gya');
  assert.equal(c.phoneCountry, 'IS');
  assert.equal(c.phoneDisplay, '+354 539 0680');
  assert.equal(c.phone, '+3545390680');          // tel: safe
  assert.equal(c.pin, '7723645902601');
  assert.equal(c.morePhonesUrl, 'https://tel.meet/nnc-etnz-gya?pin=7723645902601&hs=7');
});

test('Teams: angle-bracketed URL is unwrapped, ID and passcode extracted', () => {
  const c = parseConferencing(TEAMS);
  assert.ok(c);
  assert.equal(c.provider, 'teams');
  assert.equal(c.label, 'Join Teams meeting');
  assert.ok(c.joinUrl.startsWith('https://teams.microsoft.com/l/meetup-join/'));
  assert.doesNotMatch(c.joinUrl, /[<>]/);        // the bug this guards
  assert.equal(c.meetingId, '380 238 149 439');
  assert.equal(c.passcode, 'PuA4o8');
});

test('every extracted join URL parses as an absolute URL', () => {
  for (const src of [GOOGLE, TEAMS, 'Join Zoom Meeting\nhttps://klak.zoom.us/j/1234567890']) {
    const c = parseConferencing(src);
    assert.ok(c);
    assert.doesNotThrow(() => new URL(c.joinUrl));
  }
});

test('Zoom is recognised, including a vanity subdomain', () => {
  const c = parseConferencing('Join Zoom Meeting\nhttps://klak.zoom.us/j/1234567890\nPasscode: 998877');
  assert.ok(c);
  assert.equal(c.provider, 'zoom');
  assert.equal(c.passcode, '998877');
});

test('a trailing period is not swallowed into the URL', () => {
  const c = parseConferencing('Call here: https://meet.google.com/abc-defg-hij.');
  assert.equal(c?.joinUrl, 'https://meet.google.com/abc-defg-hij');
});

test('virtual_link wins over a link in the description', () => {
  const c = parseConferencing(GOOGLE, 'https://meet.google.com/curated-link');
  assert.equal(c?.joinUrl, 'https://meet.google.com/curated-link');
  // …but the dial-in from the description is still carried through.
  assert.equal(c?.pin, '7723645902601');
});

test('a description with no conferencing yields null', () => {
  assert.equal(parseConferencing('Retro for the sprint. Bring notes.'), null);
  assert.equal(parseConferencing(null), null);
  assert.equal(parseConferencing(''), null);
  assert.equal(parseConferencing(undefined, ''), null);
});

test('prose mentioning a provider without a link is not joinable', () => {
  assert.equal(parseConferencing('We will use Google Meet — link to follow.'), null);
});

test('provenance notes are separated from the description body', () => {
  const src = 'Real agenda here.\nAdded from email invitation (Sunna <sunna@klak.is>, 2026-08-11).';
  const { notes, rest } = extractProvenance(src);
  assert.equal(rest, 'Real agenda here.');
  assert.equal(notes.length, 1);
  assert.match(notes[0], /^Added from email invitation/);
});

test('bracketed update notes are unwrapped and removed from the body', () => {
  const src = '[Updated from email 2026-06-08: rescheduled A -> B]\nAgenda.';
  const { notes, rest } = extractProvenance(src);
  assert.equal(rest, 'Agenda.');
  assert.match(notes[0], /^Updated from email/);
  assert.doesNotMatch(notes[0], /^\[|\]$/);
});

test('a description with no provenance is returned unchanged', () => {
  const src = 'Just an agenda.\nSecond line.';
  const { notes, rest } = extractProvenance(src);
  assert.deepEqual(notes, []);
  assert.equal(rest, src);
});

test('extractProvenance is safe on empty input', () => {
  assert.deepEqual(extractProvenance(null), { notes: [], rest: '' });
  assert.deepEqual(extractProvenance(''), { notes: [], rest: '' });
});

// ── describeParts ──────────────────────────────────────────────────────
import { describeParts } from './conferencing.ts';

test('plain text yields a single text part', () => {
  const p = describeParts('Just an agenda.');
  assert.deepEqual(p, [{ kind: 'text', text: 'Just an agenda.' }]);
});

test("Outlook's Label<url> form becomes text plus a link", () => {
  const p = describeParts('Senta úr Outlook fyrir Android<https://aka.ms/AAb9ysg>');
  assert.equal(p.length, 2);
  assert.equal(p[0].kind, 'text');
  assert.match(p[0].text, /^Senta úr Outlook/);
  assert.equal(p[1].kind, 'link');
  assert.equal(p[1].href, 'https://aka.ms/AAb9ysg');
  // The angle brackets must not survive into the label.
  assert.doesNotMatch(p[1].text, /[<>]/);
});

test('a bare URL becomes a link labelled by host and path', () => {
  const p = describeParts('Docs at https://klak.is/handbok/2026 please');
  const link = p.find((x) => x.kind === 'link');
  assert.equal(link?.href, 'https://klak.is/handbok/2026');
  assert.equal(link?.text, 'klak.is/handbok/2026');
});

test('a very long URL label is truncated, href kept whole', () => {
  const long = 'https://example.com/' + 'a'.repeat(90);
  const link = describeParts(long).find((x) => x.kind === 'link');
  assert.equal(link?.href, long);
  assert.ok(link.text.length <= 42);
  assert.match(link.text, /…$/);
});

test('sentence punctuation stays out of the href', () => {
  const p = describeParts('See https://klak.is/x.');
  const link = p.find((x) => x.kind === 'link');
  assert.equal(link?.href, 'https://klak.is/x');
  assert.equal(p[p.length - 1].text, '.');
});

test('www. is dropped from the label but not the href', () => {
  const link = describeParts('https://www.klak.is/').find((x) => x.kind === 'link');
  assert.equal(link?.href, 'https://www.klak.is/');
  assert.equal(link?.text, 'klak.is');
});

test('multiple links in one description are all found', () => {
  const p = describeParts('One https://a.com/1 and two https://b.com/2');
  assert.equal(p.filter((x) => x.kind === 'link').length, 2);
});

test('empty input yields no parts', () => {
  assert.deepEqual(describeParts(null), []);
  assert.deepEqual(describeParts(''), []);
});

test('Outlook Label<url> gains a separating space so words do not collide', () => {
  const p = describeParts('Senta úr Outlook fyrir Android<https://aka.ms/AAb9ysg>');
  const flat = p.map((x) => x.text).join('');
  assert.match(flat, /Android aka\.ms/);       // not "Androidaka.ms"
  assert.doesNotMatch(flat, /Androidaka/);
});

test('a bracketed link already preceded by a space gains no second space', () => {
  const p = describeParts('Join here <https://klak.is/x>');
  assert.equal(p.map((x) => x.text).join(''), 'Join here klak.is/x');
});

test('a bare URL is not given an artificial separator', () => {
  const p = describeParts('See https://klak.is/x');
  assert.equal(p.map((x) => x.text).join(''), 'See klak.is/x');
});
