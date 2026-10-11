// MIT. SF88 adapter to the original x402 SDK. SF81 owns approval/reservation.
import { isDeepStrictEqual } from 'node:util';

const NETWORK = 'stellar:testnet';
const I128_MAX = 170141183460469231731687303715884105727n;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (left, right) => isDeepStrictEqual(left, right);
let sdkPromise;

export class NativeSignerError extends Error {
  constructor(code) { super(code); this.name = 'NativeSignerError'; this.code = code; }
}
const fail = code => { throw new NativeSignerError(code); };

function atomic(value) {
  if (typeof value !== 'string' || value.length > 39 || !/^[1-9][0-9]*$/.test(value))
    fail('SIGNER_INVALID_ATOMIC_AMOUNT');
  const amount = BigInt(value);
  if (amount > I128_MAX) fail('SIGNER_INVALID_ATOMIC_AMOUNT');
  return amount;
}

function pins(options) {
  if (!object(options) || options.network !== NETWORK) fail('SIGNER_TESTNET_REQUIRED');
  if (typeof options.asset !== 'string' || !/^C[A-Z2-7]{55}$/.test(options.asset))
    fail('SIGNER_INVALID_ASSET');
  if (typeof options.payTo !== 'string' || !/^[GC][A-Z2-7]{55}$/.test(options.payTo))
    fail('SIGNER_INVALID_RECIPIENT');
  if (typeof options.expectedPayer !== 'string' || !/^[GC][A-Z2-7]{55}$/.test(options.expectedPayer))
    fail('SIGNER_EXPECTED_PAYER_REQUIRED');
  atomic(options.maxAtomic);
  return Object.freeze({ network: NETWORK, asset: options.asset, payTo: options.payTo,
    maxAtomic: options.maxAtomic, expectedPayer: options.expectedPayer });
}

