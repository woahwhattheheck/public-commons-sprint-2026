// MIT. Trusted operator configuration; review does not load signing material.
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

export class FacilitatorError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export const requireValue = (ok, code) => { if (!ok) throw new FacilitatorError(code); };
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
function fields(x, names, code) {
  requireValue(object(x) && Object.keys(x).every(key => names.includes(key)), code);
}
function signer(x) {
  fields(x, ['address', 'secretEnv'], 'SIGNER_CONFIG_INVALID');
  requireValue(/^G[A-Z2-7]{55}$/.test(x.address ?? ''), 'SIGNER_ADDRESS_REQUIRED');
  requireValue(typeof x.secretEnv === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(x.secretEnv),
    'SIGNER_ENV_NAME_REQUIRED');
  return { address:x.address, secretEnv:x.secretEnv };
}
const integer = (x, min, max, code) => requireValue(Number.isSafeInteger(x) && x >= min && x <= max, code);
function addresses(x, prefix, code) {
  requireValue(Array.isArray(x) && x.length >= 1 && x.length <= 64 &&
    x.every(v => typeof v === 'string' && new RegExp(`^[${prefix}][A-Z2-7]{55}$`).test(v)) &&
    new Set(x).size === x.length, code);
  return [...x];
}

export function validateConfig(input) {
  fields(input, ['schema','network','rpcUrl','signers','feeBumpSigner','payments','limits','operations'], 'CONFIG_FIELDS_INVALID');
  requireValue(input.schema === 'stellar-forge.native-facilitator.v1', 'CONFIG_SCHEMA_INVALID');
  requireValue(['stellar:testnet','stellar:pubnet'].includes(input.network), 'EXPLICIT_STELLAR_NETWORK_REQUIRED');
  let rpc;
  const rpcUrl = input.rpcUrl ?? (input.network === 'stellar:testnet' ? 'https://soroban-testnet.stellar.org' : null);
  try { rpc = new URL(rpcUrl); } catch { throw new FacilitatorError('RPC_HTTPS_URL_REQUIRED'); }
  requireValue(rpc.protocol === 'https:' && !rpc.username && !rpc.password && !rpc.hash,
    'RPC_HTTPS_URL_REQUIRED');
  requireValue(Array.isArray(input.signers) && input.signers.length >= 1 && input.signers.length <= 32,
    'EXISTING_SIGNERS_REQUIRED');
  const signers = input.signers.map(signer);
  requireValue(new Set(signers.map(x => x.address)).size === signers.length &&
    new Set(signers.map(x => x.secretEnv)).size === signers.length, 'DUPLICATE_SIGNER');
  const feeBumpSigner = input.feeBumpSigner == null ? null : signer(input.feeBumpSigner);
  fields(input.payments, ['assets','recipients','maxAtomic','paymentFlows'], 'PAYMENT_POLICY_REQUIRED');
  const paymentFlows = input.payments.paymentFlows === undefined ? ['authorization'] : input.payments.paymentFlows;
  requireValue(Array.isArray(paymentFlows) && paymentFlows.length >= 1 && paymentFlows.length <= 2 &&
    paymentFlows.every(flow => ['authorization','upfront'].includes(flow)) &&
    new Set(paymentFlows).size === paymentFlows.length, 'PAYMENT_FLOWS_INVALID');
  const assets = addresses(input.payments.assets, 'C', 'ASSET_CONTRACTS_REQUIRED');
  const recipients = addresses(input.payments.recipients, 'GC', 'MERCHANT_RECIPIENTS_REQUIRED');
  const maxAtomic = input.payments.maxAtomic;
  requireValue(typeof maxAtomic === 'string' && /^[1-9][0-9]*$/.test(maxAtomic) &&
    maxAtomic.length <= 39 && BigInt(maxAtomic) <= 170141183460469231731687303715884105727n,
    'MAX_ATOMIC_I128_REQUIRED');
  const limits = input.limits;
  fields(limits, ['maxTransactionFeeStroops','inclusionFeeStroops','maxVerifyInFlight','maxSettleInFlight','drainGraceMs'], 'FEE_LIMIT_REQUIRED');
  integer(limits.maxTransactionFeeStroops, 100, 2147483647, 'FEE_CEILING_REQUIRED');
  const inclusionFeeStroops = limits.inclusionFeeStroops ?? 100;
  integer(inclusionFeeStroops, 100, limits.maxTransactionFeeStroops, 'INCLUSION_FEE_INVALID');
  requireValue(!feeBumpSigner || limits.maxTransactionFeeStroops >= 2 * inclusionFeeStroops,
    'FEE_BUMP_CEILING_TOO_LOW');
  const maxVerifyInFlight = limits.maxVerifyInFlight ?? 16;
  integer(maxVerifyInFlight, 1, 256, 'VERIFY_CAPACITY_INVALID');
  const maxSettleInFlight = limits.maxSettleInFlight ?? 1;
  integer(maxSettleInFlight, 1, signers.length, 'SETTLEMENT_CAPACITY_INVALID');
  const drainGraceMs = limits.drainGraceMs ?? 60000;
  integer(drainGraceMs, 1000, 300000, 'DRAIN_GRACE_INVALID');
  const op = input.operations ?? {};
  fields(op, ['ownershipDirectory','rpcTimeoutMs','readinessMaxAgeMs','maxLedgerAgeSeconds','requireReady'],
    'OPERATIONS_CONFIG_INVALID');
  const ownershipDirectory = op.ownershipDirectory ?? null;
  requireValue(ownershipDirectory === null || (typeof ownershipDirectory === 'string' &&
    isAbsolute(ownershipDirectory) && !/[\0\r\n]/.test(ownershipDirectory) && ownershipDirectory.length <= 4096),
    'OWNERSHIP_ABSOLUTE_DIRECTORY_REQUIRED');
  const rpcTimeoutMs = op.rpcTimeoutMs ?? 10000;
  const readinessMaxAgeMs = op.readinessMaxAgeMs ?? 30000;
  const maxLedgerAgeSeconds = op.maxLedgerAgeSeconds ?? 120;
  integer(rpcTimeoutMs, 100, 60000, 'RPC_TIMEOUT_INVALID');
  integer(readinessMaxAgeMs, 1000, 300000, 'READINESS_MAX_AGE_INVALID');
  integer(maxLedgerAgeSeconds, 5, 3600, 'LEDGER_MAX_AGE_INVALID');
  requireValue(op.requireReady === undefined || typeof op.requireReady === 'boolean', 'REQUIRE_READY_INVALID');
  return { schema:input.schema, network:input.network, rpcUrl:rpc.href, signers, feeBumpSigner,
    payments:{assets,recipients,maxAtomic,paymentFlows:[...paymentFlows]}, limits:{maxTransactionFeeStroops:limits.maxTransactionFeeStroops,
      inclusionFeeStroops,maxVerifyInFlight,maxSettleInFlight,drainGraceMs}, operations:{
      ownershipDirectory:ownershipDirectory === null ? null : resolve(ownershipDirectory),
      rpcTimeoutMs,readinessMaxAgeMs,maxLedgerAgeSeconds,requireReady:op.requireReady ?? false} };
}

export async function readConfig(path) {
  const info = await stat(path);
  requireValue(info.isFile() && info.size <= 65536, 'CONFIG_FILE_INVALID');
  const bytes = await readFile(path);
  requireValue(bytes.length <= 65536, 'CONFIG_FILE_TOO_LARGE');
  let config;
  try { config = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)); }
  catch { throw new FacilitatorError('CONFIG_JSON_INVALID'); }
  return validateConfig(config);
}

export function reviewConfig(input) {
  const c = validateConfig(input);
  return { mode:'OFFLINE_FACILITATOR_REVIEW', network:c.network, rpcOrigin:new URL(c.rpcUrl).origin,
    signers:c.signers, feeBumpSigner:c.feeBumpSigner, payments:c.payments, limits:c.limits,
    operations:c.operations,feesSponsored:true, settlementConcurrency:c.limits.maxSettleInFlight,
    signingMaterialLoaded:false };
}

