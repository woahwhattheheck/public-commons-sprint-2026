// MIT. Prepare the original published Stellar SDK bundle for native receiving.
import { readFile, writeFile, mkdir, realpath, stat } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const SDK_RUNTIME_SOURCE = Object.freeze({
  package: '@stellar/stellar-sdk',
  version: '16.3.1',
  nodeMajorMinimum: 22,
  bundleBytes: 487628,
  bundleIntegrity: 'sha256-ZEWtWqGPz98s2AlXZtmX4YwaBLKJBz21Tnrq5DzBxD8=',
  distributionMetadataUrl: 'https://unpkg.com/@stellar/stellar-sdk@16.3.1/dist/?meta',
  metadataBytes: 8764,
  bundleUrl: 'https://cdn.jsdelivr.net/npm/@stellar/stellar-sdk@16.3.1/dist/stellar-sdk.min.js',
  metadataUrl: 'https://registry.npmjs.org/@stellar/stellar-sdk/16.3.1',
  repository: 'https://github.com/stellar/js-stellar-sdk',
  gitHead: '1f2b862d0257401c85d62e9b7d424b64d14b149a',
  buildSource: 'https://github.com/stellar/js-stellar-sdk/blob/v16.3.1/rollup.config.mjs',
  buildSourceGitBlob: '01dec437e305be2fbd2cb5b438c164095622c609',
});
export const SDK_RUNTIME_EXPORTS = Object.freeze([
  'Account', 'Address', 'Asset', 'Contract', 'MuxedAccount',
  'Networks', 'StrKey', 'TransactionBuilder', 'scValToNative', 'xdr',
]);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const gitBlob = bytes => createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
const need = (condition, message) => { if (!condition) throw new Error(message); };

const adapterSource = `// MIT. Thin Node ESM adapter for the unchanged published @stellar/stellar-sdk UMD.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sdk = require('./stellar-sdk-16.3.1.cjs');
const names = ['Account','Address','Asset','Contract','MuxedAccount','Networks','StrKey','TransactionBuilder','scValToNative','xdr'];
for (const name of names) {
  if (sdk[name] === undefined || sdk[name] === null) {
    throw new Error('The retained Stellar SDK bundle omitted required export ' + name + '.');
  }
}
export const Account = sdk.Account;
export const Address = sdk.Address;
export const Asset = sdk.Asset;
export const Contract = sdk.Contract;
export const MuxedAccount = sdk.MuxedAccount;
export const Networks = sdk.Networks;
export const StrKey = sdk.StrKey;
export const TransactionBuilder = sdk.TransactionBuilder;
export const scValToNative = sdk.scValToNative;
export const xdr = sdk.xdr;
export default sdk;
`;

/**
 * Create a private, independently reusable SDK donor without package installation.
 * options: bundle, metadata, output (a new directory), importedAt (optional ISO).
 * Copies the complete original bundle bytes as .cjs solely to select Node's UMD
 * CommonJS loading mode. Source metadata and the exact preparer join the donor.
 */
