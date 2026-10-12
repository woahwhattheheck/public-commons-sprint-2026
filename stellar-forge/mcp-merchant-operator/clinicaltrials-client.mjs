// MIT. ClinicalTrials customer control and complete retained files over the original MCP transport.
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { clinicalTrialsWorkspaceTools, validateClinicalTrialsArguments, parseClinicalTrialsExport,
  CLINICALTRIALS_MANIFEST, CLINICALTRIALS_MAX_JSON_BYTES } from './clinicaltrials-workspace.mjs';
import { openMerchantFileClient, createRetainedDownload } from './retained-download.mjs';

const PREFIX = 'merchant_clinicaltrials_';
const fail = (code, message) => Object.assign(new Error(message), { code });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const clinicalTrialsActions = Object.freeze(Object.fromEntries(clinicalTrialsWorkspaceTools(
  (name, description, properties, required, annotations = {}) =>
    ({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false }, annotations }))
  .map(definition => [definition.name.slice(PREFIX.length), definition])));

export async function openClinicalTrialsClient(options = {}) {
  const original = await openMerchantFileClient({ ...options, errorPrefix: 'CLINICALTRIALS',
    // The native JSON appears as structuredContent and as JSON-escaped text.
    // Keep every original field while bounding both complete representations.
    maximumResponseBytes: 3 * CLINICALTRIALS_MAX_JSON_BYTES + 65536,
    clientName: 'starforge-clinicaltrials-operator' });
  const call = async (action, args = {}, requestOptions) => {
    if (typeof action !== 'string') throw fail('INVALID_PARAMS', 'Choose an action from clinicaltrials tools.');
    const name = action.startsWith(PREFIX) ? action : PREFIX + action;
    validateClinicalTrialsArguments(name, args);
    return original.call(name, args, requestOptions);
  };
  const named = Object.fromEntries(Object.keys(clinicalTrialsActions).map(action =>
    [action.replace(/_([a-z])/g, (_,letter) => letter.toUpperCase()), (args = {}, requestOptions) => call(action, args, requestOptions)]));
  return Object.freeze({ endpoint: original.endpoint, call, ...named });
}

const downloads = createRetainedDownload({
  manifestName: CLINICALTRIALS_MANIFEST, parseManifest: parseClinicalTrialsExport,
  maximumBytes: 256_000_000,
  stateSchema: 'stellar-forge.clinicaltrials-download.v1',
  resultSchema: 'stellar-forge.clinicaltrials-download-result.v1',
  toolPrefix: PREFIX.slice(0, -1), errorPrefix: 'CLINICALTRIALS',
  clientName: 'starforge-clinicaltrials-download',
  describe: manifest => ({ workspace: manifest.workspace, revision: manifest.revision,
    revisionAfter: manifest.revisionAfter, original: manifest.source })
});
export const downloadClinicalTrialsExport = downloads.download;
export const inspectClinicalTrialsExport = downloads.inspect;

/** Reopens the original completed receiving directory under its existing download lease. */
export async function reopenClinicalTrialsExport({ directory, exportId, expectedManifestSha256 } = {}) {
  if (typeof directory !== 'string' || !directory || directory.includes('\0') ||
      !/^[0-9a-f]{64}$/.test(exportId ?? '') ||
      expectedManifestSha256 !== undefined && !/^[0-9a-f]{64}$/.test(expectedManifestSha256))
    throw fail('CLINICALTRIALS_DOWNLOAD_CONFIGURATION', 'Select the original private receiving directory, export ID and optional reviewed manifest SHA256.');
  const root = resolve(directory);
  const manifestBytes = await downloads.bytesAt(join(root, CLINICALTRIALS_MANIFEST), 65_000);
  const manifestSha256 = sha(manifestBytes), manifest = parseClinicalTrialsExport(manifestBytes, exportId);
  if (expectedManifestSha256 !== undefined && expectedManifestSha256 !== manifestSha256)
    throw fail('CLINICALTRIALS_DOWNLOAD_EXPORT_CHANGED', 'The completed original manifest differs from its reviewed SHA256.');
  return downloads.lockedDownload(root, async context => {
    await downloads.loadContext(context, manifestBytes, exportId);
    for (const file of manifest.files) {
      context.lease.assertHeld();
      await downloads.verifiedFile(join(root, file.name), file);
    }
    return { schema: 'stellar-forge.clinicaltrials-download-result.v1', state: 'REOPENED',
      directory: root, exportId, workspace: manifest.workspace, revision: manifest.revision,
      revisionAfter: manifest.revisionAfter, original: manifest.source, manifestSha256,
      files: manifest.files.length, bytes: manifest.files.reduce((sum,file) => sum + file.bytes, 0),
      verifiedFiles: manifest.files };
  });
}
