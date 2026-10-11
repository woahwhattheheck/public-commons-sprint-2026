// MIT — Deliver selected original SF88 response files through original SF100.
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {open, mkdir, lstat, realpath, rm} from 'node:fs/promises';
import {basename, dirname, isAbsolute, join, resolve} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {openQueue} from './queue.mjs';
import {InputError, need} from './config.mjs';
import {aggregateOutcomes} from '../sf52-buyer-outcomes/outcomes.mjs';
import {init, appendMany, finalize} from '../sf100-buyer-dataset-delivery/deliver.mjs';

const MAX_PAGE = 2 * 1024 * 1024;
const MAX_SOURCES = 256 * 1024 * 1024;
const MAX_PAGES = 4096;
const INTENT = /^[A-Za-z0-9._:-]{1,128}$/;
const HASH = /^[a-f0-9]{64}$/;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const privateMode = info => process.platform === 'win32' || ((info.mode & 0o077) === 0 &&
  (typeof process.getuid !== 'function' || info.uid === process.getuid()));
const pathOf = value => {
  need(typeof value === 'string' && isAbsolute(value) && !value.includes('\0'),
    'DATASET_ABSOLUTE_PATH_REQUIRED');
  return resolve(value);
};

async function privateDirectory(path) {
  const info = await lstat(path);
  need(info.isDirectory() && !info.isSymbolicLink() && privateMode(info) &&
    await realpath(path) === path, 'DATASET_PRIVATE_DIRECTORY_REQUIRED');
  return info;
}

async function readPrivate(path, limit) {
  const handle = await open(pathOf(path), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    need(info.isFile() && privateMode(info) && info.size <= limit, 'DATASET_PRIVATE_FILE_REQUIRED');
    const bytes = await handle.readFile();
    need(bytes.length <= limit, 'DATASET_SOURCE_BYTE_LIMIT');
    return bytes;
  } finally { await handle.close(); }
}

async function writePrivate(path, bytes) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
  return {sha256:sha(bytes), bytes:bytes.length};
}

function select(intents) {
  need(Array.isArray(intents) && intents.length > 0 && intents.length <= MAX_PAGES &&
    intents.every(id => typeof id === 'string' && INTENT.test(id)) &&
    new Set(intents).size === intents.length, 'DATASET_EXPLICIT_UNIQUE_INTENTS_REQUIRED');
  return [...intents];
}

export async function readDatasetSelection(path) {
  const raw = await readPrivate(path, 1024 * 1024);
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(raw)); }
  catch { throw new InputError('DATASET_SELECTION_JSON_INVALID'); }
  return select(value);
}

function requestOf(record) {
  need(record.operation.method === 'GET' && record.bodySha256 === null,
    'DATASET_ORIGINAL_GET_REQUIRED');
  const url = new URL(record.operation.url), keys = new Set();
  const query = [];
  let cursor;
  for (const [key, value] of url.searchParams) {
    need(!keys.has(key), 'DATASET_REPEATED_REQUEST_PARAMETER');
    keys.add(key);
    if (key === 'cursor') cursor = value;
    else if (key !== 'limit') query.push([key, value]);
  }
  query.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  // Page size may change; the original endpoint, projection and query must not.
  return {identity:JSON.stringify([url.origin, url.pathname, query]), cursor};
}

async function savedPage(queue, intentId) {
  const record = await queue.show(intentId);
  const outcome = record.outcome, saved = outcome?.responseFile;
  need(record.attempt?.kind === 'EXECUTE' &&
    outcome?.mode === 'ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT' &&
    outcome.intentId === intentId && saved?.status === 'SAVED' &&
    Number.isInteger(outcome.httpStatus) && outcome.httpStatus >= 200 && outcome.httpStatus < 300 &&
    HASH.test(saved.sha256) && Number.isSafeInteger(saved.bytes) && saved.bytes >= 0 &&
    saved.bytes <= MAX_PAGE && typeof record.responseDestination === 'string',
    'DATASET_ORIGINAL_SAVED_RESPONSE_REQUIRED');
  const configured = pathOf(record.responseDestination);
  const canonical = join(await realpath(dirname(configured)), basename(configured));
  need(saved.path === canonical, 'DATASET_RESPONSE_DESTINATION_MISMATCH');
  const response = await readPrivate(saved.path, MAX_PAGE);
  need(response.length === saved.bytes && sha(response) === saved.sha256,
    'DATASET_ORIGINAL_RESPONSE_CHANGED');
  let evidence = null, evidenceDigestSource = null;
  if (outcome.evidencePath !== null && outcome.evidencePath !== undefined) {
    need(outcome.evidencePath === record.evidencePath, 'DATASET_EVIDENCE_DESTINATION_MISMATCH');
    evidence = await readPrivate(outcome.evidencePath, MAX_PAGE);
    let original;
    try { original = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(evidence)); }
    catch { throw new InputError('DATASET_ORIGINAL_EVIDENCE_INVALID'); }
    need(original?.schema === 'scf82.checkout-evidence.v1' && original.intentId === intentId &&
      original.observation?.intentId === intentId && original.observedAt === original.observation.observedAt &&
      Number.isFinite(Date.parse(original.observedAt)) &&
      Date.parse(original.observedAt) >= Date.parse(record.attempt.startedAt),
      'DATASET_ORIGINAL_EVIDENCE_MISMATCH');
    // SF52's generatedAt is the report-generation time, not an observed event.
    // Compare its actual contents while preserving both original timestamps.
    const {generatedAt: regeneratedAt, ...computed} = aggregateOutcomes([original.observation]);
    const {generatedAt: originalGeneratedAt, ...retained} = outcome.originalOutcomeReport ?? {};
    need(isDeepStrictEqual(computed, retained),
      'DATASET_ORIGINAL_EVIDENCE_OUTCOME_CHANGED');
    if (record.recovery) {
      need(HASH.test(record.recovery.evidenceSha256) && sha(evidence) === record.recovery.evidenceSha256,
        'DATASET_RECOVERED_EVIDENCE_CHANGED');
      evidenceDigestSource = 'RECORDED_BY_ORIGINAL_INBOX_RECOVERY';
    } else evidenceDigestSource = 'CAPTURED_DURING_DATASET_EXPORT';
  }
  return {record, response, evidence, evidenceDigestSource, request:requestOf(record)};
}

