import { createHash, createPublicKey, sign as nodeSign, verify as nodeVerify } from 'node:crypto';
import {
  WorkSealError,
  assertAtomic,
  assertNonEmptyString,
  assertSha256,
  canonicalJson,
  sha256Hex,
} from './canonical.mjs';
import { normalizeTask, taskDigest } from './protocol.mjs';

export const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const U64_MAX = 18446744073709551615n;

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_MAP = new Map([...BASE58].map((c, i) => [c, BigInt(i)]));
const PDA_MARKER = Buffer.from('ProgramDerivedAddress', 'utf8');
const P = (1n << 255n) - 19n;
const D = mod(-121665n * modInv(121666n));
const SQRT_M1 = modPow(2n, (P - 1n) / 4n, P);
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const ESCROW_SEED = Buffer.from('workseal-v1', 'utf8');
const ESCROW_SCHEMA = 'workseal-solana-escrow-plan/v1';
const STATE_SCHEMA = 'workseal-solana-escrow-state/v1';

function fail(code, message) {
  throw new WorkSealError(code, message);
}

function assertExactKeys(object, allowed, name) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) fail('BAD_OBJECT', `${name} must be an object`);
  const extras = Object.keys(object).filter((key) => !allowed.includes(key));
  if (extras.length) fail('UNKNOWN_FIELD', `${name} has unknown field(s): ${extras.sort().join(', ')}`);
}

function mod(value) {
  const x = value % P;
  return x < 0n ? x + P : x;
}

function modPow(base, exponent, modulus = P) {
  let b = ((base % modulus) + modulus) % modulus;
  let e = exponent;
  let out = 1n;
  while (e > 0n) {
    if (e & 1n) out = (out * b) % modulus;
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return out;
}

function modInv(value) {
  return modPow(mod(value), P - 2n, P);
}

function bytesToBigIntLE(bytes) {
  let n = 0n;
  for (let i = bytes.length - 1; i >= 0; i -= 1) n = (n << 8n) + BigInt(bytes[i]);
  return n;
}

export function base58Encode(bytes) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) fail('BAD_BYTES', 'base58 input must be bytes');
  const input = Buffer.from(bytes);
  let zeroes = 0;
  while (zeroes < input.length && input[zeroes] === 0) zeroes += 1;
  let n = 0n;
  for (const byte of input) n = n * 256n + BigInt(byte);
  let encoded = '';
  while (n > 0n) {
    const rem = Number(n % 58n);
    encoded = BASE58[rem] + encoded;
    n /= 58n;
  }
  return '1'.repeat(zeroes) + encoded;
}

export function base58Decode(value) {
  const text = assertNonEmptyString(value, 'base58', 128);
  let zeroes = 0;
  while (zeroes < text.length && text[zeroes] === '1') zeroes += 1;
  let n = 0n;
  for (const c of text) {
    const digit = BASE58_MAP.get(c);
    if (digit === undefined) fail('BAD_BASE58', `invalid base58 character: ${c}`);
    n = n * 58n + digit;
  }
  const reversed = [];
  while (n > 0n) {
    reversed.push(Number(n % 256n));
    n /= 256n;
  }
  return Buffer.concat([Buffer.alloc(zeroes), Buffer.from(reversed.reverse())]);
}

export function decodePubkey(value, name = 'pubkey') {
  let bytes;
  try {
    bytes = base58Decode(value);
  } catch (error) {
    if (error instanceof WorkSealError) fail('BAD_PUBKEY', `${name} is not valid base58: ${error.message}`);
    throw error;
  }
  if (bytes.length !== 32) fail('BAD_PUBKEY', `${name} must decode to exactly 32 bytes`);
  return bytes;
}

export function pubkeyFromSeed(seed) {
  return base58Encode(createHash('sha256').update(assertNonEmptyString(seed, 'seed', 1000)).digest());
}

function isEd25519Point(compressed) {
  if (compressed.length !== 32) return false;
  const copy = Buffer.from(compressed);
  const sign = (copy[31] >> 7) & 1;
  copy[31] &= 0x7f;
  const y = bytesToBigIntLE(copy);
  if (y >= P) return false;
  const y2 = mod(y * y);
  const denominator = mod(D * y2 + 1n);
  if (denominator === 0n) return false;
  const x2 = mod((y2 - 1n) * modInv(denominator));
  let x = modPow(x2, (P + 3n) / 8n, P);
  if (mod(x * x - x2) !== 0n) x = mod(x * SQRT_M1);
  if (mod(x * x - x2) !== 0n) return false;
  if (x === 0n && sign === 1) return false;
  return true;
}

