const lakeSelect = document.querySelector('#pilot-lake');
const zoneSelect = document.querySelector('#pilot-zone');
const timeInput = document.querySelector('#pilot-time');
const noteInput = document.querySelector('#pilot-note');
const phInput = document.querySelector('#pilot-ph');
const temperatureInput = document.querySelector('#pilot-temperature');
const photoInput = document.querySelector('#pilot-photo');
const preview = document.querySelector('#pilot-preview');
const previewWrap = document.querySelector('#pilot-preview-wrap');
const removePhotoButton = document.querySelector('#pilot-remove-photo');
const form = document.querySelector('#pilot-report-form');
const submitButton = document.querySelector('#pilot-submit');
const statusBox = document.querySelector('#pilot-status');
const reportsContainer = document.querySelector('#pilot-reports');
const charCount = document.querySelector('#pilot-char-count');
const refreshButton = document.querySelector('#pilot-refresh');

let lakes = [];
let selectedFile = null;

// -----------------------------
// HELPERS
// -----------------------------

function createRequestId() {
  return crypto.randomUUID().replaceAll('-', '');
}

function setStatus(message, type = '') {
  statusBox.textContent = message;
  statusBox.className = `pilot-status ${type}`;
}

function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function setCurrentLocalTime() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  timeInput.value = now.toISOString().slice(0, 16);
}

function localTimeToISO(value) {
  const date = new Date(value);
  return date.toISOString();
}

async function api(url, options = {}) {
  const response = await fetch(url, options);

  let data;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(
      data?.error?.message || `Request failed (${response.status})`
    );
  }

  return data;
}

// -----------------------------
// LOAD LAKES
// -----------------------------

async function loadLakes() {
  try {
    const runtime = await api('/api/status');
    const scope = document.querySelector('#pilot-data-scope');
    if (scope) {
      scope.textContent = runtime.hosted
        ? 'Hosted demo: reports are saved in this browser’s private session. Shared pilot review requires the configured pilot service.'
        : 'Local demo: reports are saved by this JalNetra server.';
    }

    lakes = await api('/api/lakes');

    lakeSelect.innerHTML = `
      <option value="">Choose a lake</option>
      ${lakes.map(lake => `
        <option value="${escapeHTML(lake.id)}">
          ${escapeHTML(lake.name)}
        </option>
      `).join('')}
    `;

    zoneSelect.innerHTML = '<option value="">Choose a lake first</option>';

    if (!lakes.length) {
      lakeSelect.innerHTML = '<option value="">No lakes available</option>';
    }
  } catch (error) {
    lakeSelect.innerHTML = '<option value="">Unable to load lakes</option>';
    setStatus(error.message, 'error');
  }
}

// -----------------------------
// LOAD SHORELINE ZONES
// -----------------------------

function loadZones() {
  const lake = lakes.find(item => item.id === lakeSelect.value);

  if (!lake) {
    zoneSelect.innerHTML = '<option value="">Choose a lake first</option>';
    reportsContainer.innerHTML = '<p class="pilot-empty">Select a lake to view reports.</p>';
    return;
  }

  zoneSelect.innerHTML = `
    <option value="">Choose observation zone</option>
    ${(lake.zones || []).map(zone => `
      <option value="${escapeHTML(zone.id)}">
        ${escapeHTML(zone.name)}
      </option>
    `).join('')}
  `;

  loadReports();
}

lakeSelect.addEventListener('change', loadZones);

// -----------------------------
// PHOTO PREVIEW
// -----------------------------

photoInput.addEventListener('change', () => {
  const file = photoInput.files?.[0];

  selectedFile = null;
  previewWrap.classList.add('hidden');

  if (!file) return;

  if (!['image/jpeg', 'image/png'].includes(file.type)) {
    setStatus('Please choose a JPEG or PNG image.', 'error');
    photoInput.value = '';
    return;
  }

  if (file.size > 10 * 1024 * 1024) {
    setStatus('Photo must be smaller than 10 MB.', 'error');
    photoInput.value = '';
    return;
  }

  selectedFile = file;
  preview.src = URL.createObjectURL(file);
  previewWrap.classList.remove('hidden');
  setStatus('');
});

removePhotoButton.addEventListener('click', () => {
  photoInput.value = '';
  selectedFile = null;
  preview.src = '';
  previewWrap.classList.add('hidden');
  setStatus('');
});

// -----------------------------
// NOTE COUNTER
// -----------------------------

noteInput.addEventListener('input', () => {
  charCount.textContent = `${noteInput.value.length} / 500`;
});

// -----------------------------
// CONVERT PHOTO TO RAW RGB
// Backend expects RGB pixel bytes,
// not the original JPEG/PNG file.
// -----------------------------

async function imageToRGB(file) {
  const bitmap = await createImageBitmap(file);

  const maxSize = 1200;
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));

  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d', {
    willReadFrequently: true
  });

  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const imageData = context.getImageData(0, 0, width, height);
  const rgba = imageData.data;
  const rgb = new Uint8Array(width * height * 3);

  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i];
    rgb[j + 1] = rgba[i + 1];
    rgb[j + 2] = rgba[i + 2];
  }

  return { width, height, rgb };
}

// -----------------------------
// SUBMIT REPORT
// -----------------------------

