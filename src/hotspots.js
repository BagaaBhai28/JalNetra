const windowMs = 48 * 60 * 60 * 1000;

export function currentEvidence(db, mode, now, zoneId = null, category = null) {
  const through = new Date(now).toISOString();
  const since = new Date(now - windowMs).toISOString();
  return db.prepare(`WITH ranked AS (
    SELECT r.id, r.zone_id AS zoneId, r.observed_at AS observedAt, z.name AS zoneName,
      z.lake_name AS lakeName, z.latitude, z.longitude, r.ph, r.temperature_c AS temperatureC,
      a.source AS analysisSource, d.category, d.cue, d.attempt,
      row_number() OVER (PARTITION BY r.zone_id, d.category, r.image_fingerprint
        ORDER BY r.observed_at DESC, r.id DESC) AS rank
    FROM report r JOIN zone z ON z.id = r.zone_id
    JOIN analysis_attempt a ON a.report_id = r.id AND a.attempt = r.current_attempt
    JOIN detection d ON d.report_id = a.report_id AND d.attempt = a.attempt
    WHERE r.data_mode = ? AND r.observed_at BETWEEN ? AND ? AND a.status = 'classified'
      AND (? IS NULL OR r.zone_id = ?) AND (? IS NULL OR d.category = ?)
  )
  SELECT * FROM ranked WHERE rank = 1 ORDER BY observedAt DESC, id DESC`)
    .all(mode, since, through, zoneId, zoneId, category, category);
}

export function hotspotDashboard(db, mode, now) {
  const zones = new Map(db.prepare('SELECT id, name FROM zone ORDER BY rowid').all().map(zone => [
    zone.id, { zoneId: zone.id, name: zone.name, status: 'none', categories: [] },
  ]));
  const groups = new Map();
  for (const evidence of currentEvidence(db, mode, now)) {
    const { id, zoneId, category, observedAt, cue, analysisSource } = evidence;
    const key = zoneId + ':' + category;
    if (!groups.has(key)) groups.set(key, { zoneId, category, reports: [] });
    groups.get(key).reports.push({
      id, observedAt, cue, analysisSource, photoUrl: '/api/reports/' + id + '/photo',
    });
  }
  for (const { zoneId, category, reports } of groups.values()) {
    const zone = zones.get(zoneId);
    const status = reports.length >= 2 ? 'priority_hotspot' : 'watch';
    zone.categories.push({
      category, status, evidenceCount: reports.length, evidenceReportIds: reports.map(report => report.id), reports,
    });
    if (status === 'priority_hotspot' || zone.status === 'none') zone.status = status;
  }
  for (const zone of zones.values()) zone.categories.sort((a, b) => b.evidenceCount - a.evidenceCount ||
    a.category.localeCompare(b.category));
  return { dataMode: mode, windowHours: 48, zones: [...zones.values()] };
}
