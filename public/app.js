import { drawMap, nearestZone, sectorAt } from './lake-map.js';
import { readingText, renderReadings } from './readings.js';

const form = document.querySelector('#report-form');
const zone = document.querySelector('#zone');
const times = document.querySelector('#observed-at');
const photoInput = document.querySelector('#photo');
const preview = document.querySelector('#preview');
const status = document.querySelector('#form-status');
const submit = document.querySelector('#submit');
const markers = document.querySelector('#map-zones');
const historyStatus = document.querySelector('#history-status');
const reports = document.querySelector('#report-list');
const evidenceContent = document.querySelector('#evidence-content');
const hotspotLabels = { none: 'No active evidence', watch: 'Watch', priority_hotspot: 'Priority hotspot' };
let dashboard;
let zonesLoaded = false;
let lakes = [];
let currentLake;
let readingRequest = 0;
const lakeSelect = document.querySelector('#lake-select');
const readingZone = document.querySelector('#reading-zone');
const gpsButton = document.querySelector('#gps-zone');
const gpsStatus = document.querySelector('#gps-status');
const map = document.querySelector('#lake-map');
const tiles = document.querySelector('#map-tiles');
const cityMap = document.querySelector('#city-map');
const cityTiles = document.querySelector('#city-map-tiles');
const cityMarkers = document.querySelector('#city-markers');
const lakeChoices = document.querySelector('#lake-choices');
let cityPoints = [];
let shoreViewport;
let recentReportCount;
const draftDialog = document.querySelector('#draft-dialog');
const draftForm = document.querySelector('#draft-form');
const draftStatus = document.querySelector('#draft-status');
const recipientInput = document.querySelector('#recipient');
const draftText = document.querySelector('#draft-text');
const saveDraftButton = document.querySelector('#save-draft');
const downloadDraft = document.querySelector('#download-draft');
let currentDraft;
const rehearsalButton = document.querySelector('#restart-rehearsal');
let requestId = crypto.randomUUID();
let previewUrl;
let selectedFile;
let preparedPhoto;
let previewRevision = 0;
const sampleControl = document.querySelector('#sample-controls');
const sampleSelect = document.querySelector('#demo-sample');
const statusLabels = {
  pending: 'Pending analysis', needs_review: 'Needs review', classified: 'Signs detected',
  no_target_signs: 'No target signs detected',
};
const categoryLabels = { foam: 'Foam', algae_like_growth: 'Algae-like growth', dumping: 'Dumping' };
const sourceLabels = { simulated: 'Simulated', captured_replay: 'Demo replay', live_model: 'Live vision' };
const maxPhotoBytes = 5 * 1024 * 1024;
const formatTime = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata',
});

async function getJson(url, options) {
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || 'JalNetra could not complete the request.');
  return result;
}

