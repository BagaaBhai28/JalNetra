import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPilotHandler } from '../src/pilot.js';

const source = 'https://pilotexample.supabase.co';
const host = 'https://jalnetra.example';
const settings = { url: source, publishableKey: 'sb_publishable_example' };

test('pilot health verifies the Supabase schema over the Vercel rewrite', async () => {
  const handle = createPilotHandler({ ...settings, async request(url, options) {
    assert.equal(url.href, source + '/rest/v1/rpc/jalnetra_pilot_status');
    assert.equal(options.headers.apikey, settings.publishableKey);
    assert.equal(options.headers.Authorization, undefined);
    return Response.json({ ready: true, schemaVersion: 1 });
  } });
  assert.equal(await handle(new Request(host + '/api/status')), null);
  const result = await handle(new Request(host + '/api/jalnetra?jalroute=pilot/status'));
  assert.deepEqual(await result.json(), { ready: true, provider: 'supabase', schemaVersion: 1 });
  assert.equal((await createPilotHandler()(new Request(host + '/api/pilot/status'))).status, 503);
});

test('pilot reports require a bearer token and forward it for row-level access', async () => {
  let calls = 0;
  const handle = createPilotHandler({ ...settings, async request(url, options) {
    calls++;
    assert.equal(url.pathname, '/rest/v1/pilot_reports');
    assert.equal(url.searchParams.get('limit'), '25');
    assert.equal(options.headers.Authorization, 'Bearer demo.token.value');
    return calls === 1 ? Response.json([{ id: 'authorized-report' }]) : new Response(null, { status: 401 });
  } });
  const route = host + '/api/pilot/reports';
  assert.equal((await handle(new Request(route))).status, 401);
  assert.equal((await handle(new Request(route, { method: 'POST' }))).status, 405);
  assert.equal(calls, 0);
  const authorized = () => new Request(route, { headers: { Authorization: 'Bearer demo.token.value' } });
  assert.deepEqual(await (await handle(authorized())).json(), { reports: [{ id: 'authorized-report' }] });
  assert.equal((await handle(authorized())).status, 401);
});
