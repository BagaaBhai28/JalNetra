import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { encodePhoto, maxDimension, maxRgbBytes } from './photo.js';
import { claimAttempt, runAttempt, transact } from './analysis.js';
import { hotspotDashboard } from './hotspots.js';
import { createDraft, exportDraft, getDraft, updateDraft } from './complaints.js';
import { resetRehearsal } from './rehearsal.js';
import { createOpenAiVision, createReplayVision, fingerprintPhoto, getSample, sampleList, categories } from './vision.js';

const zones = [
  ['north-inlet', 'North Inlet', .45, .24],
  ['east-shore', 'East Shore', .73, .45],
  ['south-bank', 'South Bank', .46, .75],
];
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
]);
const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' blob:; style-src 'self'; object-src 'none'; frame-ancestors 'none'",
};
class InputError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function respond(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { ...headers, 'Content-Type': type });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 2500;');
  db.exec('BEGIN IMMEDIATE');
  try {
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version === 0) {
      const initialized = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'report'").get();
      if (!initialized) {
        db.exec(readFileSync(new URL('../database/schema.sql', import.meta.url), 'utf8'));
      }
      db.exec(`CREATE TABLE IF NOT EXISTS report_photo (
        report_id TEXT PRIMARY KEY REFERENCES report (id) ON DELETE CASCADE,
        png BLOB NOT NULL
      ); PRAGMA user_version = 1;`);
    } else if (version !== 1) {
      throw new Error('Unsupported JalNetra database schema version.');
    }
    const seed = db.prepare(`INSERT INTO zone (id, lake_name, name, marker_x, marker_y)
      VALUES (?, 'Demo Lake', ?, ?, ?) ON CONFLICT(id) DO NOTHING`);
    for (const zone of zones) seed.run(...zone);
    db.exec('COMMIT');
    return db;
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }
}

async function readBody(req, limit) {
  if (Number(req.headers['content-length']) > limit) {
    req.resume();
    throw new InputError(413, 'UPLOAD_TOO_LARGE', 'The upload is too large.');
  }
  const blocks = [];
  let bytes = 0;
  for await (const block of req.iterator({ destroyOnReturn: false })) {
    bytes += block.length;
    if (bytes > limit) {
      req.resume();
      throw new InputError(413, 'UPLOAD_TOO_LARGE', 'The upload is too large.');
    }
    blocks.push(block);
  }
  return Buffer.concat(blocks);
}

async function parseJson(req) {
  const type = req.headers['content-type'] ?? '';
  if (!/^application\/json(?:\s*;|$)/i.test(type)) {
    throw new InputError(415, 'EXPECTED_JSON', 'Send this request as JSON.');
  }
  const data = await readBody(req, 48 * 1024);
  try {
    const value = JSON.parse(data.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new InputError(400, 'INVALID_JSON', 'The draft details could not be read.');
  }
}

async function parseForm(req) {
  const type = req.headers['content-type'] ?? '';
  if (!/^multipart\/form-data\s*;/i.test(type)) {
    throw new InputError(415, 'EXPECTED_FORM', 'Submit a photo using the report form.');
  }
  const data = await readBody(req, maxRgbBytes + 32 * 1024);
  try {
    return await new Response(data, {
      headers: { 'Content-Type': type },
    }).formData();
  } catch {
    throw new InputError(400, 'INVALID_FORM', 'The upload could not be read. Try selecting your photo again.');
  }
}

function stringField(form, name) {
  const value = form.get(name);
  if (value === null) return '';
  if (typeof value !== 'string' || form.getAll(name).length !== 1) {
    throw new InputError(400, 'INVALID_FIELD', 'The report has an invalid field.');
  }
  return value.trim();
}

function numericField(form, name, label) {
  const value = stringField(form, name);
  if (!value) return null;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) || !Number.isFinite(Number(value))) {
    throw new InputError(400, 'INVALID_READING', `Enter a valid number for ${label}.`);
  }
  return Number(value);
}

