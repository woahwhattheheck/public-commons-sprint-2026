import {lstat, realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
import {IntakeError, need, id, hash} from './contract.mjs';

// A committed export is historical. Availability is a new read of its exact
// retained files, never permission to regenerate them from current database rows.
export async function inspectCommittedOutput({kind, projectId, operationId, requestSha256,
  directory, manifestFile}, openOutput) {
  need(kind === 'receiving' || kind === 'backup', 'POSTGIS_COMMITTED_EXPORT_KIND_INVALID');
  id(projectId); id(operationId); hash(requestSha256);
  need(typeof directory === 'string' && directory.length && resolve(directory) === directory &&
    manifestFile && manifestFile.path === (kind === 'receiving' ? 'postgis-receiving.json' : 'postgis-backup.json') &&
    Number.isSafeInteger(manifestFile.bytes) && manifestFile.bytes >= 0,
    'POSTGIS_COMMITTED_EXPORT_RECORD_INVALID');
  hash(manifestFile.sha256);
  const result = {kind, state: 'unavailable', directory, expectedManifest: manifestFile,
    manifestFile: null, issue: null};
  try {
    // Do not recreate an absent original destination during read-only recovery.
    const before = await lstat(directory);
    need(before.isDirectory() && !before.isSymbolicLink() &&
      await realpath(directory) === directory, 'POSTGIS_ORIGINAL_EXPORT_DIRECTORY_CHANGED');
    const opened = await openOutput(directory, manifestFile.sha256);
    need(opened.manifest.operationId === operationId && opened.manifest.projectId === projectId &&
      opened.manifest.requestSha256 === requestSha256 &&
      opened.manifestFile.path === manifestFile.path && opened.manifestFile.bytes === manifestFile.bytes &&
      opened.manifestFile.sha256 === manifestFile.sha256,
      'POSTGIS_COMMITTED_EXPORT_IDENTITY_CHANGED');
    const after = await lstat(directory);
    need(before.dev === after.dev && before.ino === after.ino && after.isDirectory() &&
      !after.isSymbolicLink() && await realpath(directory) === directory,
      'POSTGIS_ORIGINAL_EXPORT_DIRECTORY_CHANGED');
    return {...result, state: 'available', manifestFile: opened.manifestFile};
  } catch (error) {
    return {...result, issue: {code: error.code || 'POSTGIS_EXPORT_READ_FAILED',
      message: error.code === 'ENOENT' ? 'A file in this original committed export is missing.' :
        error.code?.startsWith('POSTGIS_') ? error.message :
          'The original committed export could not be verified.'}};
  }
}

export function requireAvailableOutput(artifact, operationId) {
  if (artifact.state !== 'available') {
    const error = new IntakeError('POSTGIS_COMMITTED_EXPORT_UNAVAILABLE', artifact);
    error.operationId = operationId;
    error.postgisCommitOutcome = 'committed-output-unavailable';
    throw error;
  }
  return artifact;
}
