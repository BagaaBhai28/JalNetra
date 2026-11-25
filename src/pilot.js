import { encodePhoto, maxDimension, maxRgbBytes } from './photo.js';
import { createOpenAiVision, categories } from './vision.js';
import { lakes } from './lakes.js';
import { groupPilotHotspots, pilotHotspotWindowMs } from './pilot-hotspots.js';
import { createPilotComplaint } from './complaints.js';

const routes = {
  status: 'GET', signup: 'POST', signin: 'POST', refresh: 'POST', recover: 'POST', password: 'POST', signout: 'POST', account: 'GET',
  catalog: 'GET', enroll: 'POST', members: 'GET POST', reports: 'GET', upload: 'POST', concerns: 'GET POST',
  photo: 'GET', analyze: 'POST', review: 'POST', hotspots: 'GET', complaint: 'POST',
};
const validUuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const tokenPattern = /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/i;
const bucket = 'jalnetra-pilot-evidence';
const photoColumns = 'id,lake_id,zone_id,observed_at,created_at,note,ph,temperature_c,photo_path';
const reportSelect = photoColumns + ',reporter_id,photo_hash,events:pilot_review_events!pilot_review_events_lake_id_report_id_fkey(id,actor_id,action,category,note,duplicate_of,model_output,created_at)';
const jsonHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const reply = (status, body) => Response.json(body, { status, headers: jsonHeaders });

