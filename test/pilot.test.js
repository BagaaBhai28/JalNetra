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

test('pilot writes enforce same origin and allow only assigned operators to run live vision', async () => {
  const reportId = 'a1020000-0000-4000-8000-000000000001';
  const lakeId = 'a1020000-0000-4000-8000-000000000002';
  const user = 'a1020000-0000-4000-8000-000000000003';
  const report = { id: reportId, lake_id: lakeId, photo_path: user + '/' + reportId + '.png' };
  let operator = false, providerCalls = 0, saved;
  const handle = createPilotHandler({ ...settings, apiKey: 'test', model: 'openai/test-model', gateway: true,
    async visionRequest(url, options) {
      assert.equal(url, 'https://ai-gateway.vercel.sh/v1/responses');
      assert.equal(JSON.parse(options.body).model, 'openai/test-model');
      providerCalls++;
      return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text',
        text: JSON.stringify({ imageQuality: 'usable', detections: [{ category: 'foam', cue: 'White bubbles along the shoreline' }] }),
      }] }] });
    },
    async request(url, options) {
      if (url.pathname === '/rest/v1/pilot_reports') return Response.json([report]);
      if (url.pathname === '/auth/v1/user') return Response.json({ id: user });
      if (url.pathname === '/rest/v1/pilot_memberships') {
        assert.equal(url.searchParams.get('user_id'), 'eq.' + user);
        return Response.json(operator ? [{ role: 'operator' }] : []);
      }
      if (url.pathname.startsWith('/storage/v1/object/authenticated/')) return new Response(Buffer.from([1, 2, 3]));
      if (url.pathname === '/rest/v1/pilot_review_events' && options.method === 'GET') return Response.json(saved ? [saved] : []);
      if (url.pathname === '/rest/v1/pilot_review_events' && options.method === 'POST') {
        saved = JSON.parse(options.body);
        return Response.json([saved], { status: 201 });
      }
      throw new Error('Unexpected request');
    },
  });
  const analyze = origin => handle(new Request(host + '/api/pilot/analyze', {
    method: 'POST', headers: { Authorization: 'Bearer demo.token.value', Origin: origin },
    body: JSON.stringify({ reportId }),
  }));
  assert.equal((await analyze('https://other.example')).status, 403);
  assert.equal((await analyze(host)).status, 403);
  assert.equal(providerCalls, 0);
  operator = true;
  assert.equal((await analyze(host)).status, 201);
  assert.equal(saved.model_output.detections[0].category, 'foam');
  assert.equal((await analyze(host)).status, 200);
  assert.equal(providerCalls, 1);
});

test('pilot enrollment accepts a successful empty response from Supabase', async () => {
  const userId = 'a1020000-0000-4000-8000-000000000003';
  const lakeId = 'a1020000-0000-4000-8000-000000000001';
  const handle = createPilotHandler({ ...settings, async request(url, options) {
    if (url.pathname === '/auth/v1/user') return Response.json({ id: userId, email_confirmed_at: '2026-11-25' });
    assert.equal(url.pathname, '/rest/v1/pilot_memberships');
    assert.deepEqual(JSON.parse(options.body), { user_id: userId, lake_id: lakeId, role: 'citizen' });
    return new Response(null, { status: 201 });
  } });
  const response = await handle(new Request(host + '/api/pilot/enroll', {
    method: 'POST', headers: { Authorization: 'Bearer demo.token.value', Origin: host },
    body: JSON.stringify({ lakeId }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { enrolled: true });
});
