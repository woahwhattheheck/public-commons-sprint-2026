// MIT. SF88 adapter to the original x402 SDK. SF81 owns approval/reservation.
import { isDeepStrictEqual } from 'node:util';
import { readFile, lstat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createNativeBuyerSigner } from '../sf103-native-buyer-signer/adapter.mjs';

const NETWORK = 'stellar:testnet';
const SDK_VERSION = '2.28.0';
const DEFAULT_RPC = 'https://soroban-testnet.stellar.org';
const require = createRequire(import.meta.url);
const I128_MAX = 170141183460469231731687303715884105727n;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (left, right) => isDeepStrictEqual(left, right);
let sdkPromise;

export class NativeSignerError extends Error {
  constructor(code) {
    super(code); this.name = 'NativeSignerError'; this.code = code;
    // The adapter returns before SF31 constructs or sends its paid HTTP retry.
    this.paymentSent = false;
  }
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
  let rpc;
  try { rpc = new URL(options.rpcUrl ?? DEFAULT_RPC); }
  catch { fail('SIGNER_RPC_URL_INVALID'); }
  if (rpc.protocol !== 'https:' || rpc.username || rpc.password || rpc.search || rpc.hash)
    fail('SIGNER_RPC_HTTPS_REQUIRED');
  return Object.freeze({ network: NETWORK, asset: options.asset, payTo: options.payTo,
    maxAtomic: options.maxAtomic, expectedPayer: options.expectedPayer, rpcUrl:rpc.href });
}

export function validateNativeSignerConfiguration(options) { return pins(options); }

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

async function packageVersion(name, specifier) {
  let directory;
  try { directory = dirname(require.resolve(specifier)); }
  catch { fail('OFFICIAL_STELLAR_SDK_UNAVAILABLE'); }
  for (;;) {
    try {
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      if (manifest.name === name) return manifest.version;
    } catch (error) {
      if (error.code !== 'ENOENT') fail('OFFICIAL_STELLAR_SDK_METADATA_INVALID');
    }
    const parent = dirname(directory);
    if (parent === directory) fail('OFFICIAL_STELLAR_SDK_METADATA_INVALID');
    directory = parent;
  }
}

async function officialSdk() {
  sdkPromise ??= (async () => {
    const versions = {
      core:await packageVersion('@x402/core', '@x402/core/client'),
      stellar:await packageVersion('@x402/stellar', '@x402/stellar/exact/client'),
    };
    if (!Object.values(versions).every(version => version === SDK_VERSION))
      fail('OFFICIAL_STELLAR_SDK_VERSION_MISMATCH');
    const [core, stellar, signer] = await Promise.all([
    import('@x402/core/client'), import('@x402/stellar/exact/client'), import('@x402/stellar'),
    ]);
    if (typeof core.x402Client !== 'function' || typeof core.x402Client.prototype.setSpendControls !== 'function' ||
        typeof stellar.ExactStellarScheme !== 'function' || typeof signer.createEd25519Signer !== 'function')
      fail('OFFICIAL_STELLAR_SDK_INCOMPATIBLE');
    return { x402Client: core.x402Client, ExactStellarScheme: stellar.ExactStellarScheme,
      createEd25519Signer: signer.createEd25519Signer, versions };
  })().catch(error => {
    sdkPromise = undefined;
    if (error instanceof NativeSignerError) throw error;
    fail('OFFICIAL_STELLAR_SDK_UNAVAILABLE');
  });
  return sdkPromise;
}

/** Package availability only: no provider import, key access, RPC or signature. */
export async function inspectNativeSignerRuntime() {
  const sdk = await officialSdk();
  return { sdkVersion:SDK_VERSION, versions:sdk.versions, network:NETWORK,
    scheme:'exact', payloadEngine:'SF103_ORIGINAL_X402_STELLAR', feesSponsoredRequired:true };
}

