// MIT. Receive an original verified Woo refund handoff into the operator workspace.
import {constants} from 'node:fs';
import {open, lstat, readdir, link, unlink, rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join, dirname, sep} from 'node:path';
import {reference} from './buyer.mjs';
import {inspectRefund} from './refund-operator.mjs';
import {adjustmentId} from '../merchant-settlement-accounting/adjustments.mjs';
import {absolute, need, object, digest, now, privateDirectory, parseJson,
  jsonBytes, exists, syncDirectory} from '../sf88-operator-buyer-cli/node/store.mjs';

export const REFUND_HANDOFF_SCHEMA = 'stellar-forge.sf104.merchant-refund-export.v1';
export const REFUND_RECEIVE_SCHEMA = 'stellar-forge.sf104.merchant-refund-receive.v1';
export const REFUND_HANDOFF_LIMITS = Object.freeze({
  files:2048, bytes:256 * 1024 * 1024, manifestBytes:1024 * 1024,
  adjustmentBytes:32 * 1024 * 1024, stateBytes:4 * 1024 * 1024,
});
const HASH = /^[a-f0-9]{64}$/;
const REQUIRED = ['adjustments.json', 'adjustment-request.json', 'order-before.json', 'input.json'];
const RECORD = /^(?:prepare|apply|recover)-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.json$/;
const REVIEW = /^review-[a-f0-9]{64}\.json$/;
const MANIFEST_KEYS = ['adjustmentId', 'files', 'inputSha256', 'orderReference', 'schema', 'siteUrl'];
const entryLimit = name => name === 'adjustments.json' ?
  REFUND_HANDOFF_LIMITS.adjustmentBytes : REFUND_HANDOFF_LIMITS.stateBytes;
const related = (a, b) => a === b || a.startsWith(b + sep) || b.startsWith(a + sep);

function exactFields(value, keys, code) {
  need(object(value) && Object.keys(value).sort().join('\n') === [...keys].sort().join('\n'), code);
}

/** Delivered files stay single-link; only exact receiver-owned temporary aliases can recover. */
async function snapshotFile(path, {bytes, sha256, limit, receiverCopy = false}) {
  const named = await lstat(absolute(path));
  need(named.isFile() && !named.isSymbolicLink() &&
    (receiverCopy ? named.nlink >= 1 : named.nlink === 1), 'WOO_REFUND_HANDOFF_FILE_INVALID');
  const handle = await open(absolute(path), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    need(before.dev === named.dev && before.ino === named.ino, 'WOO_REFUND_HANDOFF_FILE_CHANGED');
    need(before.isFile() && Number.isSafeInteger(before.size) && before.size > 0 && before.size <= limit &&
      (bytes === undefined || before.size === bytes), 'WOO_REFUND_HANDOFF_FILE_INVALID');
    const raw = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < raw.length) {
      const read = await handle.read(raw, offset, Math.min(65536, raw.length - offset), offset);
      need(read.bytesRead > 0, 'WOO_REFUND_HANDOFF_FILE_CHANGED');
      offset += read.bytesRead;
    }
    const extra = await handle.read(Buffer.alloc(1), 0, 1, raw.length), after = await handle.stat();
    const currentName = await lstat(path), actualHash = digest(raw);
    need(extra.bytesRead === 0 && after.size === before.size && after.nlink === before.nlink &&
      after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs &&
      currentName.dev === before.dev && currentName.ino === before.ino && !currentName.isSymbolicLink() &&
      (sha256 === undefined || actualHash === sha256), 'WOO_REFUND_HANDOFF_FILE_CHANGED');
    if (receiverCopy && after.nlink > 1) {
      // A killed exclusive copy may have linked its completed file but not yet
      // removed its private temporary name. Retire only this receiver's aliases
      // of the exact verified inode; an unrelated external hard link still fails.
      const prefix = '.sf104-receive-' + actualHash + '-';
      for (const name of await readdir(dirname(path))) {
        if (!name.startsWith(prefix) || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(name.slice(prefix.length))) continue;
        const candidate = join(dirname(path), name);
        let alias;
        try { alias = await lstat(candidate); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        if (alias.isFile() && !alias.isSymbolicLink() && alias.dev === before.dev && alias.ino === before.ino)
          await unlink(candidate).catch(error => { if (error.code !== 'ENOENT') throw error; });
      }
      need((await handle.stat()).nlink === 1, 'WOO_REFUND_HANDOFF_FILE_INVALID');
      await syncDirectory(dirname(path));
    } else need(after.nlink === 1, 'WOO_REFUND_HANDOFF_FILE_INVALID');
    return raw;
  } finally { await handle.close(); }
}

