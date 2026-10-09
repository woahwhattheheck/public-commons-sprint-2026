// SPDX-License-Identifier: MIT
// Read-only evidence that a finalized SOL transfer settled this exact WorkSeal intent.
// RPC finality is trusted only to the operator-selected endpoint; this is not a light client.
import { WorkSealError, assertAtomic, assertSha256, sha256Hex } from './canonical.mjs';
import { SOLANA_SYSTEM_PROGRAM, SOLANA_MEMO_PROGRAM } from './solana.mjs';

const SETTLEMENT_SCHEMA = 'workseal-settlement-intent/v1';
const RESULT_SCHEMA = 'workseal-solana-finalized-settlement/v1';
const BASE58_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{80,90}$/;

function reject(code, reason) { throw new WorkSealError(code, reason); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }

function validateIntent(intent) {
  if (!object(intent) || intent.schema !== SETTLEMENT_SCHEMA) reject('BAD_INTENT', 'requires a WorkSeal settlement intent');
  for (const key of ['taskDigest', 'resultDigest', 'acceptanceDigest', 'eventHead', 'receiptAuthorityFingerprint']) {
    assertSha256(intent[key], `intent.${key}`);
  }
  if (intent.currency !== 'SOL_LAMPORTS') reject('UNSUPPORTED_CURRENCY', 'only SOL_LAMPORTS is verified here');
  if (typeof intent.payer !== 'string' || !intent.payer || typeof intent.payee !== 'string' || !intent.payee || intent.payer === intent.payee) {
    reject('BAD_PARTIES', 'payer and payee must be distinct non-empty addresses');
  }
  const atomic = assertAtomic(intent.amountAtomic, 'intent.amountAtomic');
  if (BigInt(atomic) > BigInt(Number.MAX_SAFE_INTEGER)) reject('UNSAFE_LAMPORTS', 'jsonParsed lamports cannot represent this amount exactly');
  return { settlementDigest: sha256Hex(intent), lamports: Number(atomic) };
}

function memoData(instruction) {
  if (instruction.programId !== SOLANA_MEMO_PROGRAM) return null;
  // Solana jsonParsed emits Memo as the exact string (not a SystemProgram instruction).
  if (typeof instruction.parsed === 'string') return instruction.parsed;
  // Some RPC implementations wrap the Memo string as parsed.info.memo.
  if (object(instruction.parsed) && object(instruction.parsed.info) && typeof instruction.parsed.info.memo === 'string') {
    return instruction.parsed.info.memo;
  }
  reject('UNPARSED_MEMO', 'RPC did not return parsed memo text');
}

/**
 * A normalized, fail-closed comparison of a Solana `getTransaction` response.
 * `commitment` must be the documented commitment actually requested from RPC;
 * use fetchFinalizedSolanaSettlement() to construct this assertion automatically.
 * This function cannot independently prove the operator's RPC endpoint is honest.
 */
export function verifyFinalizedSolanaSettlement({ intent, signature, commitment, transaction }) {
  const { settlementDigest, lamports } = validateIntent(intent);
  if (commitment !== 'finalized') reject('UNFINALIZED', 'requires finalized RPC commitment');
  if (typeof signature !== 'string' || !BASE58_SIGNATURE.test(signature)) reject('BAD_SIGNATURE', 'requires a base58 Solana signature');
  if (!object(transaction)) reject('NOT_FOUND', 'finalized transaction has not been returned');
  if (!Number.isSafeInteger(transaction.slot) || transaction.slot < 1) reject('BAD_SLOT', 'missing valid finalized slot');
  if (!object(transaction.meta) || transaction.meta.err !== null) reject('FAILED_TRANSACTION', 'transaction execution did not succeed');
  const message = transaction.transaction?.message;
  const signatures = transaction.transaction?.signatures;
  if (!object(message) || !Array.isArray(signatures) || !signatures.includes(signature)) {
    reject('SIGNATURE_MISMATCH', 'transaction does not contain the requested signature');
  }
  if (!Array.isArray(message.accountKeys) || !message.accountKeys.some((key) => object(key) && key.pubkey === intent.payer && key.signer === true)) {
    reject('PAYER_NOT_SIGNER', 'payer must sign the transaction');
  }
  if (!Array.isArray(message.instructions) || message.instructions.length > 64) reject('BAD_INSTRUCTIONS', 'bounded parsed instructions required');
  const exactMemo = `WORKSEAL:v1:${settlementDigest}`;
  let memos = 0;
  let transfers = 0;
  for (const instruction of message.instructions) {
    if (!object(instruction)) reject('BAD_INSTRUCTION', 'malformed instruction');
    if (instruction.programId === SOLANA_MEMO_PROGRAM) {
      if (memoData(instruction) !== exactMemo) reject('MEMO_MISMATCH', 'unexpected WorkSeal memo payload');
      memos++;
    }
    if (instruction.programId === SOLANA_SYSTEM_PROGRAM && instruction.parsed?.type === 'transfer') {
      const info = instruction.parsed?.info;
      if (!object(info) || info.source !== intent.payer || info.destination !== intent.payee ||
          !Number.isSafeInteger(info.lamports) || info.lamports !== lamports) {
        reject('TRANSFER_MISMATCH', 'SystemProgram transfer does not match intended payer/payee/amount');
      }
      transfers++;
    }
  }
  if (memos !== 1 || transfers !== 1) reject('INSTRUCTION_SET_MISMATCH', 'require exactly one matching memo and one SOL transfer');
  return Object.freeze({
    schema: RESULT_SCHEMA, settlementDigest, signature, slot: transaction.slot,
    transfer: { from: intent.payer, to: intent.payee, lamports: String(lamports) },
    rpcCommitment: 'finalized', transactionSucceeded: true, writePerformed: false,
  });
}

/** Read-only Solana JSON-RPC getTransaction (no wallet, no signing or broadcast). */
export async function fetchFinalizedSolanaSettlement({ intent, signature, rpcUrl, fetchImpl = fetch, timeoutMs = 12000 }) {
  validateIntent(intent);
  if (typeof rpcUrl !== 'string') reject('BAD_RPC_URL', 'operator must supply an HTTPS Solana RPC URL');
  let url;
  try { url = new URL(rpcUrl); } catch { reject('BAD_RPC_URL', 'invalid Solana RPC URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) reject('BAD_RPC_URL', 'HTTPS RPC URL without embedded credentials or fragment required');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) reject('BAD_TIMEOUT', 'timeout must be 100..30000 ms');
  if (typeof signature !== 'string' || !BASE58_SIGNATURE.test(signature)) reject('BAD_SIGNATURE', 'requires a base58 Solana signature');
  const payload = { jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [signature, { encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 0, rewards: false }] };
  let response;
  try {
    response = await fetchImpl(url.toString(), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs),
    });
  } catch { reject('RPC_UNAVAILABLE', 'read-only finalized RPC query failed'); }
  if (!response?.ok) reject('RPC_UNAVAILABLE', 'RPC endpoint returned an unsuccessful HTTP status');
  let data;
  try { data = await response.json(); } catch { reject('BAD_RPC_RESPONSE', 'RPC response is not JSON'); }
  if (!object(data) || data.jsonrpc !== '2.0' || data.id !== 1 || data.error) reject('BAD_RPC_RESPONSE', 'RPC response has an error or wrong request id');
  return verifyFinalizedSolanaSettlement({ intent, signature, commitment: 'finalized', transaction: data.result });
}