function updateTimestamp() {
  const now = new Date();
  times.value = new Date(now - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function highlightZone() {
  for (const marker of markers.children) {
    marker.setAttribute('aria-pressed', String(marker.dataset.zoneId === zone.value));
    const hotspot = dashboard?.zones.find(item => item.zoneId === marker.dataset.zoneId);
    marker.dataset.status = hotspot?.status ?? 'none';
    marker.setAttribute('aria-label', marker.textContent + ' — ' + hotspotLabels[marker.dataset.status]);
  }
  renderEvidence();
  const selected = currentLake?.zones.find(item => item.id === zone.value);
  document.querySelector('#selected-shoreline').hidden = !selected;
  document.querySelector('#selected-shoreline-label').textContent = selected ? currentLake.name + ' · ' + selected.name : '';
  updateLakeProfile();
}

function textElement(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function appendReportContext(element, report) {
  const readings = readingText(report);
  if (readings) element.append(textElement('p', readings, 'reading-detail'));
  if (report.note) element.append(textElement('p', 'Note: ' + report.note));
}

function lakeEndpoint(path, zoneId) {
  const query = new URLSearchParams({ lakeId: currentLake.id });
  if (zoneId) query.set('zoneId', zoneId);
  return path + '?' + query;
}

function renderEvidence() {
  evidenceContent.replaceChildren();
  if (!dashboard) {
    evidenceContent.append(textElement('p', 'Loading zone evidence…'));
    return;
  }
  const selected = dashboard.zones.find(item => item.zoneId === zone.value) ??
    dashboard.zones.find(item => item.status === 'priority_hotspot') ??
    dashboard.zones.find(item => item.status === 'watch');
  if (!selected) {
    evidenceContent.append(textElement('p', 'No matching shoreline observations in the last 48 hours.'));
    return;
  }
  evidenceContent.append(textElement('p', selected.name + ' · ' + hotspotLabels[selected.status], 'evidence-zone'));
  if (!selected.categories.length) evidenceContent.append(textElement('p', 'No eligible reports in this zone.'));
  for (const group of selected.categories) {
    const card = document.createElement('article');
    card.className = 'evidence-group';
    const count = group.evidenceCount + (group.evidenceCount === 1 ? ' photo' : ' photos');
    card.append(textElement('h4', categoryLabels[group.category]),
      textElement('p', hotspotLabels[group.status] + ' · ' + count + ' in 48 hours'));
    const list = document.createElement('ul');
    for (const report of group.reports) {
      const row = document.createElement('li');
      const photo = document.createElement('img');
      photo.loading = 'lazy';
      photo.src = report.photoUrl;
      photo.alt = 'Evidence photo from ' + selected.name;
      const summary = document.createElement('div');
      summary.append(textElement('strong', report.cue),
        textElement('p', formatTime.format(new Date(report.observedAt)) + ' IST · ' + sourceLabels[report.analysisSource]),
        textElement('p', report.id));
      appendReportContext(summary, report);
      row.append(photo, summary);
      list.append(row);
    }
    card.append(list);
    if (group.status === 'priority_hotspot') {
      const button = textElement('button', 'Open complaint draft', 'secondary');
      button.type = 'button';
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          currentDraft = await getJson('/api/complaints', jsonRequest('POST', {
            zoneId: selected.zoneId, category: group.category,
          }));
          recipientInput.value = currentDraft.recipient ?? '';
          draftText.value = currentDraft.draftText;
          document.querySelector('#draft-evidence').textContent =
            'Evidence: ' + currentDraft.evidence.map(report => report.id).join(', ');
          draftStatus.textContent = '';
          draftDialog.showModal();
        } catch (error) {
          card.append(textElement('p', error.message, 'feedback error'));
        } finally {
          button.disabled = false;
        }
      });
      card.append(button);
    }
    evidenceContent.append(card);
  }
}

function jsonRequest(method, data) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

async function saveDraft(download = false) {
  if (!currentDraft || !draftForm.reportValidity() || saveDraftButton.disabled) return;
  saveDraftButton.disabled = true;
  downloadDraft.disabled = true;
  draftStatus.textContent = '';
  draftStatus.className = 'feedback';
  try {
    const url = '/api/complaints/' + currentDraft.id;
    currentDraft = await getJson(url, jsonRequest('PATCH', {
      recipient: recipientInput.value, draftText: draftText.value,
    }));
    draftStatus.textContent = 'Draft saved.';
    if (download) {
      const link = document.createElement('a');
      link.href = url + '/export';
      link.download = currentDraft.id + '.txt';
      link.click();
    }
  } catch (error) {
    draftStatus.textContent = error.message;
    draftStatus.className = 'feedback error';
  } finally {
    saveDraftButton.disabled = false;
    downloadDraft.disabled = false;
  }
}

document.querySelector('#close-draft').addEventListener('click', () => draftDialog.close());
draftForm.addEventListener('submit', event => {
  event.preventDefault();
  saveDraft();
});
downloadDraft.addEventListener('click', () => saveDraft(true));

async function loadHotspots() {
  const lake = currentLake;
  try {
    const result = await getJson(lakeEndpoint('/api/hotspots'));
    if (lake !== currentLake) return;
    dashboard = result;
    highlightZone();
  } catch {
    if (lake !== currentLake) return;
    dashboard = undefined;
    evidenceContent.replaceChildren(textElement('p', 'Zone evidence could not be loaded. Refresh to try again.'));
  }
}

