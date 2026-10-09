// Independent, read-only provenance audit for Counterpress Compass synthetic events.
// Does not change canonical scoring or infer that an observed event stream is complete.
export const WINDOW_SECONDS = 8;
export const TEAMS = Object.freeze(['Harbor FC', 'Metro Rovers']);
const TYPES = new Set(['loss', 'pressure', 'regain', 'pass', 'shot', 'clock']);
const ZONES = new Set(['defensive', 'middle', 'attacking']);

export function auditFixture(events, {coverage = 'unverified', sourceSha256 = null} = {}) {
  if (!['unverified', 'operator-attested-complete'].includes(coverage)) {
    throw new TypeError('coverage must be unverified or operator-attested-complete');
  }
  const findings = [];
  const add = (severity, code, eventIds, detail) => findings.push({severity, code, eventIds, detail});
  const present = Array.isArray(events) && events.length <= 1000;
  if (!present) {
    add('ERROR', 'INVALID_EVENT_COLLECTION', [], 'Expected at most 1000 events in an array');
    return result([], findings, [], coverage, sourceSha256, false);
  }
  const seen = new Set();
  let last = -Infinity;
  for (const [i, e] of events.entries()) {
    if (!e || typeof e !== 'object' || Array.isArray(e) ||
      typeof e.id !== 'string' || !/^e[0-9]{3,6}$/.test(e.id) || seen.has(e.id) ||
      typeof e.second !== 'number' || !Number.isFinite(e.second) ||
      e.second < 0 || e.second > 5400 || e.second < last ||
      !TEAMS.includes(e.team) || !TYPES.has(e.type) || !ZONES.has(e.zone) ||
      typeof e.player !== 'string' || e.player.length > 48 || /[<>]/.test(e.player)) {
      add('ERROR', 'INVALID_EVENT_SCHEMA', typeof e?.id === 'string' ? [e.id] : [],
        `Event index ${i} violates the canonical id/time/team/type/zone/player contract`);
    } else {
      seen.add(e.id);
      last = e.second;
    }
  }
  if (findings.some(f => f.severity === 'ERROR')) {
    return result([], findings, [], coverage, sourceSha256, false);
  }

  const active = new Map();
  const windows = [];
  const finalize = (a, state, at, closing = null, watermark = null) => {
    const window = {
      id: a.loss.id,
      team: a.loss.team,
      startSecond: a.loss.second,
      endSecond: at,
      status: state,
      pressureIds: a.pressures.map(p => p.id),
      evidenceIds: [a.loss.id, ...a.pressures.map(p => p.id), ...(closing ? [closing.id] : [])],
      closingEventId: closing?.id ?? null,
      watermarkEventId: watermark?.id ?? null,
      coverageAssumption: state === 'expired' ? coverage : 'not-required',
    };
    windows.push(window);
    if (state === 'expired' && coverage !== 'operator-attested-complete') {
      add('WARNING', 'UNVERIFIED_TIMEOUT_COVERAGE', [a.loss.id, ...a.pressures.map(p => p.id), watermark.id],
        'A later event passes the 8s deadline, but the stream does not establish that all regains were captured');
    }
  };
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const next = events[i+1];
    if (next && next.second === e.second && next.team === e.team &&
      new Set([next.type, e.type]).size > 1 &&
      ['loss', 'pressure', 'regain'].includes(e.type) &&
      ['loss', 'pressure', 'regain'].includes(next.type)) {
      add('REVIEW', 'SAME_TIME_TACTICAL_ORDER', [e.id, next.id],
        'Distinct tactical transitions share the same second; list order may determine the result');
    }
    for (const [team, a] of active) {
      if (e.second > a.loss.second + WINDOW_SECONDS) {
        finalize(a, a.pressures.length ? 'expired' : 'not_attempted', a.loss.second + WINDOW_SECONDS,
          null, e);
        active.delete(team);
      }
    }
    if (e.type === 'loss') {
      for (const [other, a] of active) {
        if (other !== e.team) add('REVIEW', 'OVERLAPPING_TEAM_LOSS', [a.loss.id, e.id],
          'Both synthetic teams have unresolved possession-loss windows; inspect possession continuity');
      }
      const old = active.get(e.team);
      if (old) finalize(old, old.pressures.length ? 'interrupted' : 'not_attempted', e.second, e);
      active.set(e.team, {loss: e, pressures: []});
    } else if (e.type === 'pressure') {
      const a = active.get(e.team);
      if (a && e.second <= a.loss.second + WINDOW_SECONDS) a.pressures.push(e);
      else add('NOTE', 'PRESSURE_OUTSIDE_COUNTERPRESS_WINDOW', [e.id],
        'This pressure is not counted by the eight-second counterpress metric');
    } else if (e.type === 'regain') {
      const a = active.get(e.team);
      if (a && e.second <= a.loss.second + WINDOW_SECONDS) {
        finalize(a, a.pressures.length ? 'success' : 'not_attempted', e.second, e);
        active.delete(e.team);
      } else add('NOTE', 'REGAIN_WITHOUT_OPEN_LOSS', [e.id],
        'No same-team loss is open; this regain is not evidence of a counterpress success');
    }
  }
  const unresolved = [];
  for (const a of active.values()) {
    unresolved.push({id: a.loss.id, team: a.loss.team, startSecond: a.loss.second,
      pressureIds: a.pressures.map(p => p.id)});
    add('NOTE', 'OPEN_WINDOW_WITHOUT_LATER_WATERMARK', [a.loss.id, ...a.pressures.map(p => p.id)],
      'Do not assign a timeout or success without a closing event or strictly later watermark');
  }
  windows.sort((a, b) => a.startSecond - b.startSecond || a.id.localeCompare(b.id));
  unresolved.sort((a,b) => a.startSecond-b.startSecond || a.id.localeCompare(b.id));
  return result(windows, findings, unresolved, coverage, sourceSha256, true);
}

