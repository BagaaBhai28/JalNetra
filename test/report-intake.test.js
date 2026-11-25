import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';
import { createApp } from '../src/server.js';

function formFor(observedAt, changes = {}) {
  const form = new FormData();
  const fields = {
    requestId: 'test-intake-001',
    zoneId: 'north-inlet',
    observedAt,
    photoWidth: '2',
    photoHeight: '1',
    ph: '7.2',
    ...changes,
  };
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  form.set('photo', new Blob([Uint8Array.of(20, 50, 80, 200, 230, 255)], {
    type: 'application/octet-stream',
  }), 'fixture.rgb');
  return form;
}

function openApp(dbPath) {
  const server = createApp({ dbPath });
  const handle = server.listeners('request')[0];
  async function request(url, options = {}) {
    const input = new Request('http://127.0.0.1' + url, options);
    const body = Buffer.from(await input.arrayBuffer());
    const req = Object.assign(Readable.from(body.length ? [body] : []), {
      method: input.method,
      url,
      headers: { host: '127.0.0.1', ...Object.fromEntries(input.headers) },
    });
    return new Promise((resolve, reject) => {
      const res = {
        writeHead(status, headers) {
          this.status = status;
          this.headers = headers;
        },
        end(data) {
          resolve(new Response(data, { status: this.status, headers: this.headers }));
        },
      };
      handle(req, res).catch(reject);
    });
  }
  return { request, close: () => server.emit('close') };
}

test('observations are validated, idempotent and persisted with a readable photo', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jalnetra-test-'));
  const dbPath = join(directory, 'reports.sqlite');
  let app = openApp(dbPath);
  try {
    const zones = await app.request('/api/zones').then(response => response.json());
    assert.deepEqual(zones.map(zone => zone.name), ['North Inlet', 'East Shore', 'South Bank']);
    assert.match(await app.request('/').then(response => response.text()), /Save observation/);
    const observedAt = new Date(Date.now() - 30000).toISOString();
    const submit = changes => app.request('/api/reports', { method: 'POST', body: formFor(observedAt, changes) });
    const blocked = await app.request('/api/reports', {
      method: 'POST',
      headers: { Origin: 'https://example.com' },
      body: formFor(observedAt),
    });
    assert.equal(blocked.status, 403);
    assert.equal((await submit({ zoneId: 'invalid' })).status, 400);
    assert.equal((await submit({ photoWidth: '3' })).status, 400);
    assert.equal((await submit({ ph: 'invalid' })).status, 400);
    assert.equal((await submit({ observedAt: '2031-02-30T00:00:00Z' })).status, 400);

    const responses = await Promise.all([submit(), submit()]);
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 201]);
    const [saved, duplicate] = await Promise.all(responses.map(response => response.json()));
    assert.equal(saved.id, duplicate.id);
    assert.equal(saved.status, 'pending');
    assert.equal(saved.ph, 7.2);
    assert.equal((await submit({ note: 'Different payload' })).status, 409);
    assert.equal((await app.request('/api/reports?zoneId=east-shore').then(response => response.json())).length, 0);

    await app.close();
    app = null;
    app = openApp(dbPath);
    const recent = await app.request('/api/reports').then(response => response.json());
    assert.deepEqual(recent.map(report => report.id), [saved.id]);
    const photo = await app.request(saved.photoUrl);
    assert.equal(photo.headers.get('content-type'), 'image/png');
    const png = Buffer.from(await photo.arrayBuffer());
    assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
    assert.equal(png.readUInt32BE(16), 2);
    assert.equal(png.readUInt32BE(20), 1);
    assert.equal(png.subarray(37, 41).toString('ascii'), 'IDAT');
    assert.deepEqual([...inflateSync(png.subarray(41, 41 + png.readUInt32BE(33)))], [0, 20, 50, 80, 200, 230, 255]);
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