/** Publish one complete file exclusively; its recoverable temporary stays in this private directory. */
async function writeFirst(path, raw) {
  const temporary = join(dirname(path), '.sf104-receive-' + digest(raw) + '-' + randomUUID());
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(raw); await handle.sync(); await handle.close(); handle = undefined;
    await link(temporary, path);
  } finally {
    if (handle) await handle.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  await syncDirectory(dirname(path));
}

async function retainFile(path, raw, descriptor) {
  if (!await exists(path)) {
    try { await writeFirst(path, raw); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  await snapshotFile(path, {...descriptor, limit:descriptor.bytes, receiverCopy:true});
}

function manifestFrom(raw, config) {
  const value = parseJson(raw);
  exactFields(value, MANIFEST_KEYS, 'WOO_REFUND_HANDOFF_MANIFEST_INVALID');
  need(value.schema === REFUND_HANDOFF_SCHEMA, 'WOO_REFUND_HANDOFF_MANIFEST_REQUIRED');
  adjustmentId(value.adjustmentId);
  need(value.siteUrl === config.siteUrl && reference(value.orderReference) &&
    HASH.test(value.inputSha256), 'WOO_REFUND_HANDOFF_STORE_OR_ORDER_CHANGED');
  need(Array.isArray(value.files) && value.files.length >= REQUIRED.length &&
    value.files.length <= REFUND_HANDOFF_LIMITS.files, 'WOO_REFUND_HANDOFF_FILE_LIMIT');
  let total = 0; const names = new Set();
  for (const file of value.files) {
    exactFields(file, ['name', 'bytes', 'sha256'], 'WOO_REFUND_HANDOFF_ENTRY_INVALID');
    need(typeof file.name === 'string' && (REQUIRED.includes(file.name) ||
      RECORD.test(file.name) || REVIEW.test(file.name)) && !names.has(file.name) &&
      Number.isSafeInteger(file.bytes) && file.bytes > 0 && file.bytes <= entryLimit(file.name) &&
      typeof file.sha256 === 'string' && HASH.test(file.sha256), 'WOO_REFUND_HANDOFF_ENTRY_INVALID');
    names.add(file.name); total += file.bytes;
    need(total <= REFUND_HANDOFF_LIMITS.bytes, 'WOO_REFUND_HANDOFF_BYTE_LIMIT');
  }
  need(REQUIRED.every(name => names.has(name)), 'WOO_REFUND_HANDOFF_INPUT_MISSING');
  return {manifest:value, total};
}

function summary(manifest, state, sha256, total) {
  need(state.adjustmentId === manifest.adjustmentId && state.siteUrl === manifest.siteUrl &&
    state.orderReference === manifest.orderReference && state.input.sha256 === manifest.inputSha256,
    'WOO_REFUND_HANDOFF_INPUT_CHANGED');
  return {schema:REFUND_RECEIVE_SCHEMA, adjustmentId:manifest.adjustmentId,
    orderReference:manifest.orderReference, siteUrl:manifest.siteUrl,
    manifestSha256:sha256, inputSha256:manifest.inputSha256,
    operationStatus:state.status, amountAtomic:state.input.amountAtomic,
    wooAmount:state.input.wooAmount, currency:state.input.currency,
    originalTransactionHash:state.input.originalTransactionHash,
    refundTransactionHash:state.input.reviewedRefund.transaction,
    reviews:state.reviews.length, attempts:state.attempts.length,
    files:manifest.files.length, bytes:total};
}

function sealed(value) { return {...value, sha256:digest(jsonBytes(value))}; }
function readReceipt(raw, expected) {
  const value = parseJson(raw);
  need(object(value), 'WOO_REFUND_RECEIVE_RECEIPT_CHANGED');
  const {sha256, ...body} = value;
  need(HASH.test(sha256) && digest(jsonBytes(body)) === sha256 &&
    value.schema === REFUND_RECEIVE_SCHEMA && value.status === 'RECEIVED' &&
    value.manifestSha256 === expected.manifestSha256 &&
    value.inputSha256 === expected.inputSha256 &&
    value.adjustmentId === expected.adjustmentId &&
    value.orderReference === expected.orderReference && value.siteUrl === expected.siteUrl &&
    value.workspace === expected.workspace, 'WOO_REFUND_RECEIVE_RECEIPT_CHANGED');
  return value;
}

async function completedReceipt(config, manifest, manifestSha256, total, workspace, target) {
  const directory = join(workspace, 'refund-handoffs', manifest.adjustmentId, manifestSha256);
  const path = join(directory, 'receipt.json');
  if (!await exists(path)) return null;
  for (const parent of [join(workspace, 'refund-handoffs'),
    join(workspace, 'refund-handoffs', manifest.adjustmentId), directory,
    join(workspace, 'refunds'), target]) await privateDirectory(parent, {create:false});
  const raw = await snapshotFile(path, {limit:REFUND_HANDOFF_LIMITS.manifestBytes, receiverCopy:true});
  const expected = {manifestSha256, inputSha256:manifest.inputSha256,
    adjustmentId:manifest.adjustmentId, orderReference:manifest.orderReference, siteUrl:manifest.siteUrl, workspace};
  const receipt = readReceipt(raw, expected);
  for (const file of manifest.files)
    await snapshotFile(join(target, file.name), {...file, limit:entryLimit(file.name), receiverCopy:true});
  const current = await inspectRefund(config, manifest.adjustmentId);
  summary(manifest, current, manifestSha256, total);
  return receipt;
}

/**
 * Validate the complete original export, then copy its original files without
 * replacing any retained record. The existing refund engine validates the
 * native source, input seal, reviews and attempt bindings in an isolated stage.
 * check:true returns that reviewed snapshot before installing the operation.
 */
export async function receiveRefund(config, sourceDirectory, {expectedManifestSha256, check = false} = {}) {
  need(typeof expectedManifestSha256 === 'string' && HASH.test(expectedManifestSha256),
    'WOO_REFUND_HANDOFF_HASH_REQUIRED');
  need(typeof check === 'boolean', 'WOO_REFUND_HANDOFF_CHECK_INVALID');
  const source = await privateDirectory(absolute(sourceDirectory), {create:false});
  const manifestRaw = await snapshotFile(join(source, 'manifest.json'),
    {sha256:expectedManifestSha256, limit:REFUND_HANDOFF_LIMITS.manifestBytes});
  const {manifest, total} = manifestFrom(manifestRaw, config);
  const names = new Set(['manifest.json', ...manifest.files.map(file => file.name)]);
  const entries = await readdir(source, {withFileTypes:true});
  need(entries.length === names.size && entries.every(entry => names.has(entry.name) && entry.isFile()),
    'WOO_REFUND_HANDOFF_FILE_SET_CHANGED');
  const workspace = await privateDirectory(config.workspace);
  const targetParent = join(workspace, 'refunds'), target = join(targetParent, manifest.adjustmentId);
  const stageParent = join(workspace, '.refund-receive');
  const stage = join(stageParent, manifest.adjustmentId + '-' + expectedManifestSha256);
  need(!related(source, target) && !related(source, stage), 'WOO_REFUND_HANDOFF_SEPARATE_DIRECTORY_REQUIRED');
  if (!check) {
    const completed = await completedReceipt(config, manifest, expectedManifestSha256, total, workspace, target);
    if (completed) return completed;
  }
  await privateDirectory(stageParent);
  await privateDirectory(stage);
  const claim = jsonBytes({schema:REFUND_RECEIVE_SCHEMA, adjustmentId:manifest.adjustmentId,
    siteUrl:manifest.siteUrl, workspace, manifestSha256:expectedManifestSha256});
  await retainFile(join(stage, 'claim.json'), claim, {bytes:claim.length, sha256:digest(claim)});
  await retainFile(join(stage, 'manifest.json'), manifestRaw,
    {bytes:manifestRaw.length, sha256:expectedManifestSha256});
  await privateDirectory(join(stage, 'refunds'));
  const stagedOperation = await privateDirectory(join(stage, 'refunds', manifest.adjustmentId));
  // A copy is restartable at each immutable file. Always recheck the source.
  for (const file of manifest.files) {
    const raw = await snapshotFile(join(source, file.name), {...file, limit:entryLimit(file.name)});
    await retainFile(join(stagedOperation, file.name), raw, file);
  }
  const original = await inspectRefund({...config, workspace:stage}, manifest.adjustmentId);
  const reviewed = summary(manifest, original, expectedManifestSha256, total);
  if (check) return {...reviewed, status:'REVIEWED', workspace, operationDirectory:target};

  // Preflight every existing named record before copying any new target file.
  // Later local attempts may coexist; delivered attempts can never replace them.
  await privateDirectory(targetParent);
  await privateDirectory(target);
  for (const file of manifest.files) {
    const path = join(target, file.name);
    if (await exists(path)) await snapshotFile(path, {...file, limit:entryLimit(file.name), receiverCopy:true});
  }
  // A new operation becomes readable only after all of its source/history files.
  const ordered = [...manifest.files].sort((a, b) =>
    Number(a.name === 'input.json') - Number(b.name === 'input.json') || a.name.localeCompare(b.name));
  for (const file of ordered) {
    const raw = await snapshotFile(join(stagedOperation, file.name), {...file, limit:entryLimit(file.name), receiverCopy:true});
    await retainFile(join(target, file.name), raw, file);
  }
  const received = await inspectRefund(config, manifest.adjustmentId);
  summary(manifest, received, expectedManifestSha256, total);

  const receipts = await privateDirectory(join(workspace, 'refund-handoffs'));
  const byAdjustment = await privateDirectory(join(receipts, manifest.adjustmentId));
  const receiptDirectory = await privateDirectory(join(byAdjustment, expectedManifestSha256));
  await retainFile(join(receiptDirectory, 'manifest.json'), manifestRaw,
    {bytes:manifestRaw.length, sha256:expectedManifestSha256});
  const receiptPath = join(receiptDirectory, 'receipt.json');
  const receipt = sealed({...reviewed, status:'RECEIVED', receivedAt:now(), workspace,
    operationDirectory:target, receiptDirectory});
  try { await writeFirst(receiptPath, jsonBytes(receipt)); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const saved = readReceipt(await snapshotFile(receiptPath, {limit:REFUND_HANDOFF_LIMITS.manifestBytes, receiverCopy:true}),
    {...reviewed, workspace});
  // This exact stage is owned by the validated claim and is now fully copied.
  await snapshotFile(join(stage, 'claim.json'), {bytes:claim.length, sha256:digest(claim), limit:claim.length, receiverCopy:true});
  await rm(stage, {recursive:true, force:true}).catch(() => {});
  return saved;
}
