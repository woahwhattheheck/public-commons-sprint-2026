import { WorkSealError, assertAtomic, assertNonEmptyString, assertSha256, sha256Hex } from './canonical.mjs';

// Classic SPL Token only. Token-2022 extensions can change transfer semantics and
// require separate, explicit inspection; this module never silently selects them.
export const SPL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const SOLANA_MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
export const MAX_SPL_TOKEN_AMOUNT = 18446744073709551615n;
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const DIGITS = new Map([...BASE58].map((letter, index) => [letter, BigInt(index)]));

function fail(code, message) {
  throw new WorkSealError(code, message);
}

export function assertSolanaAddress(value, name) {
  assertNonEmptyString(value, name, 44);
  let number = 0n;
  let leadingZeroBytes = 0;
  for (const letter of value) {
    const digit = DIGITS.get(letter);
    if (digit === undefined) fail('BAD_PUBKEY', `${name} must be base58`);
    number = number * 58n + digit;
  }
  for (const letter of value) {
    if (letter !== '1') break;
    leadingZeroBytes += 1;
  }
  let payloadLength = 0;
  while (number > 0n) {
    payloadLength += 1;
    number >>= 8n;
  }
  if (leadingZeroBytes + payloadLength !== 32) {
    fail('BAD_PUBKEY', `${name} must decode to exactly 32 bytes`);
  }
  return value;
}

/**
 * Build a non-executing, deterministic classic SPL Token TransferChecked plan.
 *
 * Currency is pinned in the signed WorkSeal task as SPL_TOKEN:<mint address>.
 * The supplied token-account addresses MUST be independently checked against
 * current on-chain state before signing: owner, mint, amount and recipient.
 * No account lookups, wallet access, signatures or transactions occur here.
 */
export function makeSolanaSplSettlementPlan(intent, {
  mint,
  sourceTokenAccount,
  destinationTokenAccount,
  decimals,
  cluster = 'devnet',
} = {}) {
  if (!intent || typeof intent !== 'object' || Array.isArray(intent) || intent.schema !== 'workseal-settlement-intent/v1') {
    fail('BAD_SCHEMA', 'intent must be a WorkSeal settlement intent');
  }
  if (!['devnet', 'testnet', 'mainnet-beta', 'localnet'].includes(cluster)) {
    fail('BAD_CLUSTER', 'unsupported Solana cluster');
  }
  assertSolanaAddress(mint, 'mint');
  if (intent.currency !== `SPL_TOKEN:${mint}`) {
    fail('UNSUPPORTED_CURRENCY', 'signed task currency must be SPL_TOKEN:<exact mint>');
  }
  const payer = assertSolanaAddress(intent.payer, 'intent.payer');
  const payee = assertSolanaAddress(intent.payee, 'intent.payee');
  const source = assertSolanaAddress(sourceTokenAccount, 'sourceTokenAccount');
  const destination = assertSolanaAddress(destinationTokenAccount, 'destinationTokenAccount');
  if (payer === payee || source === destination) {
    fail('SAME_PARTY', 'payer/payee and source/destination must be distinct');
  }
  for (const field of ['taskDigest', 'resultDigest', 'acceptanceDigest', 'receiptAuthorityFingerprint', 'eventHead']) {
    assertSha256(intent[field], `intent.${field}`);
  }
  if (!Number.isSafeInteger(intent.generation) || intent.generation < 1) {
    fail('BAD_GENERATION', 'intent.generation must be positive');
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    fail('BAD_DECIMALS', 'mint decimals must be an integer between 0 and 255');
  }
  const amount = BigInt(assertAtomic(intent.amountAtomic, 'intent.amountAtomic'));
  if (amount > MAX_SPL_TOKEN_AMOUNT) {
    fail('AMOUNT_OVERFLOW', 'SPL Token transfers are limited to unsigned 64-bit atomic amounts');
  }
  const payload = Buffer.alloc(10);
  payload.writeUInt8(12, 0); // TokenInstruction::TransferChecked
  payload.writeBigUInt64LE(amount, 1);
  payload.writeUInt8(decimals, 9);

  const settlementDigest = sha256Hex(intent);
  return {
    schema: 'workseal-solana-spl-plan/v1',
    cluster,
    settlementDigest,
    currency: intent.currency,
    amountAtomic: intent.amountAtomic,
    mint,
    decimals,
    authority: 'CLIENT_MUST_VERIFY_PINNED_WORKSEAL_ACCEPTANCE_AND_ONCHAIN_TOKEN_ACCOUNTS_BEFORE_SIGNING',
    tokenAccountPreflight: {
      owner: payer,
      sourceTokenAccount: source,
      destinationOwner: payee,
      destinationTokenAccount: destination,
      mint,
      decimals,
      tokenProgram: SPL_TOKEN_PROGRAM,
      requiredChecks: [
        'Fetch source/destination and mint using the chosen cluster at signing time.',
        'Both token accounts must belong to the classic SPL Token program and have this exact mint.',
        'The source token-account owner or valid delegate must authorize the transfer; this plan expects payer as owner.',
        'The destination token account must be owned by payee; confirm its existence and correct mint.',
        'Verify mint decimals and sufficient source balance; verify the signed WorkSeal receipt against this exact result generation.',
        'Use a fresh blockhash, fee payer, and current chain instructions; prevent duplicate settlement/replay in the signing application.',
      ],
    },
    unsigned: true,
    writePerformed: false,
    onchainEscrowEnforced: false,
    instructions: [
      {
        programId: SOLANA_MEMO_PROGRAM,
        kind: 'memo',
        utf8: `WORKSEAL:v1:${settlementDigest}`,
      },
      {
        programId: SPL_TOKEN_PROGRAM,
        kind: 'transferChecked',
        sourceTokenAccount: source,
        mint,
        destinationTokenAccount: destination,
        owner: payer,
        amountAtomic: intent.amountAtomic,
        decimals,
        accounts: [
          { pubkey: source, isSigner: false, isWritable: true },
          { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: destination, isSigner: false, isWritable: true },
          { pubkey: payer, isSigner: true, isWritable: false },
        ],
        dataHex: payload.toString('hex'),
      },
    ],
  };
}
