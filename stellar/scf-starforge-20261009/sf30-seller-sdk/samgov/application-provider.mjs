// MIT. Source-owned Applications registration for the original SAM.gov operator.
import {join} from 'node:path';
import {APPLICATION_PROVIDER_SCHEMA, applicationPreparation, observeApplicationStartup}
  from '../../distribution/runtime-workspace/application-provider.mjs';
import {samManagedOptions} from './managed.mjs';
import {SAM_STARTUP_SCHEMA, SAM_CONNECTION_FILENAME, samNeed, samPlain,
  readSamConnection, inspectSamListener} from './connection.mjs';

export const SAM_APPLICATION_ID = 'samgov-opportunities';
export default {
  schema: APPLICATION_PROVIDER_SCHEMA, id: 'samgov', order: 1010,
  catalog({common, field}) {
    return [{
      id: SAM_APPLICATION_ID, command: 'samgov-workspace', title: 'SAM.gov opportunities',
      terminal: false, requiredSource: 'stellar/scf-starforge-20261009/sf30-seller-sdk/samgov/managed.mjs',
      description: 'Review original federal notices and issued files, save qualifications and deadlines, prepare merchants, and retain complete opportunity handoffs.',
      fields: [
        field('workspaceDirectory', 'SAM opportunity workspace', 'path', true,
          'Select the original private source workspace or a new directory inside a private parent.'),
        field('operator', 'Recording operator', 'text', true,
          'Name recorded by the original source, review and handoff actions.'),
        field('apiKeyEnv', 'SAM credential environment name', 'text', false,
          'Existing environment variable; defaults to SAM_GOV_API_KEY. Retained files work without a provider request.'),
        field('endpoint', 'GSA search endpoint', 'text', false,
          'Optional original production or alpha SAM search endpoint.'),
        field('opportunityDirectory', 'Opportunity handoff workspace', 'path', false,
          'Existing LGNDX opportunity workspace that receives the selected original notice and issued files.'),
        ...common,
      ],
    }];
  },
  validateSettings(_type, settings) {
    const args = ['--workspace', settings.workspaceDirectory, '--operator', settings.operator];
    for (const [field, flag] of [['apiKeyEnv', '--api-key-env'], ['endpoint', '--endpoint'],
      ['opportunityDirectory', '--opportunity-workspace']]) if (settings[field]) args.push(flag, settings[field]);
    samManagedOptions(args);
  },
  async prepare(_type, settings, {inputPath}) {
    const {args, inputs, createDirectories, path, option} = applicationPreparation(settings, inputPath);
    const workspace = await path('workspaceDirectory', 'directory', true, true);
    if (!workspace.exists) createDirectories.push(workspace.path);
    option('--workspace', workspace.path); option('--operator', settings.operator);
    option('--api-key-env', settings.apiKeyEnv); option('--endpoint', settings.endpoint);
    const opportunity = await path('opportunityDirectory', 'directory', false, true);
    if (opportunity) option('--opportunity-workspace', opportunity.path);
    return {args, inputs, createDirectories};
  },
  matchRequest(request) { return !request.pythonCommand && request.command === 'samgov-workspace'; },
  createObserver(request, directory) {
    return observeApplicationStartup(request, directory, text => {
      if (!text.startsWith('{"schema":"' + SAM_STARTUP_SCHEMA + '",')) return null;
      return () => samApplicationStartup(request, text);
    });
  },
};
export async function samApplicationStartup(request, text) {
  if (request.command !== 'samgov-workspace') return null;
  let announced;
  try { announced = JSON.parse(text); } catch { return null; }
  if (!samPlain(announced) || announced.schema !== SAM_STARTUP_SCHEMA ||
    announced.status !== 'SAM_WORKSPACE_READY') return null;
  const selected = samManagedOptions(request.args);
  samNeed(announced.directory === selected.directory && announced.operator === selected.operator &&
    announced.connectionFile === join(selected.directory, SAM_CONNECTION_FILENAME),
  'SAM_APPLICATION_STARTUP_CHANGED', 'The SAM launch differs from the reviewed application.', 409);
  const connection = await readSamConnection(announced.connectionFile, {directory: selected.directory});
  samNeed(connection.sha256 === announced.connectionSha256 &&
    connection.value.instanceId === announced.instanceId && connection.value.pid === announced.pid &&
    connection.value.workspaceId === announced.workspaceId &&
    connection.value.origin === announced.origin && connection.value.url === announced.url &&
    connection.value.apiKeyEnv === selected.apiKeyEnv && connection.value.endpoint === selected.endpoint &&
    connection.value.opportunityDirectory === (selected.opportunityDirectory || null) &&
    (!selected.port || Number(new URL(connection.value.origin).port) === selected.port),
  'SAM_APPLICATION_STARTUP_CHANGED', 'The original SAM listener identity differs from its startup record.', 409);
  const input = request.inputs?.find(value => value.path === selected.directory && value.kind === 'directory');
  if (input?.exists) samNeed(connection.value.directoryIdentity.dev === String(input.dev) &&
    connection.value.directoryIdentity.ino === String(input.ino),
  'SAM_APPLICATION_STARTUP_CHANGED', 'The original SAM directory changed after review.', 409);
  const live = await inspectSamListener(connection);
  return {url: connection.value.url, workspaceId: live.workspace.id,
    connectionFile: connection.path, original: {
      schema: SAM_STARTUP_SCHEMA, workspaceId: live.workspace.id,
      directory: selected.directory, instanceId: connection.value.instanceId,
      connectionSha256: connection.sha256, pid: connection.value.pid,
      operator: connection.value.operator,
    }};
}
