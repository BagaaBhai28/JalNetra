
import { normalize } from './photo-input.js';

const $ = id => document.getElementById(id);
const notice = $('pilot-status');
const lakeSelect = $('pilot-lake');
const photoForm = $('pilot-photo-form');
const concernForm = $('pilot-concern-form');

const store = 'jalnetra-pilot-session';

const time = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata'
});

const labels = {
  foam: 'Foam',
  algae_like_growth: 'Algae-like growth',
  dumping: 'Waste dumping',
  'suspected-discharge': 'Suspected wastewater discharge',
  sewage: 'Sewage or drain overflow',
  other: 'Other concern',
  confirm: 'Confirmed',
  correct: 'Corrected',
  dismiss: 'Dismissed',
  duplicate: 'Marked duplicate'
};

let session;

try {
  session = JSON.parse(sessionStorage.getItem(store));
} catch {
  session = null;
}

let user;
let lakes = [];
let lake;
let role;

let listVersion = 0;
let refreshInFlight;
let visionConfigured = false;

let photoId = crypto.randomUUID();
let concernId = crypto.randomUUID();

const previews = new Set();

/* -------------------- UI HELPERS -------------------- */

function msg(text, error = false) {
  notice.textContent = text;
  notice.dataset.kind = error ? 'error' : 'success';
}

function el(tag, text) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  return node;
}

function setSession(next) {
  session = next;

  if (next) {
    sessionStorage.setItem(store, JSON.stringify(next));
  } else {
    sessionStorage.removeItem(store);
  }
}

/* -------------------- API -------------------- */

