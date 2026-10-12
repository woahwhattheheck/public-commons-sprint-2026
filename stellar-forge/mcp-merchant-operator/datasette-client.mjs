// MIT. Datasette customer operations and receiving through the original merchant transport.
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { DATASETTE_OPERATIONS } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/datasette/client.mjs';
import { datasetteWorkspaceTools } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/datasette/provider.mjs';
import { datasetteReceivingTools } from './catalog/datasette-workspace.mjs';
import { openMerchantFileClient, createRetainedDownload } from './retained-download.mjs';
import { exact, failure, identifier } from './host-files.mjs';
import { DATASETTE_DOWNLOAD_MANIFEST, DATASETTE_MAX_FILE_BYTES, DATASETTE_MAX_MANIFEST_BYTES,
  parseDatasetteDownloadManifest, validateDatasetteExportId } from './datasette-download-contract.mjs';

const PREFIX = 'merchant_datasette_';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const describeTool = (name, description, properties, required, annotations = {}) => ({
  name, description, inputSchema: {type:'object', properties, required, additionalProperties:false}, annotations,
});
export const datasetteActions = Object.freeze(Object.fromEntries([
  ...datasetteWorkspaceTools(describeTool), ...datasetteReceivingTools(describeTool),
].map(tool => [tool.name.slice(PREFIX.length), tool])));
function checkedTool(action, args) {
  if (typeof action !== 'string') throw failure('INVALID_PARAMS', 'Choose a declared Datasette merchant action.');
  const name = action.startsWith(PREFIX) ? action : PREFIX + action, definition = datasetteActions[name.slice(PREFIX.length)];
  if (!definition) throw failure('TOOL_NOT_FOUND', 'Choose a declared Datasette merchant action.');
  exact(args, Object.keys(definition.inputSchema.properties), definition.inputSchema.required);
  return name;
}
const operationMethod = name => name.replace(/[.-]([a-z])/g, (_, letter) => letter.toUpperCase());

/** This client attaches the existing merchant listener; it never owns the Datasette source workspace. */
export async function openDatasetteClient({workspace, ...options} = {}) {
  if (workspace !== undefined) identifier(workspace, 'Datasette workspace alias');
  const original = await openMerchantFileClient({...options, errorPrefix:'DATASETTE',
    clientName:'starforge-datasette-customer', maximumResponseBytes:128 * 1024 * 1024});
  const call = (action, args = {}, requestOptions) => {
    const local = {...args};
    const short = typeof action === 'string' && action.startsWith(PREFIX) ? action.slice(PREFIX.length) : action;
    if (workspace !== undefined && short !== 'workspaces') {
      if (local.workspace !== undefined && local.workspace !== workspace)
        throw failure('DATASETTE_CLIENT_BINDING', 'Use the original selected Datasette workspace alias.');
      local.workspace = workspace;
    }
    return original.call(checkedTool(action, local), local, requestOptions);
  };
  const namedTools = Object.fromEntries(Object.keys(datasetteActions).map(action => [
    action.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()),
    (args = {}, requestOptions) => call(action, args, requestOptions),
  ]));
  const nativeOperations = Object.fromEntries(DATASETTE_OPERATIONS.map(operation => [
    operationMethod(operation),
    ({input = {}, workspace: selected = workspace} = {}, requestOptions) =>
      call('operation', {workspace:selected, operation, input}, requestOptions),
  ]));
  return Object.freeze({
    endpoint:original.endpoint, call, ...namedTools, ...nativeOperations,
    nativeOperation(operation, input, requestOptions) {
      if (workspace === undefined) throw failure('DATASETTE_CLIENT_BINDING', 'Select the original workspace alias or call operation with explicit arguments.');
      return call('operation', {workspace, operation, input}, requestOptions);
    },
    downloadExport(args = {}) {
      if (workspace !== undefined && args.workspace !== undefined && args.workspace !== workspace)
        throw failure('DATASETTE_CLIENT_BINDING', 'Use the original selected Datasette workspace alias.');
      return downloadDatasetteExport({...args, workspace:args.workspace ?? workspace, client:original});
    },
    inspectExport(args = {}) {
      if (workspace !== undefined && args.workspace !== undefined && args.workspace !== workspace)
        throw failure('DATASETTE_CLIENT_BINDING', 'Use the original selected Datasette workspace alias.');
      return inspectDatasetteExport({...args, workspace:args.workspace ?? workspace, client:original});
    },
  });
}

