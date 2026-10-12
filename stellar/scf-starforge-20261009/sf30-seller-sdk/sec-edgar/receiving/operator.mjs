// MIT. Whole saved SEC workspaces over original immutable files and source archives.
import { readdir, lstat, mkdir, rename } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { openEdgarStore } from '../source.mjs';
import { WORKSPACE_SCHEMA } from '../workspace.mjs';
import { compileEdgarMerchant } from '../config.mjs';
import {
  OPERATOR_ARCHIVE_SCHEMA, MAX_MANIFEST_BYTES, MAX_MEMBERS, need, digest, encoded,
  same, revisionName, validateOperatorManifest, portableSummary,
} from './manifest.mjs';
import {
  absolute, privateDirectory, exists, syncDirectory, realDirectory, pinnedFile,
  exactFile, selectedPath, decodeJson, linkExactOriginal,
} from './storage.mjs';
import { nativeArchive } from './archive.mjs';

const VERSION = /^\d{12}\.json$/;
const requestName = 'operator-export-request.json';
async function existingDirectory(value) {
  const path = absolute(value), info = await lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink(), 'EDGAR_PORTABLE_DIRECTORY_REQUIRED');
  return path;
}
async function ensureParent(value) {
  const path = absolute(value);
  await mkdir(path, { recursive: true, mode: 0o700 });
  return existingDirectory(path);
}
const versionsAt = async directory => (await readdir(join(directory, 'versions'))).filter(name => VERSION.test(name)).sort();

/** Read every saved revision and every imported edition through the native engine. */
export async function reviewEdgarOperator({ directory, storeDirectory, expectedRevision } = {}) {
  directory = await existingDirectory(directory);
  storeDirectory = await existingDirectory(storeDirectory);
  await existingDirectory(join(directory, 'versions'));
  await existingDirectory(join(storeDirectory, 'editions'));
  await existingDirectory(join(storeDirectory, 'blobs'));
  const names = await versionsAt(directory);
  need(names.length > 0 && names.length < MAX_MEMBERS, 'EDGAR_PORTABLE_HISTORY_REQUIRED',
    'Open the original saved SEC workspace before preparing its complete handover.');
  for (const [index, name] of names.entries())
    need(name === revisionName(index), 'EDGAR_PORTABLE_HISTORY_GAP', 'The original revision history must be complete from revision zero.');
  const lastRevision = names.length - 1;
  if (expectedRevision !== undefined)
    need(expectedRevision === lastRevision, 'EDGAR_PORTABLE_REVIEW_CHANGED', 'Review the current saved revision before exporting.');
  const source = await openEdgarStore(storeDirectory), entries = new Map();
  const add = async (path, original, maximum) => {
    const file = await pinnedFile(original, null, maximum);
    entries.set(path, { path, original, bytes: file.bytes.length.toString(), sha256: file.sha256 });
    return file.bytes;
  };
  let first, current;
  const queries = new Set();
  try {
    const selectedEditions = await source.listEditions();
    const editions = [], byEdition = new Map();
    for (const selected of selectedEditions) {
      const { record } = await source.getEdition(selected.id);
      need(same(record, selected), 'EDGAR_PORTABLE_REVIEW_CHANGED');
      const recordBytes = await add('source-store/editions/' + record.id + '.json',
        join(storeDirectory, 'editions', record.id + '.json'), 1024 * 1024);
      need(same(decodeJson(recordBytes), record), 'EDGAR_PORTABLE_REVIEW_CHANGED');
      const path = 'source-store/blobs/' + record.sourceSha256 + '.json';
      if (!entries.has(path)) {
        const raw = await add(path, join(storeDirectory, 'blobs', record.sourceSha256 + '.json'));
        need(digest(raw) === record.sourceSha256 && raw.length === record.sourceBytes,
          'EDGAR_PORTABLE_SOURCE_BINDING_INVALID');
      }
      editions.push(record);
      byEdition.set(record.id, record);
    }
    for (const [revision, name] of names.entries()) {
      const bytes = await add('workspace/versions/' + name, join(directory, 'versions', name), 8 * 1024 * 1024);
      const state = decodeJson(bytes);
      need(state.schema === WORKSPACE_SCHEMA && state.revision === revision,
        'EDGAR_PORTABLE_HISTORY_INVALID');
      first ??= state;
      need(state.workspaceId === first.workspaceId && state.createdAt === first.createdAt,
        'EDGAR_PORTABLE_WORKSPACE_CHANGED', 'All original revisions must belong to the same workspace.');
      if (state.config === null) {
        need(state.configSha256 === null && revision === 0, 'EDGAR_PORTABLE_HISTORY_INVALID');
      } else {
        need(state.configSha256 === digest(JSON.stringify(state.config)), 'EDGAR_PORTABLE_CONFIG_CHANGED');
        const compiled = compileEdgarMerchant(state.config);
        if (!queries.has(compiled.inputSha256)) {
          for (const product of compiled.products) {
            const edition = byEdition.get(product.editionId);
            need(edition && edition.kind === product.kind && edition.cik === product.cik &&
              edition.sourceSha256 === product.sourceSha256, 'EDGAR_PORTABLE_PRODUCT_SOURCE_CHANGED');
            await source.query(product.editionId, product, product.example);
          }
          queries.add(compiled.inputSha256);
        }
      }
      current = state;
    }
    need(same(await versionsAt(directory), names) &&
      same((await source.listEditions()).map(row => row.id), selectedEditions.map(row => row.id)),
    'EDGAR_PORTABLE_REVIEW_CHANGED', 'Saved work changed during the review. Review the current complete workspace.');
    const files = [...entries.values()].sort((a, b) => a.path.localeCompare(b.path));
    const manifest = validateOperatorManifest({
      schema: OPERATOR_ARCHIVE_SCHEMA,
      workspace: {
        workspaceId: first.workspaceId, createdAt: first.createdAt, revision: current.revision,
        configSha256: current.configSha256,
        initialRevisionSha256: entries.get('workspace/versions/' + revisionName(0)).sha256,
        revisionSha256: entries.get('workspace/versions/' + revisionName(current.revision)).sha256,
      },
      editions: editions.sort((a, b) => a.id.localeCompare(b.id)),
      files: files.map(({ original, ...file }) => file),
    });
    return { manifest, entries: files, summary: portableSummary(manifest) };
  } finally { await source.close(); }
}