async function http(route, payload, token) {
  const headers = new Headers();

  if (token) {
    headers.set('Authorization', 'Bearer ' + token);
  }

  const method = payload === undefined ? 'GET' : 'POST';
  let body = payload;

  if (payload !== undefined && !(payload instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(payload);
  }

  return fetch('/api/pilot/' + route, {
    method,
    headers,
    body
  });
}

async function decode(response) {
  if (response.ok) {
    return response.json();
  }

  const info = await response.json().catch(() => ({}));

  throw new Error(
    info.error?.message ||
    'Shared reporting could not complete this request.'
  );
}

async function api(route, payload, image = false) {
  let response = await http(
    route,
    payload,
    session?.access_token
  );

  if (response.status === 401 && session?.refresh_token) {
    const key = session.refresh_token;

    refreshInFlight ??= http(
      'refresh',
      { refresh_token: key }
    )
      .then(decode)
      .then(next => {
        if (session?.refresh_token === key) {
          setSession(next);
        }
      })
      .finally(() => {
        refreshInFlight = undefined;
      });

    await refreshInFlight;

    response = await http(
      route,
      payload,
      session?.access_token
    );
  }

  if (image && response.ok) {
    return response.blob();
  }

  return decode(response);
}

/* -------------------- ACTION HANDLER -------------------- */

function operate(button, run) {
  if (button?.disabled) return;

  if (button) button.disabled = true;

  msg('');

  return Promise.resolve()
    .then(run)
    .catch(error => {
      msg(
        error?.message || 'Something went wrong.',
        true
      );
    })
    .finally(() => {
      if (button) button.disabled = false;
    });
}

/* -------------------- LAKE HELPERS -------------------- */

function zoneName(id, selected = lake) {
  return selected?.pilot_zones?.find(
    zone => zone.id === id
  )?.name ?? 'Shoreline sector';
}

function labelOf(value) {
  return labels[value] || value || 'Unclassified';
}

/* -------------------- PHOTO SIMILARITY -------------------- */

function photoDistance(a, b) {
  if (
    !/^[a-f0-9]{16}$/.test(a ?? '') ||
    !/^[a-f0-9]{16}$/.test(b ?? '')
  ) {
    return Infinity;
  }

  let bits = BigInt('0x' + a) ^ BigInt('0x' + b);
  let count = 0;

  for (; bits > 0n; bits &= bits - 1n) {
    count++;
  }

  return count;
}

/* -------------------- REVIEW HELPERS -------------------- */

function events(report) {
  return [...(report.events ?? [])].sort(
    (a, b) => b.created_at.localeCompare(a.created_at)
  );
}

function latestReview(report) {
  return events(report).find(
    item => item.action !== 'model'
  );
}

/* -------------------- CORROBORATION -------------------- */

function renderCorroboration(reports, selected) {
  const groups = new Map();

  for (const report of reports) {
    const review = latestReview(report);

    const age = Date.now() - Date.parse(report.observed_at);

    if (
      !review?.category ||
      age > 48 * 3600000 ||
      age < 0
    ) {
      continue;
    }

    const key = report.zone_id + ':' + review.category;

    if (!groups.has(key)) {
      groups.set(key, {
        zone: report.zone_id,
        category: review.category,
        independent: new Set()
      });
    }

    groups.get(key).independent.add(
      report.reporter_id
    );
  }

  $('pilot-corroboration').textContent =
    [...groups.values()]
      .filter(group => group.independent.size >= 2)
      .map(group =>
        zoneName(group.zone, selected) +
        ' · ' +
        labelOf(group.category) +
        ' · ' +
        group.independent.size +
        ' independent reporters'
      )
      .join(' | ');
}

/* -------------------- REVIEW FORM -------------------- */

function reviewForm(report, candidates, version) {
  const block = el('form');

  const decision = el('select');
  decision.setAttribute(
    'aria-label',
    'Decision for ' + report.id
  );

  for (const [value, name] of [
    ['confirm', 'Confirm visible evidence'],
    ['correct', 'Correct category'],
    ['dismiss', 'Dismiss evidence'],
    ['duplicate', 'Mark as duplicate']
  ]) {
    decision.add(new Option(name, value));
  }

  const category = el('select');
  category.setAttribute(
    'aria-label',
    'Evidence category'
  );

  for (const value of [
    'foam',
    'algae_like_growth',
    'dumping'
  ]) {
    category.add(
      new Option(labels[value], value)
    );
  }

  const duplicate = el('select');
  duplicate.setAttribute(
    'aria-label',
    'Original report'
  );

  duplicate.add(
    new Option('Choose the original report', '')
  );

  for (const candidate of candidates) {
    duplicate.add(
      new Option(candidate.title, candidate.id)
    );
  }

  const note = el('textarea');
  note.required = true;
  note.maxLength = 500;
  note.rows = 2;
  note.placeholder = 'Explain the decision';
  note.setAttribute(
    'aria-label',
    'Operator review note'
  );

  function fields() {
    duplicate.hidden = decision.value !== 'duplicate';
    duplicate.required = !duplicate.hidden;

    category.hidden = [
      'dismiss',
      'duplicate'
    ].includes(decision.value);
  }

  decision.addEventListener('change', fields);
  fields();

  const submit = el('button', 'Save review');
  submit.className = 'secondary';
  submit.type = 'submit';

  block.append(
    decision,
    category,
    duplicate,
    note,
    submit
  );

  block.addEventListener('submit', event => {
    event.preventDefault();

    operate(submit, async () => {
      await api('review', {
        reportId: report.id,
        decision: decision.value,
        category: category.hidden
          ? null
          : category.value,
        duplicateOf: duplicate.hidden
          ? null
          : duplicate.value,
        note: note.value
      });

      if (version === listVersion) {
        await loadRecords();
        msg('Review saved.');
      }
    });
  });

  return block;
}

/* -------------------- REPORT CARD -------------------- */

function reportCard(
  report,
  reports,
  selected,
  canReview,
  version
) {
  const card = el('li');

  const review = latestReview(report);

  const model = events(report).find(
    item => item.action === 'model'
  )?.model_output;

  card.append(
    el(
      'h3',
      zoneName(report.zone_id, selected) +
      ' · ' +
      time.format(new Date(report.observed_at)) +
      ' IST'
    ),
    el(
      'p',
      review
        ? labelOf(review.action) +
          (review.category
            ? ' · ' + labelOf(review.category)
            : '')
        : 'Awaiting human review'
    )
  );

  if (report.note) {
    card.append(el('p', report.note));
  }

  const readings = [
    report.ph != null ? 'pH ' + report.ph : '',
    report.temperature_c != null
      ? report.temperature_c + ' °C'
      : ''
  ].filter(Boolean);

  if (readings.length) {
    card.append(
      el(
        'p',
        'Citizen-reported · ' + readings.join(' · ')
      )
    );
  }

  if (review?.note) {
    card.append(el('p', review.note));
  }

  /* Photo viewer */

  const media = el('button', 'View photo');
  media.type = 'button';
  media.className = 'secondary';

  media.addEventListener('click', () => {
    operate(media, async () => {
      const blob = await api(
        'photo?id=' + encodeURIComponent(report.id),
        undefined,
        true
      );

      if (version !== listVersion) return;

      const image = el('img');

      image.alt =
        'Citizen photo from ' +
        zoneName(report.zone_id, selected);

      image.src = URL.createObjectURL(blob);
      previews.add(image.src);

      media.replaceWith(image);
    });
  });

  card.append(media);

  /* AI visual analysis */

  if (model) {
    const cues = model.detections?.map(
      item =>
        labelOf(item.category) +
        ' — ' +
        item.cue
    );

    card.append(
      el(
        'p',
        'Live vision · ' +
        (
          model.imageQuality === 'unclear'
            ? 'Image unclear'
            : cues?.join('; ') ||
              'No visible target signs'
        )
      )
    );
  }

  if (!canReview) {
    return card;
  }

  /* Analyze button */

  if (visionConfigured && !model) {
    const analyze = el('button', 'Analyze photo');
    analyze.type = 'button';
    analyze.className = 'secondary';

    analyze.addEventListener('click', () => {
      operate(analyze, async () => {
        await api('analyze', {
          reportId: report.id
        });

        if (version === listVersion) {
          await loadRecords();
          msg('Photo analysis saved.');
        }
      });
    });

    card.append(analyze);
  }

  /* Possible duplicate matching */

  const candidates = reports
    .filter(other => other.id !== report.id)
    .map(other => {
      const distance = photoDistance(
        report.photo_hash,
        other.photo_hash
      );

      return {
        id: other.id,
        distance,
        title:
          zoneName(other.zone_id, selected) +
          ' · ' +
          time.format(
            new Date(other.observed_at)
          ) +
          ' · ' +
          other.id.slice(0, 8) +
          (
            distance <= 6
              ? ' · visually similar'
              : ''
          )
      };
    })
    .sort((a, b) => a.distance - b.distance);

  if (
    candidates.some(other => other.distance <= 6)
  ) {
    card.append(
      el(
        'p',
        'Possible near-duplicate. Compare the photos before deciding.'
      )
    );
  }

  /* Review panel */

  const details = el('details');

  details.append(
    el('summary', 'Review evidence'),
    reviewForm(report, candidates, version)
  );

  /* Review history */

  if (review) {
    const history = el('details');

    history.append(
      el('summary', 'Review history')
    );

    for (const entry of events(report).filter(
      item => item.action !== 'model'
    )) {
      history.append(
        el(
          'p',
          labelOf(entry.action) +
          ' · ' +
          time.format(
            new Date(entry.created_at)
          ) +
          ' IST · ' +
          (entry.note || '')
        )
      );
    }

    details.append(history);
  }

  card.append(details);

  return card;
}

/* -------------------- LOAD REPORTS -------------------- */

async function loadRecords() {
  const version = ++listVersion;
  const selected = lake;

  /* Clean previous photo preview URLs */

  for (const url of previews) {
    URL.revokeObjectURL(url);
  }

  previews.clear();

  $('pilot-corroboration').textContent = '';

  const reports = $('pilot-reports');
  const concerns = $('pilot-concerns');

  if (!selected || !role) {
    reports.replaceChildren(
      el('li', 'Join this lake to view your submissions.')
    );

    concerns.replaceChildren();

    return;
  }

  const canReview = [
    'operator',
    'admin'
  ].includes(role);

  reports.replaceChildren(
    el('li', 'Loading observations…')
  );

  concerns.replaceChildren(
    el('li', 'Loading concerns…')
  );

  const scope = '?lakeId=' + selected.id;

  const [photoData, concernData] =
    await Promise.all([
      api('reports' + scope),
      api('concerns' + scope)
    ]);

  /* Prevent stale results after lake switching */

  if (version !== listVersion || lake !== selected) {
    return;
  }

  reports.replaceChildren(
    ...(
      photoData.reports.length
        ? photoData.reports.map(report =>
            reportCard(
              report,
              photoData.reports,
              selected,
              canReview,
              version
            )
          )
        : [el('li', 'No observations yet.')]
    )
  );

  concerns.replaceChildren(
    ...(
      concernData.concerns.length
        ? concernData.concerns.map(concern => {
            const row = el('li');

            row.append(
              el(
                'h3',
                labelOf(concern.category) +
                ' · ' +
                zoneName(
                          concern.zone_id,
                          selected
                        )
              ),
              el('p', concern.description),
              el(
                'small',
                'JalNetra reference ' + concern.id
              )
            );

            return row;
          })
        : [el('li', 'No concerns yet.')]
    )
  );

  if (canReview) {
    renderCorroboration(
      photoData.reports,
      selected
    );
  }
}

/* -------------------- TIME HELPER -------------------- */

function setObserved() {
  const now = new Date();

  $('pilot-observed').value = new Date(
    now - now.getTimezoneOffset() * 60000
  )
    .toISOString()
    .slice(0, 16);
}

/* -------------------- LAKE SELECTION -------------------- */

async function chooseLake() {
  lake = lakes.find(
    item => item.id === lakeSelect.value
  );

  role = user?.memberships?.find(
    item => item.lake_id === lake?.id
  )?.role;

  $('pilot-enroll').hidden = !lake || !!role;

  $('pilot-intake').hidden = role !== 'citizen';

  $('pilot-admin').hidden = role !== 'admin';

  $('pilot-role').textContent =
    (
      role
        ? 'Lake role · ' + role
        : 'Select a lake to join and report.'
    ) +
    ' · Account ID ' +
    (user?.id ?? '');

  $('pilot-report-scope').textContent =
    ['operator', 'admin'].includes(role)
      ? (
          visionConfigured
            ? 'Shared review queue · latest 25 reports'
            : 'Shared review queue · human review available'
        )
      : 'Your latest submissions';

  for (const id of [
    'pilot-zone',
    'pilot-concern-zone'
  ]) {
    $(id).replaceChildren(
      ...(lake?.pilot_zones ?? []).map(
        zone => new Option(zone.name, zone.id)
      )
    );
  }

  photoForm.reset();
  concernForm.reset();
  setObserved();

  photoId = crypto.randomUUID();
  concernId = crypto.randomUUID();

  await Promise.all([
    loadRecords(),
    role === 'admin'
      ? loadMembers(lake)
      : undefined
  ]);
}

/* -------------------- ADMIN MEMBERS -------------------- */

async function loadMembers(selected) {
  const { members } = await api(
    'members?lakeId=' + selected.id
  );

  if (lake !== selected) return;

  $('pilot-member-list').replaceChildren(
    ...members.map(member =>
      el(
        'li',
        member.user_id + ' · ' + member.role
      )
    )
  );
}

/* -------------------- WORKSPACE -------------------- */

async function openWorkspace() {
  const [account, catalog, status] =
    await Promise.all([
      api('account'),
      api('catalog'),
      api('status')
    ]);

  user = account;
  lakes = catalog.lakes;
  visionConfigured = status.visionConfigured;

  $('pilot-auth').hidden = true;
  $('pilot-workspace').hidden = false;

  $('pilot-account').textContent = user.email;

  const requested = new URLSearchParams(
    location.search
  ).get('lake');

  lakeSelect.replaceChildren(
    ...lakes.map(
      item => new Option(item.name, item.id)
    )
  );

  const initial =
    lakes.find(item => item.slug === requested) ??
    lakes.find(item =>
      user.memberships.some(
        membership => membership.lake_id === item.id
      )
    );

  if (initial) {
    lakeSelect.value = initial.id;
  }

  await chooseLake();
}

/* -------------------- LOGIN / SIGNUP -------------------- */

$('pilot-login').addEventListener(
  'submit',
  event => {
    event.preventDefault();

    const button = event.submitter;
    if (!button) return;

    operate(button, async () => {
      const payload = Object.fromEntries(
        new FormData(event.target)
      );

      const auth = await decode(
        await http(button.value, payload)
      );

      event.target.reset();

      if (button.value === 'signup') {
        return msg(auth.message);
      }

      setSession(auth);

      await openWorkspace();
    });
  }
);

/* -------------------- SIGNOUT -------------------- */

$('pilot-signout').addEventListener(
  'click',
  () => operate(
    $('pilot-signout'),
    async () => {
      try {
        await api('signout', {});
      } finally {
        setSession(null);

        user = null;
        lakes = [];
        lake = null;
        role = null;

        listVersion++;

        for (const url of previews) {
          URL.revokeObjectURL(url);
        }

        previews.clear();

        await loadRecords();

        $('pilot-workspace').hidden = true;
        $('pilot-auth').hidden = false;
      }
  )
);

/* -------------------- ENROLL -------------------- */

$('pilot-enroll').addEventListener(
  'click',
  () => operate(
    $('pilot-enroll'),
    async () => {
      await api('enroll', {
        lakeId: lake.id
      });

      user = await api('account');

      await chooseLake();
    }
  )
);

/* -------------------- LAKE CHANGE -------------------- */

lakeSelect.addEventListener(
  'change',
  () => chooseLake().catch(
    error => msg(error.message, true)
  )
);

/* -------------------- RELOAD -------------------- */

$('pilot-reload').addEventListener(
  'click',
  () => operate(
    $('pilot-reload'),
    loadRecords
  )
);

/* -------------------- MEMBER MANAGEMENT -------------------- */

$('pilot-members').addEventListener(
  'submit',
  event => {
    event.preventDefault();

    operate(event.submitter, async () => {
      const selected = lake;

      await api(
        'members?lakeId=' + selected.id,
        {
          userId: $('pilot-member').value.trim(),
          role: $('pilot-member-role').value
        }
      );

      if (lake !== selected) return;

      await loadMembers(selected);

      msg('Lake role updated.');
    });
  }
);

/* -------------------- FORM ID RESET -------------------- */

photoForm.addEventListener(
  'input',
  () => {
    photoId = crypto.randomUUID();
  }
);

concernForm.addEventListener(
  'input',
  () => {
    concernId = crypto.randomUUID();
  }
);

/* -------------------- PHOTO SUBMISSION -------------------- */

photoForm.addEventListener(
  'submit',
  event => {
    event.preventDefault();

    operate(event.submitter, async () => {
      const current = lake;
      const id = photoId;

      if (!current) {
        throw new Error('Select a lake first.');
      }

      const payload = new FormData(photoForm);

      payload.set('lake_id', current.id);
      payload.set('id', id);

      payload.set(
        'observed_at',
        new Date(
          $('pilot-observed').value
        ).toISOString()
      );

      const photo = await normalize(
        $('pilot-photo').files[0]
      );

      payload.set(
        'pixels',
        photo.pixels,
        'normalized.rgb'
      );

      payload.set('width', photo.width);
      payload.set('height', photo.height);

      const report = await api(
        'upload',
        payload
      );

      if (lake !== current) return;

      if (photoId === id) {
        photoForm.reset();
        setObserved();
        photoId = crypto.randomUUID();
      }

      msg(
        'Observation saved. Reference ' +
        report.id
      );

      await loadRecords();
    }
  }
);

/* -------------------- CONCERN SUBMISSION -------------------- */

concernForm.addEventListener(
  'submit',
  event => {
    event.preventDefault();

    operate(event.submitter, async () => {
      const current = lake;
      const id = concernId;

      if (!current) {
        throw new Error('Select a lake first.');
      }

      const concern = await api(
        'concerns',
        {
          ...Object.fromEntries(
            new FormData(concernForm)
          ),
          id,
          lake_id: current.id
        }
      );

      if (lake !== current) return;

      if (concernId === id) {
        concernForm.reset();
        concernId = crypto.randomUUID();
      }

      msg(
        'Concern saved. Reference ' +
        concern.id
      );

      await loadRecords();
    }
  }
);

/* -------------------- AUTH CALLBACK -------------------- */

const authFragment = new URLSearchParams(
  location.hash.slice(1)
);

if (
  authFragment.has('access_token') ||
  authFragment.has('error_description')
) {
  history.replaceState(
    null,
    '',
    location.pathname + location.search
  );

  if (authFragment.has('access_token')) {
    msg('Email confirmed. Sign in to continue.');
  } else {
    msg(
      'The confirmation link could not be used. Request a new account email or sign in if already confirmed.',
      true
    );
  }
}

/* -------------------- SESSION RESTORE -------------------- */

if (session) {
  openWorkspace().catch(error => {
    setSession(null);
    user = null;
    lake = null;
    role = null;
    msg(error.message, true);
  });
}