export function createProgramAddress(seeds, programId) {
  if (!Array.isArray(seeds) || seeds.length > 16) fail('BAD_SEEDS', 'PDA requires at most 16 seeds');
  const seedBytes = seeds.map((seed, index) => {
    if (!Buffer.isBuffer(seed) && !(seed instanceof Uint8Array)) fail('BAD_SEED', `seed[${index}] must be bytes`);
    const bytes = Buffer.from(seed);
    if (bytes.length > 32) fail('BAD_SEED', `seed[${index}] exceeds 32 bytes`);
    return bytes;
  });
  const program = decodePubkey(programId, 'programId');
  const digest = createHash('sha256').update(Buffer.concat([...seedBytes, program, PDA_MARKER])).digest();
  if (isEd25519Point(digest)) fail('PDA_ON_CURVE', 'derived address lies on the ed25519 curve');
  return base58Encode(digest);
}

export function findProgramAddress(seeds, programId) {
  if (!Array.isArray(seeds) || seeds.length >= 16) fail('BAD_SEEDS', 'PDA bump requires at most 15 caller seeds');
  for (let bump = 255; bump >= 0; bump -= 1) {
    try {
      return { address: createProgramAddress([...seeds, Buffer.from([bump])], programId), bump };
    } catch (error) {
      if (!(error instanceof WorkSealError) || error.code !== 'PDA_ON_CURVE') throw error;
    }
  }
  fail('PDA_NOT_FOUND', 'no off-curve PDA bump found');
}

export function associatedTokenAddress(owner, mint) {
  const ownerBytes = decodePubkey(owner, 'owner');
  const tokenProgramBytes = decodePubkey(SPL_TOKEN_PROGRAM_ID, 'tokenProgramId');
  const mintBytes = decodePubkey(mint, 'mint');
  return findProgramAddress([ownerBytes, tokenProgramBytes, mintBytes], ASSOCIATED_TOKEN_PROGRAM_ID);
}

export function ed25519SpkiFingerprint(pubkey) {
  const raw = decodePubkey(pubkey, 'verifierPubkey');
  return createHash('sha256').update(Buffer.concat([ED25519_SPKI_PREFIX, raw])).digest('hex');
}

function rawEd25519PublicKey(pubkey, name = 'pubkey') {
  const raw = decodePubkey(pubkey, name);
  return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
}

export function signCanonicalAuthorization(authorization, privateKeyPem) {
  return nodeSign(null, Buffer.from(canonicalJson(authorization)), privateKeyPem).toString('base64');
}

export function verifyCanonicalAuthorization(authorization, signatureBase64, signerPubkey) {
  if (typeof signatureBase64 !== 'string' || signatureBase64.length === 0) return false;
  try {
    return nodeVerify(
      null,
      Buffer.from(canonicalJson(authorization)),
      rawEd25519PublicKey(signerPubkey, 'signerPubkey'),
      Buffer.from(signatureBase64, 'base64'),
    );
  } catch {
    return false;
  }
}

export const WORKSEAL_ESCROW_PROGRAM_ID = base58Encode(
  createHash('sha256').update('workseal-solana-escrow-program-v1').digest(),
);

function parseSplCurrency(currency) {
  if (typeof currency !== 'string' || !currency.startsWith('SPL:')) {
    fail('UNSUPPORTED_CURRENCY', 'escrow requires currency format SPL:<mint-pubkey>');
  }
  const mint = currency.slice(4);
  decodePubkey(mint, 'currency mint');
  return mint;
}

function assertU64Atomic(value, name = 'amountAtomic') {
  const atomic = assertAtomic(value, name);
  const amount = BigInt(atomic);
  if (amount > U64_MAX) fail('AMOUNT_U64_OVERFLOW', `${name} exceeds Solana u64`);
  return atomic;
}

function assertCluster(cluster) {
  if (!['devnet', 'testnet', 'mainnet-beta', 'localnet'].includes(cluster)) fail('BAD_CLUSTER', 'unsupported Solana cluster');
  return cluster;
}

