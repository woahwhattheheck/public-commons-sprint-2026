/** Finalized read-only account inspection for an already constructed WorkSeal SPL plan.
 * JSON-RPC account observations are advisory; they do not prove a signed receipt,
 * secure chain endpoint, escrow, or continued balances at transaction signing.
 */
import { SOLANA_MEMO_PROGRAM, SPL_TOKEN_PROGRAM } from './solana_spl.mjs';

export class SolanaSplPreflightError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SolanaSplPreflightError';
    this.code = code;
  }
}

const TOKEN_PROGRAM = SPL_TOKEN_PROGRAM;
const RPC_ENDPOINTS = Object.freeze({
  devnet: 'https://api.devnet.solana.com',
  testnet: 'https://api.testnet.solana.com',
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
});
const MAX_RESPONSE_BYTES = 256 * 1024;
const DECIMAL_ATOMIC = /^[1-9][0-9]*$/;

function fail(code, message) {
  throw new SolanaSplPreflightError(code, message);
}

// Byte and signer-role binding for the exact unsigned maker's transfer plan.
// A downstream wallet can serialize these fields directly into an instruction.
function exactAccountMeta(actual, pubkey, isSigner, isWritable) {
  return actual && typeof actual === 'object' && !Array.isArray(actual)
    && Object.keys(actual).length === 3
    && actual.pubkey === pubkey && actual.isSigner === isSigner
    && actual.isWritable === isWritable;
}

function encodedTransferChecked(atomic, decimals) {
  const bytes = Buffer.alloc(10);
  bytes.writeUInt8(12, 0);
  bytes.writeBigUInt64LE(BigInt(atomic), 1);
  bytes.writeUInt8(decimals, 9);
  return bytes.toString('hex');
}

function checkPlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)
      || plan.schema !== 'workseal-solana-spl-plan/v1'
      || plan.unsigned !== true || plan.writePerformed !== false
      || plan.onchainEscrowEnforced !== false) {
    fail('INVALID_PLAN', 'expected an unsigned, nonexecuting WorkSeal SPL plan');
  }
  if (!Object.hasOwn(RPC_ENDPOINTS, plan.cluster)) {
    fail('UNSUPPORTED_CLUSTER', 'explicit trusted RPC endpoint is unavailable for this cluster');
  }
  if (!DECIMAL_ATOMIC.test(plan.amountAtomic)
      || BigInt(plan.amountAtomic) > 18446744073709551615n) {
    fail('INVALID_AMOUNT', 'amount must be a positive SPL u64 atomic string');
  }
  const keys = ['mint', 'authority', 'tokenAccountPreflight', 'settlementDigest'];
  if (keys.some((key) => !Object.hasOwn(plan, key))) {
    fail('INVALID_PLAN', 'missing required WorkSeal fields');
  }
  const preflight = plan.tokenAccountPreflight;
  if (!preflight || preflight.tokenProgram !== TOKEN_PROGRAM
      || preflight.mint !== plan.mint || !Number.isInteger(plan.decimals)
      || plan.decimals < 0 || plan.decimals > 255 || preflight.decimals !== plan.decimals
      || typeof preflight.owner !== 'string' || typeof preflight.destinationOwner !== 'string'
      || typeof preflight.sourceTokenAccount !== 'string'
      || typeof preflight.destinationTokenAccount !== 'string'
      || preflight.sourceTokenAccount === preflight.destinationTokenAccount
      || preflight.owner === preflight.destinationOwner) {
    fail('INVALID_PLAN', 'mint, owner, account and decimals must agree with the unsigned plan');
  }
  if (plan.currency !== `SPL_TOKEN:${plan.mint}`
      || !/^[0-9a-f]{64}$/.test(plan.settlementDigest)) {
    fail('INVALID_PLAN', 'plan currency/memo digest is not pinned');
  }
  const memo = plan.instructions?.[0];
  const transfer = plan.instructions?.[1];
  const memoKeys = ['programId', 'kind', 'utf8'];
  const transferKeys = ['programId', 'kind', 'sourceTokenAccount', 'mint',
    'destinationTokenAccount', 'owner', 'amountAtomic', 'decimals', 'accounts', 'dataHex'];
  if (plan.instructions?.length !== 2 || !memo || !transfer
      || Object.keys(memo).length !== memoKeys.length
      || memoKeys.some(key => !Object.hasOwn(memo, key))
      || Object.keys(transfer).length !== transferKeys.length
      || transferKeys.some(key => !Object.hasOwn(transfer, key))
      || memo.programId !== SOLANA_MEMO_PROGRAM || memo.kind !== 'memo'
      || memo.utf8 !== `WORKSEAL:v1:${plan.settlementDigest}`
      || transfer.kind !== 'transferChecked' || transfer.programId !== TOKEN_PROGRAM
      || transfer.mint !== plan.mint || transfer.owner !== preflight.owner
      || transfer.sourceTokenAccount !== preflight.sourceTokenAccount
      || transfer.destinationTokenAccount !== preflight.destinationTokenAccount
      || transfer.amountAtomic !== plan.amountAtomic || transfer.decimals !== plan.decimals
      || transfer.dataHex !== encodedTransferChecked(plan.amountAtomic, plan.decimals)
      || !Array.isArray(transfer.accounts) || transfer.accounts.length !== 4
      || !exactAccountMeta(transfer.accounts[0], preflight.sourceTokenAccount, false, true)
      || !exactAccountMeta(transfer.accounts[1], plan.mint, false, false)
      || !exactAccountMeta(transfer.accounts[2], preflight.destinationTokenAccount, false, true)
      || !exactAccountMeta(transfer.accounts[3], preflight.owner, true, false)) {
    fail('INVALID_PLAN', 'serialized transfer bytes, account metas or memo differ from the bound plan');
  }
  return preflight;
}

