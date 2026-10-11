// MIT. SF88 adapter for the original Apache-2.0 x402 Stellar client.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual as same } from 'node:util';

export const SDK_VERSION = '2.28.0';
const I128 = 170141183460469231731687303715884105727n;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const atomic = value => typeof value === 'string' && /^[1-9][0-9]{0,38}$/.test(value) && BigInt(value) <= I128;

export class NativeSignerError extends Error {
  constructor(code) { super(code); this.name = 'NativeSignerError'; this.code = code; }
}
export function requireValue(value, code) { if (!value) throw new NativeSignerError(code); }

async function packageVersion(name, specifier) {
  let directory;
  try { directory = dirname(fileURLToPath(import.meta.resolve(specifier))); }
  catch { throw new NativeSignerError('NATIVE_SDK_NOT_INSTALLED'); }
  for (let depth = 0; depth < 8; depth++) {
    try {
      const value = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      if (value.name === name) return value.version;
    } catch { /* exported entrypoints may be several directories below package.json */ }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new NativeSignerError('NATIVE_SDK_VERSION_UNAVAILABLE');
}

/** Imports installed source; it does not build, sign, simulate or submit anything. */
export async function loadNativeSdk() {
  const versions = {
    core: await packageVersion('@x402/core', '@x402/core/client'),
    stellar: await packageVersion('@x402/stellar', '@x402/stellar/exact/client'),
  };
  requireValue(Object.values(versions).every(version => version === SDK_VERSION), 'NATIVE_SDK_VERSION_MISMATCH');
  try {
    const [{ x402Client }, { ExactStellarScheme }, { createEd25519Signer }] = await Promise.all([
      import('@x402/core/client'), import('@x402/stellar/exact/client'), import('@x402/stellar'),
    ]);
    requireValue([x402Client, ExactStellarScheme, createEd25519Signer].every(value => typeof value === 'function'),
      'NATIVE_SDK_EXPORTS_UNAVAILABLE');
    return Object.freeze({ x402Client, ExactStellarScheme, createEd25519Signer, versions });
  } catch (error) {
    if (error instanceof NativeSignerError) throw error;
    throw new NativeSignerError('NATIVE_SDK_LOAD_FAILED');
  }
}

/** Input comes from SF31 after SF81 approval. The original SF88 config is host-owned. */
export function validateSigningRequest(input, expected) {
  const { intent, challenge, accepted } = input ?? {};
  const { operation, body } = expected;
  const terms = operation.expect;
  requireValue(object(intent) && object(challenge) && object(accepted), 'NATIVE_SIGNER_INPUT_INVALID');
  requireValue(challenge.x402Version === 2 && object(challenge.resource) &&
    Array.isArray(challenge.accepts) && challenge.accepts.length >= 1 && challenge.accepts.length <= 32,
  'NATIVE_CHALLENGE_INVALID');
  requireValue(challenge.resource.url === new URL(operation.url).href && intent.url === challenge.resource.url &&
    intent.intentId === operation.intentId && intent.method === operation.method,
  'NATIVE_OPERATION_MISMATCH');
  requireValue(intent.bodyPresent === body.present && intent.bodyBytes === body.bytes &&
    intent.bodySha256 === body.sha256, 'NATIVE_REQUEST_BODY_MISMATCH');
  requireValue(accepted.scheme === 'exact' && accepted.network === terms.network &&
    accepted.asset === terms.asset && accepted.payTo === terms.payTo &&
    atomic(accepted.amount) && atomic(terms.maxAtomic) && BigInt(accepted.amount) <= BigInt(terms.maxAtomic),
  'NATIVE_PAYMENT_TERMS_MISMATCH');
  requireValue(Number.isInteger(accepted.maxTimeoutSeconds) && accepted.maxTimeoutSeconds >= 1 &&
    accepted.maxTimeoutSeconds <= (terms.maxTimeoutSeconds ?? 86400), 'NATIVE_TIMEOUT_MISMATCH');
  requireValue(accepted.extra?.areFeesSponsored === true &&
    (accepted.extra?.paymentFlow ?? 'authorization') === 'authorization',
  'NATIVE_AUTHORIZATION_SPONSORSHIP_REQUIRED');
  requireValue(['scheme', 'network', 'asset', 'payTo', 'amount', 'maxTimeoutSeconds']
    .every(key => intent[key] === accepted[key]) && intent.maxAtomic === terms.maxAtomic &&
    same(intent.acceptedTerms, accepted), 'NATIVE_APPROVED_INTENT_MISMATCH');
  requireValue(challenge.accepts.filter(option => same(option, accepted)).length === 1,
    'NATIVE_SELECTED_OFFER_MISMATCH');
  requireValue(challenge.extensions === undefined || object(challenge.extensions), 'NATIVE_EXTENSIONS_INVALID');
  return { intent: structuredClone(intent), challenge: structuredClone(challenge), accepted: structuredClone(accepted) };
}

/**
 * The native SDK creates and signs the transaction. SF31 owns the signed HTTP
 * retry; SF81/SF36 own human approval and persistent spend reservations.
 * sdk is injectable only by trusted embedding code, never by a seller request.
 */
export async function createNativeBuyerSigner({ signer, expected, rpcUrl, sdk }) {
  sdk ??= await loadNativeSdk();
  requireValue(expected && object(expected.operation) && object(expected.body), 'NATIVE_EXPECTATION_REQUIRED');
  requireValue(['stellar:testnet', 'stellar:pubnet'].includes(expected.operation.expect?.network),
    'NATIVE_NETWORK_INVALID');
  requireValue(typeof expected.payer === 'string' && /^[GC][A-Z2-7]{55}$/.test(expected.payer) &&
    object(signer) && signer.address === expected.payer && typeof signer.signAuthEntry === 'function',
  'NATIVE_PAYER_MISMATCH');
  const fixed = structuredClone(expected);
  const nativeSigner = { address: expected.payer, signAuthEntry: signer.signAuthEntry.bind(signer) };
  if (typeof signer.signTransaction === 'function') nativeSigner.signTransaction = signer.signTransaction.bind(signer);
  const scheme = new sdk.ExactStellarScheme(Object.freeze(nativeSigner), { url: rpcUrl });
  let attempted = false;
  return Object.freeze({
    get readiness() { return Object.freeze({ network: fixed.operation.expect.network, payer: fixed.payer,
      sdkVersions: sdk.versions, provider: 'ORIGINAL_X402_STELLAR', signingAttempts: attempted ? 1 : 0 }); },
    async sign(input) {
      const checked = validateSigningRequest(input, fixed);
      requireValue(!attempted, 'NATIVE_SIGNING_ALREADY_ATTEMPTED');
      attempted = true;
      // A new native client uses exactly the host-approved selected option and
      // its original atomic cap. No USD conversion, fallback rail or extra retry.
      const client = new sdk.x402Client((version, options) => {
        const matches = options.filter(option => same(option, checked.accepted));
        requireValue(version === 2 && matches.length === 1, 'NATIVE_SDK_SELECTION_MISMATCH');
        return matches[0];
      });
      requireValue(typeof client.setSpendControls === 'function', 'NATIVE_SDK_SPEND_CONTROLS_UNAVAILABLE');
      client.register(checked.accepted.network, scheme);
      client.setSpendControls({ allowedAssets: [{ network: checked.accepted.network,
        asset: checked.accepted.asset, maxAmountPerPayment: checked.intent.maxAtomic }] });
      let result;
      try { result = await client.createPaymentPayload(checked.challenge); }
      catch { throw new NativeSignerError('NATIVE_PAYMENT_CREATION_FAILED'); }
      requireValue(object(result) && result.x402Version === 2 && object(result.payload) &&
        same(result.accepted, checked.accepted) && same(result.resource, checked.challenge.resource) &&
        same(result.extensions ?? {}, checked.challenge.extensions ?? {}), 'NATIVE_SDK_ENVELOPE_MISMATCH');
      // Preserve the official complete envelope; never reconstruct signed bytes.
      return result;
    },
  });
}