async function loadReadings() {
  const revision = ++readingRequest;
  const feedback = document.querySelector('#reading-status');
  feedback.textContent = 'Loading readings…';
  try {
    const view = await getJson(lakeEndpoint('/api/readings', readingZone.value));
    if (revision !== readingRequest) return;
    renderReadings(view.items, formatTime);
    feedback.textContent = view.items.length ? currentLake.name + ' · ' + view.items.length + ' recorded observations' :
      'No readings have been saved for this view.';
  } catch {
    if (revision !== readingRequest) return;
    renderReadings([], formatTime);
    feedback.textContent = 'Water readings could not be loaded. Refresh to try again.';
  }
}

function refreshDashboard() {
  return Promise.all([loadHistory(), loadHotspots(), loadReadings()]);
}

function setStatus(message, mood = '') {
  status.className = 'feedback ' + mood;
  status.textContent = message;
}

function clearPreview() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = undefined;
  selectedFile = undefined;
  preparedPhoto = undefined;
  preview.hidden = true;
  preview.removeAttribute('src');
}

async function decodePhoto(photo) {
  if (photo.size > maxPhotoBytes) throw new Error('Choose a photo smaller than 5 MB.');
  const signature = new Uint8Array(await photo.slice(0, 8).arrayBuffer());
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => signature[index] === byte);
  const jpeg = signature[0] === 255 && signature[1] === 216 && signature[2] === 255;
  if (!png && !jpeg) throw new Error('Choose a valid JPEG or PNG.');
  try {
    return await createImageBitmap(photo);
  } catch {
    throw new Error('The photo could not be read. Try a different JPEG or PNG.');
  }
}

