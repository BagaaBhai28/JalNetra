import { normalize } from './photo-input.js';
import { drawMap } from './lake-map.js';

const $ = id => document.getElementById(id);
const notice = $('pilot-status');
const lakeSelect = $('pilot-lake');
const photoForm = $('pilot-photo-form');
const concernForm = $('pilot-concern-form');
const store = 'jalnetra-pilot-session';
const time = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
const labels = { foam: 'Foam', algae_like_growth: 'Algae-like growth', dumping: 'Waste dumping',
  'suspected-discharge': 'Suspected wastewater discharge', sewage: 'Sewage or drain overflow', other: 'Other concern',
  confirm: 'Confirmed', correct: 'Corrected', dismiss: 'Dismissed', duplicate: 'Marked duplicate', clear: 'No visible issue' };
let session;
try { session = JSON.parse(sessionStorage.getItem(store)); } catch { /* A fresh sign-in is required. */ }
let user, lakes = [], lake, role, listVersion = 0, refreshInFlight, visionConfigured;
let reportPage = 0;
let linkedReport;
let conditions = [];
let conditionsVersion = 0;
let recoveryToken;
let photoId = crypto.randomUUID(), concernId = crypto.randomUUID();
const previews = new Set();

function msg(text, error = false) {
  notice.textContent = text;
  notice.dataset.kind = error ? 'error' : 'success';
}
function el(tag, text) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  return node;
}
function setSession(next) {
  session = next;
  if (next) sessionStorage.setItem(store, JSON.stringify(next));
  else sessionStorage.removeItem(store);
}
async function http(route, payload, token) {
  const headers = new Headers();
  if (token) headers.set('Authorization', 'Bearer ' + token);
  const method = payload === undefined ? 'GET' : 'POST';
  let body = payload;
  if (payload !== undefined && !(payload instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(payload);
  }
  return fetch('/api/pilot/' + route, { method, headers, body });
}
async function decode(response) {
  if (response.ok) return response.json();
  const info = await response.json().catch(() => ({}));
  throw new Error(info.error?.message || 'Shared reporting could not complete this request.');
}
async function api(route, payload, image = false) {
  let response = await http(route, payload, session?.access_token);
  if (response.status === 401 && session?.refresh_token) {
    const key = session.refresh_token;
    refreshInFlight ??= http('refresh', { refresh_token: key }).then(decode).then(next => {
      if (session?.refresh_token === key) setSession(next);
    }).finally(() => { refreshInFlight = undefined; });
    await refreshInFlight;
    response = await http(route, payload, session?.access_token);
  }
  if (image && response.ok) return response.blob();
  return decode(response);
}
function operate(button, run) {
  if (button.disabled) return;
  button.disabled = true;
  msg('');
  return Promise.resolve().then(run).catch(error => msg(error.message, true)).finally(() => {
    button.disabled = false;
  });
}
function zoneName(id, selected = lake) {
  return selected?.pilot_zones.find(zone => zone.id === id)?.name ?? 'Shoreline sector';
}
function photoDistance(a, b) {
  if (!/^[a-f0-9]{16}$/.test(a ?? '') || !/^[a-f0-9]{16}$/.test(b ?? '')) return Infinity;
  let bits = BigInt('0x' + a) ^ BigInt('0x' + b);
  let count = 0;
  for (; bits > 0n; bits &= bits - 1n) count++;
  return count;
}
function events(report) {
  return [...(report.events ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
}
function latestReview(report) {
  return events(report).find(item => item.action !== 'model');
}
const hotspotStatus = { none: 'No reviewed evidence', watch: 'Watch', priority_hotspot: 'Priority hotspot' };
const hotspotMap = $('pilot-hotspot-map');
const hotspotTiles = $('pilot-hotspot-tiles');
const hotspotMarkers = $('pilot-hotspot-markers');
let hotspotPoints = [];
let activeHotspotZone;
const complaintDialog = $('pilot-complaint');
let currentComplaint;

new ResizeObserver(() => drawMap(hotspotMap, hotspotTiles, hotspotPoints, hotspotMarkers, 17, 50)).observe(hotspotMap);

function viewPhoto(id, title, version) {
  const button = el('button', 'View photo');
  button.type = 'button';
  button.className = 'secondary';
  button.setAttribute('aria-label', 'View photo for report ' + id);
  button.addEventListener('click', () => operate(button, async () => {
    const blob = await api('photo?id=' + encodeURIComponent(id), undefined, true);
    if (version !== listVersion || !button.isConnected) return;
    const image = el('img');
    image.alt = title;
    image.src = URL.createObjectURL(blob);
    previews.add(image.src);
    button.replaceWith(image);
  }));
  return button;
}

function readingText(ph, temperature) {
  return [ph != null ? 'pH ' + ph : '', temperature != null ? temperature + ' °C' : ''].filter(Boolean).join(' · ');
}

function complaintButton(lakeId, zoneId, category, version) {
  const button = el('button', 'Generate complaint draft');
  button.type = 'button';
  button.className = 'secondary';
  button.addEventListener('click', () => operate(button, async () => {
    const draft = await api('complaint', { lakeId, zoneId, category });
    if (version !== listVersion || !button.isConnected) return;
    currentComplaint = draft;
    $('pilot-export-status').textContent = '';
    $('pilot-complaint-recipient').value = draft.recipient;
    $('pilot-complaint-text').value = draft.draftText;
    $('pilot-complaint-routing').textContent = draft.localContact
      ? 'The council is a local contact. Confirm jurisdiction before filing.'
      : 'Confirm the responsible civic body and enter it before downloading.';
    const links = $('pilot-complaint-links');
    links.replaceChildren();
    for (const contact of [draft.localContact, draft.filing].filter(Boolean)) {
      const link = el('a', contact.name);
      link.href = contact.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      links.append(link);
    }
    if (!complaintDialog.open) complaintDialog.showModal();
  }));
  return button;
}

$('pilot-complaint-close').addEventListener('click', () => complaintDialog.close());
$('pilot-complaint-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!currentComplaint) return;
  const recipient = $('pilot-complaint-recipient').value.trim();
  const body = $('pilot-complaint-text').value.trim();
  if (!recipient || !body) {
    const field = recipient ? $('pilot-complaint-text') : $('pilot-complaint-recipient');
    field.value = '';
    field.reportValidity();
    return;
  }
  const text = ['DRAFT — review before filing.', 'To: ' + recipient, '', body, '', 'Evidence references',
    ...currentComplaint.evidence.map(report => report.id + ' — ' + report.observedAt),
  ].join('\n');
  downloadFile(new Blob([text], { type: 'text/plain;charset=utf-8' }), 'jalnetra-complaint-draft.txt');
});

function downloadFile(blob, name) {
  const href = URL.createObjectURL(blob);
  const link = el('a');
  link.href = href;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

$('pilot-export-evidence').addEventListener('click', async event => {
  const button = event.currentTarget;
  const form = $('pilot-complaint-form');
  const feedback = $('pilot-export-status');
  const draft = currentComplaint;
  if (!draft || button.disabled || !form.reportValidity()) return;
  const recipient = $('pilot-complaint-recipient').value.trim();
  const text = $('pilot-complaint-text').value.trim();
  if (!recipient || !text) {
    feedback.textContent = 'Enter a recipient and draft text.';
    return;
  }
  button.disabled = true;
  feedback.textContent = 'Preparing evidence photos.';
  try {
    const file = document.implementation.createHTMLDocument('JalNetra complaint evidence');
    file.body.append(el('h1', 'JalNetra complaint evidence'),
      el('p', 'Draft for review'), el('p', 'To: ' + recipient), el('pre', text));
    for (const report of draft.evidence) {
      const photo = await api('photo?id=' + encodeURIComponent(report.id), undefined, true);
      if (draft !== currentComplaint || !complaintDialog.open) return;
      if (photo.type !== 'image/png') throw new Error('An evidence photo is unavailable.');
      const url = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(photo);
      });
      if (draft !== currentComplaint || !complaintDialog.open) return;
      const figure = el('figure');
      const image = el('img');
      image.src = url;
      image.width = 640;
      image.alt = 'Shoreline evidence from report ' + report.id;
      const caption = report.id + ' · ' + time.format(new Date(report.observedAt)) + ' IST';
      const readings = readingText(report.ph, report.temperatureC);
      figure.append(image, el('figcaption', caption + (readings ? ' · Citizen-reported ' + readings : '')));
      file.body.append(figure);
    }
    downloadFile(new Blob(['<!doctype html>\n', file.documentElement.outerHTML],
      { type: 'text/html;charset=utf-8' }), 'jalnetra-complaint-with-photos.html');
    feedback.textContent = 'Draft with evidence photos downloaded.';
  } catch {
    if (draft === currentComplaint) feedback.textContent = 'The photo export could not be created. Retry or download the text draft.';
  } finally {
    button.disabled = false;
  }
});

function renderHotspots(selected, groups, version) {
  const list = $('pilot-hotspot-zones');
  const panel = $('pilot-hotspot-evidence');
  const zones = selected.pilot_zones;
  hotspotPoints = zones.filter(zone => Number.isFinite(zone.latitude) && Number.isFinite(zone.longitude));
  hotspotMap.hidden = !hotspotPoints.length;
  list.replaceChildren();
  hotspotMarkers.replaceChildren();
  if (!zones.some(zone => zone.id === activeHotspotZone)) {
    activeHotspotZone = groups[0]?.zoneId ?? zones[0]?.id;
  }
  function showZone(zone) {
    activeHotspotZone = zone.id;
    for (const button of [...list.children, ...hotspotMarkers.children]) {
      button.setAttribute('aria-pressed', String(button.dataset.mapId === zone.id));
    }
    panel.replaceChildren(el('h3', zone.name));
    const categories = groups.filter(group => group.zoneId === zone.id);
    if (!categories.length) panel.append(el('p', hotspotStatus.none));
    for (const group of categories) {
      const section = el('section');
      section.append(el('h4', labels[group.category] + ' · ' + hotspotStatus[group.status]),
        el('p', group.evidence.length + (group.evidence.length === 1 ? ' independent reporter' : ' independent reporters')));
      const evidence = el('ul');
      evidence.className = 'pilot-records';
      for (const report of group.evidence) {
        const row = el('li');
        row.append(el('p', time.format(new Date(report.observedAt)) + ' IST'), el('small', 'JalNetra reference ' + report.id));
        const readings = readingText(report.ph, report.temperatureC);
        if (readings) row.append(el('p', 'Citizen-reported · ' + readings));
        row.append(viewPhoto(report.id, 'Citizen photo from ' + zone.name, version));
        evidence.append(row);
      }
      section.append(evidence);
      if (group.status === 'priority_hotspot') section.append(complaintButton(selected.id, zone.id, group.category, version));
      panel.append(section);
    }
  }
  for (const zone of zones) {
    const matching = groups.filter(group => group.zoneId === zone.id);
    const status = matching.find(group => group.status === 'priority_hotspot')?.status ?? matching[0]?.status ?? 'none';
    const label = zone.name + ' · ' + hotspotStatus[status];
    const addButton = (parent, text, className) => {
      const button = el('button', text);
      button.type = 'button';
      button.className = className;
      button.dataset.status = status;
      button.dataset.mapId = zone.id;
      button.setAttribute('aria-label', label);
      button.addEventListener('click', () => showZone(zone));
      parent.append(button);
    };
    addButton(list, label, 'secondary');
    if (hotspotPoints.includes(zone)) addButton(hotspotMarkers, zone.name.split(' ')[0], 'marker');
  }
  const active = zones.find(zone => zone.id === activeHotspotZone);
  if (active) showZone(active);
  else panel.replaceChildren(el('p', 'This lake has no reporting sectors.'));
  drawMap(hotspotMap, hotspotTiles, hotspotPoints, hotspotMarkers, 17, 50);
}
function reviewForm(report, candidates, version, suggestedCategory) {
  const block = el('form');
  const decision = el('select');
  decision.setAttribute('aria-label', 'Decision for ' + report.id);
  for (const [value, name] of [['confirm', 'Confirm visible evidence'], ['correct', 'Correct category'], ['dismiss', 'Dismiss evidence'], ['clear', 'No visible issue in photo'], ['duplicate', 'Mark as duplicate']]) {
    decision.add(new Option(name, value));
  }
  const category = el('select');
  category.setAttribute('aria-label', 'Evidence category');
  category.add(new Option('Choose a visible category', ''));
  for (const value of ['foam', 'algae_like_growth', 'dumping']) category.add(new Option(labels[value], value));
  if (suggestedCategory) category.value = suggestedCategory;
  const duplicate = el('select');
  duplicate.setAttribute('aria-label', 'Original report');
  duplicate.add(new Option('Choose the original report', ''));
  for (const candidate of candidates) duplicate.add(new Option(candidate.title, candidate.id));
  const note = el('textarea');
  note.required = true; note.maxLength = 500; note.rows = 2;
  note.placeholder = 'Explain the decision';
  note.setAttribute('aria-label', 'Operator review note');
  function fields() {
    duplicate.hidden = decision.value !== 'duplicate';
    duplicate.required = !duplicate.hidden;
    category.hidden = ['dismiss', 'duplicate', 'clear'].includes(decision.value);
    category.required = !category.hidden;
  }
  decision.addEventListener('change', fields);
  fields();
  const submit = el('button', 'Save review'); submit.className = 'secondary';
  block.append(decision, category, duplicate, note, submit);
  block.addEventListener('submit', event => {
    event.preventDefault();
    operate(submit, async () => {
      await api('review', { reportId: report.id, decision: decision.value,
        category: category.hidden ? null : category.value, duplicateOf: duplicate.hidden ? null : duplicate.value, note: note.value });
      if (version === listVersion) { await loadRecords(); msg('Review saved.'); }
    });
  });
  return block;
}
function reportCard(report, reports, selected, canReview, version) {
  const card = el('li');
  const review = latestReview(report);
  const model = events(report).find(item => item.action === 'model')?.model_output;
  card.append(el('h3', zoneName(report.zone_id, selected) + ' · ' + time.format(new Date(report.observed_at)) + ' IST'),
    el('p', review ? labels[review.action] + (review.category ? ' · ' + labels[review.category] : '') : 'Awaiting human review'));
  card.append(el('small', 'JalNetra reference ' + report.id));
  if (report.note) card.append(el('p', report.note));
  const readings = readingText(report.ph, report.temperature_c);
  if (readings) card.append(el('p', 'Citizen-reported · ' + readings));
  if (review?.note) card.append(el('p', review.note));
  card.append(viewPhoto(report.id, 'Citizen photo from ' + zoneName(report.zone_id, selected), version));
  if (model) {
    const cues = model.detections?.map(item => labels[item.category] + ' — ' + item.cue);
    card.append(el('p', 'Preliminary photo assessment · ' + (model.imageQuality === 'unclear' ? 'Image unclear' : cues?.join('; ') || 'No visible target signs')));
  }
  if (!canReview) {
    if (model?.detections?.length) card.append(linkConcernButton(report, model));
    return card;
  }
  if (visionConfigured && !model) {
    const analyze = el('button', 'Analyze photo'); analyze.type = 'button'; analyze.className = 'secondary';
    analyze.addEventListener('click', () => operate(analyze, async () => {
      await api('analyze', { reportId: report.id });
      if (version === listVersion) { await loadRecords(); msg('Photo analysis saved.'); }
    }));
    card.append(analyze);
  }
  const candidates = reports.filter(other => other.id !== report.id).map(other => {
    const distance = photoDistance(report.photo_hash, other.photo_hash);
    return { id: other.id, distance, title: zoneName(other.zone_id, selected) + ' · ' +
      time.format(new Date(other.observed_at)) + ' · ' + other.id.slice(0, 8) + (distance <= 6 ? ' · visually similar' : '') };
  }).sort((a, b) => a.distance - b.distance);
  if (candidates.some(other => other.distance <= 6)) card.append(el('p', 'Possible near-duplicate. Compare the photos before deciding.'));
  const details = el('details');
  const detections = model?.detections ?? [];
  const suggestedCategory = review?.category ?? (detections.length === 1 ? detections[0].category : null);
  details.append(el('summary', 'Review evidence'), reviewForm(report, candidates, version, suggestedCategory));
  if (review) {
    const history = el('details');
    history.append(el('summary', 'Review history'));
    for (const entry of events(report).filter(item => item.action !== 'model')) {
      history.append(el('p', labels[entry.action] + ' · ' + time.format(new Date(entry.created_at)) + ' IST · ' + entry.note));
    }
    details.append(history);
  }
  card.append(details);
  return card;
}
async function loadRecords() {
  const version = ++listVersion, selected = lake;
  currentComplaint = undefined;
  if (complaintDialog.open) complaintDialog.close();
  for (const url of previews) URL.revokeObjectURL(url);
  previews.clear();
  $('pilot-hotspots').hidden = true;
  hotspotMap.hidden = true;
  $('pilot-hotspot-zones').replaceChildren();
  $('pilot-hotspot-evidence').replaceChildren();
  const reports = $('pilot-reports'), concerns = $('pilot-concerns');
  if (!selected || !role) {
    reports.replaceChildren(el('li', 'Join this lake to view your submissions.'));
    concerns.replaceChildren();
    return;
  }
  const canReview = ['operator', 'admin'].includes(role);
  $('pilot-prev').disabled = true;
  $('pilot-next').disabled = true;
  reports.replaceChildren(el('li', 'Loading observations…'));
  concerns.replaceChildren(el('li', 'Loading concerns…'));
  const scope = '?lakeId=' + selected.id;
  const hotspotTask = canReview ? api('hotspots' + scope).then(({ groups }) => {
    if (version !== listVersion) return;
    $('pilot-hotspots').hidden = false;
    renderHotspots(selected, groups, version);
  }).catch(error => {
    if (version !== listVersion) return;
    $('pilot-hotspots').hidden = false;
    $('pilot-hotspot-evidence').textContent = error.message;
  }) : undefined;
  const state = $('pilot-review-state').value;
  const results = await Promise.allSettled([
    api('reports' + scope + '&page=' + reportPage + (canReview && state ? '&review=' + state : '')),
    api('concerns' + scope),
  ]);
  const [photoData, concernData] = results.map(item => item.status === 'fulfilled' ? item.value : null);
  if (version !== listVersion) return;
  $('pilot-prev').disabled = reportPage === 0;
  $('pilot-next').disabled = !photoData?.hasMore;
  reports.replaceChildren(...(photoData?.reports.length ? photoData.reports.map(report => reportCard(report, photoData.reports, selected, canReview, version)) : [el('li', photoData ? 'No observations on this page.' : 'Reports could not load. Click Refresh to retry.')]));
  concerns.replaceChildren(...(concernData?.concerns.length ? concernData.concerns.map(concern => {
    const row = el('li');
    row.append(el('h3', labels[concern.category] + ' · ' + zoneName(concern.zone_id, selected)),
      el('p', concern.description), el('small', 'JalNetra reference ' + concern.id));
    if (concern.report_id) {
      row.append(el('p', 'Linked photo observation ' + concern.report_id),
        viewPhoto(concern.report_id, 'Linked shoreline evidence', version));
    }
    return row;
  }) : [el('li', concernData ? 'No concerns yet.' : 'Concerns could not load. Click Refresh to retry.')]));
  await hotspotTask;
}
function setObserved() {
  const now = new Date();
  $('pilot-observed').value = new Date(now - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
const conditionState = {
  verified: { title: 'Verified concern', rank: 3 },
  pending: { title: 'Awaiting review', rank: 2 },
  clear: { title: 'No visible issue in reviewed photo', rank: 1 },
  unknown: { title: 'No recent information', rank: 0 },
};
const conditionMap = $('conditions-map');
const conditionTiles = $('conditions-tiles');
const conditionMarkers = $('conditions-markers');
const conditionPanel = $('conditions-detail');
let conditionPoints = [];
new ResizeObserver(() => drawMap(conditionMap, conditionTiles, conditionPoints, conditionMarkers, 12, 42)).observe(conditionMap);

function renderConditions() {
  if ($('citizen-conditions').hidden) return;
  const byLake = new Map();
  for (const signal of conditions) {
    if (!Object.hasOwn(conditionState, signal.state)) continue;
    if (!byLake.has(signal.lake_id)) byLake.set(signal.lake_id, []);
    byLake.get(signal.lake_id).push(signal);
  }
  conditionPoints = lakes.filter(item => item.center?.length === 2).map(item => ({
    id: item.id, latitude: item.center[0], longitude: item.center[1],
  }));
  conditionMarkers.replaceChildren();
  for (const point of conditionPoints) {
    const item = lakes.find(entry => entry.id === point.id);
    const state = (byLake.get(item.id) ?? []).reduce((best, signal) =>
      conditionState[signal.state].rank > conditionState[best].rank ? signal.state : best, 'unknown');
    const label = item.name + ' · ' + conditionState[state].title;
    const button = el('button');
    button.type = 'button';
    button.className = 'marker conditions-marker';
    button.dataset.mapId = item.id;
    button.dataset.state = state;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(lake?.id === item.id));
    button.addEventListener('click', () => {
      lakeSelect.value = item.id;
      chooseLake().then(() => conditionPanel.focus()).catch(error => msg(error.message, true));
    });
    conditionMarkers.append(button);
  }
  drawMap(conditionMap, conditionTiles, conditionPoints, conditionMarkers, 12, 42);
  conditionPanel.replaceChildren();
  if (!lake) return;
  conditionPanel.tabIndex = -1;
  conditionPanel.append(el('h3', lake.name));
  const details = byLake.get(lake.id) ?? [];
  if (!details.length) {
    conditionPanel.append(el('p', 'No recent information for this lake.'));
    return;
  }
  const list = el('ul');
  details.sort((a, b) => conditionState[b.state].rank - conditionState[a.state].rank ||
    Date.parse(b.observed_at) - Date.parse(a.observed_at));
  for (const signal of details) {
    const subject = signal.category ? ' · ' + labels[signal.category] : '';
    list.append(el('li', zoneName(signal.zone_id) + ' · ' + conditionState[signal.state].title + subject +
      ' · ' + time.format(new Date(signal.observed_at)) + ' IST'));
  }
  conditionPanel.append(list);
}

async function loadConditions() {
  if ($('citizen-conditions').hidden) return;
  const version = ++conditionsVersion;
  try {
    const result = await api('conditions');
    if (version !== conditionsVersion) return;
    conditions = result.signals;
    renderConditions();
  } catch {
    if (version !== conditionsVersion) return;
    conditionPanel.replaceChildren(el('p', 'Lake conditions could not load. Click Refresh map to retry.'));
  }
}

$('conditions-refresh').addEventListener('click', event => operate(event.currentTarget, loadConditions));

function clearLinkedReport() {
  linkedReport = undefined;
  $('pilot-linked-report').hidden = true;
}
$('pilot-concern-zone').addEventListener('change', event => {
  if (linkedReport?.zone_id !== event.target.value) clearLinkedReport();
});

function linkConcernButton(report, model) {
  const button = el('button', 'Raise concern from this photo');
  button.type = 'button';
  button.className = 'secondary';
  button.addEventListener('click', () => {
    if (lake?.id !== report.lake_id || role !== 'citizen') return;
    linkedReport = report;
    concernId = crypto.randomUUID();
    $('pilot-concern-zone').value = report.zone_id;
    $('pilot-concern-type').value = model.detections.some(item => item.category === 'dumping') ? 'dumping' : 'other';
    const details = $('pilot-concern-text');
    if (!details.value.trim()) {
      details.value = model.detections.map(item => 'Possible ' + labels[item.category].toLowerCase() + ': ' + item.cue)
        .join('\n').slice(0, details.maxLength);
    }
    const status = $('pilot-linked-report');
    status.textContent = 'Linked photo observation ' + report.id + '. Review the description before submitting.';
    status.hidden = false;
    details.focus();
  });
  return button;
}

async function runPreliminary(report, selected) {
  if (lake !== selected || role !== 'citizen') return;
  const panel = $('pilot-preliminary');
  panel.replaceChildren(el('h3', 'Preliminary photo assessment'), el('p', 'Analyzing your saved photo.'));
  try {
    const event = await api('preliminary', { reportId: report.id });
    if (lake !== selected || role !== 'citizen') return;
    const model = event.model_output;
    const note = model.imageQuality === 'unclear' ? 'The photo is unclear. Try another photo with a closer view of the shoreline.' :
      model.detections.length ? 'Possible visible concerns found. An operator can verify this assessment.' :
        'No visible signs of foam, algae-like growth, or dumping were detected in this photo.';
    panel.replaceChildren(el('h3', 'Preliminary photo assessment'), el('p', note));
    if (model.detections.length) {
      const list = el('ul');
      for (const item of model.detections) list.append(el('li', labels[item.category] + ' · ' + item.cue));
      panel.append(list, linkConcernButton(report, model));
    }
    panel.append(el('p', 'This image assessment cannot establish water quality or identify the source of an issue.'));
  } catch {
    if (lake !== selected || role !== 'citizen') return;
    const retry = el('button', 'Retry photo analysis');
    retry.className = 'secondary';
    retry.type = 'button';
    retry.addEventListener('click', () => runPreliminary(report, selected));
    panel.replaceChildren(el('h3', 'Preliminary photo assessment'),
      el('p', 'Your observation is saved. Photo analysis is temporarily unavailable.'), retry);
  }
}

async function chooseLake() {
  lake = lakes.find(item => item.id === lakeSelect.value);
  role = user?.memberships.find(item => item.lake_id === lake?.id)?.role;
  const url = new URL(location.href);
  if (lake?.slug) url.searchParams.set('lake', lake.slug);
  else url.searchParams.delete('lake');
  if (url.href !== location.href) history.replaceState(null, '', url);
  $('pilot-map-link').href = lake?.slug ? '/?lake=' + encodeURIComponent(lake.slug) : '/';
  $('pilot-enroll').hidden = !lake || !!role;
  $('pilot-intake').hidden = role !== 'citizen';
  $('pilot-admin').hidden = role !== 'admin';
  $('pilot-role').textContent = (role ? 'Lake role · ' + role : 'Select a lake to join and report.') + ' · Account ID ' + user.id;
  $('pilot-report-scope').textContent = ['operator', 'admin'].includes(role) ?
    (visionConfigured ? 'Shared review queue' : 'Shared review queue · human review available') : 'Your latest submissions';
  for (const id of ['pilot-zone', 'pilot-concern-zone']) {
    $(id).replaceChildren(...(lake?.pilot_zones ?? []).map(zone => new Option(zone.name, zone.id)));
  }
  photoForm.reset(); concernForm.reset(); setObserved();
  linkedReport = undefined;
  $('pilot-linked-report').hidden = true;
  $('pilot-preliminary').replaceChildren();
  renderConditions();
  reportPage = 0;
  $('pilot-review-state').value = '';
  $('pilot-review-filter').hidden = !['operator', 'admin'].includes(role);
  const sector = new URLSearchParams(location.search).get('sector');
  const matched = lake?.pilot_zones.find(item => item.slug === sector);
  if (matched) for (const id of ['pilot-zone', 'pilot-concern-zone']) $(id).value = matched.id;
  photoId = crypto.randomUUID(); concernId = crypto.randomUUID();
  await Promise.all([loadRecords(), role === 'admin' ? loadMembers(lake) : undefined]);
}
async function loadMembers(selected) {
  const { members } = await api('members?lakeId=' + selected.id);
  if (lake !== selected) return;
  $('pilot-member-list').replaceChildren(...members.map(member => el('li', member.user_id + ' · ' + member.role)));
}
async function openWorkspace() {
  const [account, catalog, status] = await Promise.all([api('account'), api('catalog'), api('status')]);
  const params = new URLSearchParams(location.search);
  const entry = params.get('role');
  const reviewLakeIds = new Set(account.memberships.filter(item =>
    item.role === 'operator' || item.role === 'admin').map(item => item.lake_id));
  const allowedLakes = catalog.lakes.filter(item => entry === 'operator' ? reviewLakeIds.has(item.id) :
    entry === 'citizen' ? !reviewLakeIds.has(item.id) : true);
  if (!allowedLakes.length && entry === 'operator') {
    setSession(null);
    throw new Error('This account has no assigned operator role. Use Citizen sign in or contact a lake administrator.');
  }
  if (!allowedLakes.length && entry === 'citizen' && reviewLakeIds.size) {
    setSession(null);
    throw new Error('This account has lake review access. Use Operator sign in.');
  }
  user = account; lakes = allowedLakes; visionConfigured = status.visionConfigured;
  $('pilot-auth').hidden = true;
  $('pilot-workspace').hidden = false;
  $('pilot-account').textContent = user.email;
  const requested = params.get('lake');
  lakeSelect.replaceChildren(...lakes.map(item => new Option(item.name, item.id)));
  const initial = lakes.find(item => item.slug === requested) ??
    lakes.find(item => user.memberships.some(m => m.lake_id === item.id));
  if (initial) lakeSelect.value = initial.id;
  const showConditions = entry !== 'operator' && allowedLakes.some(item => !reviewLakeIds.has(item.id));
  $('citizen-conditions').hidden = !showConditions;
  await Promise.all([chooseLake(), showConditions ? loadConditions() : undefined]);
}

function submitLogin(event) {
  event.preventDefault();
  const button = event.submitter;
  if (!button) return;
  operate(button, async () => {
    const payload = Object.fromEntries(new FormData(event.target));
    const auth = await decode(await http(button.value, payload));
    event.target.reset();
    if (button.value === 'signup') return msg(auth.message);
    const url = new URL(location.href);
    url.searchParams.set('role', event.target.id === 'pilot-operator-login' ? 'operator' : 'citizen');
    history.replaceState(null, '', url);
    setSession(auth);
    await openWorkspace();
  });
}
$('pilot-login').addEventListener('submit', submitLogin);
$('pilot-operator-login').addEventListener('submit', submitLogin);
$('pilot-signout').addEventListener('click', () => operate($('pilot-signout'), async () => {
  try { await api('signout', {}); } finally {
    setSession(null); user = null; lake = null; role = null;
    conditions = [];
    ++conditionsVersion;
    $('citizen-conditions').hidden = true;
    await loadRecords();
    $('pilot-workspace').hidden = true;
    $('pilot-auth').hidden = false;
  }
}));
$('pilot-enroll').addEventListener('click', () => operate($('pilot-enroll'), async () => {
  await api('enroll', { lakeId: lake.id });
  user = await api('account');
  await chooseLake();
}));
lakeSelect.addEventListener('change', () => chooseLake().catch(error => msg(error.message, true)));
$('pilot-reload').addEventListener('click', () => operate($('pilot-reload'), loadRecords));
$('pilot-review-state').addEventListener('change', () => {
  reportPage = 0;
  return loadRecords();
});
for (const [id, delta] of [['pilot-prev', -1], ['pilot-next', 1]]) {
  $(id).addEventListener('click', () => {
    reportPage = Math.max(0, reportPage + delta);
    return loadRecords();
  });
}
$('pilot-members').addEventListener('submit', event => {
  event.preventDefault();
  operate(event.submitter, async () => {
    const selected = lake;
    await api('members?lakeId=' + selected.id, { userId: $('pilot-member').value.trim(), role: $('pilot-member-role').value });
    if (lake !== selected) return;
    await loadMembers(selected);
    msg('Lake role updated.');
  });
});

photoForm.addEventListener('input', () => { photoId = crypto.randomUUID(); });
concernForm.addEventListener('input', () => { concernId = crypto.randomUUID(); });
photoForm.addEventListener('submit', event => {
  event.preventDefault();
  operate(event.submitter, async () => {
    const current = lake, id = photoId;
    const payload = new FormData(photoForm);
    payload.set('lake_id', current.id);
    payload.set('id', id);
    payload.set('observed_at', new Date($('pilot-observed').value).toISOString());
    const photo = await normalize($('pilot-photo').files[0]);
    payload.set('pixels', photo.pixels, 'normalized.rgb');
    payload.set('width', photo.width);
    payload.set('height', photo.height);
    const report = await api('upload', payload);
    if (lake !== current) return;
    if (photoId === id) { photoForm.reset(); setObserved(); photoId = crypto.randomUUID(); }
    msg('Observation saved. Reference ' + report.id);
    await Promise.all([runPreliminary(report, current), loadConditions()]);
    if (lake === current) await loadRecords();
  });
});
concernForm.addEventListener('submit', event => {
  event.preventDefault();
  operate(event.submitter, async () => {
    const current = lake, id = concernId;
    const concern = await api('concerns', {
      ...Object.fromEntries(new FormData(concernForm)), id, lake_id: current.id, report_id: linkedReport?.id,
    });
    if (lake !== current) return;
    if (concernId === id) { concernForm.reset(); concernId = crypto.randomUUID(); clearLinkedReport(); }
    msg('Concern saved for operator review. Reference ' + concern.id);
    await Promise.all([loadRecords(), loadConditions()]);
  });
});

for (const button of document.querySelectorAll('[data-reset-password]')) {
  button.addEventListener('click', () => {
    const email = button.form.elements.namedItem('email');
    if (email.reportValidity()) operate(button, async () => {
      const response = await decode(await http('recover', { email: email.value.trim() }));
      msg(response.message);
    });
  });
}
$('pilot-reset-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!recoveryToken || !event.submitter) return;
  operate(event.submitter, async () => {
    await decode(await http('password', { password: $('pilot-new-password').value }, recoveryToken));
    recoveryToken = undefined;
    event.target.reset();
    $('pilot-reset').hidden = true;
    $('pilot-auth').hidden = false;
    msg('Password updated. Sign in with your new password.');
  });
});

const authFragment = new URLSearchParams(location.hash.slice(1));
if (authFragment.has('access_token') || authFragment.has('error_description')) {
  history.replaceState(null, '', location.pathname + location.search);
  if (authFragment.get('type') === 'recovery' && authFragment.has('access_token')) {
    setSession(null);
    recoveryToken = authFragment.get('access_token');
    $('pilot-auth').hidden = true;
    $('pilot-reset').hidden = false;
  } else if (authFragment.has('access_token')) msg('Email confirmed. Sign in to continue.');
  else msg('The confirmation link could not be used. Request a new account email or sign in if already confirmed.', true);
}
if (session) openWorkspace().catch(error => { setSession(null); msg(error.message, true); });
