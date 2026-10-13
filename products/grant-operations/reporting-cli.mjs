#!/usr/bin/env node
// MIT. Installed Grant reporting capture, procedure handover and original Application receiving.
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  captureGrantReporting, inspectGrantReportingHandoff, inspectGrantReportingArchive, packGrantReportingPlan,
  unpackGrantReporting, receiveGrantReporting, readGrantReportingJSON, saveGrantReportingJSON,
} from './reporting.mjs';
import { inspectGrantReportingProfile } from './reporting-plan.mjs';

export const GRANT_REPORTING_HELP = [
  'starforge grant-reporting <capture|inspect|pack|unpack|receive> [options]',
  '',
  'capture --profile FILE --case ID --end-date YYYY-MM-DD --out NEW.json',
  '        [--start-date YYYY-MM-DD] [--plan CURRENT.json] [--id ID] [--allow-start]',
  'inspect --bundle FILE [--python EXECUTABLE]',
  'pack    --bundle FILE --plan CURRENT.json --out NEW.json',
  'unpack  --bundle FILE --directory DIR [--python EXECUTABLE]',
  'receive --bundle FILE --workspace RUNTIME_WORKSPACE --operation ORIGINAL_DIR',
  '        --bindings FILE --profile RECEIVER_PROFILE --directory DIR',
  '',
  'Catalog selection defaults to the original grant-operations product; --source-root DIR reads a checkout.',
  'The profile selects the original grant workspace, Python executable, named operator and receiving locations.',
  'Capture reads the native complete period report and exports its exact case version.',
  'Pack preserves the native case and adds complete saved procedure revisions.',
  'Receive uses the original Grant Application handoff operation; repeat that same operation after interruption.',
  'Complete source guide: products/grant-operations/REPORTING.md.',
].join('\n');
const allowed = {
  capture: ['profile', 'case', 'start-date', 'end-date', 'out', 'plan', 'id', 'allow-start', 'source-root'],
  inspect: ['bundle', 'python'],
  pack: ['bundle', 'plan', 'out'],
  unpack: ['bundle', 'directory', 'python'],
  receive: ['bundle', 'workspace', 'operation', 'bindings', 'profile', 'directory', 'source-root'],
};
function required(value, name) {
  if (typeof value !== 'string' || !value.trim())
    throw Object.assign(new TypeError('Use --' + name + '.'), { code: 'GRANT_REPORTING_ARGUMENT_REQUIRED' });
  return value;
}
export async function main(args = process.argv.slice(2), { log = console.log } = {}) {
  const { values, positionals } = parseArgs({ args, strict: true, allowPositionals: true, options: {
    profile: { type: 'string' }, case: { type: 'string' }, 'start-date': { type: 'string' },
    'end-date': { type: 'string' }, out: { type: 'string' }, plan: { type: 'string' }, id: { type: 'string' },
    'allow-start': { type: 'boolean' }, bundle: { type: 'string' }, directory: { type: 'string' },
    python: { type: 'string' }, workspace: { type: 'string' }, operation: { type: 'string' }, bindings: { type: 'string' },
    'source-root': { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help || !positionals.length) { log(GRANT_REPORTING_HELP); return; }
  const [action] = positionals;
  if (positionals.length !== 1 || !allowed[action] || Object.keys(values).some(key => !allowed[action].includes(key)))
    throw new TypeError('Choose one reporting action and its declared options. Use --help.');
  const packet = values.bundle ? await readGrantReportingJSON(values.bundle) : null;
  let result;
  if (action === 'inspect') {
    required(values.bundle, 'bundle');
    const value = inspectGrantReportingHandoff(packet);
    inspectGrantReportingArchive(packet, values.python ?? 'python3');
    result = { id: value.id, createdAt: value.createdAt, planRevision: value.plan.revisions.length,
      case: value.report.case, plan: value.report.plan, period: value.report.selection,
      reportSha256: value.report.reportSha256, archiveBytes: value.caseBytes.length,
      owner: value.profile.owner, receiving: value.profile.receiving };
  } else if (action === 'pack') {
    required(values.bundle, 'bundle');
    const plan = await readGrantReportingJSON(required(values.plan, 'plan'));
    const next = packGrantReportingPlan(packet, plan);
    result = await saveGrantReportingJSON(required(values.out, 'out'), next);
  } else if (action === 'unpack') {
    required(values.bundle, 'bundle');
    result = await unpackGrantReporting(packet, required(values.directory, 'directory'), { pythonExecutable: values.python ?? 'python3' });
  } else {
    const profile = inspectGrantReportingProfile(await readGrantReportingJSON(required(values.profile, 'profile')));
    const { loadCommandCatalog } = await import('../../stellar/scf-starforge-20261009/distribution/discovery/load.mjs');
    const catalog = await loadCommandCatalog({ sourceRoot: values['source-root'], selection: 'grant-operations' });
    if (action === 'receive') {
      required(values.bundle, 'bundle');
      const bindings = await readGrantReportingJSON(required(values.bindings, 'bindings'));
      const { openRuntimeWorkspace } = await import('../../stellar/scf-starforge-20261009/distribution/runtime-workspace/model.mjs');
      const model = await openRuntimeWorkspace({ directory: resolve(required(values.workspace, 'workspace')) });
      result = await receiveGrantReporting({ model, packet, catalog, bindings, profile,
        operation: required(values.operation, 'operation'), directory: required(values.directory, 'directory') });
    } else {
      const caseId = required(values.case, 'case'), endDate = required(values['end-date'], 'end-date');
      const filename = required(values.out, 'out');
      const previous = values.plan ? await readGrantReportingJSON(values.plan) : undefined;
      if (previous && values.id && previous.id !== values.id) throw new TypeError('A continued procedure keeps its original ID.');
      const { inspectGrantAgentBinding, GrantWorkspaceClient } = await import('../../stellar/scf_2026/sf47_budget_model/workspace/agent-client.mjs');
      const binding = await inspectGrantAgentBinding({ directory: profile.workspaceDirectory,
        pythonExecutable: profile.pythonExecutable, allowStart: values['allow-start'] === true, label: profile.title });
      const client = new GrantWorkspaceClient(binding);
      try {
        await client.open({ expectedSelectionSha256: binding.selectionSha256 });
        const captured = await captureGrantReporting({ client, catalog, profile, caseId,
          startDate: values['start-date'], endDate, plan: previous, id: previous?.id ?? values.id ?? randomUUID() });
        result = { ...await saveGrantReportingJSON(filename, captured), planId: captured.id,
          planRevision: captured.plan.revisions.length };
      } finally { await client.close(); }
    }
  }
  log(JSON.stringify(result, null, 2)); return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error(JSON.stringify({ error: {
    code: error.code ?? 'GRANT_REPORTING_ERROR', message: String(error.message ?? error),
  } })); process.exitCode = 1; });