async function normalize(file) {
  const image = await decodePhoto(file);
  try {
    const scale = Math.min(1, 1200 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const rgb = new Uint8Array(canvas.width * canvas.height * 3);
    for (let source = 0, target = 0; source < rgba.length; source += 4, target += 3) {
      rgb[target] = rgba[source];
      rgb[target + 1] = rgba[source + 1];
      rgb[target + 2] = rgba[source + 2];
    }
    return { width: canvas.width, height: canvas.height, pixels: new Blob([rgb], { type: 'application/octet-stream' }) };
  } finally {
    image.close();
  }
}

function redrawMap() {
  shoreViewport = currentLake?.kind === 'geographic' ?
    drawMap(map, tiles, currentLake.zones, markers, 16, 46) : null;
}

function redrawCity() {
  drawMap(cityMap, cityTiles, cityPoints, cityMarkers, 13, 62);
}

function selectShoreline(id) {
  if (zone.disabled) return;
  zone.value = id;
  gpsStatus.hidden = true;
  zone.dispatchEvent(new Event('change', { bubbles: true }));
}

function updateLakeProfile() {
  if (!currentLake) return;
  const real = currentLake.kind === 'geographic';
  for (const button of [...cityMarkers.children, ...lakeChoices.children]) {
    button.setAttribute('aria-pressed', String(button.dataset.mapId === currentLake.id));
  }
  document.querySelector('#profile-name').textContent = real ? currentLake.name : 'Choose a lake';
  document.querySelector('#profile-locality').textContent = real ? currentLake.locality : '';
  document.querySelector('#profile-description').textContent = real ? currentLake.description :
    'Select a pin or name to explore its shoreline.';
  const observations = document.querySelector('#profile-observations');
  const watch = dashboard?.zones.filter(item => item.status !== 'none').length;
  observations.textContent = real ?
    currentLake.zones.length + ' reporting sectors' +
    (recentReportCount === undefined ? '' : ' · ' + recentReportCount + ' recent reports in this session') +
    (watch === undefined ? '' : ' · ' + watch + ' sectors with active evidence') : '';
  const reference = document.querySelector('#lake-reference');
  reference.hidden = !real;
  if (real) reference.href = currentLake.reference;
  document.querySelector('#view-shoreline').hidden = !real;
}

function buildCityExplorer() {
  for (const lake of lakes.filter(item => item.kind === 'geographic')) {
    const [latitude, longitude] = lake.center;
    cityPoints.push({ id: lake.id, latitude, longitude });
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'city-pin';
    pin.dataset.mapId = lake.id;
    pin.append(textElement('span', lake.name));
    const choice = textElement('button', lake.name, 'lake-choice');
    choice.type = 'button';
    choice.dataset.mapId = lake.id;
    for (const button of [pin, choice]) {
      button.addEventListener('click', () => {
        if (!lakeSelect.disabled) setLake(lake.id);
      });
    }
    cityMarkers.append(pin);
    lakeChoices.append(choice);
  }
  redrawCity();
}

map.addEventListener('click', event => {
  if (!shoreViewport || zone.disabled || event.target.closest('button,a')) return;
  const rect = map.getBoundingClientRect();
  const sector = sectorAt(currentLake, shoreViewport, event.clientX - rect.left, event.clientY - rect.top);
  if (sector) selectShoreline(sector.id);
  else {
    gpsStatus.hidden = false;
    gpsStatus.textContent = 'Choose a shoreline sector near one of the markers.';
  }
});

function setLake(id) {
  const selected = lakes.find(item => item.id === id);
  if (!selected) return;
  const geographic = selected.kind === 'geographic';
  currentLake = selected;
  lakeSelect.value = id;
  requestId = crypto.randomUUID();
  dashboard = undefined;
  recentReportCount = undefined;
  document.querySelector('#map-help').textContent = geographic
    ? 'Click a shoreline sector or its marker to set the location for your next upload.'
    : 'Select a marker to see that zone’s evidence or choose a zone in the form.';
  document.querySelector('#map-title').textContent = selected.name;
  document.querySelector('#map-kind').textContent = geographic ? 'Approximate zones' : 'Illustrative';
  document.querySelector('#illustrative-map').toggleAttribute('hidden', geographic);
  document.querySelector('#map-attribution').hidden = !geographic;
  tiles.hidden = !geographic;
  gpsButton.hidden = !geographic;
  gpsStatus.hidden = true;
  if (!geographic) tiles.replaceChildren();
  if (geographic && sampleSelect.value) {
    sampleSelect.value = '';
    photoInput.required = true;
    ++previewRevision;
    clearPreview();
  }
  sampleControl.hidden = geographic || samples.length === 0;
  zone.replaceChildren(new Option('Choose a zone', ''));
  readingZone.replaceChildren(new Option('All zones', ''));
  markers.replaceChildren();
  for (const item of selected.zones) {
    zone.add(new Option(item.name, item.id));
    readingZone.add(new Option(item.name, item.id));
    const marker = document.createElement('button');
    marker.type = 'button';
    marker.className = 'marker';
    marker.textContent = item.name;
    marker.dataset.zoneId = item.id;
    marker.dataset.mapId = item.id;
    if (!geographic) {
      marker.style.left = item.markerX * 100 + '%';
      marker.style.top = item.markerY * 100 + '%';
    }
    marker.addEventListener('click', () => selectShoreline(item.id));
    markers.append(marker);
  }
  const url = new URL(window.location.href);
  if (geographic) url.searchParams.set('lake', id);
  else url.searchParams.delete('lake');
  window.history.replaceState(null, '', url);
  zonesLoaded = true;
  redrawMap();
  highlightZone();
  renderReadings([], formatTime);
  return refreshDashboard();
}

async function loadLakes() {
  lakes = await getJson('/api/lakes');
  buildCityExplorer();
  for (const item of lakes) lakeSelect.add(new Option(item.name, item.id));
  const requested = new URLSearchParams(window.location.search).get('lake');
  return setLake(lakes.some(item => item.id === requested) ? requested : 'demo-lake');
}

lakeSelect.addEventListener('change', () => setLake(lakeSelect.value));
readingZone.addEventListener('change', loadReadings);
new ResizeObserver(redrawMap).observe(map);
new ResizeObserver(redrawCity).observe(cityMap);
gpsButton.addEventListener('click', () => {
  const lake = currentLake;
  gpsStatus.hidden = false;
  if (!navigator.geolocation) {
    gpsStatus.textContent = 'GPS is unavailable in this browser. Choose a zone on the map or from the list.';
    return;
  }
  gpsButton.disabled = true;
  gpsStatus.textContent = 'Checking your location. Only the suggested zone is saved with your report.';
  navigator.geolocation.getCurrentPosition(({ coords }) => {
    gpsButton.disabled = false;
    if (lake !== currentLake) return;
    const suggested = nearestZone(lake, coords);
    if (!suggested) {
      gpsStatus.textContent = 'GPS is too far from this lake or too imprecise. Choose a zone manually.';
      return;
    }
    zone.value = suggested.id;
    zone.dispatchEvent(new Event('change', { bubbles: true }));
    gpsStatus.textContent = 'Suggested zone is ' + suggested.name + '. Check the map and adjust if needed.';
  }, () => {
    gpsButton.disabled = false;
    if (lake === currentLake) gpsStatus.textContent = 'Location was unavailable. Choose a zone from the map or the list.';
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
});

async function loadHistory() {
  const lake = currentLake;
  try {
    const items = await getJson(lakeEndpoint('/api/reports'));
    if (lake !== currentLake) return;
    recentReportCount = items.length;
    updateLakeProfile();
    reports.replaceChildren();
    historyStatus.hidden = items.length > 0;
    historyStatus.textContent = 'Saved observations will appear here.';
    for (const item of items) {
      const row = document.createElement('li');
      const image = document.createElement('img');
      image.src = item.photoUrl;
      image.alt = 'Saved photo from ' + item.zoneName;
      image.loading = 'lazy';
      const detail = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = item.zoneName + ' · ' + formatTime.format(new Date(item.observedAt));
      const id = document.createElement('p');
      id.textContent = item.id;
      detail.append(title, id);
      appendReportContext(detail, item);
      for (const detection of item.detections) {
        const cue = document.createElement('p');
        cue.textContent = categoryLabels[detection.category] + ' — ' + detection.cue;
        detail.append(cue);
      }
      const notes = [sourceLabels[item.analysisSource], item.reviewReason].filter(Boolean);
      if (notes.length) {
        const reason = document.createElement('p');
        reason.textContent = notes.join(' · ');
        detail.append(reason);
      }
      if (item.canRetry) {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'secondary';
        retry.textContent = 'Retry analysis';
        retry.addEventListener('click', async () => {
          retry.disabled = true;
          try {
            const updated = await getJson('/api/reports/' + item.id + '/retry', { method: 'POST' });
            setStatus(statusLabels[updated.status], updated.status === 'needs_review' ? 'error' : 'success');
            await refreshDashboard();
          } catch (error) {
            setStatus(error.message, 'error');
            retry.disabled = false;
          }
        });
        detail.append(retry);
      }
      const label = document.createElement('span');
      label.className = 'tag';
      label.textContent = statusLabels[item.status] ?? item.status;
      row.append(image, detail, label);
      reports.append(row);
    }
  } catch {
    if (lake !== currentLake) return;
    historyStatus.hidden = false;
    historyStatus.textContent = 'Recent observations could not be loaded. Refresh to try again.';
  }
}

form.addEventListener('input', () => { requestId = crypto.randomUUID(); });
form.addEventListener('change', () => { requestId = crypto.randomUUID(); });
zone.addEventListener('change', highlightZone);
function pickPhoto(file) {
  const revision = ++previewRevision;
  clearPreview();
  photoInput.setCustomValidity('');
  setStatus('');
  if (!file) return;
  selectedFile = file;
  requestId = crypto.randomUUID();
  preparedPhoto = normalize(file).then(result => {
    if (revision === previewRevision) {
      previewUrl = URL.createObjectURL(file);
      preview.src = previewUrl;
      preview.hidden = false;
    }
    return { result };
  }, error => {
    if (revision === previewRevision) {
      photoInput.setCustomValidity(error.message);
      setStatus(error.message, 'error');
    }
    return { error };
  });
}
photoInput.addEventListener('change', () => {
  sampleSelect.value = '';
  photoInput.required = true;
  pickPhoto(photoInput.files[0]);
});

let samples = [];
sampleSelect.addEventListener('change', async () => {
  const sample = samples.find(item => item.id === sampleSelect.value);
  if (!sample) return;
  const revision = ++previewRevision;
  clearPreview();
  photoInput.value = '';
  photoInput.setCustomValidity('');
  photoInput.required = true;
  setStatus('Loading sample…');
  try {
    const response = await fetch(sample.url);
    if (!response.ok) throw new Error('Sample could not be loaded.');
    const image = await response.blob();
    if (revision !== previewRevision) return;
    photoInput.required = false;
    pickPhoto(image);
  } catch (error) {
    if (revision === previewRevision) setStatus(error.message, 'error');
  }
});

async function loadMode() {
  const mode = await getJson('/api/status');
  document.querySelector('#app-mode').lastChild.textContent =
    mode.hosted ? ' Hosted demo' : mode.mode === 'live' ? ' Live vision' : mode.rehearsal ? ' Demo rehearsal' : ' Offline demo';
  if (mode.hosted) document.querySelector('#rehearsal-status').textContent =
    'Use the illustrated samples. Your browser has a separate demo session which expires after seven days.';
  document.querySelector('#rehearsal-tools').hidden = !mode.rehearsal;
  samples = mode.samples;
  sampleControl.hidden = samples.length === 0;
  for (const sample of samples) sampleSelect.add(new Option(sample.title, sample.id));
}

rehearsalButton.addEventListener('click', async () => {
  const feedback = document.querySelector('#rehearsal-status');
  if (!zonesLoaded) {
    feedback.textContent = 'Wait for the shoreline zones to load before starting the rehearsal.';
    return;
  }
  rehearsalButton.disabled = true;
  try {
    await getJson('/api/demo/reset', jsonRequest('POST', {}));
    currentDraft = undefined;
    if (draftDialog.open) draftDialog.close();
    rehearsalButton.textContent = 'Restart rehearsal';
    feedback.textContent = 'North Inlet is on Watch. Select “Foam from a second view” and save it at the same zone.';
    if (currentLake.id !== 'demo-lake') await setLake('demo-lake');
    zone.value = 'north-inlet';
    zone.dispatchEvent(new Event('change', { bubbles: true }));
    await refreshDashboard();
  } catch (error) {
    feedback.textContent = error.message;
  } finally {
    rehearsalButton.disabled = false;
  }
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submit.disabled) return;
  if (!selectedFile) {
    setStatus('Choose a photo or a labelled demo sample.', 'error');
    return;
  }
  const payload = new FormData(form);
  const revision = previewRevision;
  const observedAt = new Date(times.value);
  if (!Number.isFinite(observedAt.valueOf())) {
    setStatus('Choose a valid observation time.', 'error');
    return;
  }
  payload.set('requestId', requestId);
  payload.set('observedAt', observedAt.toISOString());
  submit.disabled = true;
  submit.textContent = 'Saving…';
  setStatus('');
  const controls = [...form.elements, lakeSelect].filter(control => control !== submit && !control.disabled);
  for (const control of [...controls, ...markers.children]) control.disabled = true;
  try {
    const { result, error } = await preparedPhoto;
    if (error) throw error;
    payload.set('photo', result.pixels, 'photo.rgb');
    payload.set('photoWidth', String(result.width));
    payload.set('photoHeight', String(result.height));
    const report = await getJson('/api/reports', { method: 'POST', body: payload });
    if (revision === previewRevision) {
      form.reset();
      zone.value = report.zoneId;
      photoInput.required = true;
      ++previewRevision;
      clearPreview();
      highlightZone();
      updateTimestamp();
      requestId = crypto.randomUUID();
    }
    setStatus('Observation saved. ' + statusLabels[report.status] + '. Report ID ' + report.id, 'success');
    await refreshDashboard();
  } catch (error) {
    setStatus(error.message || 'The report could not be saved. Try again.', 'error');
  } finally {
    for (const control of [...controls, ...markers.children]) control.disabled = false;
    submit.disabled = false;
    submit.textContent = 'Save observation';
  }
});

updateTimestamp();
loadMode().then(loadLakes)
  .catch(() => setStatus('The demo could not be loaded. Refresh to try again.', 'error'));