const downloads = createRetainedDownload({
  manifestName:DATASETTE_DOWNLOAD_MANIFEST, parseManifest:parseDatasetteDownloadManifest,
  maximumBytes:DATASETTE_MAX_FILE_BYTES, maximumManifestBytes:DATASETTE_MAX_MANIFEST_BYTES,
  maximumCheckpointBytes:128 * 1024 * 1024, nestedFiles:true,
  stateSchema:'stellar-forge.datasette-download-state.v1',
  resultSchema:'stellar-forge.datasette-download-result.v1',
  toolPrefix:'merchant_datasette_export', errorPrefix:'DATASETTE',
  clientName:'starforge-datasette-receiving', validateExportId:validateDatasetteExportId,
  describe:manifest => ({workspaceId:manifest.workspaceId, native:manifest.native}),
});
async function selectedTransport({client, workspace, url, tokenEnv, environment, signal}) {
  identifier(workspace, 'Datasette workspace alias');
  if (client !== undefined && url !== undefined)
    throw failure('DATASETTE_DOWNLOAD_CONFIGURATION', 'Supply the original client or its endpoint once.');
  const original = client ?? await openMerchantFileClient({url, tokenEnv, environment, signal,
    errorPrefix:'DATASETTE', clientName:'starforge-datasette-receiving', maximumResponseBytes:128 * 1024 * 1024});
  if (!original || typeof original.call !== 'function' || typeof original.endpoint !== 'string')
    throw failure('DATASETTE_DOWNLOAD_CONFIGURATION', 'Use one original merchant file client.');
  return {endpoint:original.endpoint + '#datasette=' + workspace,
    call:(tool, args, options) => original.call(tool, {...args, workspace}, options)};
}
export async function downloadDatasetteExport(options = {}) {
  const {workspace, client, url, tokenEnv, environment, signal, ...rest} = options;
  const selected = await selectedTransport({workspace, client, url, tokenEnv, environment, signal});
  return downloads.download({...rest, signal, client:selected});
}
export async function inspectDatasetteExport(options = {}) {
  const {workspace, client, url, tokenEnv, environment, signal, ...rest} = options;
  const selected = await selectedTransport({workspace, client, url, tokenEnv, environment, signal});
  return downloads.inspect({...rest, signal, client:selected});
}

/** Verify every original received file with both native and merchant listeners closed. */
export async function reopenDatasetteExport({directory, exportId, expectedManifestSha256} = {}) {
  validateDatasetteExportId(exportId);
  if (typeof directory !== 'string' || !directory || directory.includes('\0') ||
      expectedManifestSha256 !== undefined && !/^[a-f0-9]{64}$/.test(expectedManifestSha256))
    throw failure('DATASETTE_DOWNLOAD_CONFIGURATION', 'Select the retained directory and its original manifest identity.');
  const root = resolve(directory), raw = await downloads.bytesAt(join(root, DATASETTE_DOWNLOAD_MANIFEST), DATASETTE_MAX_MANIFEST_BYTES);
  const manifestSha256 = sha(raw), manifest = parseDatasetteDownloadManifest(raw, exportId);
  if (expectedManifestSha256 !== undefined && expectedManifestSha256 !== manifestSha256)
    throw failure('DATASETTE_DOWNLOAD_EXPORT_CHANGED', 'The completed manifest differs from its reviewed original digest.');
  return downloads.lockedDownload(root, async context => {
    await downloads.loadContext(context, raw, exportId);
    for (const file of manifest.files) {
      context.lease.assertHeld();
      await downloads.verifiedFile(join(root, file.name), file);
    }
    return {schema:'stellar-forge.datasette-download-result.v1', state:'REOPENED',
      directory:root, exportId, workspaceId:manifest.workspaceId, native:manifest.native,
      manifestSha256, files:manifest.files.length, bytes:manifest.totalBytes,
      verifiedFiles:manifest.files};
  });
}