/** Validate the original SF31 payload against independent operator configuration. */
export function validateNativeSignerInput(payload, configuration) {
  const policy = pins(configuration);
  const { intent, challenge, accepted } = payload ?? {};
  if (!object(intent) || !object(challenge) || !object(accepted) ||
      challenge.x402Version !== 2 || !object(challenge.resource) ||
      !Array.isArray(challenge.accepts) || challenge.accepts.length < 1 || challenge.accepts.length > 32)
    fail('SIGNER_INVALID_CHALLENGE');
  if (accepted.scheme !== 'exact' || accepted.network !== policy.network ||
      accepted.asset !== policy.asset || accepted.payTo !== policy.payTo)
    fail('SIGNER_PAYMENT_TERMS_CHANGED');
  if (atomic(accepted.amount) > atomic(policy.maxAtomic) ||
      atomic(intent.maxAtomic) > atomic(policy.maxAtomic) ||
      atomic(accepted.amount) > atomic(intent.maxAtomic)) fail('SIGNER_SPEND_CAP_EXCEEDED');
  if (!Number.isSafeInteger(accepted.maxTimeoutSeconds) || accepted.maxTimeoutSeconds < 1 ||
      accepted.maxTimeoutSeconds > 86400 || accepted.extra?.areFeesSponsored !== true ||
      (accepted.extra?.paymentFlow !== undefined && accepted.extra.paymentFlow !== 'authorization'))
    fail('SIGNER_UNSUPPORTED_STELLAR_TERMS');
  if (!same(intent.acceptedTerms, accepted) ||
      ['scheme', 'network', 'asset', 'payTo', 'amount', 'maxTimeoutSeconds'].some(key => intent[key] !== accepted[key]))
    fail('SIGNER_APPROVED_INTENT_MISMATCH');
  if (typeof intent.intentId !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(intent.intentId) ||
      !['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(intent.method) ||
      typeof intent.url !== 'string' || challenge.resource.url !== intent.url)
    fail('SIGNER_RESOURCE_MISMATCH');
  let url;
  try { url = new URL(intent.url); } catch { fail('SIGNER_RESOURCE_MISMATCH'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.href !== intent.url)
    fail('SIGNER_RESOURCE_MISMATCH');
  if (challenge.accepts.filter(option => same(option, accepted)).length !== 1)
    fail('SIGNER_ACCEPTED_OPTION_MISMATCH');
  if (challenge.extensions !== undefined && !object(challenge.extensions))
    fail('SIGNER_INVALID_CHALLENGE');
  // Snapshots survive asynchronous SDK/RPC work. Caller changes cannot alter a signed quote.
  return { policy, intent: structuredClone(intent), accepted: structuredClone(accepted),
    challenge: structuredClone(challenge) };
}

async function officialSdk() {
  sdkPromise ??= Promise.all([
    import('@x402/core/client'), import('@x402/stellar/exact/client'), import('@x402/stellar'),
  ]).then(([core, stellar, signer]) => {
    if (typeof core.x402Client !== 'function' || typeof core.x402Client.prototype.setSpendControls !== 'function' ||
        typeof stellar.ExactStellarScheme !== 'function' || typeof signer.createEd25519Signer !== 'function')
      fail('OFFICIAL_STELLAR_SDK_INCOMPATIBLE');
    return { x402Client: core.x402Client, ExactStellarScheme: stellar.ExactStellarScheme,
      createEd25519Signer: signer.createEd25519Signer };
  }).catch(error => {
    sdkPromise = undefined;
    if (error instanceof NativeSignerError) throw error;
    fail('OFFICIAL_STELLAR_SDK_UNAVAILABLE');
  });
  return sdkPromise;
}

/**
 * Existing official ClientStellarSigner -> SF31 sign callback.
 * Call only from the operator-owned SF81 path after its durable reservation.
 * The SDK simulates/signs authorization; SF31 alone sends the paid HTTP retry.
 */
export async function createOfficialStellarSigner(options) {
  const policy = pins(options);
  const signer = options.signer;
  if (!object(signer) || signer.address !== policy.expectedPayer || typeof signer.signAuthEntry !== 'function')
    fail('SIGNER_PAYER_MISMATCH');
  const sdk = await officialSdk();
  return Object.freeze({ payer: signer.address, network: policy.network,
    async sign(payload) {
      const input = validateNativeSignerInput(payload, policy);
      if (signer.address !== policy.expectedPayer) fail('SIGNER_PAYER_MISMATCH');
      const client = new sdk.x402Client((version, requirements) => {
        if (version !== 2) fail('SIGNER_UNSUPPORTED_VERSION');
        const matches = requirements.filter(requirement => same(requirement, input.accepted));
        if (matches.length !== 1) fail('SIGNER_ACCEPTED_OPTION_MISMATCH');
        return matches[0];
      });
      client.register(policy.network, new sdk.ExactStellarScheme(signer));
      client.setSpendControls({ allowedAssets: [{ network: policy.network, asset: policy.asset,
        maxAmountPerPayment: policy.maxAtomic }] });
      let result;
      try { result = await client.createPaymentPayload(input.challenge); }
      catch (error) {
        if (error instanceof NativeSignerError) throw error;
        // SDK errors can include account/transaction material; the CLI needs only classification.
        fail('OFFICIAL_STELLAR_PAYMENT_CREATION_FAILED');
      }
      if (!object(result) || result.x402Version !== 2 || !object(result.payload) ||
          !same(result.accepted, input.accepted) || !same(result.resource, input.challenge.resource) ||
          !same(result.extensions ?? {}, input.challenge.extensions ?? {}))
        fail('OFFICIAL_STELLAR_ENVELOPE_MISMATCH');
      return result;
    },
  });
}

/** Existing local testnet key -> official SDK signer; never read a key on import/review. */
export async function createEnvironmentStellarSigner(options) {
  const policy = pins(options);
  const environment = options.environment ?? process.env;
  const secretEnv = options.secretEnv ?? 'STELLAR_SECRET';
  if (typeof secretEnv !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(secretEnv))
    fail('SIGNER_INVALID_SECRET_ENV_NAME');
  const secret = environment?.[secretEnv];
  if (typeof secret !== 'string' || !/^S[A-Z2-7]{55}$/.test(secret))
    fail('SIGNER_LOCAL_TESTNET_KEY_REQUIRED');
  const sdk = await officialSdk();
  let signer;
  try { signer = sdk.createEd25519Signer(secret, policy.network); }
  catch { fail('SIGNER_INVALID_LOCAL_TESTNET_KEY'); }
  return createOfficialStellarSigner({ ...policy, signer });
}
