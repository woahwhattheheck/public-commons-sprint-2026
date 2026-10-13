// MIT. CANADABUYS procurement desk in the original source-owned Applications registry.
import {
  APPLICATION_PROVIDER_SCHEMA,
  applicationField,
  applicationPreparation,
  applicationPrivateUrl,
  observeApplicationStartup,
} from '../../distribution/runtime-workspace/application-provider.mjs';
import { absolute, need, digest, json, canonical }
  from '../../distribution/runtime-workspace/storage.mjs';

const ROOT = 'stellar/scf-starforge-20261009/sf30-seller-sdk/canadabuys/';
const STARTUP = 'stellar-forge.canadabuys-startup.v1';
const PREFIX = '{"schema":"' + STARTUP + '",';
const OPERATOR_DEFAULT = 'operator';
const hash = value => digest(json(canonical(value)));

export function canadabuysApplication(common = []) {
  return {
    id: 'canadabuys',
    command: 'canadabuys',
    title: 'CanadaBuys procurement',
    terminal: false,
    requiredSource: ROOT + 'cli.mjs',
    description: 'Capture official federal sources; save company capabilities, evidence and reviewed bid decisions; plan partner workshares and transfer complete procurement workspaces.',
    fields: [
      applicationField('workspaceDirectory', 'Procurement workspace directory', 'path', true,
        'Choose the directory for retained sources, editions and review decisions. A new directory is created when the application is saved.'),
      applicationField('operator', 'Operator name', 'text', false,
        'Name the person or team responsible for saved reviews. Defaults to operator.'),
      ...common,
    ],
  };
}

function portNumber(value) {
  const raw = value === undefined || value === '' ? '0' : String(value);
  need(/^(0|[1-9]\d*)$/.test(raw) && Number(raw) <= 65535,
    'APPLICATION_CANADABUYS_PORT_INVALID', 'Use a local port between 0 and 65535.');
  return Number(raw);
}

export async function prepareCanadaBuysApplication(settings, { inputPath } = {}) {
  need(typeof inputPath === 'function', 'APPLICATION_CANADABUYS_INPUT_READER_REQUIRED');
  need(typeof settings.workspaceDirectory === 'string' && settings.workspaceDirectory.trim(),
    'APPLICATION_CANADABUYS_WORKSPACE_REQUIRED', 'Choose a procurement workspace directory.');
  const selected = applicationPreparation(settings, inputPath);
  const workspace = await selected.path('workspaceDirectory', 'directory', true, true);
  const operator = typeof settings.operator === 'string' && settings.operator.trim()
    ? settings.operator.trim() : OPERATOR_DEFAULT;
  need(operator.length <= 256 && !/[\u0000-\u001f\u007f]/.test(operator),
    'APPLICATION_CANADABUYS_OPERATOR_INVALID', 'Use a single-line operator name up to 256 characters.');
  if (!workspace.exists) selected.createDirectories.push(workspace.path);
  selected.args.push('serve');
  selected.option('--workspace', workspace.path);
  selected.option('--operator', operator);
  selected.option('--host', '127.0.0.1');
  selected.option('--port', portNumber(settings.port));
  return {
    args: selected.args,
    inputs: selected.inputs,
    createDirectories: selected.createDirectories,
    resourceKey: hash({ family: 'canadabuys-procurement', directory: workspace.path }),
  };
}

function argument(request, name) {
  const positions = request.args.flatMap((value, index) => value === name ? [index] : []);
  need(positions.length === 1 && typeof request.args[positions[0] + 1] === 'string' &&
    !request.args[positions[0] + 1].startsWith('--'),
  'APPLICATION_CANADABUYS_STARTUP_CHANGED', 'The procurement startup arguments changed.');
  return request.args[positions[0] + 1];
}

export function readCanadaBuysStartup(request, line, context = {}) {
  if (request.command !== 'canadabuys' || request.pythonCommand || !Array.isArray(request.args) ||
      request.args[0] !== 'serve' || typeof line !== 'string' || line.length > 16384 ||
      !line.startsWith(PREFIX)) return null;
  let startup;
  try { startup = JSON.parse(line); }
  catch {
    need(false, 'APPLICATION_CANADABUYS_STARTUP_CHANGED', 'The procurement startup announcement is not valid JSON.');
  }
  need(startup && typeof startup === 'object' && !Array.isArray(startup) &&
    startup.schema === STARTUP && typeof startup.origin === 'string',
  'APPLICATION_CANADABUYS_STARTUP_CHANGED', 'The procurement startup announcement changed.');
  const expectedDirectory = absolute(argument(request, '--workspace'));
  const expectedOperator = argument(request, '--operator');
  const expectedHost = argument(request, '--host');
  const expectedPort = portNumber(argument(request, '--port'));
  const privateUrl = applicationPrivateUrl(startup.origin);
  need(privateUrl && expectedHost === '127.0.0.1',
    'APPLICATION_CANADABUYS_STARTUP_CHANGED', 'The procurement browser must announce its selected local address.');
  const address = new URL(privateUrl);
  need(address.hostname === expectedHost && address.pathname === '/' &&
    !address.search && !address.hash && (!expectedPort || Number(address.port || 80) === expectedPort) &&
    startup.directory === expectedDirectory && startup.operator === expectedOperator &&
    typeof startup.workspaceId === 'string' && startup.workspaceId.length > 0 &&
    Number.isSafeInteger(startup.revision) && startup.revision >= 0 &&
    Number.isSafeInteger(startup.pid) && startup.pid > 0 &&
    (context.pid === undefined || startup.pid === context.pid),
  'APPLICATION_CANADABUYS_STARTUP_CHANGED', 'The announced procurement workspace differs from the selected application.');
  return { url: privateUrl, workspaceId: startup.workspaceId, original: startup };
}

export default {
  schema: APPLICATION_PROVIDER_SCHEMA,
  id: 'canadabuys',
  order: 1110,
  appendPort: false,
  catalog({ common }) { return [canadabuysApplication(common)]; },
  prepare(type, settings, context) {
    need(type.command === 'canadabuys' && type.terminal === false,
      'APPLICATION_CANADABUYS_COMMAND_CHANGED', 'The procurement application command changed.');
    return prepareCanadaBuysApplication(settings, context);
  },
  matchRequest(request) {
    return !request.pythonCommand && request.command === 'canadabuys' && request.args?.[0] === 'serve';
  },
  createObserver(request, directory, context) {
    return observeApplicationStartup(request, directory,
      line => readCanadaBuysStartup(request, line, context));
  },
};