function inputPaths(input) {
  return { directory: absolute(input.directory), storeDirectory: absolute(input.storeDirectory) };
}
function sourcePath(paths, file) {
  if (file.path.startsWith('workspace/')) return selectedPath(paths.directory, file.path.slice('workspace/'.length));
  need(file.path.startsWith('source-store/'), 'EDGAR_PORTABLE_PATH_INVALID');
  return selectedPath(paths.storeDirectory, file.path.slice('source-store/'.length));
}

/** Freeze one complete review; repeating it receives the same archive after a lost return. */
export async function exportEdgarOperator(input = {}) {
  const paths = inputPaths(input), out = await realDirectory(input.outputDirectory, { create: true });
  need(![paths.directory, paths.storeDirectory].includes(out), 'EDGAR_PORTABLE_OUTPUT_CONFLICT');
  need(/^[a-f0-9]{64}$/.test(input.expectedReviewSha256 ?? ''), 'EDGAR_PORTABLE_REVIEW_REQUIRED',
    'Choose the complete workspace review before saving its archive.');
  const marker = join(out, requestName);
  let manifest;
  if (await exists(marker)) {
    const retained = decodeJson((await pinnedFile(marker, null, MAX_MANIFEST_BYTES)).bytes);
    need(retained.schema === 'stellar-forge.sec-edgar-operator-export-request.v1' &&
      same(retained.source, paths) && retained.reviewSha256 === input.expectedReviewSha256,
    'EDGAR_PORTABLE_EXPORT_CONFLICT', 'This export name belongs to another saved selection.');
    manifest = validateOperatorManifest(retained.manifest);
    need(digest(encoded(manifest)) === retained.reviewSha256, 'EDGAR_PORTABLE_EXPORT_CONFLICT');
  } else {
    const review = await reviewEdgarOperator(paths);
    need(review.summary.reviewSha256 === input.expectedReviewSha256, 'EDGAR_PORTABLE_REVIEW_CHANGED',
      'Saved source or revisions changed. Review the complete current workspace.');
    manifest = review.manifest;
    await exactFile(marker, encoded({
      schema: 'stellar-forge.sec-edgar-operator-export-request.v1', source: paths,
      reviewSha256: review.summary.reviewSha256, manifest,
    }));
  }
  const source = await realDirectory(join(out, 'source'), { create: true });
  for (const file of manifest.files) {
    const target = selectedPath(source, file.path);
    if (await exists(target)) await pinnedFile(target, file);
    else await exactFile(target, (await pinnedFile(sourcePath(paths, file), file)).bytes);
  }
  await exactFile(join(out, 'workspace-manifest.json'), encoded(manifest));
  const archivePath = join(out, 'sec-edgar-workspace.zip');
  const result = await nativeArchive('archive', {
    source, destination: archivePath, manifest, inventory: manifest.files,
  }, input);
  const completed = {
    ...portableSummary(manifest), schema: 'stellar-forge.sec-edgar-operator-export.v1',
    archive: result.archive, members: result.members,
  };
  await exactFile(join(out, 'completed.json'), encoded(completed));
  return { ...completed, directory: out, archivePath, reused: result.reused === true };
}

