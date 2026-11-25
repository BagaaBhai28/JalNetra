const paths = new Map([
  ['pilot/status', 'status'],
  ['pilot/reports', 'reports'],
]);

function reply(status, body) {
  return Response.json(body, { status, headers: {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  } });
}

export function createPilotHandler({ url, publishableKey, request = fetch } = {}) {
  const configured = /^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url ?? '') &&
    /^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey ?? '');

  return async function handle(input) {
    const incoming = new URL(input.url);
    const route = incoming.pathname === '/api/jalnetra' ?
      incoming.searchParams.get('jalroute') : incoming.pathname.slice('/api/'.length);
    const action = incoming.pathname.startsWith('/api/') ? paths.get(route) : undefined;
    if (!action) return null;
    if (input.method !== 'GET') return reply(405, { error: { code: 'METHOD_NOT_ALLOWED' } });

    const isStatus = action === 'status';
    const bearer = input.headers.get('authorization');
    if (!isStatus && (!bearer || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(bearer))) {
      return reply(401, { error: { code: 'PILOT_SIGN_IN_REQUIRED' } });
    }
    if (!configured) return reply(503, { ready: false, error: { code: 'PILOT_NOT_CONFIGURED' } });

    const target = new URL(isStatus ? '/rest/v1/rpc/jalnetra_pilot_status' : '/rest/v1/pilot_reports', url);
    if (!isStatus) {
      target.searchParams.set('select', 'id,lake_id,zone_id,observed_at,created_at,note,ph,temperature_c,photo_path');
      target.searchParams.set('order', 'created_at.desc,id.desc');
      target.searchParams.set('limit', '25');
    }

    try {
      const response = await request(target, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5000),
        headers: isStatus ? { apikey: publishableKey } : { apikey: publishableKey, Authorization: bearer },
      });
      if (!isStatus && [401, 403].includes(response.status)) {
        return reply(response.status, { error: { code: 'PILOT_ACCESS_DENIED' } });
      }
      if (!response.ok) throw new Error('Pilot Data API request failed');
      const data = await response.json();
      if (isStatus && data?.ready === true && data.schemaVersion === 1) {
        return reply(200, { ready: true, provider: 'supabase', schemaVersion: 1 });
      }
      if (!isStatus && Array.isArray(data)) return reply(200, { reports: data });
      throw new Error('Unexpected pilot Data API response');
    } catch {
      return reply(503, { ready: false, error: { code: 'PILOT_DATA_UNAVAILABLE' } });
    }
  };
}