export function createEscrowPlan(task, receiptAuthorityFingerprint, {
  cluster = 'devnet',
  programId = WORKSEAL_ESCROW_PROGRAM_ID,
} = {}) {
  const normalized = normalizeTask(task);
  const td = taskDigest(normalized);
  const authority = assertSha256(receiptAuthorityFingerprint, 'receiptAuthorityFingerprint');
  const amountAtomic = assertU64Atomic(normalized.amountAtomic);
  const mint = parseSplCurrency(normalized.currency);
  const payer = normalized.buyer.settlementAddress;
  const payee = normalized.worker.settlementAddress;
  decodePubkey(payer, 'buyer.settlementAddress');
  decodePubkey(payee, 'worker.settlementAddress');
  decodePubkey(programId, 'programId');
  const selectedCluster = assertCluster(cluster);
  const refundAfterUnix = Math.floor(Date.parse(normalized.deadline) / 1000);
  if (!Number.isSafeInteger(refundAfterUnix) || refundAfterUnix <= 0) fail('BAD_REFUND_TIME', 'task deadline cannot be represented as a positive unix timestamp');
  const escrow = findProgramAddress([ESCROW_SEED, Buffer.from(td, 'hex')], programId);
  const buyerAta = associatedTokenAddress(payer, mint);
  const workerAta = associatedTokenAddress(payee, mint);
  const vaultAta = associatedTokenAddress(escrow.address, mint);
  const fundingRef = Object.freeze({
    chain: `solana:${selectedCluster}`,
    reference: `workseal-escrow:${escrow.address}`,
    currency: normalized.currency,
    amountAtomic,
  });
  const binding = {
    schema: 'workseal-solana-escrow-binding/v1',
    cluster: selectedCluster,
    programId,
    taskDigest: td,
    receiptAuthorityFingerprint: authority,
    payer,
    payee,
    mint,
    amountAtomic,
    refundAfterUnix,
    escrowPda: escrow.address,
    escrowBump: escrow.bump,
    buyerAta: buyerAta.address,
    workerAta: workerAta.address,
    vaultAta: vaultAta.address,
    tokenProgramId: SPL_TOKEN_PROGRAM_ID,
    associatedTokenProgramId: ASSOCIATED_TOKEN_PROGRAM_ID,
  };
  return {
    schema: ESCROW_SCHEMA,
    binding,
    bindingDigest: sha256Hex(binding),
    fundingRef,
    writePerformed: false,
    deploymentObserved: false,
    instructions: [
      {
        kind: 'initializeEscrow',
        signers: [payer, payee],
        escrowPda: escrow.address,
        taskDigest: td,
        receiptAuthorityFingerprint: authority,
        mint,
        amountAtomic,
        refundAfterUnix,
      },
      {
        kind: 'fundEscrowTransferChecked',
        signer: payer,
        sourceTokenAccount: buyerAta.address,
        destinationTokenAccount: vaultAta.address,
        mint,
        amountAtomic,
        tokenProgramId: SPL_TOKEN_PROGRAM_ID,
      },
    ],
  };
}

