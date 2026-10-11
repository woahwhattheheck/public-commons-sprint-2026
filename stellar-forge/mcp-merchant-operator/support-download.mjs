// MIT. Original support transfer adapter and native saved-case reopening.
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { realpath } from 'node:fs/promises';
import { createRetainedDownload } from './retained-download.mjs';
import { parseSupportExportManifest } from './support.mjs';
import { failure, privateSupportDirectory } from './config.mjs';
import { importRuntimeHandoff, MAX_HANDOFF_BYTES } from '../../stellar/scf-starforge-20261009/sf74-merchant-support-console/runtime-support.mjs';
import { openCaseStore, caseMetadata } from '../../stellar/scf-starforge-20261009/sf74-merchant-support-console/case-store.mjs';
export { openMerchantFileClient } from './retained-download.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const validReadId = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const transfer = createRetainedDownload({ manifestName: 'support-export.json', parseManifest: parseSupportExportManifest,
  maximumBytes: MAX_HANDOFF_BYTES, stateSchema: 'stellar-forge.merchant-support-download.v1',
  resultSchema: 'stellar-forge.merchant-support-download-result.v1', toolPrefix: 'merchant_support_export',
  errorPrefix: 'SUPPORT', clientName: 'starforge-support-download', describe: manifest => ({ case: manifest.case }) });
const { lockedDownload, loadContext, bytesAt, verifiedFile, checkpoint } = transfer;
export const downloadSupportExport = transfer.download;
export const inspectSupportExport = transfer.inspect;

/** Offline continuation through the original SF74 importer and its versioned store. */
export async function reopenDownloadedSupportExport({ directory, casesDirectory } = {}) {
  if (typeof casesDirectory !== 'string' || !casesDirectory || casesDirectory.includes('\0'))
    throw failure('SUPPORT_DOWNLOAD_CONFIGURATION', 'Supply the original private case directory.');
  const cases = await realpath(await privateSupportDirectory(resolve(casesDirectory)));
  return lockedDownload(directory, async context => {
    const bytes = await bytesAt(join(context.root, 'support-export.json'), 65000);
    let exportId; try { exportId = JSON.parse(decode(bytes)).exportId; } catch { throw failure('SUPPORT_EXPORT_INVALID', 'Open a completed original support export.'); }
    await loadContext(context, bytes, exportId);
    for (const file of context.manifest.files) await verifiedFile(join(context.root, file.name), file);
    const source = JSON.parse(decode(await bytesAt(join(context.root, 'case.json'), MAX_HANDOFF_BYTES)));
    let original = { workspaceText: decode(await bytesAt(join(context.root, 'merchant-workspace.json'), MAX_HANDOFF_BYTES)), supportText: null, metadata: caseMetadata(source.metadata) };
    if (context.manifest.case.supportSha256 !== null)
      original = await importRuntimeHandoff(decode(await bytesAt(join(context.root, 'merchant-support.json'), MAX_HANDOFF_BYTES)));
    if (sha(original.workspaceText) !== context.manifest.case.workspaceSha256 ||
        (original.supportText === null ? null : sha(original.supportText)) !== context.manifest.case.supportSha256)
      throw failure('SUPPORT_DOWNLOAD_EXPORT_CHANGED', 'The original case inputs disagree with the downloaded completion manifest.');
    const bound = context.state.localCase;
    if (bound && (bound.directory !== cases || !validReadId(bound.id)))
      throw failure('SUPPORT_DOWNLOAD_CASE_CONFLICT', 'This download already reopens in a different local case directory. Use its retained original case.');
    if (!bound) { context.state.localCase = { directory: cases, id: randomUUID(), revision: null }; await checkpoint(context); }
    const local = context.state.localCase, store = await openCaseStore(cases);
    if (!local.revision) {
      let existing;
      try { existing = await store.read(local.id); } catch (error) { if (error.code !== 'CASE_NOT_FOUND') throw error; }
      if (existing) {
        // A save may have completed before its download checkpoint, followed by
        // a legitimate local edit. Recover the original first revision without
        // replaying the save over the current head or discarding the edit.
        let before = null, initial = null; const seen = new Set();
        do {
          const page = await store.history(local.id, { before, limit: 100 });
          for (const row of page.revisions) {
            if (seen.has(row.revision)) throw failure('SUPPORT_DOWNLOAD_CASE_CONFLICT', 'The retained local case history contains a cycle.');
            seen.add(row.revision);
            if (row.previousRevision === null) initial = row;
          }
          before = page.nextBefore;
        } while (before);
        if (!initial) throw failure('SUPPORT_DOWNLOAD_CASE_CONFLICT', 'The original imported case revision is absent from local history.');
        const first = await store.read(local.id, initial.revision);
        if (sha(first.workspaceText) !== context.manifest.case.workspaceSha256 ||
            (first.supportText === null ? null : sha(first.supportText)) !== context.manifest.case.supportSha256 ||
            JSON.stringify(caseMetadata(first.metadata)) !== JSON.stringify(caseMetadata(original.metadata)))
          throw failure('SUPPORT_DOWNLOAD_CASE_CONFLICT', 'The first local case revision differs from this downloaded original handoff.');
        local.revision = initial.revision;
      } else {
        const saved = await store.save({ id: local.id, expectedRevision: null, ...original, metadata: caseMetadata(original.metadata) });
        local.revision = saved.case.revision;
      }
      await checkpoint(context);
    }
    const reopened = await store.read(local.id);
    return { schema: 'stellar-forge.merchant-support-reopened.v1', exportId, sourceCase: context.manifest.case,
      case: { id: reopened.id, revision: reopened.revision, importedRevision: local.revision, directory: cases },
      manifestSha256: context.manifestSha256, state: 'REOPENED' };
  });
}