export async function inspectEdgarOperatorArchive({ archivePath, expectedArchiveSha256, ...options } = {}) {
  archivePath = absolute(archivePath);
  const result = await nativeArchive('inspect', { archive: archivePath }, options);
  validateOperatorManifest(result.manifest);
  if (expectedArchiveSha256 !== undefined)
    need(/^[a-f0-9]{64}$/.test(expectedArchiveSha256) && result.archive.sha256 === expectedArchiveSha256,
      'EDGAR_PORTABLE_ARCHIVE_CHANGED');
  return { ...result, ...portableSummary(result.manifest), archivePath };
}

async function verifyIncoming(stage, manifest) {
  const review = await reviewEdgarOperator({
    directory: join(stage, 'workspace'), storeDirectory: join(stage, 'source-store'),
    expectedRevision: manifest.workspace.revision,
  });
  need(same(review.manifest, manifest), 'EDGAR_PORTABLE_RECEIVED_SELECTION_CHANGED');
  return review;
}

async function verifyExistingPrefix(destination, manifest) {
  for (const file of manifest.files) {
    const path = selectedPath(destination, file.path);
    if (await exists(path)) await pinnedFile(path, file);
  }
  const original = join(destination, 'workspace', 'versions', revisionName(0));
  need(await exists(original), 'EDGAR_PORTABLE_DESTINATION_NOT_SELECTED',
    'Choose a new receiving directory or the original received SEC workspace.');
  const current = await reviewEdgarOperator({
    directory: join(destination, 'workspace'), storeDirectory: join(destination, 'source-store'),
  });
  need(current.summary.workspaceId === manifest.workspace.workspaceId,
    'EDGAR_PORTABLE_WORKSPACE_CHANGED');
  return current;
}


async function verifySelectedPrefix(destination, manifest, current) {
  const selectedState = decodeJson((await pinnedFile(join(destination, 'workspace', 'versions',
    revisionName(manifest.workspace.revision)))).bytes);
  const selectedFiles = new Set(manifest.files.map(file => file.path));
  const selectedEditions = new Set(manifest.editions.map(edition => edition.id));
  const actual = {
    schema: OPERATOR_ARCHIVE_SCHEMA,
    workspace: {
      workspaceId: selectedState.workspaceId, createdAt: selectedState.createdAt,
      revision: selectedState.revision, configSha256: selectedState.configSha256,
      initialRevisionSha256: current.manifest.workspace.initialRevisionSha256,
      revisionSha256: current.manifest.files.find(file =>
        file.path === 'workspace/versions/' + revisionName(selectedState.revision)).sha256,
    },
    editions: current.manifest.editions.filter(edition => selectedEditions.has(edition.id)),
    files: current.manifest.files.filter(file => selectedFiles.has(file.path)),
  };
  need(same(actual, manifest), 'EDGAR_PORTABLE_RECEIVED_SELECTION_CHANGED');
}

/**
 * The archive is fully inspected and source-validated before the receiver is published.
 * Existing exact native history prefixes remain writable; later local revisions survive replay.
 */
