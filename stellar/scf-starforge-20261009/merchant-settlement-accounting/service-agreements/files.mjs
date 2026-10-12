// MIT. Original quotation bytes stay in the existing accounting export tree.
import {randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {open, mkdir, lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {identifier, need, json, sha} from '../receivables/core.mjs';
import {RECEIVABLE_REQUEST_BYTES} from '../receivables/store.mjs';
export const SOURCE_NAMES = new Set(['quote.json', 'response.json', 'source.json', 'review.json', 'renewal.json']);
async function syncDirectory(path) {
  const file = await open(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0));
  try { await file.sync(); } finally { await file.close(); }
}
async function sourceDirectory(workspace, id) {
  workspace.lease.assertHeld(); identifier(id, 'agreement source directory');
  const root = join(workspace.directory, 'exports'), directory = join(root, id);
  for (const path of [root, directory]) {
    const info = await lstat(path);
    need(info.isDirectory() && !info.isSymbolicLink(), 'AGREEMENT_SOURCE_DIRECTORY_CHANGED',
      'The original agreement source directory changed.', 409);
  }
  return directory;
}
export function validateSourceBodies(value) {
  need(typeof value.quoteContent === 'string' && typeof value.responseContent === 'string' &&
    (value.renewalJson === undefined || typeof value.renewalJson === 'string') &&
    Buffer.byteLength(value.quoteContent, 'utf8') + Buffer.byteLength(value.responseContent, 'utf8') +
      (value.renewalJson === undefined ? 0 : Buffer.byteLength(value.renewalJson, 'utf8')) <= RECEIVABLE_REQUEST_BYTES,
    'AGREEMENT_SOURCE_REQUIRED',
    'Choose the original quote, its accepted response and any complete renewal handover within the two-megabyte request limit.');
}
export async function retainSource(workspace, value, compiled) {
  workspace.lease.assertHeld(); validateSourceBodies(value);
  const root = join(workspace.directory, 'exports'), id = randomUUID(), directory = join(root, id);
  const parent = await lstat(root);
  need(parent.isDirectory() && !parent.isSymbolicLink(), 'AGREEMENT_SOURCE_DIRECTORY_CHANGED',
    'The original accounting export directory changed.', 409);
  await mkdir(directory, {mode: 0o700});
  const originals = {'quote.json': Buffer.from(value.quoteContent), 'response.json': Buffer.from(value.responseContent),
    'source.json': Buffer.from(json(compiled.source)), 'review.json': Buffer.from(json(compiled.review))};
  if (value.renewalJson !== undefined) originals['renewal.json'] = Buffer.from(value.renewalJson, 'utf8');
  const files = {};
  for (const [name, bytes] of Object.entries(originals)) {
    const handle = await open(join(directory, name),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    files[name] = {bytes: bytes.length, sha256: sha(bytes)};
  }
  await syncDirectory(directory); await syncDirectory(root);
  return {id, directoryId: id, files, quote: compiled.source.quote, response: compiled.source.response,
    sourceSha256: compiled.source.sha256, reviewSha256: compiled.review.sha256};
}
export async function readSourceFile(workspace, source, name) {
  need(SOURCE_NAMES.has(name) && source.files[name], 'AGREEMENT_SOURCE_FILE_NOT_FOUND',
    'Choose an original agreement source file.', 404);
  const directory = await sourceDirectory(workspace, source.directoryId);
  const handle = await open(join(directory, name), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat(), expected = source.files[name];
    need(info.isFile() && info.size === expected.bytes && info.size <= RECEIVABLE_REQUEST_BYTES,
      'AGREEMENT_SOURCE_CHANGED', 'The retained agreement source changed.', 409);
    const bytes = await handle.readFile();
    need(bytes.length === expected.bytes && sha(bytes) === expected.sha256,
      'AGREEMENT_SOURCE_CHANGED', 'The retained agreement source differs from its original bytes.', 409);
    return {name, type: 'application/json; charset=utf-8', bytes};
  } finally { await handle.close(); }
}
export async function sourceBodies(workspace, source) {
  const quote = await readSourceFile(workspace, source, 'quote.json');
  const response = await readSourceFile(workspace, source, 'response.json');
  return {quoteContent: quote.bytes.toString('utf8'), responseContent: response.bytes.toString('utf8')};
}