/** A new private package, assembled only from explicit, already-saved attempts.
 * Original SF100 validates page/query/cursor continuity and writes the dataset.
 * This function never executes a buyer, imports a signer, or opens its ledger. */
export async function exportQueueDataset({root, intents, destination} = {}) {
  const selection = select(intents), out = pathOf(destination);
  await privateDirectory(dirname(out));
  const queue = await openQueue(root);
  // mkdir is the destination claim. An existing directory is never replaced.
  await mkdir(out, {mode:0o700});
  const created = await privateDirectory(out);
  let finished = false;
  try {
    const sources = join(out, 'sources'), dataset = join(out, 'dataset');
    await mkdir(sources, {mode:0o700});
    await init(dataset);
    const operations = [], inputs = [];
    let sourceBytes = 0, requestIdentity = null;
    for (let index = 0; index < selection.length; index++) {
      const intentId = selection[index];
      const {record, response, evidence, evidenceDigestSource, request} = await savedPage(queue, intentId);
      const operationBytes = encode(record);
      sourceBytes += response.length + operationBytes.length + (evidence?.length ?? 0);
      need(sourceBytes <= MAX_SOURCES, 'DATASET_SOURCE_BYTE_LIMIT');
      if (index === 0) {
        need(request.cursor === undefined, 'DATASET_FIRST_REQUEST_HAS_CURSOR');
        requestIdentity = request.identity;
      } else need(request.identity === requestIdentity, 'DATASET_REQUEST_QUERY_CHANGED');
      const prefix = String(index).padStart(5, '0');
      const sourcePath = 'sources/' + prefix + '.response.json';
      const operationPath = 'sources/' + prefix + '.operation.json';
      const evidencePath = evidence === null ? null : 'sources/' + prefix + '.evidence.json';
      const sourceFile = await writePrivate(join(out, sourcePath), response);
      const operationFile = await writePrivate(join(out, operationPath), operationBytes);
      const evidenceFile = evidence === null ? null : await writePrivate(join(out, evidencePath), evidence);
      operations.push({index, intentId, inboxRecord:record.id, attemptId:record.attempt.id,
        configSha256:record.configSha256,
        source:{path:sourcePath, ...sourceFile},
        originalOperation:{path:operationPath, ...operationFile},
        evidence:evidenceFile === null ? null : {path:evidencePath, ...evidenceFile, digestSource:evidenceDigestSource}});
      inputs.push({page:join(out, sourcePath), intent:intentId,
        ...(request.cursor === undefined ? {} : {cursor:request.cursor}),
        ...(evidencePath === null ? {} : {evidence:join(out, evidencePath)})});
    }
    await appendMany(dataset, inputs);
    const delivery = await finalize(dataset);
    const nativeManifest = await readPrivate(join(dataset, 'manifest.json'), 8 * 1024 * 1024);
    const manifest = {schema:'stellar-forge.sf88.queue-dataset-delivery.v1',
      createdAt:new Date().toISOString(), queueRoot:queue.root,
      selection:{intents:selection, sha256:sha(encode(selection))},
      originalDatasetManifest:{path:'dataset/manifest.json', sha256:sha(nativeManifest), bytes:nativeManifest.length},
      operations, dataset:{name:delivery.dataset, snapshot:delivery.snapshot,
        pages:delivery.pages, rows:delivery.rows, total:delivery.total},
    };
    // Completion is published last. A process interruption leaves an explicitly
    // incomplete local directory; the original inbox and saved files are intact.
    const completion = await writePrivate(join(out, 'delivery.json'), encode(manifest));
    finished = true;
    return {action:'DATASET_DELIVERED', directory:out,
      manifest:{path:join(out, 'delivery.json'), ...completion},
      review:join(dataset, 'review.html'), jsonl:join(dataset, 'dataset.jsonl'), csv:join(dataset, 'dataset.csv'),
      ...manifest.dataset, operations:operations.length};
  } finally {
    if (!finished) {
      const current = await lstat(out).catch(() => null);
      // Remove only this invocation's new failed package, never an input or a
      // replacement destination. Abrupt process termination remains visible.
      if (current?.isDirectory() && !current.isSymbolicLink() &&
        current.dev === created.dev && current.ino === created.ino)
        await rm(out, {recursive:true, force:true}).catch(() => {});
    }
  }
}
