import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHostedHandler, SnapshotConflict } from '../src/hosted.js';
import { sampleForm } from '../test-support/samples.js';

const origin = 'https://jalnetra.example';

test('hosted demo persists across requests, isolates browsers and protects concurrent writes', async () => {
  const files = new Map();
  let rev = 0;
  const store = {
    async read(path) { return files.get(path) ?? null; },
    async write(path, bytes, etag) {
      if (files.get(path)?.etag !== etag) throw new SnapshotConflict();
      files.set(path, { bytes, etag: String(++rev) });
    },
  };
  let fetch = createHostedHandler(store);
  const getCookie = async () => {
    const response = await fetch(new Request(origin + '/api/jalnetra?jalroute=status'));
    assert.equal(response.status, 200);
    const header = response.headers.get('set-cookie');
    assert.match(header, /Secure; HttpOnly; SameSite=Strict/);
    assert.equal((await response.json()).hosted, true);
    return header.split(';')[0];
  };
  const send = (path, cookie, options = {}) => {
    const headers = new Headers(options.headers);
    if (cookie) headers.set('cookie', cookie);
    if (options.method && !headers.has('origin')) headers.set('origin', origin);
    return fetch(new Request(origin + path, { ...options, headers }));
  };
  const json = body => ({
    method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
  });
  const first = await getCookie();
  const second = await getCookie();
  assert.notEqual(first, second);
  assert.equal((await send('/api/demo/reset', null, json({}))).status, 403);
  assert.equal((await send('/api/demo/reset', first, {
    ...json({}), headers: { 'Content-Type': 'application/json', Origin: 'https://different.example' },
  })).status, 403);
  const seeded = await send('/api/demo/reset', first, json({})).then(response => response.json());
  assert.ok(seeded.seededReportId);
  fetch = createHostedHandler(store);
  const [one, other] = await Promise.all([
    send('/api/hotspots', first).then(response => response.json()),
    send('/api/hotspots', second).then(response => response.json()),
  ]);
  assert.equal(one.zones[0].status, 'watch');
  assert.equal(other.zones[0].status, 'none');

  const body = sampleForm('foam-bank');
  assert.equal((await send('/api/reports', first, { method: 'POST', body })).status, 201);
  const draft = await send('/api/complaints', first, json({ zoneId: 'north-inlet', category: 'foam' }))
    .then(response => response.json());
  assert.equal(draft.evidence.length, 2);
  assert.equal((await send('/api/complaints/' + draft.id + '/export', second)).status, 404);
  const exported = await send('/api/complaints/' + draft.id + '/export', first);
  assert.match(await exported.text(), /DEMO DRAFT/);
  assert.match(exported.headers.get('content-disposition'), /attachment/);
  const [raceOne, raceTwo] = await Promise.all([
    send('/api/reports', first, { method: 'POST', body: sampleForm('algae') }),
    send('/api/reports', first, { method: 'POST', body: sampleForm('unclear') }),
  ]);
  assert.deepEqual([raceOne.status, raceTwo.status].sort(), [201, 409]);
});
