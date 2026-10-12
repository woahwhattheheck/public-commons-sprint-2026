// MIT. OpenCage through the existing managed Applications catalog and observer.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { absolute, plain, need } from './storage.mjs';

const SOURCE = 'stellar/scf-starforge-20261009/sf30-seller-sdk/opencage';
const STARTUP = 'stellar-forge.opencage-application-startup.v1';
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });

export function opencageApplication(common) {
  return {
    id: 'opencage-workspace', command: 'opencage-workbench', title: 'OpenCage geocoding',
    terminal: false, requiredSource: SOURCE + '/launch.mjs',
    description: 'Review source queries and candidate locations, preserve explicit decisions, publish merchant releases and receive complete customer deliveries in the original saved workspace.',
    fields: [
      field('workspaceDirectory', 'Initialized OpenCage workspace', 'path', true,
        'Choose the existing workspace containing its saved plan and payment terms. Initialize one with opencage-workbench init before reviewing this application.'),
      ...common,
    ],
  };
}

export async function prepareOpenCageApplication(settings, { inputPath, runtimeDirectory } = {}) {
  need(typeof inputPath === 'function', 'APPLICATION_OPENCAGE_INPUT_READER_REQUIRED');
  const workspaceDirectory = absolute(settings.workspaceDirectory);
  const inputs = [await inputPath(workspaceDirectory, 'directory', false, true)];
  const runtime = await inspectMerchantRuntime(absolute(runtimeDirectory), { load: false });
  const sourceDirectory = join(runtime.sourceRoot, SOURCE);
  const native = await import(pathToFileURL(join(sourceDirectory, 'launch.mjs')).href);
  need(typeof native.prepareGeocodeManagedSelection === 'function' &&
    typeof native.verifyGeocodeManagedStartup === 'function', 'APPLICATION_OPENCAGE_NATIVE_READER_REQUIRED');
  const selection = await native.prepareGeocodeManagedSelection({ workspaceDirectory, sourceDirectory });
  const configuration = await inputPath(selection.workspace.configurationFile, 'file');
  need(configuration.sha256 === selection.workspace.configurationSha256,
    'APPLICATION_OPENCAGE_CONFIGURATION_CHANGED');
  inputs.push(configuration);
  for (const file of selection.source.files) {
    const selected = await inputPath(join(sourceDirectory, file.name), 'file');
    need(selected.sha256 === file.sha256 && selected.bytes === file.bytes,
      'APPLICATION_OPENCAGE_SOURCE_CHANGED');
    inputs.push(selected);
  }
  return {
    args: ['serve', '--workspace', workspaceDirectory, '--managed-selection', JSON.stringify(selection)],
    inputs, createDirectories: [],
  };
}

function option(request, name, optional = false) {
  need(Array.isArray(request.args), 'APPLICATION_OPENCAGE_STARTUP_CHANGED');
  const positions = request.args.flatMap((value, index) => value === name ? [index] : []);
  if (optional && positions.length === 0) return undefined;
  need(positions.length === 1 && typeof request.args[positions[0] + 1] === 'string' &&
    !request.args[positions[0] + 1].startsWith('--'), 'APPLICATION_OPENCAGE_STARTUP_CHANGED');
  return request.args[positions[0] + 1];
}

export async function opencageStartup(request, text) {
  if (request.command !== 'opencage-workbench' || typeof text !== 'string' ||
    text.length > 16384 || !text.startsWith('{"schema":"' + STARTUP + '",')) return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!plain(value) || value.schema !== STARTUP || value.status !== 'OPENCAGE_WORKSPACE_READY') return null;
  need(request.args?.[0] === 'serve' && !request.args.includes('--delivery'),
    'APPLICATION_OPENCAGE_STARTUP_CHANGED');
  const workspaceDirectory = absolute(option(request, '--workspace'));
  const rawSelection = option(request, '--managed-selection');
  let selected;
  try { selected = JSON.parse(rawSelection); } catch { need(false, 'APPLICATION_OPENCAGE_STARTUP_CHANGED'); }
  need(plain(selected) && plain(selected.source) && plain(selected.workspace) &&
    selected.workspace.directory === workspaceDirectory, 'APPLICATION_OPENCAGE_STARTUP_CHANGED');
  const sourceDirectory = absolute(selected.source.directory);
  const launchSourceDirectory = join(absolute(request.releaseDirectory), 'source', SOURCE);
  const port = Number(option(request, '--port', true) ?? 0);
  need(Number.isInteger(port) && port >= 0 && port <= 65535, 'APPLICATION_OPENCAGE_STARTUP_CHANGED');
  const native = await import(pathToFileURL(join(sourceDirectory, 'launch.mjs')).href);
  return native.verifyGeocodeManagedStartup(value, {
    selection: rawSelection, launchSourceDirectory, port,
  });
}
