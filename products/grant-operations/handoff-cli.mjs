#!/usr/bin/env node
// MIT. Installed Grant Operations case and Applications handoff command.
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openRuntimeWorkspace } from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/model.mjs';
import {
  inspectGrantHandoff, exportGrantHandoff, prepareGrantHandoff,
  receiveGrantHandoff, saveGrantHandoffApplication, grantHandoffStatus,
} from './handoff.mjs';

const HELP = [
  'starforge grant-application-handoff <export|inspect|prepare|receive|save|status> [options]',
  '',
  'export  --workspace DIR --operation DIR --application ID --case ID --expected-version N',
  '        [--name TEXT] [--allow-start] [--request-id UUID]',
  'inspect --package FILE',
  'prepare --workspace DIR --operation DIR (--package FILE | --case-archive ZIP) --bindings FILE',
  '        [--request-id UUID] [--name TEXT; native archive only]',
  'receive --workspace DIR --operation DIR',
  'save    --workspace DIR --operation DIR',
  'status  --operation DIR',
  '',
  'Export creates one complete grant-handoff.json inside the retained operation directory.',
  'Prepare retains the complete package or native case ZIP, explicit host bindings and original native requests.',
  'A native ZIP starts a new Application from those host settings through the same review and save.',
  'Receive imports the original case and returns its Applications review; save commits that setup.',
  'Resume export or prepare with the same workspace and operation; the original inputs stay retained.',
  'The complete receiving guide is products/grant-operations/HANDOFF.md in the installed source.',
].join('\n');
const ALLOWED = {
  export: ['workspace', 'operation', 'application', 'case', 'expected-version', 'name', 'allow-start', 'request-id'],
  inspect: ['package'], prepare: ['workspace', 'operation', 'package', 'case-archive', 'bindings', 'request-id', 'name'],
  receive: ['workspace', 'operation'], save: ['workspace', 'operation'], status: ['operation'],
};
function required(value, flag) {
  if (typeof value !== 'string' || !value) throw Object.assign(new Error('Use --' + flag + '.'), { code: 'GRANT_HANDOFF_ARGUMENT_REQUIRED' });
  return value;
}
export async function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args, strict: true, allowPositionals: true, options: {
    workspace: { type: 'string' }, operation: { type: 'string' }, application: { type: 'string' },
    case: { type: 'string' }, 'expected-version': { type: 'string' }, name: { type: 'string' },
    package: { type: 'string' }, 'case-archive': { type: 'string' }, bindings: { type: 'string' }, 'request-id': { type: 'string' },
    'allow-start': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help || !positionals.length) { process.stdout.write(HELP + '\n'); return; }
  const [action] = positionals;
  if (positionals.length !== 1 || !Object.hasOwn(ALLOWED, action) ||
      Object.keys(values).some(key => !ALLOWED[action].includes(key)))
    throw Object.assign(new Error('Choose one handoff action and its declared options. Use --help.'), { code: 'GRANT_HANDOFF_ARGUMENT_INVALID' });
  if (action === 'inspect') return inspectGrantHandoff({ package: required(values.package, 'package') });
  const operation = required(values.operation, 'operation');
  if (action === 'status') return grantHandoffStatus({ operation });
  const model = await openRuntimeWorkspace({ directory: resolve(required(values.workspace, 'workspace')) });
  if (action === 'export') {
    let expectedVersion;
    if (values['expected-version'] !== undefined) {
      if (!/^[1-9][0-9]*$/.test(values['expected-version']))
        throw Object.assign(new Error('Use the native positive case version.'), { code: 'GRANT_HANDOFF_ARGUMENT_INVALID' });
      expectedVersion = Number(values['expected-version']);
    }
    return exportGrantHandoff(model, { operation, applicationId: values.application, caseId: values.case,
      expectedVersion, name: values.name, allowStart: values['allow-start'] === true, requestId: values['request-id'] });
  }
  if (action === 'prepare') return prepareGrantHandoff(model,
    { operation, package: values.package, caseArchive: values['case-archive'], name: values.name,
      bindings: values.bindings, requestId: values['request-id'] });
  if (action === 'receive') return receiveGrantHandoff(model, { operation });
  return saveGrantHandoffApplication(model, { operation });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(value => { if (value !== undefined) process.stdout.write(JSON.stringify(value, null, 2) + '\n'); })
    .catch(error => {
      process.stderr.write(JSON.stringify({ error: { code: error.code ?? 'GRANT_HANDOFF_ERROR',
        message: String(error.message ?? error) } }) + '\n');
      process.exitCode = 1;
    });
}
