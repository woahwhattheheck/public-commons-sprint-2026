// MIT. One original-data Datasette adoption, edition and receiving programme.
// node datasette/acceptance.mjs --packet /private/original-carrier.json --directory /private/journey
import { readFile } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { privateDirectory, createFile, bytes, digest, readPrivate, stamp, fault } from '../postgres/publisher/files.mjs';
import { adoptDatasettePages, captureDatasette, inspectDatasetteOperation, readDatasetteCapture } from './capture.mjs';
import { reviewDatasetteCapture, createDatasetteEdition, readDatasetteEdition,
  compareDatasetteEditions, exportDatasetteEdition, receiveDatasettePackage } from './editions.mjs';

const EXPECTED_CARRIER = 'b903dd5d148cdcc6286481f8a1365755dcddb2481a6d76ac73929d8635cc2857';
const OPERATION = 'SCF-DATASETTE-SOURCE-EDITIONS-07476-20261012';
const requireValue = (condition, code) => { if (!condition) throw fault(code); };
function args(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!['--packet', '--directory'].includes(key) || !argv[index + 1] || Object.hasOwn(result, key.slice(2)))
      throw fault('DATASETTE_PROGRAMME_ARGUMENTS');
    result[key.slice(2)] = resolve(argv[index + 1]);
  }
  if (!result.packet || !result.directory) throw fault('DATASETTE_PROGRAMME_ARGUMENTS');
  return result;
}
async function execute({ packet: packetFile, directory }) {
  const startedAt = stamp();
  const raw = await readPrivate(packetFile, 16777216);
  requireValue(digest(raw) === EXPECTED_CARRIER, 'DATASETTE_ORIGINAL_CARRIER_CHANGED');
  const packet = JSON.parse(raw), members = new Map();
  requireValue(packet.schema === 'commons.source-carrier/v1' && packet.operation_id === OPERATION &&
    Array.isArray(packet.files), 'DATASETTE_ORIGINAL_CARRIER_INVALID');
  for (const member of packet.files) {
    requireValue(typeof member.path === 'string' && !members.has(member.path) &&
      typeof member.content === 'string', 'DATASETTE_CARRIER_MEMBER_INVALID');
    const content = Buffer.from(member.content, 'utf8');
    requireValue(content.length === member.bytes && digest(content) === member.sha256, 'DATASETTE_CARRIER_MEMBER_CHANGED');
    members.set(member.path, { ...member, raw: content });
  }
  const manifestFile = members.get(packet.manifest);
  requireValue(!!manifestFile, 'DATASETTE_ORIGINAL_MANIFEST_MISSING');
  const original = JSON.parse(manifestFile.content);
  const reference = role => {
    const entry = original.references.find(item => item.role === role);
    const member = entry && members.get(entry.file);
    requireValue(!!member && member.sha256 === entry.sha256 && member.bytes === entry.bytes,
      'DATASETTE_ORIGINAL_REFERENCE_CHANGED');
    return { ...entry, body: member.content };
  };
  const schema = reference('ordered_columns_native_schema_and_selected_count');
  const publisher = reference('original_publisher_attribution_license_and_database_metadata');
  const selection = {
    url: original.source.url, kind: 'table', database: original.source.database, table: original.source.table,
    columns: original.columns, continuation: 'next_url',
    columnSource: { ...schema, kind: 'retained-original-datasette-metadata' },
    metadata: { title: original.source.title, publisher: original.source.publisher, license: original.source.license,
      licenseUrl: original.source.license_url, deploymentVersion: original.source.deployment_version,
      versionEvidence: original.source.version_evidence, publisherMetadata: publisher,
      originalManifest: { file: manifestFile.path, sha256: manifestFile.sha256, bytes: manifestFile.bytes,
        body: manifestFile.content } },
  };
  const pages = original.pages.map(receipt => {
    const member = members.get(receipt.file);
    requireValue(!!member && member.sha256 === receipt.sha256 && member.bytes === receipt.bytes,
      'DATASETTE_ORIGINAL_RESPONSE_CHANGED');
    return { ...receipt, body: member.raw, originalReceipt: receipt };
  });
  await privateDirectory(directory, true);
  const captureDirectory = join(directory, 'capture');
  const editionDirectory = join(directory, 'editions', 'wri-geothermal');
  const receiveDirectory = join(directory, 'received', 'wri-geothermal');
  const partial = await adoptDatasettePages({ directory: captureDirectory, operationId: OPERATION, selection, pages: pages.slice(0, 2) });
  requireValue(partial.state === 'INCOMPLETE' && partial.pageCount === 2 && partial.rowCount === 100,
    'DATASETTE_PARTIAL_ADOPTION_DID_NOT_COMMIT');
  const reopenedPartial = await inspectDatasetteOperation(captureDirectory);
  requireValue(reopenedPartial.rowCount === partial.rowCount && reopenedPartial.pageCount === partial.pageCount &&
    reopenedPartial.nextUrl === partial.nextUrl, 'DATASETTE_ORIGINAL_CURSOR_DID_NOT_REOPEN');
  const resumed = await adoptDatasettePages({ directory: captureDirectory, operationId: OPERATION, selection, pages });
  requireValue(resumed.state === 'COMPLETE' && resumed.rowCount === 189 && resumed.pageCount === 4,
    'DATASETTE_FULL_SOURCE_ADOPTION_INCOMPLETE');
  const reopened = await captureDatasette({ directory: captureDirectory, operationId: OPERATION, selection,
    fetchImpl: async () => { throw fault('DATASETTE_COMPLETED_OPERATION_REPEATED_GET'); } });
  requireValue(reopened.captureSha256 === resumed.captureSha256, 'DATASETTE_OPERATION_IDENTITY_CHANGED');
  const capture = await readDatasetteCapture(resumed.captureFile, { expectedSha256: resumed.captureSha256 });
  requireValue(capture.columns.length === 26 && capture.pages.every((page, index) =>
    page.body.sha256 === original.pages[index].sha256 && page.status === original.pages[index].status &&
    page.requestedUrl === original.pages[index].requested_url && page.responseUrl === original.pages[index].final_url),
    'DATASETTE_ORIGINAL_RESPONSE_BINDING_CHANGED');
  const profile = await reviewDatasetteCapture(capture.captureFile, { key: ['gppd_idnr'] });
  requireValue(profile.key.unique && profile.key.distinctValues === 189 && profile.key.missingRows === 0 &&
    profile.key.blankRows === 0 && profile.key.duplicateRows === 0, 'DATASETTE_SOURCE_KEY_REVIEW_FAILED');
  const review = await reviewDatasetteCapture(capture.captureFile, {
    key: ['gppd_idnr'], projection: profile.suggestedProjection,
  });
  requireValue(Object.keys(review.projection).length === 26, 'DATASETTE_FULL_PROJECTION_REQUIRED');
  const edition = await createDatasetteEdition({ captureFile: capture.captureFile, directory: editionDirectory,
    name: 'WRI geothermal retained source 2026-10-12', review, operationId: OPERATION + '-edition' });
  const reopenedEdition = await readDatasetteEdition(edition.editionFile, { expectedSha256: edition.editionSha256 });
  requireValue(reopenedEdition.captureSha256 === capture.captureSha256, 'DATASETTE_EDITION_SOURCE_CHANGED');
  const archive = await exportDatasetteEdition({ editionFile: edition.editionFile, outputFile: join(directory, 'wri-geothermal.sfds.gz') });
  const exportReplay = await exportDatasetteEdition({ editionFile: edition.editionFile, outputFile: archive.archiveFile });
  requireValue(exportReplay.reused === true && exportReplay.sha256 === archive.sha256,
    'DATASETTE_EXPORT_REPLAY_CHANGED');
  const received = await receiveDatasettePackage({ archiveFile: archive.archiveFile, directory: receiveDirectory, sha256: archive.sha256 });
  const receiveReplay = await receiveDatasettePackage({ archiveFile: archive.archiveFile, directory: receiveDirectory, sha256: archive.sha256 });
  requireValue(receiveReplay.reused === true && receiveReplay.editionSha256 === received.editionSha256 &&
    receiveReplay.captureSha256 === received.captureSha256 && receiveReplay.archiveSha256 === archive.sha256,
    'DATASETTE_RECEIVE_REPLAY_CHANGED');
  const reopenedReceived = await readDatasetteEdition(received.editionFile, { expectedSha256: edition.editionSha256 });
  requireValue(reopenedReceived.captureSha256 === capture.captureSha256 &&
    reopenedReceived.editionSha256 === edition.editionSha256, 'DATASETTE_RECEIVED_IDENTITIES_CHANGED');
  const comparison = await compareDatasetteEditions(edition.editionFile, reopenedReceived.editionFile);
  requireValue(comparison.sourceValuesUnchanged && comparison.httpBodiesUnchanged && comparison.unchangedRows === 189 &&
    comparison.addedRows === 0 && comparison.removedRows === 0 && comparison.changedRows === 0,
    'DATASETTE_RECEIVED_SOURCE_COMPARISON_CHANGED');
  const sourceFiles = ['json.mjs', 'capture.mjs', 'editions.mjs', 'acceptance.mjs'];
  const code = [];
  for (const file of sourceFiles) {
    const content = await readFile(new URL('./' + file, import.meta.url));
    code.push({ file: 'datasette/' + file, sha256: digest(content), bytes: content.length });
  }
  const report = {
    schema: 'stellar-forge.datasette-original-data-programme.v1', operationId: OPERATION,
    state: 'COMPLETE', startedAt, completedAt: stamp(), originalCarrierSha256: EXPECTED_CARRIER,
    sourceFiles: code,
    adoption: { originalPages: pages.length, originalColumns: capture.columns.length,
      committedPartial: { pageCount: partial.pageCount, rowCount: partial.rowCount, nextUrl: partial.nextUrl },
      reopenedPartial: { pageCount: reopenedPartial.pageCount, rowCount: reopenedPartial.rowCount, nextUrl: reopenedPartial.nextUrl },
      complete: { pageCount: capture.pages.length, rowCount: capture.rows.length, captureSha256: capture.captureSha256 },
      originalResponseHashes: capture.pages.map(page => page.body.sha256),
      originalResponseStatuses: capture.pages.map(page => page.status),
      receiptKinds: capture.pages.map(page => page.acquisition),
      originalRequestedUrls: capture.pages.map(page => page.requestedUrl),
      originalFinalUrls: capture.pages.map(page => page.responseUrl),
      observationWindow: capture.capture.observationWindow,
      page2RedirectObservation: capture.pages[1].redirectObservability,
      completeOperationReopenSha256: reopened.captureSha256 },
    review: { digest: review.digest, rowCount: review.rowCount, key: review.key, columnCount: review.columnTypes.length,
      columns: review.columns.map(column => ({ name: column.name, types: column.types,
        nullCount: column.nullCount, emptyStringCount: column.emptyStringCount,
        suggestedType: column.suggestedType, suggestedRepresentation: column.suggestedRepresentation })) },
    edition: { name: edition.edition.name, editionSha256: edition.editionSha256,
      captureSha256: edition.captureSha256, reviewDigest: edition.review.digest },
    export: { sha256: archive.sha256, bytes: archive.bytes, files: archive.files, totalBytes: archive.totalBytes,
      file: basename(archive.archiveFile), replayReused: exportReplay.reused, replaySha256: exportReplay.sha256 },
    receiving: { editionSha256: reopenedReceived.editionSha256, captureSha256: reopenedReceived.captureSha256,
      directory: 'received/wri-geothermal', files: received.files, replayReused: receiveReplay.reused,
      replayEditionSha256: receiveReplay.editionSha256, replayCaptureSha256: receiveReplay.captureSha256 },
    comparison: { ...comparison, relationship: 'original-edition-and-received-reopened-edition' },
    sourceContext: { publisher: original.source.publisher, license: original.source.license,
      historicalAttributes: true, deploymentVersion: original.source.deployment_version,
      sourceUrl: original.source.url },
  };
  await createFile(join(directory, 'programme-result.json'), bytes(report));
  await createFile(join(directory, 'received-comparison.json'), bytes(comparison));
  const archiveRaw = await readPrivate(archive.archiveFile, 536870912);
  return { schema: 'stellar-forge.datasette-programme-output.v1', report,
    archive: { file: basename(archive.archiveFile), bytes: archiveRaw.length, sha256: digest(archiveRaw),
      base64: archiveRaw.toString('base64') } };
}
try {
  const output = await execute(args(process.argv.slice(2)));
  process.stdout.write(JSON.stringify(output) + '\n');
} catch (issue) {
  process.stderr.write(JSON.stringify({ code: issue.code ?? 'DATASETTE_PROGRAMME_FAILED', message: issue.message,
    stack: issue.stack }) + '\n');
  process.exitCode = 1;
}
