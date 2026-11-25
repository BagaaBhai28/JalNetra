import { claimAttempt, runAttempt, transact } from './analysis.js';
import { getSample } from './vision.js';

export async function resetRehearsal(db, vision, timeoutMs, saveReport) {
  const sample = getSample('foam-inlet');
  const attempt = transact(db, () => {
    // The caller provides an isolated local rehearsal or hosted demo session.
    db.exec(`DELETE FROM complaint_evidence;
      DELETE FROM complaint_draft;
      UPDATE report SET current_attempt = NULL;
      DELETE FROM detection;
      DELETE FROM analysis_attempt;
      DELETE FROM report;`);
    const observedAt = new Date(Date.now() - 60 * 1000).toISOString();
    const result = saveReport(db, {
      requestId: 'rehearsal-first-report', fingerprint: sample.imageHash, hash: sample.imageHash,
      png: sample.png, zoneId: 'north-inlet', observedAt, note: '', ph: null, temperature: null,
    }, 'demo');
    return claimAttempt(db, result, vision, timeoutMs);
  });
  await runAttempt(db, attempt, vision, timeoutMs);
  return attempt.id;
}
