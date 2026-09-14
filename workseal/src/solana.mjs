import { WorkSealError, assertAtomic, assertNonEmptyString, assertSha256, sha256Hex } from './canonical.mjs';

export const SOLANA_SYSTEM_PROGRAM = '11111111111111111111111111111111';
export const SOLANA_MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

function fail(code, message) {
  throw new WorkSealError(code, message);
}

export function makeSolanaSettlementPlan(intent, { cluster = 'devnet' } = {}) {
  if (intent.schema !== 'workseal-settlement-intent/v1') fail('BAD_SCHEMA', 'intent is not a WorkSeal settlement intent');
  if (intent.currency !== 'SOL_LAMPORTS') fail('UNSUPPORTED_CURRENCY', 'Solana v1 adapter currently supports SOL_LAMPORTS only');
  const lamports = assertAtomic(intent.amountAtomic, 'intent.amountAtomic');
  const payer = assertNonEmptyString(intent.payer, 'intent.payer', 64);
  const payee = assertNonEmptyString(intent.payee, 'intent.payee', 64);
  assertSha256(intent.taskDigest, 'intent.taskDigest');
  assertSha256(intent.resultDigest, 'intent.resultDigest');
  assertSha256(intent.acceptanceDigest, 'intent.acceptanceDigest');
  assertSha256(intent.eventHead, 'intent.eventHead');
  if (!['devnet', 'testnet', 'mainnet-beta', 'localnet'].includes(cluster)) fail('BAD_CLUSTER', 'unsupported Solana cluster');

  const settlementDigest = sha256Hex(intent);
  const memo = `WORKSEAL:v1:${settlementDigest}`;
  return {
    schema: 'workseal-solana-plan/v1',
    cluster,
    settlementDigest,
    authority: 'CLIENT_MUST_VERIFY_WORKSEAL_ACCEPTANCE_BEFORE_SIGNING',
    writePerformed: false,
    instructions: [
      {
        programId: SOLANA_MEMO_PROGRAM,
        kind: 'memo',
        utf8: memo,
      },
      {
        programId: SOLANA_SYSTEM_PROGRAM,
        kind: 'systemTransfer',
        from: payer,
        to: payee,
        lamports,
      },
    ],
  };
}