async function boundedJson(response) {
  if (!response || response.ok !== true || !response.body?.getReader) {
    fail('RPC_HTTP_ERROR', 'Solana RPC returned no successful streaming response');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let count = 0;
  let content = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      count += value.byteLength;
      if (count > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        fail('RPC_RESPONSE_TOO_LARGE', 'Solana RPC account response exceeds byte budget');
      }
      content += decoder.decode(value, { stream: true });
    }
    content += decoder.decode();
    return JSON.parse(content);
  } catch (error) {
    if (error instanceof SolanaSplPreflightError) throw error;
    fail('INVALID_RPC_RESPONSE', 'malformed or unreadable Solana RPC response');
  } finally {
    reader.releaseLock();
  }
}

function accountAt(value, index, kind) {
  const record = value[index];
  if (!record || record.owner !== TOKEN_PROGRAM || record.executable !== false
      || record.data?.program !== 'spl-token' || record.data?.parsed?.type !== kind
      || !record.data.parsed.info || typeof record.data.parsed.info !== 'object') {
    fail('INVALID_TOKEN_ACCOUNT', `${kind} account ${index} is missing or not classic SPL Token`);
  }
  return record.data.parsed.info;
}

/** Inspect finalized mint, source and destination accounts using a pinned cluster RPC.
 * The caller must independently verify the signed WorkSeal receipt and fresh state
 * before submitting a transaction. This method does not sign or broadcast anything.
 */
export async function preflightSolanaSplTokenAccounts(plan, {
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  const preflight = checkPlan(plan);
  if (typeof fetchImpl !== 'function') fail('NO_TRANSPORT', 'read-only fetch transport unavailable');
  const addresses = [plan.mint, preflight.sourceTokenAccount, preflight.destinationTokenAccount];
  const payload = {
    jsonrpc: '2.0', id: 1, method: 'getMultipleAccounts',
    params: [addresses, { encoding: 'jsonParsed', commitment: 'finalized' }],
  };
  let response;
  try {
    response = await fetchImpl(RPC_ENDPOINTS[plan.cluster], {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: signal ?? AbortSignal.timeout(10_000),
    });
  } catch {
    fail('RPC_UNAVAILABLE', 'Solana finalized account RPC request failed');
  }
  const document = await boundedJson(response);
  if (document?.jsonrpc !== '2.0' || document.id !== 1 || document.error
      || !Number.isSafeInteger(document.result?.context?.slot)
      || document.result.context.slot < 0 || !Array.isArray(document.result?.value)
      || document.result.value.length !== 3) {
    fail('INVALID_RPC_RESPONSE', 'Solana RPC result lacks three finalized account observations');
  }
  const accounts = document.result.value;
  const mint = accountAt(accounts, 0, 'mint');
  const source = accountAt(accounts, 1, 'account');
  const destination = accountAt(accounts, 2, 'account');
  if (mint.decimals !== plan.decimals || source.mint !== plan.mint
      || destination.mint !== plan.mint
      || source.tokenAmount?.decimals !== plan.decimals
      || destination.tokenAmount?.decimals !== plan.decimals) {
    fail('TOKEN_MINT_MISMATCH', 'mint account/decimals differ from the bound settlement plan');
  }
  if (source.owner !== preflight.owner || destination.owner !== preflight.destinationOwner) {
    fail('TOKEN_OWNER_MISMATCH', 'token account owner differs from payer/payee');
  }
  if (source.state !== 'initialized' || destination.state !== 'initialized'
      || !/^(0|[1-9][0-9]*)$/.test(source.tokenAmount?.amount ?? '')) {
    fail('UNAVAILABLE_TOKEN_ACCOUNT', 'frozen/uninitialized token account or noncanonical amount');
  }
  if (BigInt(source.tokenAmount.amount) < BigInt(plan.amountAtomic)) {
    fail('INSUFFICIENT_TOKEN_BALANCE', 'source token balance is less than planned amount');
  }
  return Object.freeze({
    schema: 'workseal-solana-spl-account-observation/v1',
    status: 'FINALIZED_RPC_ACCOUNT_MATCH',
    cluster: plan.cluster,
    slot: document.result.context.slot,
    settlementDigest: plan.settlementDigest,
    mint: plan.mint,
    decimals: plan.decimals,
    sourceAmountAtomic: source.tokenAmount.amount,
    plannedAmountAtomic: plan.amountAtomic,
    noTransactionCreated: true,
    qualification: 'RPC account observation only; verify pinned receipt, fresh balances and replay defense at signing time',
  });
}