async function validateReport(req, db) {
  const form = await parseForm(req);
  const zoneId = stringField(form, 'zoneId');
  if (!db.prepare('SELECT 1 FROM zone WHERE id = ?').get(zoneId)) {
    throw new InputError(400, 'INVALID_ZONE', 'Choose a listed shoreline zone.');
  }
  const requestId = stringField(form, 'requestId');
  if (!/^[a-z0-9_-]{12,80}$/i.test(requestId)) {
    throw new InputError(400, 'INVALID_REQUEST_ID', 'Start the report again to get a new request ID.');
  }
  const timestamp = stringField(form, 'observedAt');
  const time = Date.parse(timestamp);
  const match = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.exec(timestamp);
  const date = match && new Date(match[1] + 'T00:00:00Z');
  if (!date || Number.isNaN(date.valueOf()) || !date.toISOString().startsWith(match[1]) ||
      !Number.isFinite(time) || time > Date.now()) {
    throw new InputError(400, 'INVALID_TIME', 'Choose a valid observation time at or before the current time.');
  }

  const note = stringField(form, 'note');
  if (note.length > 500) throw new InputError(400, 'NOTE_TOO_LONG', 'Keep the note to 500 characters.');
  const ph = numericField(form, 'ph', 'pH');
  const temperature = numericField(form, 'temperatureC', 'temperature');
  const width = Number(stringField(form, 'photoWidth'));
  const height = Number(stringField(form, 'photoHeight'));
  const photo = form.get('photo');
  if (!photo || typeof photo === 'string' || photo.type !== 'application/octet-stream' ||
      form.getAll('photo').length !== 1) {
    throw new InputError(415, 'INVALID_PHOTO', 'Select a JPEG or PNG photo using the report form.');
  }
  if (![width, height].every(n => Number.isInteger(n) && n >= 1 && n <= maxDimension) ||
      photo.size !== width * height * 3) {
    throw new InputError(400, 'INVALID_PIXELS', 'The photo pixels do not match the photo size.');
  }
  const pixels = Buffer.from(await photo.arrayBuffer());
  const hash = fingerprintPhoto(width, height, pixels);
  const observedAt = new Date(time).toISOString();
  const fingerprint = createHash('sha256').update(
    JSON.stringify([zoneId, observedAt, note, ph, temperature, hash]),
  ).digest('hex');
  return { zoneId, requestId, observedAt, note, ph, temperature, width, height, pixels, hash, fingerprint };
}

const reportFields = `r.id, r.data_mode AS dataMode, r.zone_id AS zoneId, z.name AS zoneName,
  r.observed_at AS observedAt, r.submitted_at AS submittedAt, r.note, r.ph,
  r.temperature_c AS temperatureC, r.current_attempt AS attempt, COALESCE(a.status, 'pending') AS status,
  a.source AS analysisSource, a.review_reason AS reviewReason, a.expires_at AS analysisExpiresAt`;
function reportView(db, row, vision) {
  const { attempt, analysisExpiresAt, ...report } = row;
  return {
    ...report,
    photoUrl: '/api/reports/' + row.id + '/photo',
    canRetry: Boolean(vision && (row.status === 'needs_review' ||
      (row.status === 'pending' && (!analysisExpiresAt || Date.parse(analysisExpiresAt) <= Date.now())))),
    detections: db.prepare('SELECT category, cue FROM detection WHERE report_id = ? AND attempt = ? ORDER BY category')
      .all(row.id, attempt),
  };
}

