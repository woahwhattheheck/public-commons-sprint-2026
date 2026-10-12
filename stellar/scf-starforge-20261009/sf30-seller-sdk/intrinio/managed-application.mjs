// MIT. Intrinio's original saved workspace in the managed Applications console.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { absolute, need, digest, json, canonical } from '../../distribution/runtime-workspace/storage.mjs';

const SOURCE = 'stellar/scf-starforge-20261009/sf30-seller-sdk/intrinio/';
const field = (name, label, type = 'path', required = false, description = '') =>
  ({ name, label, type, required, description });
export function intrinioApplication(common) {
  return {
    id: 'intrinio-review', command: 'intrinio', title: 'Intrinio statement review', terminal: false,
    requiredSource: SOURCE + 'managed.mjs',
    description: 'Open an existing statement workspace, compare retained editions, keep reviewer decisions and export the original customer JSON, CSV and HTML.',
    fields: [
      field('workspaceDirectory', 'Saved Intrinio workspace', 'path', true,
        'Choose the private workspace created or restored by the original intrinio command. Its saved declaration selects the Python interpreter.'),
      ...common,
    ],
  };
}
export async function prepareIntrinioApplication(settings, { inputPath, runtimeDirectory } = {}) {
  need(typeof inputPath === 'function', 'APPLICATION_INTRINIO_INPUT_READER_REQUIRED');
  const workspace = await inputPath(absolute(settings.workspaceDirectory), 'directory', false, true);
  const runtime = await inspectMerchantRuntime(absolute(runtimeDirectory), { load: false });
  const native = await import(pathToFileURL(join(runtime.sourceRoot, SOURCE + 'managed.mjs')).href);
  const selection = await native.prepareIntrinioManagedSelection(workspace.path, { sourceRoot: runtime.sourceRoot });
  const inputs = [workspace];
  for (const source of selection.source.files) {
    const selected = await inputPath(join(selection.source.root, source.name), 'file');
    need(selected.bytes === source.bytes && selected.sha256 === source.sha256, 'APPLICATION_INTRINIO_SOURCE_CHANGED');
    inputs.push(selected);
  }
  return {
    args: ['serve', '--workspace', workspace.path, '--managed-selection', JSON.stringify(selection)],
    inputs, createDirectories: [],
    resourceKey: digest(json(canonical({ family: 'python-workspace', directory: workspace.path }))),
  };
}
function option(request, name, optional = false) {
  const positions = request.args.flatMap((value, index) => value === name ? [index] : []);
  if (optional && positions.length === 0) return undefined;
  need(positions.length === 1 && typeof request.args[positions[0] + 1] === 'string' &&
    !request.args[positions[0] + 1].startsWith('--'), 'APPLICATION_INTRINIO_STARTUP_CHANGED');
  return request.args[positions[0] + 1];
}
export async function intrinioApplicationStartup(request, text, context = {}) {
  if (request.command !== 'intrinio' || !Array.isArray(request.args) || request.args[0] !== 'serve' ||
    typeof text !== 'string' || text.length > 16384 ||
    !text.startsWith('{"schema":"stellar-forge.intrinio-operator-startup.v1",')) return null;
  let startup, selection;
  try { startup = JSON.parse(text); selection = JSON.parse(option(request, '--managed-selection')); }
  catch { need(false, 'APPLICATION_INTRINIO_STARTUP_CHANGED'); }
  need(selection?.workspace?.directory === absolute(option(request, '--workspace')),
    'APPLICATION_INTRINIO_STARTUP_CHANGED');
  const sourceRoot = join(absolute(request.releaseDirectory), 'source');
  const native = await import(pathToFileURL(join(sourceRoot, SOURCE + 'managed.mjs')).href);
  const rawPort = option(request, '--port', true) ?? '0';
  need(/^(0|[1-9]\d*)$/.test(rawPort) && Number(rawPort) <= 65535,
    'APPLICATION_INTRINIO_STARTUP_CHANGED');
  return native.verifyIntrinioManagedStartup(startup, {
    selection, sourceRoot, port: Number(rawPort), ...(context.pid ? { pid: context.pid } : {}),
  });
}
