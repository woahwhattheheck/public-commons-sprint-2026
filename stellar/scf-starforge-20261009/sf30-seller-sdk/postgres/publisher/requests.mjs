// MIT. Optional request receipts inside the original publisher database and files.
import { lstat, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { privateDirectory, readJson, readPrivate, createFile, syncDirectory,
  bytes, digest, identity, fault, stamp } from './files.mjs';

const REQUEST = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAXIMUM = 16 * 1024 * 1024;
const SCHEMA = 'stellar-forge.publisher-action-receipt.v1';
const clone = value => JSON.parse(JSON.stringify(value));
async function absent(path) {
  try { await lstat(path); return false; }
  catch (issue) { if (issue.code === 'ENOENT') return true; throw issue; }
}

/** The caller holds the original publisher lease. remember() is called from its
 * existing SQLite transaction, beside the actual run update or buyer event. */
export function publisherActionReceipts({ db, directory }) {
  db.exec(`CREATE TABLE IF NOT EXISTS source_action_requests(
    request TEXT PRIMARY KEY, kind TEXT NOT NULL, run TEXT NOT NULL,
    input_hash TEXT NOT NULL, created TEXT NOT NULL, result_hash TEXT NOT NULL,
    result TEXT NOT NULL)`);
  function bind(kind, run, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw fault('PUBLISHER_ACTION_INPUT_INVALID');
    const { requestId, ...rawInput } = input;
    const nativeInput = clone(rawInput);
    if (requestId === undefined) return { request: null, input: nativeInput };
    if (!REQUEST.test(requestId)) throw fault('PUBLISHER_ACTION_REQUEST_INVALID', 'Retain one UUID before submitting this action.');
    const request = { schema: SCHEMA, requestId, kind, run,
      inputHash: digest(bytes({ kind, run, input: nativeInput })) };
    return { request, input: nativeInput };
  }
  function existing(request) {
    if (!request) return null;
    const row = db.prepare('SELECT * FROM source_action_requests WHERE request=?').get(request.requestId);
    if (!row) return null;
    if (row.kind !== request.kind || row.run !== request.run || row.input_hash !== request.inputHash)
      throw fault('PUBLISHER_ACTION_REQUEST_CHANGED', 'Retry the exact original action, run and input.', 409);
    let result;
    try { result = JSON.parse(row.result); }
    catch { throw fault('PUBLISHER_ACTION_RECEIPT_INVALID'); }
    if (!HASH.test(row.result_hash) || identity(result) !== row.result_hash)
      throw fault('PUBLISHER_ACTION_RECEIPT_INVALID');
    return result;
  }
  function remember(request, result) {
    if (!request) return result;
    const original = existing(request);
    if (original) {
      if (identity(original) !== identity(result)) throw fault('PUBLISHER_ACTION_RECEIPT_CHANGED', 'The original action already has a different retained outcome.', 409);
      return original;
    }
    const encoded = JSON.stringify(result);
    if (Buffer.byteLength(encoded) > MAXIMUM) throw fault('PUBLISHER_ACTION_RECEIPT_LIMIT');
    db.prepare('INSERT INTO source_action_requests(request,kind,run,input_hash,created,result_hash,result) VALUES(?,?,?,?,?,?,?)')
      .run(request.requestId, request.kind, request.run, request.inputHash, stamp(), identity(result), encoded);
    return result;
  }
  function buyerLocation(request) {
    if (!request || request.kind !== 'publisher.prepare-buyer' || !REQUEST.test(request.requestId) ||
        !/^[a-f0-9-]{36}$/.test(request.run)) throw fault('PUBLISHER_ACTION_RECEIPT_INVALID');
    return join(directory, 'runs', request.run, 'buyer-requests', request.requestId);
  }
  async function preparedBuyer(request) {
    if (!request) return null;
    const folder = buyerLocation(request);
    if (await absent(folder)) return null;
    await privateDirectory(folder);
    const receipt = await readJson(join(folder, 'receipt.json'), MAXIMUM);
    if (receipt.schema !== SCHEMA || identity(receipt.request) !== identity(request) ||
        !receipt.result || identity(receipt.result) !== receipt.resultHash)
      throw fault('PUBLISHER_ACTION_RECEIPT_INVALID');
    const content = await readPrivate(join(folder, 'buyer.json'), MAXIMUM);
    const result = receipt.result;
    if (typeof result.configText !== 'string' || !HASH.test(result.configSha256 ?? '') ||
        digest(content) !== result.configSha256 || !content.equals(Buffer.from(result.configText)))
      throw fault('PUBLISHER_BUYER_FILE_CHANGED', 'The original prepared buyer file changed.', 409);
    // The immutable receipt keeps the sender's exact absolute path. A received
    // workspace exposes its corresponding local path without altering that history.
    const path = join(folder, 'buyer.json');
    return path === result.path ? clone(result) : { ...clone(result), path,
      originalPath: result.path, receiving: { kind: 'same-original-buyer-file', directory, sha256: result.configSha256 } };
  }
  async function retainBuyer(request, prepared) {
    const original = await preparedBuyer(request);
    if (original) return original;
    if (typeof prepared?.configText !== 'string' ||
        digest(Buffer.from(prepared.configText)) !== prepared.configSha256)
      throw fault('PUBLISHER_BUYER_CONFIGURATION_INVALID');
    const folder = buyerLocation(request), parent = join(directory, 'runs', request.run, 'buyer-requests');
    await privateDirectory(parent, true);
    const staging = join(parent, '.pending-' + request.requestId + '-' + randomUUID());
    await privateDirectory(staging, true);
    let renamed = false;
    try {
      const result = { ...prepared, path: join(folder, 'buyer.json') };
      await createFile(join(staging, 'buyer.json'), Buffer.from(prepared.configText));
      const receiptBytes = bytes({ schema: SCHEMA, request,
        createdAt: stamp(), result, resultHash: identity(result) });
      if (receiptBytes.length > MAXIMUM) throw fault('PUBLISHER_ACTION_RECEIPT_LIMIT');
      await createFile(join(staging, 'receipt.json'), receiptBytes);
      await syncDirectory(staging);
      await rename(staging, folder); renamed = true; await syncDirectory(parent);
      return await preparedBuyer(request);
    } finally {
      if (!renamed) await rm(staging, { recursive: true, force: true });
    }
  }
  async function validateBuyer(request, result) {
    if (!request) return result;
    const actual = await preparedBuyer(request);
    if (!actual || actual.configSha256 !== result.configSha256 ||
        actual.offerSha256 !== result.offerSha256 ||
        actual.configText !== result.configText)
      throw fault('PUBLISHER_BUYER_FILE_CHANGED', 'Read the exact retained original buyer configuration.', 409);
    return actual;
  }
  return Object.freeze({ bind, existing, remember, preparedBuyer, retainBuyer, validateBuyer });
}