function normalizePlan(plan) {
  assertExactKeys(plan, ['schema', 'binding', 'bindingDigest', 'fundingRef', 'writePerformed', 'deploymentObserved', 'instructions'], 'plan');
  if (plan.schema !== ESCROW_SCHEMA) fail('BAD_SCHEMA', `plan.schema must be ${ESCROW_SCHEMA}`);
  if (plan.writePerformed !== false || plan.deploymentObserved !== false) fail('AUTHORITY_ESCALATION', 'offline plan cannot claim write/deployment');
  assertSha256(plan.bindingDigest, 'bindingDigest');
  if (sha256Hex(plan.binding) !== plan.bindingDigest) fail('BINDING_TAMPER', 'binding digest mismatch');
  const b = plan.binding;
  assertExactKeys(b, [
    'schema', 'cluster', 'programId', 'taskDigest', 'receiptAuthorityFingerprint', 'payer', 'payee', 'mint',
    'amountAtomic', 'refundAfterUnix', 'escrowPda', 'escrowBump', 'buyerAta', 'workerAta', 'vaultAta', 'tokenProgramId',
    'associatedTokenProgramId',
  ], 'binding');
  if (b.schema !== 'workseal-solana-escrow-binding/v1') fail('BAD_SCHEMA', 'bad binding schema');
  assertCluster(b.cluster);
  decodePubkey(b.programId, 'programId');
  assertSha256(b.taskDigest, 'taskDigest');
  assertSha256(b.receiptAuthorityFingerprint, 'receiptAuthorityFingerprint');
  decodePubkey(b.payer, 'payer');
  decodePubkey(b.payee, 'payee');
  decodePubkey(b.mint, 'mint');
  assertU64Atomic(b.amountAtomic);
  if (!Number.isSafeInteger(b.refundAfterUnix) || b.refundAfterUnix <= 0) fail('BAD_REFUND_TIME', 'refundAfterUnix must be a positive safe integer');
  decodePubkey(b.escrowPda, 'escrowPda');
  if (!Number.isSafeInteger(b.escrowBump) || b.escrowBump < 0 || b.escrowBump > 255) fail('BAD_BUMP', 'escrowBump must be 0..255');
  if (b.tokenProgramId !== SPL_TOKEN_PROGRAM_ID || b.associatedTokenProgramId !== ASSOCIATED_TOKEN_PROGRAM_ID) fail('PROGRAM_SUBSTITUTION', 'token program ids are not canonical');
  const expectedEscrow = findProgramAddress([ESCROW_SEED, Buffer.from(b.taskDigest, 'hex')], b.programId);
  if (expectedEscrow.address !== b.escrowPda || expectedEscrow.bump !== b.escrowBump) fail('PDA_MISMATCH', 'escrow PDA does not match task/program seeds');
  if (associatedTokenAddress(b.payer, b.mint).address !== b.buyerAta) fail('ATA_MISMATCH', 'buyer ATA mismatch');
  if (associatedTokenAddress(b.payee, b.mint).address !== b.workerAta) fail('ATA_MISMATCH', 'worker ATA mismatch');
  if (associatedTokenAddress(b.escrowPda, b.mint).address !== b.vaultAta) fail('ATA_MISMATCH', 'vault ATA mismatch');
  const expectedFunding = {
    chain: `solana:${b.cluster}`,
    reference: `workseal-escrow:${b.escrowPda}`,
    currency: `SPL:${b.mint}`,
    amountAtomic: b.amountAtomic,
  };
  if (canonicalJson(plan.fundingRef) !== canonicalJson(expectedFunding)) fail('FUNDING_REF_MISMATCH', 'fundingRef does not match escrow binding');
  return plan;
}

export function createEscrowState(plan) {
  const normalized = normalizePlan(plan);
  return {
    schema: STATE_SCHEMA,
    plan: normalized,
    planDigest: sha256Hex(normalized),
    phase: 'UNFUNDED',
    sequence: 0,
    fundingObservationDigest: null,
    resultDigest: null,
    acceptanceDigest: null,
    generation: 0,
    terminalDigest: null,
    previousEventDigest: null,
  };
}

function requireState(state) {
  if (!state || state.schema !== STATE_SCHEMA || !state.plan) fail('BAD_STATE', 'not a WorkSeal escrow state');
  normalizePlan(state.plan);
  if (sha256Hex(state.plan) !== state.planDigest) fail('STATE_PLAN_TAMPER', 'state plan digest mismatch');
  return state;
}

export function fundEscrow(state, observation) {
  const current = requireState(state);
  if (current.phase !== 'UNFUNDED') fail('BAD_PHASE', `cannot fund from ${current.phase}`);
  assertExactKeys(observation, ['schema', 'signer', 'sourceTokenAccount', 'destinationTokenAccount', 'mint', 'amountAtomic', 'escrowPda'], 'fundingObservation');
  if (observation.schema !== 'workseal-solana-funding-observation/v1') fail('BAD_SCHEMA', 'bad funding observation schema');
  const b = current.plan.binding;
  const checks = [
    ['signer', b.payer],
    ['sourceTokenAccount', b.buyerAta],
    ['destinationTokenAccount', b.vaultAta],
    ['mint', b.mint],
    ['amountAtomic', b.amountAtomic],
    ['escrowPda', b.escrowPda],
  ];
  for (const [field, expected] of checks) if (observation[field] !== expected) fail('FUNDING_MISMATCH', `${field} does not match escrow binding`);
  const digest = sha256Hex(observation);
  const event = {
    type: 'ESCROW_FUNDED',
    planDigest: current.planDigest,
    fundingObservationDigest: digest,
    sequence: current.sequence + 1,
    previousEventDigest: current.previousEventDigest,
  };
  return {
    ...current,
    phase: 'FUNDED',
    sequence: event.sequence,
    fundingObservationDigest: digest,
    previousEventDigest: sha256Hex(event),
  };
}