/** Execute-only local setup check; does not read a wallet key, sign or call RPC. */
export async function checkNativeSignerPrerequisites(options) {
  pins(options);
  if (options.signerProvider !== undefined) {
    if (options.secretEnv !== undefined) fail('SIGNER_ONE_SOURCE_REQUIRED');
    await inspectSignerProvider(options.signerProvider);
  } else {
    const environment = options.environment ?? process.env;
    const secretEnv = options.secretEnv ?? 'STELLAR_SECRET';
    if (typeof secretEnv !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(secretEnv))
      fail('SIGNER_INVALID_SECRET_ENV_NAME');
    if (!object(environment) || !Object.hasOwn(environment, secretEnv))
      fail('SIGNER_LOCAL_TESTNET_KEY_REQUIRED');
  }
  await officialSdk();
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
  const attemptedIntents = new Set();
  return Object.freeze({ payer: signer.address, network: policy.network,
    async sign(payload) {
      const input = validateNativeSignerInput(payload, policy);
      if (signer.address !== policy.expectedPayer) fail('SIGNER_PAYER_MISMATCH');
      if (attemptedIntents.has(input.intent.intentId)) fail('NATIVE_SIGNING_ALREADY_ATTEMPTED');
      attemptedIntents.add(input.intent.intentId);
      // SF88 retains its independent workspace policy; SF103 is the single
      // shared native payload engine. The existing SF31/SF81 call supplies the
      // approved request body and operation, after its durable reservation.
      let result;
      try {
        const adapter = await createNativeBuyerSigner({ signer, sdk, rpcUrl:policy.rpcUrl,
        expected:{ payer:policy.expectedPayer,
          operation:{ intentId:input.intent.intentId, method:input.intent.method,
            url:input.intent.url, expect:{ scheme:'exact', network:policy.network,
              asset:policy.asset, payTo:policy.payTo, maxAtomic:input.intent.maxAtomic,
              maxTimeoutSeconds:input.intent.maxTimeoutSeconds } },
          body:{ present:input.intent.bodyPresent, bytes:input.intent.bodyBytes,
            sha256:input.intent.bodySha256 } } });
        result = await adapter.sign(input);
      } catch (error) {
        // SF103 finishes before SF31 sends the paid request. Preserve that phase.
        if (error instanceof NativeSignerError) throw error;
        fail(error?.name === 'NativeSignerError' && /^[A-Z0-9_]{1,120}$/.test(error.code)
          ? error.code : 'OFFICIAL_STELLAR_PAYMENT_CREATION_FAILED');
      }
      if (typeof result.payload?.transaction !== 'string' || !result.payload.transaction.length)
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

/** Check a trusted local provider without importing or initializing it. */
export async function inspectSignerProvider(provider) {
  if (typeof provider !== 'string' || !isAbsolute(provider) || provider.includes('\0'))
    fail('SIGNER_PROVIDER_ABSOLUTE_PATH_REQUIRED');
  const file = await lstat(provider).catch(() => null);
  if (!file?.isFile() || file.isSymbolicLink() ||
      (process.platform !== 'win32' && (file.mode & 0o022) !== 0))
    fail('SIGNER_TRUSTED_PROVIDER_FILE_REQUIRED');
  return {status:'PRESENT_NOT_IMPORTED'};
}

/** Invoked lazily by the generated module after original SF81 approval. */
export async function createProviderStellarSigner(options) {
  const policy = pins(options);
  await inspectSignerProvider(options.signerProvider);
  await officialSdk();
  let provider, signer;
  try { provider = await import(pathToFileURL(options.signerProvider).href); }
  catch { fail('SIGNER_PROVIDER_IMPORT_FAILED'); }
  if (typeof provider.createSigner !== 'function') fail('SIGNER_PROVIDER_FACTORY_REQUIRED');
  try { signer = await provider.createSigner({network:policy.network,
    payer:policy.expectedPayer, rpcUrl:policy.rpcUrl}); }
  catch { fail('SIGNER_PROVIDER_INITIALIZATION_FAILED'); }
  return createOfficialStellarSigner({...policy, signer});
}