export async function prepareSdkRuntime(options = {}) {
  const startedAt = new Date().toISOString();
  need(Number(process.versions.node.split('.')[0]) >= SDK_RUNTIME_SOURCE.nodeMajorMinimum,
    'Use the existing Node 22 or later runtime for Stellar SDK 16.3.1.');
  need(typeof options.bundle === 'string' && typeof options.metadata === 'string' &&
    typeof options.output === 'string', 'Supply the original bundle, original npm metadata and a new private output directory.');
  const bundlePath = await realpath(resolve(options.bundle));
  const metadataPath = await realpath(resolve(options.metadata));
  const output = resolve(options.output);
  const [bundleStat, metadataStat, bundle, metadataBytes] = await Promise.all([
    stat(bundlePath), stat(metadataPath), readFile(bundlePath), readFile(metadataPath),
  ]);
  need(bundleStat.isFile() && metadataStat.isFile(), 'Use the complete original downloaded source files.');
  need(bundle.length === SDK_RUNTIME_SOURCE.bundleBytes,
    'Original SDK bundle must contain exactly ' + SDK_RUNTIME_SOURCE.bundleBytes + ' bytes.');
  need(metadataBytes.length === SDK_RUNTIME_SOURCE.metadataBytes,
    'Original npm metadata must contain exactly ' + SDK_RUNTIME_SOURCE.metadataBytes + ' bytes.');
  need('sha256-' + createHash('sha256').update(bundle).digest('base64') === SDK_RUNTIME_SOURCE.bundleIntegrity,
    'The SDK bundle does not match the original published file integrity.');
  const metadata = JSON.parse(metadataBytes.toString('utf8'));
  need(metadata.name === SDK_RUNTIME_SOURCE.package && metadata.version === SDK_RUNTIME_SOURCE.version &&
    metadata.gitHead === SDK_RUNTIME_SOURCE.gitHead, 'The original metadata must identify the pinned Stellar SDK 16.3.1 publication.');
  need(metadata.dist?.tarball === 'https://registry.npmjs.org/@stellar/stellar-sdk/-/stellar-sdk-16.3.1.tgz' &&
    metadata.dist?.shasum === 'df4f77d3936e72f79aaaa15a51d1520373a5a243',
    'The original npm package distribution identity changed.');
  // Nonrecursive mkdir deliberately preserves every existing donor directory.
  await mkdir(output, {mode:0o700});
  const bundleFile = join(output, 'stellar-sdk-16.3.1.cjs');
  const metadataFile = join(output, 'stellar-sdk-16.3.1-original-npm-metadata.json');
  const adapterFile = join(output, 'stellar-sdk-16.3.1.mjs');
  const preparerFile = join(output, 'prepare-sdk-runtime.mjs');
  const preparerBytes = await readFile(fileURLToPath(import.meta.url));
  await writeFile(bundleFile, bundle, {flag:'wx', mode:0o600});
  await writeFile(metadataFile, metadataBytes, {flag:'wx', mode:0o600});
  await writeFile(adapterFile, adapterSource, {flag:'wx', mode:0o600});
  await writeFile(preparerFile, preparerBytes, {flag:'wx', mode:0o600});
  const companions = [];
  for (const [filename,expectedBlob,sourceUrl] of [
    ['stellar-sdk-16.3.1-original-LICENSE.txt','7939ac6df9a7c3cd1fe213ae4e6d84dcb56040eb','https://raw.githubusercontent.com/stellar/js-stellar-sdk/v16.3.1/LICENSE'],
    ['stellar-sdk-16.3.1-original-dist-metadata.json','c0d2094511612f493e92f4a3fbca48f7d62d91bf',SDK_RUNTIME_SOURCE.distributionMetadataUrl],
  ]) {
    let content;
    try { content = await readFile(join(dirname(metadataPath),filename)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    need(gitBlob(content) === expectedBlob, 'Preserve the complete original ' + filename + '.');
    const file = join(output,filename);
    await writeFile(file,content,{flag:'wx',mode:0o600});
    companions.push({file,filename,sourceUrl,bytes:content.length,sha256:sha256(content),gitBlobSha1:gitBlob(content)});
  }
  const receipt = {
    schema:'stellar-forge.sdk-runtime.v1',
    status:'preparing',
    source:SDK_RUNTIME_SOURCE,
    startedAt,
    importedAt:options.importedAt || startedAt,
    runtime:{node:process.version,platform:process.platform,architecture:process.arch},
    output,
    sdkModule:adapterFile,
    originalFiles:[
      {file:bundleFile,filename: 'stellar-sdk-16.3.1.cjs',sourceUrl:SDK_RUNTIME_SOURCE.bundleUrl,
        originalDownload:bundlePath,bytes:bundle.length,sha256:sha256(bundle),gitBlobSha1:gitBlob(bundle),
        transformation:'Unchanged original bytes; .cjs filename selects the CommonJS branch of the published UMD wrapper.'},
      {file:metadataFile,sourceUrl:SDK_RUNTIME_SOURCE.metadataUrl,originalDownload:metadataPath,
        bytes:metadataBytes.length,sha256:sha256(metadataBytes),gitBlobSha1:gitBlob(metadataBytes)},
    ],
    sourceCompanions:companions,
    adapter:{file:adapterFile,bytes:Buffer.byteLength(adapterSource),sha256:sha256(adapterSource),gitBlobSha1:gitBlob(Buffer.from(adapterSource))},
    preparer:{file:preparerFile,bytes:preparerBytes.length,sha256:sha256(preparerBytes),gitBlobSha1:gitBlob(preparerBytes)},
    npmPackageDistribution:metadata.dist,
    identityNote:'npmPackageDistribution.integrity covers the separate npm tarball. originalFiles records the actual retained standalone bundle and metadata digests.',
    operations:['Copy complete original sources','Load the published UMD locally','Expose original named exports'],
    exports:[],
  };
  const receiptPath = join(output,'sdk-runtime.json');
  try {
    const sdk = await import(pathToFileURL(adapterFile).href);
    for (const name of SDK_RUNTIME_EXPORTS) {
      const value = sdk[name];
      need(value !== undefined && value !== null, 'Original SDK lacks required export ' + name + '.');
      receipt.exports.push({name,type:typeof value});
    }
    need(typeof sdk.TransactionBuilder.fromXDR === 'function' &&
      typeof sdk.xdr.TransactionEnvelope?.fromXDR === 'function' &&
      typeof sdk.xdr.TransactionResult?.fromXDR === 'function' &&
      typeof sdk.xdr.TransactionMeta?.fromXDR === 'function',
      'The retained SDK lacks its native transaction/result/metadata XDR readers.');
    receipt.status = 'ready';
    receipt.completedAt = new Date().toISOString();
    await writeFile(receiptPath, JSON.stringify(receipt,null,2) + '\n', {flag:'wx',mode:0o600});
    return {...receipt,receiptPath};
  } catch (error) {
    receipt.status = 'interrupted';
    receipt.completedAt = new Date().toISOString();
    receipt.error = {name:error.name,message:error.message,code:error.code || null};
    await writeFile(receiptPath, JSON.stringify(receipt,null,2) + '\n', {flag:'wx',mode:0o600});
    error.receiptPath = receiptPath;
    throw error;
  }
}

function argumentsOf(values) {
  const options = {};
  for (let index=0;index<values.length;index+=2) {
    const key = values[index], value = values[index+1];
    need(['--bundle','--metadata','--output'].includes(key) && value && !value.startsWith('--'),
      'Use --bundle ORIGINAL_JS_FILE --metadata ORIGINAL_NPM_JSON --output NEW_PRIVATE_DIRECTORY.');
    need(!options[key.slice(2)], 'Provide each source argument once.');
    options[key.slice(2)] = value;
  }
  return options;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await prepareSdkRuntime(argumentsOf(process.argv.slice(2)));
    process.stdout.write(JSON.stringify(result,null,2) + '\n');
  } catch (error) {
    process.stderr.write(JSON.stringify({error:error.message,receiptPath:error.receiptPath || null}) + '\n');
    process.exitCode = 1;
  }
}