export async function receiveEdgarOperator(input = {}) {
  const destination = absolute(input.directory);
  need(typeof input.expectedArchiveSha256 === 'string', 'EDGAR_PORTABLE_ARCHIVE_REVIEW_REQUIRED');
  const selected = await inspectEdgarOperatorArchive(input), manifest = selected.manifest;
  await ensureParent(dirname(destination));
  const stageId = digest(encoded({ destination, archive: selected.archive.sha256 }));
  const stage = join(dirname(destination), '.sec-edgar-receiving-' + stageId);
  let previous = null, reused = false;
  if (await exists(destination)) {
    const names = await readdir(await existingDirectory(destination));
    if (names.length) previous = await verifyExistingPrefix(destination, manifest);
  }
  if (previous) {
    let complete = true;
    for (const file of manifest.files) {
      if (!await exists(selectedPath(destination, file.path))) { complete = false; break; }
    }
    if (complete) {
      await verifySelectedPrefix(destination, manifest, previous);
      return receivedResult(destination, selected, previous, true);
    }
  }
  if (previous) {
    // The native archive stage shares existing immutable source inodes. This
    // retains its recovery metadata without another whole workspace copy or
    // deleting a stage that a concurrent identical receiver may be reading.
    await realDirectory(stage, { create: true });
    for (const file of manifest.files) {
      const original = selectedPath(destination, file.path);
      if (await exists(original))
        await linkExactOriginal(original, selectedPath(stage, file.path), file);
    }
  }
  const extracted = await nativeArchive('extract', { archive: selected.archivePath, destination: stage }, input);
  need(same(extracted.archive, selected.archive) && same(extracted.manifest, manifest),
    'EDGAR_PORTABLE_ARCHIVE_CHANGED', 'The archive changed after its complete inspection.');
  await verifyIncoming(stage, manifest);
  if (!previous) {
    try {
      await rename(stage, destination);
      await syncDirectory(dirname(destination));
    } catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
      previous = await verifyExistingPrefix(destination, manifest);
    }
  }
  if (previous) {
    // Recheck all overlapping originals before appending anything. Exclusive
    // writes also protect a native save that races this preflight.
    await verifyExistingPrefix(destination, manifest);
    for (const file of manifest.files) {
      const target = selectedPath(destination, file.path);
      if (await exists(target)) await pinnedFile(target, file);
      else await linkExactOriginal(selectedPath(stage, file.path), target, file);
    }
    reused = false;
  }
  const current = await reviewEdgarOperator({
    directory: join(destination, 'workspace'), storeDirectory: join(destination, 'source-store'),
  });
  for (const file of manifest.files) await pinnedFile(selectedPath(destination, file.path), file);
  return receivedResult(destination, selected, current, reused);
}

async function receivedResult(destination, selected, current, reused) {
  const receipt = {
    schema: 'stellar-forge.sec-edgar-operator-received.v1', archive: selected.archive,
    reviewSha256: selected.reviewSha256, workspaceId: selected.workspaceId,
    selectedRevision: selected.revision,
  };
  await exactFile(join(destination, 'receiving-receipts', selected.archive.sha256 + '.json'), encoded(receipt));
  return {
    ...receipt, directory: destination, workspaceDirectory: join(destination, 'workspace'),
    storeDirectory: join(destination, 'source-store'), currentRevision: current.summary.revision,
    currentReviewSha256: current.summary.reviewSha256, currentEditions: current.summary.editions, reused,
  };
}

/** Read the completed original export record without producing a second archive. */
export async function completedEdgarOperatorExport({ outputDirectory } = {}) {
  const out = await realDirectory(outputDirectory);
  const completed = decodeJson((await pinnedFile(join(out, 'completed.json'), null, MAX_MANIFEST_BYTES)).bytes);
  need(completed.schema === 'stellar-forge.sec-edgar-operator-export.v1' &&
    /^[a-f0-9]{64}$/.test(completed.archive?.sha256 ?? '') &&
    /^[1-9][0-9]{0,15}$/.test(completed.archive?.bytes ?? ''),
  'EDGAR_PORTABLE_EXPORT_INCOMPLETE');
  return { ...completed, directory: out, archivePath: join(out, 'sec-edgar-workspace.zip') };
}

/** The manifest is the complete original archive selection, bound to its saved review. */
export async function readEdgarOperatorManifest({ outputDirectory } = {}) {
  const completed = await completedEdgarOperatorExport({ outputDirectory });
  const file = await pinnedFile(join(completed.directory, 'workspace-manifest.json'), null, MAX_MANIFEST_BYTES);
  const manifest = validateOperatorManifest(decodeJson(file.bytes));
  need(file.sha256 === completed.reviewSha256 &&
    portableSummary(manifest).reviewSha256 === completed.reviewSha256,
  'EDGAR_PORTABLE_EXPORT_CONFLICT');
  return { bytes: file.bytes, manifest, completed };
}