function result(windows, findings, unresolved, coverage, sourceSha256, schemaValid) {
  const severityOrder = {ERROR: 0, REVIEW: 1, WARNING: 2, NOTE: 3};
  findings.sort((a,b) => severityOrder[a.severity] - severityOrder[b.severity] ||
    (a.eventIds[0] || '').localeCompare(b.eventIds[0] || '') || a.code.localeCompare(b.code));
  const counts = Object.fromEntries(['success','expired','interrupted','not_attempted']
    .map(s => [s, windows.filter(w => w.status === s).length]));
  const status = !schemaValid ? 'INVALID' : findings.some(f=>f.severity==='REVIEW') ? 'REVIEW' :
    findings.some(f=>f.severity==='WARNING') ? 'PASS_WITH_WARNINGS' : 'PASS';
  return {schemaVersion: 1, status, coverage, sourceSha256,
    disclaimer: 'Synthetic fixture integrity only; not complete match capture, Premier League data, or a contest score',
    counts: {...counts, unresolved: unresolved.length}, windows, unresolved, findings};
}

export function markdownReport(audit) {
  const lines = ['# Counterpress Compass — fixture evidence audit', '',
    `**Status:** ${audit.status}  |  **Coverage:** ${audit.coverage}`,
    `**SHA-256:** ${audit.sourceSha256 || 'not supplied'}`, '',
    'Synthetic fixture only; this report does not establish complete event capture or an official score.', '',
    '## Window outcomes', '',
    '| Success | Expired | Interrupted | Not attempted | Still open |',
    '| ---: | ---: | ---: | ---: | ---: |',
    `| ${audit.counts.success} | ${audit.counts.expired} | ${audit.counts.interrupted} | ${audit.counts.not_attempted} | ${audit.counts.unresolved} |`, '',
    '## Evidence findings', ''];
  if (!audit.findings.length) lines.push('No data-contract or evidence-window findings on this fixture.');
  else {
    lines.push('| Severity | Code | Event IDs | Interpretation |', '| --- | --- | --- | --- |');
    for (const f of audit.findings) lines.push(`| ${f.severity} | ${f.code} | ${f.eventIds.join(', ') || '—'} | ${f.detail} |`);
  }
  return lines.join('\n') + '\n';
}