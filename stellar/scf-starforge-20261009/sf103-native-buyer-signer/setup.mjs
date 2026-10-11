// MIT. Prepare an original SF88 operation for the native signer, or inspect it.
import { createHash } from 'node:crypto';
import { mkdir, open, lstat, rmdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execution } from '../sf88-operator-buyer-cli/config.mjs';
import { SDK_VERSION, NativeSignerError, requireValue } from './adapter.mjs';
import { CONFIG_SCHEMA, absolute, readPrivateFile, parseJson, validateNativeConfig,
  inspectOperatorConfig, loadOperatorSigner } from './operator.mjs';

const signerModule = fileURLToPath(new URL('./signer.mjs', import.meta.url));
const sha = data => createHash('sha256').update(data).digest('hex');

async function writeNew(path, bytes) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); }
  catch (error) { await unlink(path).catch(() => {}); throw error; }
  finally { await file.close(); }
}
async function syncDirectory(path) {
  if (process.platform === 'win32') return;
  const directory = await open(path, 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

/** Creates a separate operation copy; it never changes the operator's input. */
export async function prepareNativeBuyer({ buyerConfig, output, secretEnv, signerProvider, rpcUrl }) {
  absolute(buyerConfig); absolute(output);
  const original = parseJson(await readPrivateFile(buyerConfig));
  const buyer = { ...original, signerModule };
  let parsed;
  try { parsed = execution(buyer); } catch { throw new NativeSignerError('NATIVE_SF88_CONFIG_INVALID'); }
  requireValue(typeof buyer.trustedPayer === 'string', 'NATIVE_TRUSTED_PAYER_REQUIRED');
  // Validate network/RPC configuration before writing either configuration file.
  if (rpcUrl !== undefined) {
    let url;
    try { url = new URL(rpcUrl); } catch { throw new NativeSignerError('NATIVE_RPC_URL_INVALID'); }
    requireValue(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash,
      'NATIVE_RPC_HTTPS_REQUIRED');
  }
  requireValue(parsed.op.expect.network === 'stellar:testnet' || rpcUrl !== undefined,
    'NATIVE_PUBNET_RPC_REQUIRED');
  const buyerPath = join(output, 'buyer.json');
  const signerPath = join(output, 'signer.json');
  const buyerBytes = Buffer.from(JSON.stringify(buyer, null, 2) + '\n');
  const native = validateNativeConfig({ schema: CONFIG_SCHEMA, buyerConfig: buyerPath,
    buyerConfigSha256: sha(buyerBytes), ...(secretEnv === undefined ? {} : { secretEnv }),
    ...(signerProvider === undefined ? {} : { signerProvider }), ...(rpcUrl === undefined ? {} : { rpcUrl }) });
  const parent = await lstat(dirname(output)).catch(() => null);
  requireValue(parent?.isDirectory() && (process.platform === 'win32' ||
    ((parent.mode & 0o077) === 0 && parent.uid === process.getuid())), 'NATIVE_PRIVATE_PARENT_REQUIRED');
  const created = [];
  let made = false;
  try {
    await mkdir(output, { mode: 0o700 }); made = true;
    await writeNew(buyerPath, buyerBytes); created.push(buyerPath);
    await writeNew(signerPath, JSON.stringify(native, null, 2) + '\n'); created.push(signerPath);
    const inspected = await inspectOperatorConfig(signerPath);
    await syncDirectory(output); await syncDirectory(dirname(output));
    return { ...inspected.summary, status: 'PREPARED', buyerConfig: buyerPath,
      signerConfig: signerPath, signerModule, environmentVariable: 'SF103_SIGNER_CONFIG',
      sdkRequired: SDK_VERSION };
  } catch (error) {
    for (const file of created.reverse()) await unlink(file).catch(() => {});
    if (made) await rmdir(output).catch(() => {});
    if (error instanceof NativeSignerError) throw error;
    throw new NativeSignerError(error?.code === 'EEXIST' ? 'NATIVE_OUTPUT_ALREADY_EXISTS' : 'NATIVE_SETUP_WRITE_FAILED');
  }
}

function options(args, allowed) {
  requireValue(args.length % 2 === 0, 'NATIVE_OPTION_REQUIRES_VALUE');
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    requireValue(allowed.includes(args[i]) && !Object.hasOwn(values, args[i]) && typeof args[i + 1] === 'string',
      'NATIVE_OPTION_INVALID');
    values[args[i]] = args[i + 1];
  }
  return values;
}
export async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args;
  let result;
  if (command === 'prepare') {
    const opts = options(rest, ['--buyer-config', '--out', '--secret-env', '--provider', '--rpc']);
    result = await prepareNativeBuyer({ buyerConfig: opts['--buyer-config'], output: opts['--out'],
      secretEnv: opts['--secret-env'], signerProvider: opts['--provider'], rpcUrl: opts['--rpc'] });
  } else if (command === 'inspect' || command === 'check-signer') {
    const opts = options(rest, ['--config']);
    result = command === 'inspect' ? (await inspectOperatorConfig(opts['--config'])).summary :
      (await loadOperatorSigner(opts['--config'])).summary;
  } else {
    throw new NativeSignerError('Usage: setup.mjs prepare --buyer-config /private/pilot.json --out /private/new-operation --secret-env EXISTING_SECRET_ENV [--rpc https://rpc.example] | inspect --config /private/new-operation/signer.json | check-signer --config /private/new-operation/signer.json');
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result;
}
if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write((error instanceof NativeSignerError ? error.code : 'NATIVE_SETUP_FAILED') + '\n');
    process.exitCode = 1;
  });
}