function validateSettlementIntent(intent, binding, fundingRef) {
  assertExactKeys(intent, [
    'schema', 'taskDigest', 'resultDigest', 'acceptanceDigest', 'receiptAuthorityFingerprint', 'generation',
    'currency', 'amountAtomic', 'payer', 'payee', 'funding', 'eventHead',
  ], 'settlementIntent');
  if (intent.schema !== 'workseal-settlement-intent/v1') fail('BAD_SCHEMA', 'bad settlement intent schema');
  assertSha256(intent.taskDigest, 'intent.taskDigest');
  assertSha256(intent.resultDigest, 'intent.resultDigest');
  assertSha256(intent.acceptanceDigest, 'intent.acceptanceDigest');
  assertSha256(intent.receiptAuthorityFingerprint, 'intent.receiptAuthorityFingerprint');
  assertSha256(intent.eventHead, 'intent.eventHead');
  if (!Number.isSafeInteger(intent.generation) || intent.generation < 1) fail('BAD_GENERATION', 'settlement generation must be positive');
  const expected = {
    taskDigest: binding.taskDigest,
    receiptAuthorityFingerprint: binding.receiptAuthorityFingerprint,
    currency: `SPL:${binding.mint}`,
    amountAtomic: binding.amountAtomic,
    payer: binding.payer,
    payee: binding.payee,
  };
  for (const [field, value] of Object.entries(expected)) if (intent[field] !== value) fail('SETTLEMENT_MISMATCH', `${field} does not match funded escrow`);
  if (canonicalJson(intent.funding) !== canonicalJson(fundingRef)) fail('SETTLEMENT_MISMATCH', 'funding ref does not match funded escrow');
}

export function settlementAuthorization(state, intent) {
  const current = requireState(state);
  if (current.phase !== 'FUNDED') fail('BAD_PHASE', `cannot authorize settlement from ${current.phase}`);
  const b = current.plan.binding;
  validateSettlementIntent(intent, b, current.plan.fundingRef);
  return {
    schema: 'workseal-solana-settlement-authorization/v1',
    planDigest: current.planDigest,
    taskDigest: intent.taskDigest,
    resultDigest: intent.resultDigest,
    acceptanceDigest: intent.acceptanceDigest,
    receiptAuthorityFingerprint: intent.receiptAuthorityFingerprint,
    generation: intent.generation,
    eventHead: intent.eventHead,
    escrowPda: b.escrowPda,
    mint: b.mint,
    amountAtomic: b.amountAtomic,
    payer: b.payer,
    payee: b.payee,
  };
}

export function settleEscrow(state, { intent, verifierPubkey, signatureBase64 }) {
  const current = requireState(state);
  if (current.phase !== 'FUNDED') fail('BAD_PHASE', `cannot settle from ${current.phase}`);
  const b = current.plan.binding;
  const authorization = settlementAuthorization(current, intent);
  if (ed25519SpkiFingerprint(verifierPubkey) !== b.receiptAuthorityFingerprint) {
    fail('AUTHORITY_MISMATCH', 'verifier signer does not match pinned WorkSeal receipt authority');
  }
  if (!verifyCanonicalAuthorization(authorization, signatureBase64, verifierPubkey)) {
    fail('BAD_SIGNATURE', 'settlement authorization is not signed by the pinned verifier key');
  }
  const settlementDigest = sha256Hex(intent);
  const instruction = {
    kind: 'settleEscrowTransferChecked',
    verifierSigner: verifierPubkey,
    escrowAuthority: b.escrowPda,
    sourceTokenAccount: b.vaultAta,
    destinationTokenAccount: b.workerAta,
    mint: b.mint,
    amountAtomic: b.amountAtomic,
    taskDigest: intent.taskDigest,
    resultDigest: intent.resultDigest,
    acceptanceDigest: intent.acceptanceDigest,
    generation: intent.generation,
    eventHead: intent.eventHead,
    authorizationDigest: sha256Hex(authorization),
    authorizationSignatureBase64: signatureBase64,
    writePerformed: false,
  };
  const event = {
    type: 'ESCROW_SETTLED',
    planDigest: current.planDigest,
    settlementDigest,
    instructionDigest: sha256Hex(instruction),
    sequence: current.sequence + 1,
    previousEventDigest: current.previousEventDigest,
  };
  return {
    ...current,
    phase: 'SETTLED',
    sequence: event.sequence,
    resultDigest: intent.resultDigest,
    acceptanceDigest: intent.acceptanceDigest,
    generation: intent.generation,
    terminalDigest: settlementDigest,
    terminalInstruction: instruction,
    previousEventDigest: sha256Hex(event),
  };
}

