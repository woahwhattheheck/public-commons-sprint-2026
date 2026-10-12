// MIT. Use the official Stellar SDK for native XDR and Ed25519 verification.
import { readFile, lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireValue, WalletError, digest, base64, PASSPHRASES, STELLAR_VERSION, FREIGHTER_VERSION } from './common.mjs';

export async function installedPackage(name, expectedVersion) {
  let entry;
  try { entry = fileURLToPath(import.meta.resolve(name)); }
  catch { throw new WalletError('WALLET_PACKAGE_MISSING_' + name.replace(/[^a-zA-Z0-9]/g, '_')); }
  let dir = dirname(entry);
  for (let i = 0; i < 10; i++) {
    try {
      const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
      if (pkg.name === name) {
        const installed = /^(\d+)\.(\d+)\.(\d+)$/.exec(pkg.version);
        const wanted = /^(\d+)\.(\d+)\.(\d+)$/.exec(expectedVersion.replace(/^\^/, ''));
        const compatible = expectedVersion.startsWith('^') && installed && wanted &&
          Number(installed[1]) === Number(wanted[1]) &&
          (Number(installed[2]) > Number(wanted[2]) ||
            Number(installed[2]) === Number(wanted[2]) && Number(installed[3]) >= Number(wanted[3]));
        requireValue(pkg.version === expectedVersion || compatible, 'WALLET_PACKAGE_VERSION_MISMATCH');
        return { directory: dir, entry, version: pkg.version };
      }
    } catch (e) { if (e instanceof WalletError) throw e; }
    const parent = dirname(dir); if (parent === dir) break; dir = parent;
  }
  throw new WalletError('WALLET_PACKAGE_VERSION_UNAVAILABLE');
}
export async function loadFreighterBundle() {
  const pkg = await installedPackage('@stellar/freighter-api', FREIGHTER_VERSION);
  const path = join(pkg.directory, 'build', 'index.min.js');
  const stat = await lstat(path);
  requireValue(stat.isFile() && stat.size > 0 && stat.size <= 2097152 &&
    (process.platform === 'win32' || (stat.mode & 0o022) === 0), 'WALLET_BUNDLE_INVALID');
  const bytes = await readFile(path);
  requireValue(bytes.length <= 2097152, 'WALLET_BUNDLE_TOO_LARGE');
  return { bytes, version: pkg.version, sha256: digest(bytes) };
}
export async function loadVerifier(config) {
  await installedPackage('@stellar/stellar-sdk', STELLAR_VERSION);
  return createVerifier(config, await import('@stellar/stellar-sdk'));
}

/** sdk injection is for trusted embedding; HTTP input cannot select a verifier. */
export function createVerifier(config, sdk) {
  const passphrase = PASSPHRASES[config.network];
  requireValue(sdk.StrKey.isValidEd25519PublicKey(config.payer), 'WALLET_CLASSIC_ACCOUNT_REQUIRED');
  const key = sdk.Keypair.fromPublicKey(config.payer);
  const expectedNetwork = sdk.hash(Buffer.from(passphrase));
  const terms = config.operation?.expect;
  requireValue(terms && terms.network === config.network &&
    sdk.StrKey.isValidContract(terms.asset) && /^[GC][A-Z2-7]{55}$/.test(terms.payTo) &&
    /^[1-9][0-9]{0,38}$/.test(terms.maxAtomic), 'WALLET_OPERATION_REQUIRED');

  function inspect(entryXdr) {
    const raw = base64(entryXdr);
    let preimage;
    try { preimage = sdk.xdr.HashIdPreimage.fromXDR(raw); }
    catch { throw new WalletError('WALLET_AUTH_PREIMAGE_INVALID'); }
    requireValue(preimage.switch().name === 'envelopeTypeSorobanAuthorization', 'WALLET_AUTH_PREIMAGE_TYPE');
    const auth = preimage.sorobanAuthorization();
    requireValue(Buffer.from(auth.networkId()).equals(expectedNetwork), 'WALLET_NETWORK_MISMATCH');
    const invocation = auth.invocation();
    requireValue(invocation.function().switch().name === 'sorobanAuthorizedFunctionTypeContractFn' &&
      invocation.subInvocations().length === 0, 'WALLET_TRANSFER_INVOCATION_REQUIRED');
    const call = invocation.function().contractFn();
    const contract = sdk.Address.fromScAddress(call.contractAddress()).toString();
    const method = call.functionName().toString();
    const args = call.args();
    requireValue(contract === terms.asset && method === 'transfer' && args.length === 3, 'WALLET_TRANSFER_MISMATCH');
    let from, to, amount;
    try {
      from = sdk.scValToNative(args[0]); to = sdk.scValToNative(args[1]); amount = sdk.scValToNative(args[2]);
    } catch { throw new WalletError('WALLET_TRANSFER_ARGUMENTS_INVALID'); }
    requireValue(args[0].switch().name === 'scvAddress' && args[1].switch().name === 'scvAddress' &&
      args[2].switch().name === 'scvI128' && from === config.payer && to === terms.payTo &&
      typeof amount === 'bigint' && amount > 0n && amount <= BigInt(terms.maxAtomic),
    'WALLET_TRANSFER_TERMS_MISMATCH');
    requireValue(preimage.toXDR('base64') === entryXdr, 'WALLET_AUTH_PREIMAGE_NONCANONICAL');
    return {
      kind: 'Soroban transfer authorization', network: config.network, payer: config.payer,
      asset: contract, recipient: to, amountAtomic: amount.toString(), maximumAtomic: terms.maxAtomic,
      nonce: auth.nonce().toString(), expirationLedger: auth.signatureExpirationLedger(),
      payloadSha256: digest(raw),
    };
  }
  function verify(entryXdr, result) {
    inspect(entryXdr);
    requireValue(result && !result.error && result.signerAddress === config.payer, 'WALLET_SIGNER_MISMATCH');
    const signature = base64(result.signedAuthEntry, 128);
    requireValue(signature.length === 64 && key.verify(sdk.hash(base64(entryXdr)), signature),
      'WALLET_SIGNATURE_INVALID');
    return { signedAuthEntry: signature.toString('base64'), signerAddress: config.payer };
  }
  return Object.freeze({ inspect, verify });
}
