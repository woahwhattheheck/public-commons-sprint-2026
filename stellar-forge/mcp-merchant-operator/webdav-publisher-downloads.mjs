// MIT. Retain native generated review bytes for exact WebDAV download/reopen.
import { constants } from 'node:fs';
import { open, mkdir, realpath, lstat, link, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { failure, privateSupportDirectory } from './host-files.mjs';
import { identity } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/webdav/config.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const LIMIT = 256_000_000; // Same generated snapshot limit as RetainedFileReads.
const digest = value => createHash('sha256').update(value).digest('hex');
const stamp = value => ['dev','ino','size','mtimeNs','ctimeNs','mode','uid'].map(key => String(value[key])).join(':');

async function privateChild(parent, name) {
  const path = join(parent, name);
  try { await mkdir(path, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  await privateSupportDirectory(path);
  const stat = await lstat(path);
  if (await realpath(path) !== path || typeof process.getuid === 'function' && stat.uid !== process.getuid())
    throw failure('WEBDAV_REVIEW_DIRECTORY', 'Use the original canonical private review directory.');
  return path;
}
async function readBytes(path) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(LIMIT) || before.size < 1n || before.mode & 0o077n ||
        typeof process.getuid === 'function' && before.uid !== BigInt(process.getuid()))
      throw failure('WEBDAV_REVIEW_FILE', 'Read an owned private native review within its original file limit.');
    const bytes = await handle.readFile();
    if (bytes.length > LIMIT || BigInt(bytes.length) !== before.size || stamp(before) !== stamp(await handle.stat({ bigint: true })))
      throw failure('WEBDAV_REVIEW_CHANGED', 'The retained review changed while being read.');
    return bytes;
  } finally { await handle.close(); }
}
function selectedReview(bytes, draftId) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > LIMIT)
    throw failure('WEBDAV_REVIEW_FILE', 'Retain the complete native generated review within its original file limit.');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw failure('WEBDAV_REVIEW_FILE', 'The native publisher review must remain complete UTF-8 JSON.'); }
  if (!value || value.schema !== 'stellar-forge.dataset-publisher-review.v1' || value.candidate?.id !== draftId ||
      typeof value.exportedAt !== 'string' || !Number.isFinite(Date.parse(value.exportedAt)))
    throw failure('WEBDAV_REVIEW_SELECTION', 'Keep the selected native draft and its original generated export time.');
  const { exportedAt, ...selection } = value;
  return { selectionSha256: identity(selection), value };
}
async function syncDirectory(directory) {
  const handle = await open(directory, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function retainFirst(directory, path, bytes) {
  const temporary = join(directory, '.review-' + randomUUID() + '.pending');
  let file;
  try {
    file = await open(temporary, 'wx', 0o600);
    await file.writeFile(bytes); await file.sync(); await file.close(); file = null;
    try { await link(temporary, path); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    await syncDirectory(directory);
  } finally {
    try { if (file) await file.close(); }
    finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
}
/**
 * The native publisher owns the candidate/config/selection and generates its
 * exportedAt. Retain that first complete response for the exact semantic
 * selection; its timestamp is kept verbatim. Later candidate/selection changes
 * create another retained file. An explicit old SHA reopens its original bytes.
 */
export async function retainedWebDavPublisherReview({
  directory, workspaceId, productId, draftId, expectedSha256, load
}) {
  if (![workspaceId, productId, draftId].every(value => typeof value === 'string' && UUID.test(value)) ||
      expectedSha256 !== undefined && !SHA256.test(expectedSha256) || typeof load !== 'function')
    throw failure('WEBDAV_REVIEW_SELECTION', 'Select the original native workspace, product, draft and optional exact review SHA256.');
  const root = resolve(directory);
  await privateSupportDirectory(root);
  if (await realpath(root) !== root) throw failure('WEBDAV_REVIEW_DIRECTORY', 'Use the original canonical customer-export directory.');
  const family = await privateChild(root, 'webdav-publisher-reviews');
  const scope = identity({ workspaceId, productId, draftId });
  const folder = await privateChild(family, scope);
  const result = bytes => ({ bytes, filename: 'dataset-review.json', contentType: 'application/json' });
  if (expectedSha256) {
    try {
      const bytes = await readBytes(join(folder, 'sha256-' + expectedSha256 + '.json'));
      selectedReview(bytes, draftId);
      if (digest(bytes) !== expectedSha256) throw failure('WEBDAV_REVIEW_CHANGED', 'The retained original review no longer matches its selected SHA256.');
      return result(bytes);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const original = await load();
  if (original?.filename !== 'dataset-review.json')
    throw failure('WEBDAV_REVIEW_SELECTION', 'Retain the original publisher review download.');
  const selected = selectedReview(original.bytes, draftId);
  const selectionPath = join(folder, 'selection-' + selected.selectionSha256 + '.json');
  try { await readBytes(selectionPath); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await retainFirst(folder, selectionPath, original.bytes);
  }
  const bytes = await readBytes(selectionPath);
  if (selectedReview(bytes, draftId).selectionSha256 !== selected.selectionSha256)
    throw failure('WEBDAV_REVIEW_CHANGED', 'Keep the original saved draft/config/selection for this retained review.');
  const sha256 = digest(bytes), hashPath = join(folder, 'sha256-' + sha256 + '.json');
  try { await link(selectionPath, hashPath); await syncDirectory(folder); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (!(await readBytes(hashPath)).equals(bytes))
    throw failure('WEBDAV_REVIEW_CHANGED', 'The exact original review download differs from its retained selection.');
  if (expectedSha256 && expectedSha256 !== sha256)
    throw failure('WEBDAV_FILE_CHANGED', 'The requested review SHA256 is not retained. Select the current original review as a new receiving edition.');
  return result(bytes);
}
