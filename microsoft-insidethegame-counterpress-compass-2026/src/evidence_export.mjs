import { createHash } from 'node:crypto';

// Portable, deterministic judge export of the exact selected synthetic frame.
// This is NOT a signature, live-match proof, or an Azure/Foundry response.
export function createEvidenceExport(snapshot) {
  const events = snapshot?.selectedEvents;
  if (!Array.isArray(events) || !Array.isArray(snapshot?.overlays) || !snapshot?.stats) {
    throw new TypeError('Expected a computed fixture snapshot with its source events');
  }
  const evidenceIds = new Set(events.map(event => event.id));
  if (evidenceIds.size !== events.length) throw new TypeError('Source event IDs must be unique');
  const outcomes = snapshot.overlays.map(overlay => {
    if (!Array.isArray(overlay.evidenceIds) ||
        overlay.evidenceIds.some(id => !evidenceIds.has(id))) {
      throw new TypeError('Overlay cites an event absent from the selected frame');
    }
    if (overlay.team !== snapshot.team) throw new TypeError('Overlay belongs to another selected team');
    return {
      id: overlay.id, team: overlay.team, status: overlay.status,
      showAt: overlay.showAt, hideAt: overlay.hideAt,
      evidenceIds: [...overlay.evidenceIds],
      explanation: overlay.text,
      metrics: { ...overlay.metrics }
    };
  });
  const prefixSha256 = createHash('sha256')
    .update(JSON.stringify(events), 'utf8').digest('hex');
  return {
    schema: 'counterpress-evidence-export-v1',
    provenance: 'SYNTHETIC FIXTURE ONLY / NOT REAL PREMIER LEAGUE DATA',
    proofType: 'source-event-digest-not-signature',
    digestRecipe: 'SHA-256 of UTF-8 JSON.stringify(selectedEvents)',
    sourcePrefixSha256: prefixSha256,
    selection: {
      count: snapshot.count, team: snapshot.team,
      audience: snapshot.audience, locale: snapshot.locale
    },
    elapsedSeconds: snapshot.elapsedSeconds,
    stats: { ...snapshot.stats },
    selectedEvents: events.map(event => ({ ...event })),
    outcomes
  };
}

function csvCell(value) {
  const raw = String(value ?? '');
  // Spreadsheet formula injection is not evidence: quote and neutralize it.
  const neutral = /^[=+\-@\t\r]/.test(raw) ? "'" + raw : raw;
  return '"' + neutral.replaceAll('"', '""') + '"';
}

export function evidenceCsv(report) {
  const header = [
    'schema','synthetic_source_sha256','team','frame_count','status','source_loss_id',
    'show_second','hide_second','evidence_ids','pressure_count','regain_seconds',
    'observation_seconds','zone','explanation'
  ];
  const rows = report.outcomes.map(outcome => [
    report.schema, report.sourcePrefixSha256, outcome.team, report.selection.count,
    outcome.status, outcome.id, outcome.showAt, outcome.hideAt,
    outcome.evidenceIds.join(' -> '), outcome.metrics.pressureCount,
    outcome.metrics.secondsToRecover, outcome.metrics.observedSeconds,
    outcome.metrics.zone, outcome.explanation
  ]);
  return [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