function saveReport(db, report, mode) {
  const prior = db.prepare(`SELECT id, request_fingerprint FROM report
    WHERE data_mode = ? AND request_id = ?`).get(mode, report.requestId);
  if (prior) {
    if (prior.request_fingerprint !== report.fingerprint) {
      throw new InputError(409, 'REQUEST_CONFLICT', 'This request ID already belongs to different report details.');
    }
    return { id: prior.id, created: false };
  }
  const id = 'JN-' + randomUUID();
  const png = report.png ?? encodePhoto(report.width, report.height, report.pixels);
  db.prepare(`INSERT INTO report
    (id, data_mode, request_id, request_fingerprint, zone_id, observed_at, submitted_at, image_path,
      image_fingerprint, note, ph, temperature_c)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, mode, report.requestId, report.fingerprint, report.zoneId, report.observedAt, new Date().toISOString(),
    id + '.png', report.hash, report.note || null, report.ph, report.temperature,
  );
  db.prepare('INSERT INTO report_photo (report_id, png) VALUES (?, ?)').run(id, png);
  return { id, created: true };
}

export function createApp({
  dbPath = resolve('data', 'jalnetra.sqlite'), vision = null, timeoutMs = 12000, rehearsal = false,
} = {}) {
  const mode = vision?.source === 'live_model' ? 'live' : 'demo';
  if (rehearsal && vision?.source !== 'simulated') throw new Error('Rehearsal requires offline vision samples.');
  const db = openDatabase(rehearsal ? ':memory:' : dbPath);
  let activeAnalyses = 0;
  async function withAnalysis(run) {
    activeAnalyses++;
    try {
      return await run();
    } finally {
      activeAnalyses--;
    }
  }
  const joined = `FROM report r JOIN zone z ON z.id = r.zone_id
    LEFT JOIN analysis_attempt a ON a.report_id = r.id AND a.attempt = r.current_attempt`;
  const find = db.prepare(`SELECT ${reportFields} ${joined} WHERE r.id = ? AND r.data_mode = ?`);
  const list = db.prepare(`SELECT ${reportFields} ${joined}
    WHERE r.data_mode = ? AND (? IS NULL OR r.zone_id = ?)
    ORDER BY r.submitted_at DESC, r.id DESC LIMIT 25`);
  const server = createServer({ requestTimeout: 15000, headersTimeout: 10000 }, async (req, res) => {
    try {
      const host = req.headers.host ?? '';
      const origin = req.headers.origin;
      if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(host) ||
          (origin && origin !== 'http://' + host)) {
        return respond(res, 403, { error: { code: 'LOCAL_ONLY', message: 'Open JalNetra directly on this computer.' } });
      }
      const { pathname, searchParams } = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && assets.has(pathname)) {
        const [file, type] = assets.get(pathname);
        return respond(res, 200, readFileSync(new URL('../public/' + file, import.meta.url)), type);
      }
      if (req.method === 'GET' && pathname === '/api/status') {
        return respond(res, 200, { mode, rehearsal, visionSource: vision?.source ?? null, samples: mode === 'demo' ? sampleList : [] });
      }
      if (req.method === 'POST' && rehearsal && pathname === '/api/demo/reset') {
        await parseJson(req);
        if (activeAnalyses) throw new InputError(409, 'ANALYSIS_IN_PROGRESS', 'Wait for analysis to finish before restarting the rehearsal.');
        const seededReportId = await withAnalysis(() => resetRehearsal(db, vision, timeoutMs, saveReport));
        return respond(res, 200, { seededReportId });
      }
      if (req.method === 'GET' && mode === 'demo' && pathname.startsWith('/api/demo/samples/')) {
        const sample = getSample(pathname.slice('/api/demo/samples/'.length));
        if (sample) return respond(res, 200, sample.png, 'image/png');
      }
      if (req.method === 'GET' && pathname === '/api/hotspots') {
        return respond(res, 200, hotspotDashboard(db, mode, Date.now()));
      }
      if (req.method === 'GET' && pathname === '/api/zones') {
        return respond(res, 200, db.prepare(`SELECT id, lake_name AS lakeName, name,
          latitude, longitude, marker_x AS markerX, marker_y AS markerY FROM zone ORDER BY rowid`).all());
      }
      if (req.method === 'GET' && pathname === '/api/reports') {
        const zoneId = searchParams.get('zoneId');
        return respond(res, 200, list.all(mode, zoneId, zoneId).map(row => reportView(db, row, vision)));
      }
      if (req.method === 'POST' && pathname === '/api/reports') {
        const report = await validateReport(req, db);
        const { result, attempt } = transact(db, () => {
          const result = saveReport(db, report, mode);
          return { result, attempt: result.created ? claimAttempt(db, result, vision, timeoutMs) : null };
        });
        await withAnalysis(() => runAttempt(db, attempt, vision, timeoutMs));
        return respond(res, result.created ? 201 : 200, reportView(db, find.get(result.id, mode), vision));
      }
      if (req.method === 'POST' && pathname === '/api/complaints') {
        const { zoneId, category } = await parseJson(req);
        if (typeof zoneId !== 'string' || !categories.includes(category) ||
            !db.prepare('SELECT 1 FROM zone WHERE id = ?').get(zoneId)) {
          throw new InputError(400, 'INVALID_COMPLAINT', 'Choose a listed zone and observation category.');
        }
        const result = transact(db, () => createDraft(db, mode, zoneId, category, Date.now()));
        if (!result) throw new InputError(409, 'INSUFFICIENT_EVIDENCE', 'Two distinct recent photos are required.');
        return respond(res, result.created ? 201 : 200, result.draft);
      }
      const draftRoute = /^\/api\/complaints\/(JD-[a-f0-9-]{36})(\/export)?$/.exec(pathname);
      if (draftRoute) {
        const [, id, download] = draftRoute;
        if (req.method === 'GET') {
          const draft = getDraft(db, mode, id);
          if (draft && download) {
            res.setHeader('Content-Disposition', 'attachment; filename="' + id + '.txt"');
            return respond(res, 200, exportDraft(draft), 'text/plain; charset=utf-8');
          }
          if (draft) return respond(res, 200, draft);
        }
        if (req.method === 'PATCH' && !download) {
          const { recipient, draftText } = await parseJson(req);
          if (typeof recipient !== 'string' || recipient.length > 160 || /[\r\n]/.test(recipient) ||
              typeof draftText !== 'string' || !draftText.trim() || draftText.length > 20000) {
            throw new InputError(400, 'INVALID_DRAFT', 'Check the recipient and keep the draft between 1 and 20,000 characters.');
          }
          const draft = transact(db, () => updateDraft(db, mode, id, recipient.trim(), draftText.trim()));
          if (draft) return respond(res, 200, draft);
        }
      }
      const reportRoute = /^\/api\/reports\/(JN-[a-f0-9-]{36})(\/(photo|retry))?$/.exec(pathname);
      if (reportRoute) {
        const [, id, , action] = reportRoute;
        const report = find.get(id, mode);
        if (report && req.method === 'GET' && !action) return respond(res, 200, reportView(db, report, vision));
        if (report && req.method === 'GET' && action === 'photo') {
          const image = db.prepare('SELECT png FROM report_photo WHERE report_id = ?').get(id);
          if (image) return respond(res, 200, image.png, 'image/png');
        }
        if (report && req.method === 'POST' && action === 'retry' && vision) {
          const attempt = transact(db, () => claimAttempt(db, report, vision, timeoutMs));
          await withAnalysis(() => runAttempt(db, attempt, vision, timeoutMs));
          return respond(res, attempt?.busy ? 202 : 200, reportView(db, find.get(id, mode), vision));
        }
      }
      return respond(res, 404, { error: { code: 'NOT_FOUND', message: 'This page or report could not be found.' } });
    } catch (error) {
      if (error instanceof InputError) {
        return respond(res, error.status, { error: { code: error.code, message: error.message } });
      }
      console.error(error);
      return respond(res, 500, { error: { code: 'SERVER_ERROR', message: 'The report could not be processed.' } });
    }
  });
  server.once('close', () => db.close());
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || '3000');
  const rehearsal = process.argv.includes('--rehearsal');
  const vision = !rehearsal && process.env.JALNETRA_MODE === 'live' ? createOpenAiVision({
    apiKey: process.env.OPENAI_API_KEY, model: process.env.JALNETRA_VISION_MODEL,
  }) : createReplayVision();
  createApp({ vision, rehearsal }).listen(port, '127.0.0.1', () => console.log('JalNetra is running at http://127.0.0.1:' + port));
}

