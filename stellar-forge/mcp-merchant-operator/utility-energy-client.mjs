// MIT. Original Utility customer operations and resumable complete MCP exports.
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { utilityEnergyWorkspaceTools, validateUtilityEnergyArguments, parseUtilityEnergyExport,
  UTILITY_ENERGY_MANIFEST } from './utility-energy-workspace.mjs';
import { openMerchantFileClient, createRetainedDownload } from './retained-download.mjs';
const PREFIX = 'merchant_utility_';
const fail = (code,message) => Object.assign(new Error(message),{code});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const utilityEnergyActions = Object.freeze(Object.fromEntries(utilityEnergyWorkspaceTools(
  (name,description,properties,required,annotations = {}) => ({name,description,
    inputSchema:{type:'object',properties,required,additionalProperties:false},annotations}))
  .map(definition => [definition.name.slice(PREFIX.length),definition])));

/** Uses the original merchant protocol. Every mutation retains its caller-supplied native request UUID. */
export async function openUtilityEnergyClient(options = {}) {
  const original = await openMerchantFileClient({...options,errorPrefix:'UTILITY',clientName:'starforge-utility-operator'});
  const call = async (action,args = {},requestOptions) => {
    if (typeof action !== 'string') throw fail('INVALID_PARAMS','Choose an original Utility action.');
    const name = action.startsWith(PREFIX) ? action : PREFIX+action;
    validateUtilityEnergyArguments(name,args);
    try { return await original.call(name,args,requestOptions); }
    catch (error) {
      if (typeof args.requestId === 'string') {
        error.requestId = args.requestId;
        error.operationTool = 'merchant_utility_operation';
        error.workspace = args.workspace;
      }
      throw error;
    }
  };
  const named = Object.fromEntries(Object.keys(utilityEnergyActions).map(action => [
    action.replace(/_([a-z])/g,(_,letter) => letter.toUpperCase()),
    (args = {},requestOptions) => call(action,args,requestOptions)
  ]));
  return Object.freeze({endpoint:original.endpoint,call,...named});
}
const downloads = createRetainedDownload({
  manifestName:UTILITY_ENERGY_MANIFEST,parseManifest:parseUtilityEnergyExport,maximumBytes:2*1024*1024*1024,
  stateSchema:'stellar-forge.utility-download.v1',resultSchema:'stellar-forge.utility-download-result.v1',
  toolPrefix:PREFIX.slice(0,-1),errorPrefix:'UTILITY',clientName:'starforge-utility-download',
  describe:manifest => ({workspace:manifest.workspace,bindingSha256:manifest.bindingSha256,
    revision:manifest.revision,revisionAfter:manifest.revisionAfter,original:manifest.source})
});
export const downloadUtilityEnergyExport = downloads.download;
export const inspectUtilityEnergyExport = downloads.inspect;

/** Verifies the same completed original receiving directory under its native download lease. */
export async function reopenUtilityEnergyExport({directory,exportId,expectedManifestSha256} = {}) {
  if (typeof directory !== 'string' || !directory || directory.includes('\0') ||
      !/^[0-9a-f]{64}$/.test(exportId ?? '') ||
      expectedManifestSha256 !== undefined && !/^[0-9a-f]{64}$/.test(expectedManifestSha256))
    throw fail('UTILITY_DOWNLOAD_CONFIGURATION','Select the original receiving directory, export ID and reviewed manifest SHA256.');
  const root = resolve(directory), manifestBytes = await downloads.bytesAt(join(root,UTILITY_ENERGY_MANIFEST),65000);
  const manifestSha256 = sha(manifestBytes), manifest = parseUtilityEnergyExport(manifestBytes,exportId);
  if (expectedManifestSha256 !== undefined && expectedManifestSha256 !== manifestSha256)
    throw fail('UTILITY_DOWNLOAD_EXPORT_CHANGED','The completed original manifest differs from its reviewed SHA256.');
  return downloads.lockedDownload(root,async context => {
    await downloads.loadContext(context,manifestBytes,exportId);
    for (const file of manifest.files) {
      context.lease.assertHeld(); await downloads.verifiedFile(join(root,file.name),file);
    }
    return {schema:'stellar-forge.utility-download-result.v1',state:'REOPENED',directory:root,exportId,
      workspace:manifest.workspace,bindingSha256:manifest.bindingSha256,revision:manifest.revision,
      revisionAfter:manifest.revisionAfter,original:manifest.source,manifestSha256,
      files:manifest.files.length,bytes:manifest.files.reduce((sum,file) => sum+file.bytes,0),verifiedFiles:manifest.files};
  });
}
