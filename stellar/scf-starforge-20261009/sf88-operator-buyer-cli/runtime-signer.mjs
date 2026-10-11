// MIT — SF88 operator signer loading. Review and diagnosis never load custody.
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { signing, need, InputError } from './config.mjs';
import { createNativeStellarSigner, inspectNativeSignerRuntime } from './native-signer.mjs';

const safeCode = (error, fallback) => typeof error?.code === 'string' && /^[A-Z0-9_]{1,120}$/.test(error.code)
  ? error.code : fallback;

export function signerSummary(cfg) {
  const source = signing(cfg, {required:false});
  if (!source) return null;
  if (source.kind === 'operator-module') return {kind:source.kind, filename:basename(source.module)};
  const rpc = source.rpcUrl === undefined ? null : new URL(source.rpcUrl);
  return {
    kind:source.kind, network:source.network,
    source:source.secretEnvironment !== undefined ? 'environment' : 'wallet-module',
    ...(source.secretEnvironment !== undefined ? {secretEnvironment:source.secretEnvironment} :
      {walletFilename:basename(source.walletModule)}),
    // An operator RPC can contain private service tokens in its path or query.
    rpcOrigin:rpc?.origin ?? 'https://soroban-testnet.stellar.org',
    trustedPayer:cfg.trustedPayer ?? null,
  };
}

async function trustedModule(path, code) {
  let info;
  try { info = await stat(path); } catch { throw new InputError(code); }
  need(info.isFile(), code);
  try { return await import(pathToFileURL(path).href); }
  catch { throw new InputError('OPERATOR_SIGNER_MODULE_LOAD_FAILED'); }
}

/** Called for an explicit execution, never by review, prepare or diagnose. */
export async function loadExecutionSigner(cfg, {environment=process.env}={}) {
  const source = signing(cfg);
  if (source.kind === 'operator-module') {
    const module = await trustedModule(source.module, 'SIGNER_MODULE_MUST_EXIST');
    const sign = module.sign ?? module.default?.sign;
    need(typeof sign === 'function', 'TRUSTED_SIGN_FUNCTION_REQUIRED');
    return {sign:args => sign(args), kind:source.kind};
  }
  need(typeof cfg.trustedPayer === 'string' && /^[GC][A-Z2-7]{55}$/.test(cfg.trustedPayer),
    'NATIVE_SIGNER_TRUSTED_PAYER_REQUIRED');
  // Resolve/verify pinned dependencies before any key or trusted wallet import.
  await inspectNativeSignerRuntime();
  let signer;
  if (source.secretEnvironment !== undefined) {
    const secret = environment[source.secretEnvironment];
    need(typeof secret === 'string' && secret.length > 0, 'NATIVE_SECRET_ENVIRONMENT_MISSING');
    let createEd25519Signer;
    try { ({createEd25519Signer} = await import('@x402/stellar')); }
    catch { throw new InputError('NATIVE_X402_SDK_LOAD_FAILED'); }
    need(typeof createEd25519Signer === 'function', 'NATIVE_ED25519_SIGNER_UNAVAILABLE');
    try { signer = createEd25519Signer(secret, source.network); }
    catch { throw new InputError('NATIVE_SECRET_KEY_INVALID'); }
  } else {
    const module = await trustedModule(source.walletModule, 'NATIVE_WALLET_MODULE_MUST_EXIST');
    const createSigner = module.createSigner ?? module.default?.createSigner;
    need(typeof createSigner === 'function', 'NATIVE_WALLET_FACTORY_REQUIRED');
    try { signer = await createSigner({network:source.network, rpcUrl:source.rpcUrl}); }
    catch { throw new InputError('NATIVE_WALLET_SETUP_FAILED'); }
  }
  const adapter = await createNativeStellarSigner({
    signer, network:source.network, rpcUrl:source.rpcUrl, expectedPayer:cfg.trustedPayer,
  });
  return {...adapter, kind:source.kind};
}

/** Inspect package and source availability without loading or signing with a key. */
export async function diagnoseSigner(cfg, {environment=process.env}={}) {
  const source = signing(cfg);
  const checks = [];
  let sdk = null;
  if (source.kind === 'official-stellar-sdk') {
    try {
      sdk = await inspectNativeSignerRuntime();
      checks.push({check:'official-sdk', status:'AVAILABLE'});
    } catch (error) {
      checks.push({check:'official-sdk', status:'UNAVAILABLE', code:safeCode(error,'NATIVE_X402_SDK_UNAVAILABLE')});
    }
    if (source.secretEnvironment !== undefined) {
      // Check presence only: do not read, decode or derive an account from it.
      checks.push({check:'key-environment', status:Object.hasOwn(environment, source.secretEnvironment)
        ? 'PRESENT_NOT_LOADED' : 'MISSING', name:source.secretEnvironment});
    }
    checks.push({check:'reviewed-payer', status:typeof cfg.trustedPayer === 'string' &&
      /^[GC][A-Z2-7]{55}$/.test(cfg.trustedPayer) ? 'CONFIGURED' : 'MISSING'});
  }
  const modulePath = source.kind === 'operator-module' ? source.module : source.walletModule;
  if (modulePath !== undefined) {
    let exists = false;
    try { exists = (await stat(modulePath)).isFile(); } catch {}
    checks.push({check:'signer-module', filename:basename(modulePath),
      status:exists ? 'PRESENT_NOT_IMPORTED' : 'MISSING'});
  }
  const ready = checks.every(check => !['UNAVAILABLE','MISSING'].includes(check.status));
  return {
    mode:'SIGNER_RUNTIME_DIAGNOSTICS', status:ready ? 'READY_TO_LOAD_SIGNER' : 'SETUP_REQUIRED',
    signer:signerSummary(cfg), sdk, checks,
    next:ready ? 'Review the operation and use --execute for the existing terminal approval.' :
      'Resolve the listed setup requirements before --execute.',
  };
}