class PilotError extends Error {
  constructor(status, code, message) {
    super(message);
    Object.assign(this, { status, code });
  }
}
function requireValue(condition, code, message, status = 400) {
  if (!condition) throw new PilotError(status, code, message);
}
async function bounded(input, limit) {
  const chunks = [];
  let length = 0;
  requireValue(Number(input.headers.get('content-length')) <= limit, 'BODY_TOO_LARGE', 'The upload is too large.', 413);
  if (input.body) for await (const chunk of input.body) {
    length += chunk.byteLength;
    requireValue(length <= limit, 'BODY_TOO_LARGE', 'The upload is too large.', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function jsonInput(input) {
  const bytes = await bounded(input, 8192);
  try {
    const value = JSON.parse(bytes.toString());
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch { /* Return a consistent input error. */ }
  throw new PilotError(400, 'INVALID_JSON', 'Enter valid submission details.');
}

export function differenceHash(width, height, pixels) {
  let bits = 0n;
  const gray = (x, y) => {
    const i = (Math.round(y * (height - 1) / 7) * width + Math.round(x * (width - 1) / 8)) * 3;
    return 299 * pixels[i] + 587 * pixels[i + 1] + 114 * pixels[i + 2];
  };
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    bits = (bits << 1n) | BigInt(gray(x, y) > gray(x + 1, y));
  }
  return bits.toString(16).padStart(16, '0');
}

export function createPilotHandler({ url, publishableKey, request = fetch, apiKey, model, gateway, visionRequest } = {}) {
  const configured = /^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url ?? '') &&
    /^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey ?? '');
  const vision = apiKey && model ? createOpenAiVision({ apiKey, model, gateway, request: visionRequest }) : null;

  return async function handle(input) {
    const incoming = new URL(input.url);
    const route = incoming.pathname === '/api/jalnetra' ?
      incoming.searchParams.get('jalroute') : incoming.pathname.slice('/api/'.length);
    const action = incoming.pathname.startsWith('/api/') && route?.startsWith('pilot/') ? route.slice(6) : '';
    if (!Object.hasOwn(routes, action)) return null;
    if (!routes[action].split(' ').includes(input.method)) return reply(405, { error: { code: 'METHOD_NOT_ALLOWED' } });
    const bearer = input.headers.get('authorization');
    const authAction = ['status', 'signup', 'signin', 'refresh', 'recover'].includes(action);
    if (!authAction && !tokenPattern.test(bearer ?? '')) {
      return reply(401, { error: { code: 'PILOT_SIGN_IN_REQUIRED', message: 'Sign in to continue.' } });
    }
    if (input.method === 'POST' && input.headers.get('origin') !== incoming.origin) {
      return reply(403, { error: { code: 'INVALID_ORIGIN', message: 'Open JalNetra directly to submit.' } });
    }
    if (!configured) return reply(503, { ready: false, error: { code: 'PILOT_NOT_CONFIGURED', message: 'Shared reporting is not configured.' } });

    const call = (path, { method = 'GET', body, headers = {} } = {}) => request(new URL(path, url), {
      method, body, redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { apikey: publishableKey, ...(authAction ? {} : { Authorization: bearer }), ...headers },
    });
    async function result(path, options) {
      const upstream = await call(path, options);
      if (!upstream.ok) {
        const data = await upstream.json().catch(() => ({}));
        if ([401, 403].includes(upstream.status)) throw new PilotError(upstream.status, 'PILOT_ACCESS_DENIED', 'Your account cannot perform this action. Sign in again if your session expired.');
        if (upstream.status === 409 || data.code === '23505') throw new PilotError(409, 'PILOT_CONFLICT', 'This record already exists. Refresh and try again.');
        if (upstream.status === 429) throw new PilotError(429, 'PILOT_RATE_LIMIT', 'Too many requests. Wait and try again.');
        if (upstream.status < 500) throw new PilotError(400, 'PILOT_REJECTED', 'The service rejected the request. Check the details and your access.');
        throw new Error('Pilot request failed');
      }
      const body = await upstream.text();
      return body ? JSON.parse(body) : null;
    }
    const rest = (table, params) => '/rest/v1/' + table + '?' + new URLSearchParams(params);
    const send = (path, data, prefer = 'return=representation') => result(path, {
      method: 'POST', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json', Prefer: prefer },
    });
    const account = () => result('/auth/v1/user');
    const lookup = async id => {
      requireValue(validUuid.test(id ?? ''), 'INVALID_REPORT', 'Choose an existing report.');
      const [report] = await result(rest('pilot_reports', { id: 'eq.' + id, select: photoColumns }));
      requireValue(report, 'REPORT_NOT_FOUND', 'Report is unavailable.', 404);
      return report;
    };
    const requireOperator = async lakeId => {
      const user = await account();
      const rows = await result(rest('pilot_memberships', { user_id: 'eq.' + user.id,
        lake_id: 'eq.' + lakeId, role: 'in.(operator,admin)', select: 'role' }));
      requireValue(rows.length, 'PILOT_ACCESS_DENIED', 'An operator or administrator assigned to this lake is required.', 403);
    };
    async function hotspotsFor(lakeId, now) {
      const reports = [];
      const period = '(observed_at.gte.' + new Date(now - pilotHotspotWindowMs).toISOString() +
        ',observed_at.lte.' + new Date(now).toISOString() + ')';
      const pageSize = 100;
      for (let offset = 0; ; offset += pageSize) {
        const page = await result(rest('pilot_reports', {
          lake_id: 'eq.' + lakeId, and: period, select: reportSelect,
          order: 'observed_at.desc,id.desc', limit: String(pageSize), offset: String(offset),
        }));
        reports.push(...page);
        if (page.length < pageSize) return groupPilotHotspots(reports, now);
      }
    }
    async function evidence(path) {
      const response = await call('/storage/v1/object/authenticated/' + bucket + '/' + path);
      requireValue(response.ok, 'PHOTO_UNAVAILABLE', 'Photo is unavailable.', response.status === 401 ? 401 : 404);
      return response;
    }

    try {
      if (action === 'status') {
        const data = await result('/rest/v1/rpc/jalnetra_pilot_status');
        if (data?.ready && data.schemaVersion === 1) return reply(200, { ready: true, provider: 'supabase', schemaVersion: 1 });
        if (data?.ready && data.schemaVersion === 2) {
          return reply(200, { ready: true, provider: 'supabase', schemaVersion: 2, visionConfigured: Boolean(vision) });
        }
        throw new Error('Unexpected schema');
      }
      if (action === 'recover') {
        const { email } = await jsonInput(input);
        requireValue(typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(email),
          'INVALID_EMAIL', 'Enter a valid email address.');
        const redirect = new URL('/pilot.html', incoming.origin).href;
        await send('/auth/v1/recover?' + new URLSearchParams({ redirect_to: redirect }), { email });
        return reply(200, { message: 'If this address has an account, check your email for the reset link.' });
      }
      if (action === 'password') {
        const { password } = await jsonInput(input);
        requireValue(typeof password === 'string' && password.length >= 8 && password.length <= 128,
          'INVALID_PASSWORD', 'Enter a password between 8 and 128 characters.');
        await result('/auth/v1/user', {
          method: 'PUT', body: JSON.stringify({ password }), headers: { 'Content-Type': 'application/json' },
        });
        return reply(200, { updated: true });
      }
      if (['signin', 'signup', 'refresh'].includes(action)) {
        const { email, password, refresh_token } = await jsonInput(input);
        if (action === 'refresh') {
          requireValue(typeof refresh_token === 'string' && refresh_token.length <= 800 && refresh_token.length > 0,
            'INVALID_SESSION', 'Sign in again to continue.');
          return reply(200, await send('/auth/v1/token?grant_type=refresh_token', { refresh_token }));
        }
        requireValue(typeof email === 'string' && email.length <= 254 && typeof password === 'string' && password.length >= 6 && password.length <= 128,
          'INVALID_LOGIN', 'Enter an email and a password between 6 and 128 characters.');
        if (action === 'signup') {
          const redirect = new URL('/pilot.html', incoming.origin).href;
          await send('/auth/v1/signup?' + new URLSearchParams({ redirect_to: redirect }), { email, password });
          return reply(200, { message: 'Check your email to confirm your account, then sign in.' });
        }
        return reply(200, await send('/auth/v1/token?grant_type=password', { email, password }));
      }
      if (action === 'signout') {
        await result('/auth/v1/logout?scope=local', { method: 'POST' });
        return reply(200, { signedOut: true });
      }
      if (action === 'account') {
        const user = await account();
        const memberships = await result(rest('pilot_memberships', { select: 'lake_id,role', user_id: 'eq.' + user.id }));
        return reply(200, { id: user.id, email: user.email, memberships });
      }
      if (action === 'catalog') {
        const rows = await result(rest('pilot_lakes', { select: 'id,name,slug,pilot_zones(id,name,slug)', order: 'name' }));
        const locations = new Map(lakes.map(lake => [lake.id, lake]));
        return reply(200, { lakes: rows.map(lake => ({
          ...lake,
          pilot_zones: lake.pilot_zones.map(zone => {
            const point = locations.get(lake.slug)?.zones.find(item => item.id === zone.slug);
            return point ? { ...zone, latitude: point.latitude, longitude: point.longitude } : zone;
          }),
        })) });
      }
      if (action === 'hotspots') {
        const lakeId = incoming.searchParams.get('lakeId');
        requireValue(validUuid.test(lakeId ?? ''), 'INVALID_LAKE', 'Choose a catalog lake.');
        await requireOperator(lakeId);
        return reply(200, { groups: await hotspotsFor(lakeId, Date.now()) });
      }
      if (action === 'complaint') {
        const { lakeId, zoneId, category } = await jsonInput(input);
        requireValue([lakeId, zoneId].every(id => validUuid.test(id ?? '')) && categories.includes(category),
          'INVALID_COMPLAINT', 'Choose a lake, shoreline sector, and visible category.');
        await requireOperator(lakeId);
        const groups = await hotspotsFor(lakeId, Date.now());
        const group = groups.find(item => item.zoneId === zoneId && item.category === category);
        requireValue(group?.status === 'priority_hotspot', 'HOTSPOT_NOT_ELIGIBLE',
          'A complaint draft requires two distinct, recent reviewed reports in this sector and category.', 409);
        const [lake] = await result(rest('pilot_lakes', {
          id: 'eq.' + lakeId, select: 'name,slug,pilot_zones(id,name,slug)',
        }));
        const zone = lake?.pilot_zones.find(item => item.id === zoneId);
        requireValue(zone, 'INVALID_COMPLAINT', 'This shoreline sector is unavailable.', 404);
        const point = lakes.find(item => item.id === lake.slug)?.zones.find(item => item.id === zone.slug);
        return reply(200, createPilotComplaint(lake, zone, point, group));
      }
      if (action === 'enroll') {
        const { lakeId } = await jsonInput(input);
        requireValue(validUuid.test(lakeId ?? ''), 'INVALID_LAKE', 'Choose a catalog lake.');
        const user = await account();
        requireValue(user.email_confirmed_at, 'EMAIL_NOT_CONFIRMED', 'Confirm your email before joining a lake.', 403);
        await send(rest('pilot_memberships', { on_conflict: 'lake_id,user_id' }),
          { lake_id: lakeId, user_id: user.id, role: 'citizen' }, 'resolution=ignore-duplicates,return=minimal');
        return reply(200, { enrolled: true });
      }
      if (action === 'members') {
        const lakeId = incoming.searchParams.get('lakeId');
        requireValue(validUuid.test(lakeId ?? ''), 'INVALID_LAKE', 'Choose a catalog lake.');
        const user = await account();
        const [membership] = await result(rest('pilot_memberships', { lake_id: 'eq.' + lakeId,
          user_id: 'eq.' + user.id, select: 'role' }));
        requireValue(membership?.role === 'admin', 'PILOT_ACCESS_DENIED', 'A lake administrator is required.', 403);
        if (input.method === 'GET') {
          const members = await result(rest('pilot_memberships', { lake_id: 'eq.' + lakeId,
            role: 'in.(citizen,operator)', select: 'user_id,role', order: 'user_id', limit: '250' }));
          return reply(200, { members });
        }
        const { userId, role } = await jsonInput(input);
        requireValue(validUuid.test(userId ?? '') && ['citizen', 'operator'].includes(role),
          'INVALID_MEMBER', 'Choose an enrolled account and a role.');
        const [updated] = await result(rest('pilot_memberships', { lake_id: 'eq.' + lakeId, user_id: 'eq.' + userId }), {
          method: 'PATCH', body: JSON.stringify({ role }), headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        });
        requireValue(updated, 'MEMBER_NOT_FOUND', 'That account cannot be updated.', 404);
        return reply(200, { updated: true });
      }
      if (action === 'reports' || (action === 'concerns' && input.method === 'GET')) {
        const lakeId = incoming.searchParams.get('lakeId');
        requireValue(!lakeId || validUuid.test(lakeId), 'INVALID_LAKE', 'Choose a catalog lake.');
        const params = {
          select: action === 'reports' ? (lakeId ? reportSelect : photoColumns) : 'id,lake_id,zone_id,category,description,created_at',
          order: 'created_at.desc,id.desc', limit: '25', ...(lakeId ? { lake_id: 'eq.' + lakeId } : {}),
        };
        const page = incoming.searchParams.get('page');
        const review = incoming.searchParams.get('review');
        if (action === 'reports' && page !== null) {
          requireValue(/^\d{1,5}$/.test(page), 'INVALID_PAGE', 'Choose a valid report page.');
          params.offset = String(Number(page) * 25);
          params.limit = '26';
        }
        if (action === 'reports' && review === 'pending') {
          requireValue(lakeId, 'INVALID_LAKE', 'Choose a catalog lake.');
          await requireOperator(lakeId);
          params.select += ',reviewed:pilot_review_events!pilot_review_events_lake_id_report_id_fkey(id)';
          params['reviewed.action'] = 'neq.model';
          params.reviewed = 'is.null';
        }
        const rows = await result(rest(action === 'reports' ? 'pilot_reports' : 'pilot_concerns', params));
        if (action === 'reports' && page !== null) return reply(200, { reports: rows.slice(0, 25), hasMore: rows.length > 25 });
        return reply(200, { [action]: rows });
      }
      if (action === 'concerns') {
        const { id, lake_id, zone_id, category, description } = await jsonInput(input);
        requireValue([id, lake_id, zone_id].every(value => validUuid.test(value ?? '')) &&
          ['dumping', 'suspected-discharge', 'sewage', 'other'].includes(category) &&
          typeof description === 'string' && description.trim() && description.length <= 500,
        'INVALID_CONCERN', 'Choose a shoreline side and concern type, and describe what you observed.');
        const data = { id, lake_id, zone_id, category, description: description.trim() };
        const [concern] = await send(rest('pilot_concerns', { on_conflict: 'id' }), data,
          'resolution=ignore-duplicates,return=representation');
        if (concern) return reply(201, concern);
        const user = await account();
        const [prior] = await result(rest('pilot_concerns', { id: 'eq.' + id, reporter_id: 'eq.' + user.id,
          select: 'id,lake_id,zone_id,category,description,created_at' }));
        requireValue(prior && Object.keys(data).every(key => prior[key] === data[key]),
          'PILOT_CONFLICT', 'Start a new concern for these details.', 409);
        return reply(200, prior);
      }
      if (action === 'upload') {
        const bytes = await bounded(input, maxRgbBytes + 16000);
        const form = await new Response(bytes, { headers: { 'Content-Type': input.headers.get('content-type') ?? '' } }).formData().catch(() => null);
        const read = key => form?.get(key);
        const [id, lake_id, zone_id, observed_at, note] = ['id', 'lake_id', 'zone_id', 'observed_at', 'note'].map(read);
        const [width, height] = ['width', 'height'].map(key => Number(read(key)));
        const photo = read('pixels');
        const reading = key => read(key) ? Number(read(key)) : null;
        const ph = reading('ph'), temperature_c = reading('temperature_c');
        requireValue([id, lake_id, zone_id].every(value => typeof value === 'string' && validUuid.test(value)) &&
          typeof observed_at === 'string' && Number.isFinite(Date.parse(observed_at)) && Date.parse(observed_at) <= Date.now() + 300000 &&
          typeof note === 'string' && note.length <= 500 && (ph === null || ph >= 0 && ph <= 14) &&
          (temperature_c === null || temperature_c >= -20 && temperature_c <= 100) &&
          [width, height].every(n => Number.isInteger(n) && n >= 1 && n <= maxDimension) &&
          photo instanceof Blob && photo.size === width * height * 3,
        'INVALID_REPORT', 'Check the shoreline side, observation details, and photo.');
        const user = await account();
        const members = await result(rest('pilot_memberships', { lake_id: 'eq.' + lake_id, role: 'eq.citizen',
          user_id: 'eq.' + user.id, select: 'role' }));
        const zones = await result(rest('pilot_zones', { lake_id: 'eq.' + lake_id, id: 'eq.' + zone_id, select: 'id' }));
        requireValue(members.length && zones.length, 'PILOT_ACCESS_DENIED', 'Join this lake and choose one of its shoreline sides.', 403);
        const photo_path = user.id + '/' + id + '.png';
        const [prior] = await result(rest('pilot_reports', { photo_path: 'eq.' + photo_path, select: photoColumns }));
        requireValue(!prior || (prior.lake_id === lake_id && prior.zone_id === zone_id),
          'PILOT_CONFLICT', 'Start a new observation for this shoreline side.', 409);
        if (prior) return reply(200, prior);
        const pixels = Buffer.from(await photo.arrayBuffer());
        const png = encodePhoto(width, height, pixels);
        const upload = await call('/storage/v1/object/' + bucket + '/' + photo_path,
          { method: 'POST', body: png, headers: { 'Content-Type': 'image/png' } });
        if (!upload.ok) {
          const original = await evidence(photo_path);
          requireValue(Buffer.from(await original.arrayBuffer()).equals(png),
            'PILOT_CONFLICT', 'This request already contains a different photo.', 409);
        }
        const [report] = await send(rest('pilot_reports', {}), {
          lake_id, zone_id, observed_at, note, ph, temperature_c, photo_path,
          photo_hash: differenceHash(width, height, pixels),
        });
        return reply(201, report);
      }
      if (action === 'photo') {
        const report = await lookup(incoming.searchParams.get('id'));
        const response = await evidence(report.photo_path);
        return new Response(response.body, { headers: { ...jsonHeaders, 'Content-Type': 'image/png' } });
      }
      const data = await jsonInput(input);
      const report = await lookup(data.reportId);
      await requireOperator(report.lake_id);
      const event = { lake_id: report.lake_id, report_id: report.id };
      if (action === 'analyze') {
        const [existing] = await result(rest('pilot_review_events', { report_id: 'eq.' + report.id, action: 'eq.model', limit: '1' }));
        if (existing) return reply(200, existing);
        requireValue(vision, 'VISION_NOT_CONFIGURED', 'Real analysis has not been configured. Use human review for this report.', 503);
        const photo = await evidence(report.photo_path);
        const png = Buffer.from(await photo.arrayBuffer());
        let output;
        try {
          output = await vision.analyse({ png, signal: AbortSignal.timeout(11000) });
        } catch {
          throw new PilotError(502, 'VISION_UNAVAILABLE', 'Real analysis failed. Retry or review this photo manually.');
        }
        const [saved] = await send(rest('pilot_review_events', {}), { ...event, action: 'model', model_output: output });
        return reply(201, saved);
      }
      const { decision, category, note, duplicateOf } = data;
      requireValue(['confirm', 'correct', 'dismiss', 'duplicate'].includes(decision) &&
        (['confirm', 'correct'].includes(decision) ? categories.includes(category) : !category) &&
        typeof note === 'string' && note.trim() && note.length <= 500 &&
        (decision === 'duplicate' ? validUuid.test(duplicateOf ?? '') && duplicateOf !== report.id : !duplicateOf),
      'INVALID_REVIEW', 'Choose a decision and enter a review note.');
      const [saved] = await send(rest('pilot_review_events', {}), {
        ...event, action: decision, category: category || null, note: note.trim(), duplicate_of: duplicateOf || null,
      });
      return reply(201, saved);
    } catch (error) {
      return error instanceof PilotError ? reply(error.status, { error: { code: error.code, message: error.message } }) :
        reply(503, { ready: false, error: { code: 'PILOT_DATA_UNAVAILABLE', message: 'The shared reporting service is unavailable. Try again.' } });
    }
  };
}