export function refundAuthorization(state, reasonDigest) {
  const current = requireState(state);
  if (current.phase !== 'FUNDED') fail('BAD_PHASE', `cannot authorize refund from ${current.phase}`);
  const b = current.plan.binding;
  return {
    schema: 'workseal-solana-refund-authorization/v1',
    planDigest: current.planDigest,
    taskDigest: b.taskDigest,
    escrowPda: b.escrowPda,
    mint: b.mint,
    amountAtomic: b.amountAtomic,
    payer: b.payer,
    refundAfterUnix: b.refundAfterUnix,
    reasonDigest: assertSha256(reasonDigest, 'reasonDigest'),
  };
}

export function refundEscrow(state, { signer, reasonDigest, signatureBase64, observedUnix }) {
  const current = requireState(state);
  if (current.phase !== 'FUNDED') fail('BAD_PHASE', `cannot refund from ${current.phase}`);
  const b = current.plan.binding;
  if (signer !== b.payer) fail('AUTHORITY_MISMATCH', 'refund requires the bound buyer signer');
  if (!Number.isSafeInteger(observedUnix)) fail('BAD_REFUND_TIME', 'observedUnix must be a safe integer');
  if (observedUnix < b.refundAfterUnix) fail('REFUND_NOT_MATURE', 'refund is not authorized before the task deadline');
  const authorization = refundAuthorization(current, reasonDigest);
  if (!verifyCanonicalAuthorization(authorization, signatureBase64, signer)) {
    fail('BAD_SIGNATURE', 'refund authorization is not signed by the bound buyer key');
  }
  const reason = authorization.reasonDigest;
  const instruction = {
    kind: 'refundEscrowTransferChecked',
    buyerSigner: signer,
    escrowAuthority: b.escrowPda,
    sourceTokenAccount: b.vaultAta,
    destinationTokenAccount: b.buyerAta,
    mint: b.mint,
    amountAtomic: b.amountAtomic,
    reasonDigest: reason,
    observedUnix,
    refundAfterUnix: b.refundAfterUnix,
    authorizationDigest: sha256Hex(authorization),
    authorizationSignatureBase64: signatureBase64,
    writePerformed: false,
  };
  const terminalDigest = sha256Hex({ schema: 'workseal-solana-refund/v1', planDigest: current.planDigest, reasonDigest: reason });
  const event = {
    type: 'ESCROW_REFUNDED',
    planDigest: current.planDigest,
    terminalDigest,
    instructionDigest: sha256Hex(instruction),
    sequence: current.sequence + 1,
    previousEventDigest: current.previousEventDigest,
  };
  return {
    ...current,
    phase: 'REFUNDED',
    sequence: event.sequence,
    terminalDigest,
    terminalInstruction: instruction,
    previousEventDigest: sha256Hex(event),
  };
}

export function verifyEscrowState(state) {
  const current = requireState(state);
  if (!['UNFUNDED', 'FUNDED', 'SETTLED', 'REFUNDED'].includes(current.phase)) fail('BAD_PHASE', 'unknown escrow phase');
  if (['SETTLED', 'REFUNDED'].includes(current.phase) && !current.terminalDigest) fail('BAD_TERMINAL_STATE', 'terminal state missing digest');
  return {
    valid: true,
    phase: current.phase,
    planDigest: current.planDigest,
    taskDigest: current.plan.binding.taskDigest,
    escrowPda: current.plan.binding.escrowPda,
    writePerformed: false,
    deploymentObserved: false,
  };
}

export const escrowSchemas = Object.freeze({ ESCROW_SCHEMA, STATE_SCHEMA });
