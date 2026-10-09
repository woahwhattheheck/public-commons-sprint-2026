import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { makeSnapshot } from '../src/engine.mjs';
import { createEvidenceExport, evidenceCsv } from '../src/evidence_export.mjs';

const fixture = JSON.parse(await readFile(new URL('../data/events.json', import.meta.url), 'utf8'));

test('replay export pins exact synthetic source, selection, citations and safe CSV', () => {
  const selectedEvents = fixture.slice();
  const snapshot = { count: selectedEvents.length, selectedEvents,
    ...makeSnapshot(selectedEvents, { team: 'Harbor FC', audience: 'analyst', locale: 'en' }) };
  const report = createEvidenceExport(snapshot);
  assert.equal(report.selection.count, selectedEvents.length);
  assert.match(report.sourcePrefixSha256, /^[a-f0-9]{64}$/);
  assert.equal(report.provenance.includes('SYNTHETIC'), true);
  const eventIds = new Set(selectedEvents.map(event => event.id));
  for (const item of report.outcomes) assert(item.evidenceIds.every(id => eventIds.has(id)));
  assert.equal(createEvidenceExport(snapshot).sourcePrefixSha256, report.sourcePrefixSha256);
  const shorter = selectedEvents.slice(0, -1);
  const other = createEvidenceExport({ count: shorter.length, selectedEvents: shorter,
    ...makeSnapshot(shorter, { team: 'Harbor FC', audience: 'analyst', locale: 'en' }) });
  assert.notEqual(other.sourcePrefixSha256, report.sourcePrefixSha256);
  const csv = evidenceCsv(report);
  assert(csv.startsWith('"schema","synthetic_source_sha256"'));
  assert(csv.includes(report.sourcePrefixSha256));
  assert.throws(() => createEvidenceExport({ ...snapshot, overlays: [
    { ...snapshot.overlays[0], evidenceIds: ['invented-evidence-id'] }
  ] }), /absent/);
});
