export const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
export const LAMPORTS_PER_SOL = 1_000_000_000;

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_INDEX = new Map([...BASE58_ALPHABET].map((character, index) => [character, index]));
const DEFAULT_CONFIRM_ATTEMPTS = 40;
const DEFAULT_CONFIRM_INTERVAL_MS = 500;

function asBytes(value, label = 'bytes') {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError(`${label} must be a Uint8Array-compatible value.`);
}

export function decodeBase58(value) {
  const text = String(value ?? '');
  if (!text) throw new Error('Base58 value is required.');

  let bytes = [0];
  for (const character of text) {
    const digit = BASE58_INDEX.get(character);
    if (digit === undefined) throw new Error(`Invalid base58 character: ${character}`);

    let carry = digit;
    for (let index = 0; index < bytes.length; index += 1) {
      const accumulator = bytes[index] * 58 + carry;
      bytes[index] = accumulator & 0xff;
      carry = accumulator >> 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  for (let index = 0; index < text.length - 1 && text[index] === '1'; index += 1) {
    bytes.push(0);
  }

  return Uint8Array.from(bytes.reverse());
}

export function assertPublicKey(value, label = 'public key') {
  const text = String(value ?? '');
  const decoded = decodeBase58(text);
  if (decoded.byteLength !== 32) {
    throw new Error(`${label} must decode to exactly 32 bytes.`);
  }
  return text;
}

export function encodeShortVecLength(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff) {
    throw new RangeError('Short-vector length must be an integer between 0 and 65535.');
  }
  const output = [];
  let remaining = value;
  do {
    let byte = remaining & 0x7f;
    remaining >>= 7;
    if (remaining > 0) byte |= 0x80;
    output.push(byte);
  } while (remaining > 0);
  return Uint8Array.from(output);
}

function concatBytes(...chunks) {
  const normalized = chunks.map((chunk) => asBytes(chunk));
  const output = new Uint8Array(normalized.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of normalized) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export function buildUnsignedMemoTransaction({
  feePayer,
  recentBlockhash,
  memo,
  memoProgramId = MEMO_PROGRAM_ID,
}) {
  const payerBytes = decodeBase58(assertPublicKey(feePayer, 'fee payer'));
  const programBytes = decodeBase58(assertPublicKey(memoProgramId, 'memo program id'));
  const blockhashBytes = decodeBase58(assertPublicKey(recentBlockhash, 'recent blockhash'));
  const memoBytes = new TextEncoder().encode(String(memo ?? ''));

  const message = concatBytes(
    Uint8Array.of(1, 0, 1),
    encodeShortVecLength(2),
    payerBytes,
    programBytes,
    blockhashBytes,
    encodeShortVecLength(1),
    Uint8Array.of(1),
    encodeShortVecLength(0),
    encodeShortVecLength(memoBytes.byteLength),
    memoBytes,
  );

  return concatBytes(
    encodeShortVecLength(1),
    new Uint8Array(64),
    message,
  );
}

export function bytesToBase64(value) {
  const bytes = asBytes(value, 'transaction bytes');
  let binary = '';
  for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.byteLength)));
  }
  if (typeof globalThis.btoa !== 'function') {
    throw new Error('Base64 encoding is unavailable in this runtime.');
  }
  return globalThis.btoa(binary);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class CookieChainRpc {
  constructor(url, { fetchImpl = globalThis.fetch } = {}) {
    this.url = new URL(String(url)).href;
    if (typeof fetchImpl !== 'function') throw new Error('Cookie Chain RPC requires fetch().');
    this.fetchImpl = fetchImpl;
    this.nextId = 1;
  }

  async call(method, params = []) {
    const response = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: this.nextId++,
        method,
        params,
      }),
    });
    if (!response.ok) throw new Error(`Cookie Chain RPC ${method} returned HTTP ${response.status}.`);

    const body = await response.json();
    if (!body || body.jsonrpc !== '2.0') throw new Error(`Cookie Chain RPC ${method} returned malformed JSON-RPC.`);
    if (body.error) {
      const detail = typeof body.error.message === 'string' ? body.error.message : JSON.stringify(body.error);
      throw new Error(`Cookie Chain RPC ${method} failed: ${detail}`);
    }
    if (!Object.hasOwn(body, 'result')) throw new Error(`Cookie Chain RPC ${method} omitted result.`);
    return body.result;
  }

  getVersion() {
    return this.call('getVersion');
  }

  getSlot(commitment = 'confirmed') {
    return this.call('getSlot', [{ commitment }]);
  }

  getEpochInfo(commitment = 'confirmed') {
    return this.call('getEpochInfo', [{ commitment }]);
  }

  getRecentPerformanceSamples(limit = 1) {
    return this.call('getRecentPerformanceSamples', [limit]);
  }

  getGenesisHash() {
    return this.call('getGenesisHash');
  }

  async getBalance(address, commitment = 'confirmed') {
    const result = await this.call('getBalance', [assertPublicKey(address), { commitment }]);
    if (!Number.isSafeInteger(result?.value) || result.value < 0) {
      throw new Error('Cookie Chain RPC getBalance returned an invalid lamport value.');
    }
    return result.value;
  }

  async getLatestBlockhash(commitment = 'confirmed') {
    const result = await this.call('getLatestBlockhash', [{ commitment }]);
    if (!result?.value?.blockhash || !Number.isSafeInteger(result.value.lastValidBlockHeight)) {
      throw new Error('Cookie Chain RPC getLatestBlockhash returned an invalid value.');
    }
    assertPublicKey(result.value.blockhash, 'recent blockhash');
    return result.value;
  }

  getSignaturesForAddress(address, options = {}, commitment = 'confirmed') {
    return this.call('getSignaturesForAddress', [
      assertPublicKey(address),
      { ...options, commitment },
    ]);
  }

  getParsedTransaction(signature, commitment = 'confirmed') {
    return this.call('getTransaction', [
      String(signature),
      {
        encoding: 'jsonParsed',
        commitment,
        maxSupportedTransactionVersion: 0,
      },
    ]);
  }

  sendRawTransaction(signedTransaction, {
    skipPreflight = false,
    maxRetries = 3,
    preflightCommitment = 'confirmed',
  } = {}) {
    return this.call('sendTransaction', [
      bytesToBase64(signedTransaction),
      {
        encoding: 'base64',
        skipPreflight,
        maxRetries,
        preflightCommitment,
      },
    ]);
  }

  getSignatureStatuses(signatures) {
    return this.call('getSignatureStatuses', [
      signatures.map((signature) => String(signature)),
      { searchTransactionHistory: true },
    ]);
  }

  getBlockHeight(commitment = 'confirmed') {
    return this.call('getBlockHeight', [{ commitment }]);
  }

  async confirmTransaction({
    signature,
    lastValidBlockHeight,
    commitment = 'confirmed',
    attempts = DEFAULT_CONFIRM_ATTEMPTS,
    intervalMs = DEFAULT_CONFIRM_INTERVAL_MS,
  }) {
    if (!signature) throw new Error('Transaction signature is required.');
    if (!Number.isSafeInteger(lastValidBlockHeight) || lastValidBlockHeight < 0) {
      throw new Error('lastValidBlockHeight must be a non-negative safe integer.');
    }
    if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 300) {
      throw new Error('Confirmation attempts must be between 1 and 300.');
    }
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 0 || intervalMs > 10_000) {
      throw new Error('Confirmation interval must be between 0 and 10000 ms.');
    }

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const statusResult = await this.getSignatureStatuses([signature]);
      const status = statusResult?.value?.[0] ?? null;
      if (status?.err) throw new Error(`Transaction confirmed with error: ${JSON.stringify(status.err)}`);
      if (status && ['confirmed', 'finalized'].includes(status.confirmationStatus)) return status;

      const blockHeight = await this.getBlockHeight(commitment);
      if (Number.isSafeInteger(blockHeight) && blockHeight > lastValidBlockHeight) {
        throw new Error('The transaction expired before confirmation.');
      }
      if (attempt + 1 < attempts && intervalMs > 0) await sleep(intervalMs);
    }

    throw new Error('Timed out waiting for transaction confirmation.');
  }
}