form.addEventListener('submit', async event => {
  event.preventDefault();

  if (!selectedFile) {
    setStatus('Please upload an observation photo.', 'error');
    return;
  }

  if (!lakeSelect.value || !zoneSelect.value) {
    setStatus('Please select a lake and shoreline zone.', 'error');
    return;
  }

  if (!timeInput.value) {
    setStatus('Please select the observation date and time.', 'error');
    return;
  }

  if (new Date(timeInput.value).getTime() > Date.now()) {
    setStatus('Observation time cannot be in the future.', 'error');
    return;
  }

  submitButton.disabled = true;
  submitButton.innerHTML = '<span>Submitting report...</span><span>⌛</span>';
  setStatus('Processing your photo and report. Please wait...', 'loading');

  try {
    const { width, height, rgb } = await imageToRGB(selectedFile);

    const body = new FormData();

    body.append('zoneId', zoneSelect.value);
    body.append('requestId', createRequestId());
    body.append('observedAt', localTimeToISO(timeInput.value));
    body.append('note', noteInput.value.trim());
    body.append('ph', phInput.value);
    body.append('temperatureC', temperatureInput.value);
    body.append('photoWidth', String(width));
    body.append('photoHeight', String(height));

    body.append(
      'photo',
      new Blob([rgb], { type: 'application/octet-stream' }),
      'photo.rgb'
    );

    const report = await api('/api/reports', {
      method: 'POST',
      body
    });

    setStatus('Report submitted successfully!', 'success');

    showReportSuccess(report);

    form.reset();
    selectedFile = null;
    preview.src = '';
    previewWrap.classList.add('hidden');
    charCount.textContent = '0 / 500';
    setCurrentLocalTime();

    await loadReports();

  } catch (error) {
    setStatus(error.message || 'Unable to submit report. Please try again.', 'error');
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = '<span>Submit observation</span><span>→</span>';
  }
});

// -----------------------------
// SUCCESS MESSAGE
// -----------------------------

function showReportSuccess(report) {
  if (!report) return;

  const status = report.status || 'pending';

  let statusLabel = 'Report received';
  if (status === 'classified') statusLabel = 'Visible signs detected';
  else if (status === 'no_target_signs') statusLabel = 'No target signs detected';
  else if (status === 'needs_review') statusLabel = 'Requires further review';
  else if (status === 'pending') statusLabel = 'Analysis pending';

  setStatus(
    `✓ Report submitted. ${statusLabel}. Report ID: ${report.id}`,
    'success'
  );
}

// -----------------------------
// RECENT REPORTS
// -----------------------------

async function loadReports() {
  const lakeId = lakeSelect.value;

  if (!lakeId) {
    reportsContainer.innerHTML = '<p class="pilot-empty">Select a lake to view reports.</p>';
    return;
  }

  reportsContainer.innerHTML = '<p class="pilot-empty">Loading observations...</p>';

  try {
    const reports = await api(`/api/reports?lakeId=${encodeURIComponent(lakeId)}`);

    if (!Array.isArray(reports) || reports.length === 0) {
      reportsContainer.innerHTML = `
        <p class="pilot-empty">
          No reports for this lake yet. Be the first to contribute.
        </p>
      `;
      return;
    }

    reportsContainer.innerHTML = reports.map(report => {
      const date = report.observedAt
        ? new Date(report.observedAt).toLocaleString()
        : 'Date unavailable';

      const status = report.status || 'pending';

      const statusText = {
        classified: 'Signs detected',
        no_target_signs: 'No target signs detected',
        needs_review: 'Needs review',
        pending: 'Analysis pending'
      }[status] || status.replaceAll('_', ' ');

      return `
        <article class="pilot-report-item">
          <div class="pilot-report-image">
            <img
              src="${escapeHTML(report.photoUrl || '')}"
              alt="Reported lake observation"
              loading="lazy"
            />
          </div>

          <div class="pilot-report-info">
            <div class="pilot-report-top">
              <span class="pilot-report-zone">${escapeHTML(report.zoneName || 'Shoreline')}</span>
              <span class="pilot-report-status ${escapeHTML(status)}">
                ${escapeHTML(statusText)}
              </span>
            </div>

            <h4>${escapeHTML(report.lakeName || '')}</h4>
            <p>${escapeHTML(report.note || 'No description provided.')}</p>

            <div class="pilot-report-meta">
              <span>◷ ${escapeHTML(date)}</span>
              ${report.ph !== null && report.ph !== undefined ? `<span>pH: ${escapeHTML(report.ph)}</span>` : ''}
              ${report.temperatureC !== null && report.temperatureC !== undefined ? `<span>${escapeHTML(report.temperatureC)}°C</span>` : ''}
            </div>

            ${
              report.detections?.length
                ? `<div class="pilot-detections">
                    ${report.detections.map(detection => `
                      <span class="pilot-detection-tag">
                        ${escapeHTML(detection.category)}
                      </span>
                    `).join('')}
                  </div>`
                : ''
            }

            <small class="pilot-report-id">${escapeHTML(report.id || '')}</small>
          </div>
        </article>
      `;
    }).join('');

  } catch (error) {
    reportsContainer.innerHTML = `
      <p class="pilot-empty">
        Could not load reports. ${escapeHTML(error.message)}
      </p>
    `;
  }
}

refreshButton.addEventListener('click', loadReports);

// -----------------------------
// INITIALIZATION
// -----------------------------

setCurrentLocalTime();
loadLakes();
