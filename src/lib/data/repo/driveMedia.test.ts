import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenValid, folderQuery, multipartUpload } from './driveMedia.ts';

test('tokenValid: needs a token and a future expiry (60s margin)', () => {
  assert.equal(tokenValid(null), false);
  assert.equal(tokenValid({}), false);
  assert.equal(tokenValid({ access_token: 'x' }), false);
  assert.equal(tokenValid({ access_token: 'x', expiry: Date.now() - 1000 }), false);
  assert.equal(tokenValid({ access_token: 'x', expiry: Date.now() + 30_000 }), false, 'inside the 60s margin');
  assert.equal(tokenValid({ access_token: 'x', expiry: Date.now() + 600_000 }), true);
});

test('folderQuery finds the non-trashed Twin folder', () => {
  const q = folderQuery();
  assert.match(q, /mimeType='application\/vnd\.google-apps\.folder'/);
  assert.match(q, /name='Twin'/);
  assert.match(q, /trashed=false/);
});

test('multipartUpload builds a related body with metadata + binary parts', () => {
  const file = new Blob(['hello'], { type: 'image/png' });
  const { boundary, body } = multipartUpload(file, 'avatar.png', 'FOLDER123');
  assert.ok(boundary.startsWith('twin'));
  assert.ok(body instanceof Blob);
  assert.ok(body.size > file.size, 'body wraps the file with headers');
});

test('multipartUpload metadata names the file and parents it to the folder', async () => {
  const file = new Blob(['x'], { type: 'image/jpeg' });
  const { boundary, body } = multipartUpload(file, 'photo.jpg', 'FID');
  const text = await body.text();
  assert.match(text, /"name":"photo\.jpg"/);
  assert.match(text, /"parents":\["FID"\]/);
  assert.match(text, /Content-Type: image\/jpeg/);
  assert.ok(text.includes(`--${boundary}--`), 'closes the multipart envelope');
});
