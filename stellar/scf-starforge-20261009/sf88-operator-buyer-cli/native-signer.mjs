// MIT — SF88 adapter to the original x402 2.28.0 Stellar client.
// Custody stays in the operator-supplied SEP-43 signer. This module creates a
// native payment payload only; SF31 owns the signed HTTP retry, SF81 approval.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const NATIVE_SDK_VERSION = '2.28.0';
const NETWORKS = Object.freeze(['stellar:testnet', 'stellar:pubnet']);
const I128_MAX = 170141183460469231731687303715884105727n;
const require = createRequire(import.meta.url);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const atomic = value => typeof value === 'string' && value.length <= 39 &&
  /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) <= I128_MAX;

export class NativeSignerError extends Error {
  constructor(code, { cause, signingRequested = false } = {}) {
    super(code, { cause });
    this.name = 'NativeSignerError';
    this.code = code;
    this.signingRequested = signingRequested;
    // No seller retry or transaction submission is performed by this adapter.
    this.paymentSent = false;
  }
}
function need(condition, code) {
  if (!condition) throw new NativeSignerError(code);
}

async function packageVersion(specifier, name) {
  let directory;
  try { directory = dirname(require.resolve(specifier)); }
  catch (cause) { throw new NativeSignerError('NATIVE_X402_SDK_UNAVAILABLE', { cause }); }
  for (;;) {
    try {
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      if (manifest.name === name) return manifest.version;
    } catch (cause) {
      if (cause.code !== 'ENOENT')
        throw new NativeSignerError('NATIVE_X402_SDK_METADATA_INVALID', { cause });
    }
    const parent = dirname(directory);
    if (parent === directory) throw new NativeSignerError('NATIVE_X402_SDK_METADATA_UNAVAILABLE');
    directory = parent;
  }
}

let runtimePromise;
async function runtime() {
  if (!runtimePromise) runtimePromise = (async () => {
    const [coreVersion, stellarVersion] = await Promise.all([
      packageVersion('@x402/core/client', '@x402/core'),
      packageVersion('@x402/stellar/exact/client', '@x402/stellar'),
    ]);
    need(coreVersion === NATIVE_SDK_VERSION && stellarVersion === NATIVE_SDK_VERSION,
      'NATIVE_X402_SDK_VERSION_MISMATCH');
    let core, exact, stellar;
    try {
      [core, exact, stellar] = await Promise.all([
        import('@x402/core/client'),
        import('@x402/stellar/exact/client'),
        import('@x402/stellar'),
      ]);
    } catch (cause) { throw new NativeSignerError('NATIVE_X402_SDK_LOAD_FAILED', { cause }); }
    need(typeof core.x402Client === 'function' &&
      ['register', 'setSpendControls', 'createPaymentPayload'].every(method =>
        typeof core.x402Client.prototype[method] === 'function') &&
      typeof exact.ExactStellarScheme === 'function' &&
      typeof stellar.isClientStellarSigner === 'function' &&
      typeof stellar.validateStellarAssetAddress === 'function' &&
      typeof stellar.validateStellarDestinationAddress === 'function',
    'NATIVE_X402_SDK_EXPORTS_UNAVAILABLE');
    return { x402Client:core.x402Client, ExactStellarScheme:exact.ExactStellarScheme,
      stellar, coreVersion, stellarVersion };
  })().catch(error => { runtimePromise = undefined; throw error; });
  return runtimePromise;
}

/** Inspect installed official packages without reading a signer or contacting RPC. */
export async function inspectNativeSignerRuntime() {
  const native = await runtime();
  return {
    sdkVersion:NATIVE_SDK_VERSION,
    packages:{ '@x402/core':native.coreVersion, '@x402/stellar':native.stellarVersion },
    networks:[...NETWORKS], scheme:'exact', paymentFlow:'authorization',
    feesSponsoredRequired:true,
  };
}

function rpcConfiguration(network, rpcUrl) {
  if (rpcUrl === undefined) {
    need(network === 'stellar:testnet', 'NATIVE_PUBNET_RPC_REQUIRED');
    return undefined;
  }
  let url;
  try { url = new URL(rpcUrl); }
  catch (cause) { throw new NativeSignerError('NATIVE_RPC_URL_INVALID', { cause }); }
  const localTestnet = network === 'stellar:testnet' && url.protocol === 'http:' &&
    ['127.0.0.1', '[::1]'].includes(url.hostname);
  need((url.protocol === 'https:' || localTestnet) && !url.username && !url.password && !url.hash,
    'NATIVE_RPC_URL_INVALID');
  return { url:url.href };
}

