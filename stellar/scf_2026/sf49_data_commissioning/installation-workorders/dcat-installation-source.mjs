// MIT. Original complete archive inspection and verified retained member access.
import { constants } from 'node:fs';
import { open, lstat, realpath } from 'node:fs/promises';
import { join, resolve, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { inspectCkanWorkspaceArchive, receiveCkanWorkspaceArchive }
  from '../../../scf-starforge-20261009/sf30-seller-sdk/ckan/archive.mjs';
import { validateDcatWorkspaceFiles } from '../../../scf-starforge-20261009/sf30-seller-sdk/ckan/dcat-workspace.mjs';
import { validateDcatCorrectionFiles } from '../../../scf-starforge-20261009/sf30-seller-sdk/ckan/dcat-corrections.mjs';
import { readJson, privateDirectory, acquireWorkspace } from '../../../scf-starforge-20261009/sf30-seller-sdk/postgres/publisher/files.mjs';
import { projectDcatInstallationSource, validateDcatInstallationSource, dcatInstallationNeed as need }
  from './dcat-installation-core.mjs';
export const DCAT_INSTALLATION_MAX_ARCHIVE = 128 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const aborted = signal => { if (signal?.aborted) { const error = new Error('The source inspection was interrupted. Resume the same retained input.');
  error.code = 'DCAT_INSTALLATION_INTERRUPTED'; throw error; } };
function privateStat(stat, maximum) {
  need(stat.isFile() && stat.nlink === 1 && !(stat.mode & 0o077) &&
    Number.isSafeInteger(stat.size) && stat.size >= 0 && stat.size <= maximum,
    'Use a complete private regular file within the selected source allowance.');
}
function unchanged(a,b) { return a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
  a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && b.nlink === 1; }
/** directory is the service's original-receiver subtree; this module creates no request registry. */
export async function inspectDcatInstallationArchive({ archivePath, expectedArchiveSha256, directory, signal, onProgress } = {}) {
  need(HASH.test(expectedArchiveSha256 ?? '') && typeof directory === 'string' &&
    typeof archivePath === 'string', 'Supply the complete archive SHA-256 and private original receiving directory.');
  archivePath = resolve(archivePath); directory = resolve(directory); aborted(signal);
  privateStat(await lstat(archivePath), DCAT_INSTALLATION_MAX_ARCHIVE);
  let workbench, chunks = [], count = 0;
  const archive = await inspectCkanWorkspaceArchive({ file: archivePath, expectedSha256: expectedArchiveSha256,
    signal, onProgress, async openMember(member) {
      if (member.path !== 'workbench.json') return null;
      need(member.bytes <= 16777216, 'The original workbench exceeds its maintained source bound.');
      return { async write(part) { count += part.length; need(count <= member.bytes, 'The original workbench bytes differ.'); chunks.push(Buffer.from(part)); },
        async complete() {
          const raw = Buffer.concat(chunks); chunks = [];
          workbench = JSON.parse(new TextDecoder('utf-8', { fatal:true }).decode(raw));
        }, async close() { chunks = []; } };
    } });
  need(workbench, 'The complete original archive must retain workbench.json.');
  const received = await receiveCkanWorkspaceArchive({ file: archivePath, expectedSha256: expectedArchiveSha256,
    directory, signal, onProgress });
  need(received.state === 'COMPLETE' && received.archiveSha256 === archive.sha256 &&
    received.manifestSha256 === archive.manifestSha256, 'Resume the complete original workspace receive.');
  const release = await acquireWorkspace(directory);
  try {
    const current = await readJson(join(directory,'workbench.json'),16777216);
    need(current.createdAt === workbench.createdAt && current.catalogOrigin === workbench.catalogOrigin &&
      current.operation?.state !== 'RUNNING', 'The receiving subtree now holds another or active project.');
    // Revalidate against the selected original archive state on reuse, so later
    // receiver edits cannot replace the authority of this immutable source edition.
    await validateDcatWorkspaceFiles(directory, workbench.dcat);
    await validateDcatCorrectionFiles(directory, workbench.dcat);
    aborted(signal);
  } finally { await release(); }
  return projectDcatInstallationSource({ archive, workbench });
}
/** Return an original member from the maintained receiver, including its saved pre-relocation bytes. */
export async function dcatInstallationMember({ directory, source, path, signal } = {}) {
  validateDcatInstallationSource(source); need(typeof directory === 'string' && typeof path === 'string',
    'Select a complete retained member.');
  const member = source.manifest.files.find(file => file.path === path);
  need(member, 'The requested file is not in this complete source archive.', 'DCAT_INSTALLATION_MEMBER_NOT_FOUND');
  directory = resolve(directory); await privateDirectory(directory);
  const received = await readJson(join(directory,'.ckan-receive.json'),33554432);
  need(received.state === 'COMPLETE' && received.archiveSha256 === source.archive.sha256 &&
    received.manifestSha256 === source.manifestSha256 && received.directory === directory,
    'The source receiving directory differs from the complete retained archive.');
  const mutable = path === 'workbench.json' || path === 'sources/source-locations.json' ||
    /^publications\/[^/]+\/workspace\.json$/.test(path);
  let file = join(directory,path);
  if (mutable) {
    const prior = join(directory,'transfers',source.archive.sha256,'original',path);
    try { await lstat(prior); file = prior; } catch(error) { if(error.code !== 'ENOENT') throw error; }
  }
  const actual = await realpath(file), root = await realpath(directory), rel = relative(root,actual);
  need(actual === file && rel !== '..' && !rel.startsWith('..'+sep), 'Use only the original private receiver member.');
  const handle = await open(file,constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat(); privateStat(before,member.bytes);
    need(before.size === member.bytes, 'The retained member length differs.');
    const hash = createHash('sha256'), part = Buffer.alloc(1048576); let offset = 0;
    while(offset < before.size) {
      aborted(signal); const result = await handle.read(part,0,Math.min(part.length,before.size-offset),offset);
      need(result.bytesRead > 0,'The retained original member is incomplete.');
      offset += result.bytesRead; hash.update(part.subarray(0,result.bytesRead));
    }
    need(hash.digest('hex') === member.sha256 && unchanged(before,await handle.stat()),
      'The complete retained member differs from its original archive.');
  } finally { await handle.close(); }
  const mediaType = /\.jsonl$/.test(path) ? 'application/x-ndjson' : /\.json$/.test(path) ?
    'application/json' : /\.html$/.test(path) ? 'text/html' : /\.ttl$/.test(path) ? 'text/turtle' :
    /\.nt$/.test(path) ? 'application/n-triples' : 'application/octet-stream';
  return { path:file, bytes:member.bytes, sha256:member.sha256, mediaType };
}
