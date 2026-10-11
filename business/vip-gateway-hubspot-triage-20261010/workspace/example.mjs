// Development records for learning the operator workflow. No customer records.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openWorkspace } from './model.mjs';
import { DEFAULT_CONFIG } from './source.mjs';
import { id, jsonBytes } from './common.mjs';

export const exampleConfig = () => ({ ...structuredClone(DEFAULT_CONFIG), triage: { ...DEFAULT_CONFIG.triage, portalId: '123456', stageStatus: { qualified: 'open', proposal: 'open', closedwon: 'won', closedlost: 'lost' }, nextActionProperty: 'next_action_date', leadQualityProperty: 'lead_quality', maxAlerts: 40, maxPerOwner: 10, minCohort: 5 }, scope: { pipelineIds: ['leasing'], ownerIds: [] }, context: { ...DEFAULT_CONFIG.context, lastContactProperty: 'last_contact_date', stageEnteredProperty: 'stage_entered_at', lostReasonProperty: 'closed_lost_reason' } });
export function exampleRecords(version = 1) {
  const rows = Array.from({ length: 64 }, (_, index) => {
    const open = index < 24, source = index % 2 ? 'REFERRAL' : 'PAID_SEARCH';
    return { id: String(1000 + index), createdAt: '2026-09-01T09:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z', archived: false, properties: {
      createdate: '2026-09-01T09:00:00.000Z', dealstage: open ? index % 3 ? 'qualified' : 'proposal' : index % 4 < 2 ? 'closedwon' : 'closedlost', pipeline: 'leasing', hubspot_owner_id: String(201 + index % 3), hs_lastmodifieddate: '2026-10-01T10:00:00.000Z', next_action_date: open ? index % 4 ? '2026-10-05T09:00:00Z' : null : null, hs_analytics_source: source, lead_quality: 'QUALIFIED', last_contact_date: index % 5 ? '2026-10-02T10:00:00Z' : null, stage_entered_at: '2026-09-15T09:00:00Z', closed_lost_reason: !open && index % 4 >= 2 ? 'TIMING' : null, amount: index === 0 ? '9007199254740993.07' : '12000.00', deal_currency_code: 'GBP'
    } };
  });
  if (version >= 2) { rows[0].properties.next_action_date = '2026-10-20T09:00:00Z'; rows[0].properties.hs_lastmodifieddate = '2026-10-11T10:00:00Z'; rows[1].properties.dealstage = 'closedwon'; rows[1].properties.hs_lastmodifieddate = '2026-10-11T10:00:00Z'; rows[30].properties.dealstage = 'closedwon'; rows.splice(63, 1); rows.push({ ...structuredClone(rows[5]), id: '2000' }); }
  return rows;
}
export function exampleSchemas() {
  return { properties: { results: Object.keys(exampleRecords()[0].properties).map(name => ({ name, label: name.replaceAll('_', ' '), type: /date|_at/.test(name) ? 'datetime' : 'string', fieldType: 'text' })) }, pipelines: { results: [{ id: 'leasing', label: 'Development leasing pipeline', stages: Object.entries(exampleConfig().triage.stageStatus).map(([id, status]) => ({ id, label: id, metadata: { isClosed: status === 'open' ? 'false' : 'true', probability: status === 'won' ? '1.0' : '0.0' } })) }] } };
}
export async function createExample(directory) {
  const model = await openWorkspace({ directory });
  try {
    let project = model.createProject({ name: 'Development pipeline', actor: 'Example operator', requestId: id() }).project;
    const input = () => ({ revision: model.store.project(project.id).revision, actor: 'Example operator', requestId: id() });
    model.saveConfig(project.id, { ...input(), config: exampleConfig() });
    for (const [kind, value] of Object.entries(exampleSchemas())) model.importSchema(project.id, { ...input(), kind, filename: kind + '.json', contentBase64: jsonBytes(value).toString('base64') });
    const snapshot = model.importSource(project.id, { ...input(), name: 'Development source 1', filename: 'development-deals.json', declaredComplete: true, contentBase64: jsonBytes({ results: exampleRecords() }).toString('base64') }).snapshot;
    const run = model.startRun(project.id, { ...input(), name: 'Development daily review', snapshotId: snapshot.id, asOf: '2026-10-11T12:00:00Z' }).run;
    await model.background.get(run.id)?.completion;
    return { projectId: project.id, snapshotId: snapshot.id, run: model.run(run.id), source: 'Explicitly generated development records; no live HubSpot connection', command: `node workspace/cli.mjs serve --state ${JSON.stringify(resolve(directory))} --port 0` };
  } finally { await model.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) { process.stderr.write('Usage: node workspace/example.mjs PRIVATE_STATE_DIRECTORY\n'); process.exitCode = 1; }
  else createExample(resolve(process.argv[2])).then(value => process.stdout.write(JSON.stringify(value, null, 2) + '\n')).catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