function approvedRequest(input, network, stellar) {
  need(object(input) && object(input.intent) && object(input.challenge) &&
    object(input.accepted), 'NATIVE_SIGNER_INPUT_INVALID');
  let intent, challenge, accepted;
  try { ({ intent, challenge, accepted } = structuredClone(input)); }
  catch (cause) { throw new NativeSignerError('NATIVE_SIGNER_INPUT_INVALID', { cause }); }
  need(challenge.x402Version === 2 && object(challenge.resource) &&
    typeof challenge.resource.url === 'string' && challenge.resource.url === intent.url &&
    Array.isArray(challenge.accepts) && challenge.accepts.length >= 1 &&
    challenge.accepts.length <= 32 &&
    (challenge.extensions === undefined || object(challenge.extensions)),
  'NATIVE_SIGNER_CHALLENGE_MISMATCH');
  need(accepted.scheme === 'exact' && accepted.network === network &&
    atomic(accepted.amount) && BigInt(accepted.amount) > 0n &&
    atomic(intent.maxAtomic) && BigInt(accepted.amount) <= BigInt(intent.maxAtomic) &&
    typeof accepted.asset === 'string' && stellar.validateStellarAssetAddress(accepted.asset) &&
    typeof accepted.payTo === 'string' && stellar.validateStellarDestinationAddress(accepted.payTo) &&
    Number.isInteger(accepted.maxTimeoutSeconds) && accepted.maxTimeoutSeconds >= 1 &&
    accepted.maxTimeoutSeconds <= 86400, 'NATIVE_SIGNER_TERMS_INVALID');
  need(object(accepted.extra) && accepted.extra.areFeesSponsored === true &&
    (accepted.extra.paymentFlow === undefined || accepted.extra.paymentFlow === 'authorization'),
  'NATIVE_SIGNER_AUTHORIZATION_SPONSORSHIP_REQUIRED');
  need(isDeepStrictEqual(intent.acceptedTerms, accepted) &&
    ['scheme', 'network', 'asset', 'payTo', 'amount', 'maxTimeoutSeconds']
      .every(key => intent[key] === accepted[key]), 'NATIVE_SIGNER_APPROVED_TERMS_MISMATCH');
  need(challenge.accepts.filter(option => isDeepStrictEqual(option, accepted)).length === 1,
    'NATIVE_SIGNER_ACCEPTED_OPTION_MISMATCH');
  return { intent, challenge, accepted };
}

/**
 * Adapt a trusted official ClientStellarSigner to the SF31 sign callback.
 * Construction loads SDK code but never calls RPC or signAuthEntry. Invoke sign
 * through the existing SF81 approved/reserved operation. A supplied signer must
 * implement SEP-43 signing only, without submitting transactions itself.
 */
export async function createNativeStellarSigner({ signer, network, rpcUrl, expectedPayer } = {}) {
  need(NETWORKS.includes(network), 'NATIVE_STELLAR_NETWORK_REQUIRED');
  const rpcConfig = rpcConfiguration(network, rpcUrl);
  const native = await runtime();
  need(native.stellar.isClientStellarSigner(signer) &&
    /^[GC]/.test(signer.address) && native.stellar.validateStellarDestinationAddress(signer.address),
  'NATIVE_STELLAR_SIGNER_INVALID');
  const address = signer.address;
  need(expectedPayer === undefined || expectedPayer === address, 'NATIVE_SIGNER_PAYER_MISMATCH');
  // Keep a stable wallet identity and callback even if its owner rotates a binding.
  // Rotation requires constructing a new adapter and reviewing that public payer.
  const signAuthEntry = signer.signAuthEntry.bind(signer);

  async function sign(input) {
    const { intent, challenge, accepted } = approvedRequest(input, network, native.stellar);
    let signingRequested = false;
    const wallet = { address, signAuthEntry:async (...args) => {
      signingRequested = true;
      return signAuthEntry(...args);
    } };
    // The native client builds the full v2 envelope. Its selector cannot switch
    // to an earlier, cheaper or otherwise different option after SF31 approval.
    const client = new native.x402Client((version, offers) => {
      const selected = offers.filter(option => isDeepStrictEqual(option, accepted));
      need(version === 2 && selected.length === 1, 'NATIVE_SIGNER_SELECTION_MISMATCH');
      return selected[0];
    });
    client.register(network, new native.ExactStellarScheme(wallet, rpcConfig));
    // Use the already approved exact atomic cap, including for non-default
    // assets. Do not silently replace SF36's cap with the SDK's default USD cap.
    client.setSpendControls({ allowedAssets:[{
      network, asset:accepted.asset, maxAmountPerPayment:intent.maxAtomic,
    }] });
    let payload;
    try { payload = await client.createPaymentPayload(challenge); }
    catch (cause) {
      if (cause instanceof NativeSignerError) {
        cause.signingRequested ||= signingRequested;
        throw cause;
      }
      throw new NativeSignerError('NATIVE_STELLAR_PAYLOAD_FAILED', { cause, signingRequested });
    }
    const validEnvelope = object(payload) && payload.x402Version === 2 && object(payload.payload) &&
      typeof payload.payload.transaction === 'string' && payload.payload.transaction.length > 0 &&
      isDeepStrictEqual(payload.accepted, accepted) &&
      isDeepStrictEqual(payload.resource, challenge.resource) &&
      isDeepStrictEqual(payload.extensions ?? {}, challenge.extensions ?? {});
    if (!validEnvelope)
      throw new NativeSignerError('NATIVE_SIGNER_ENVELOPE_MISMATCH', { signingRequested });
    return payload;
  }
  return Object.freeze({ address, network, sign });
}
