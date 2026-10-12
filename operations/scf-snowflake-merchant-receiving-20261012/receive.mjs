#!/usr/bin/env node
// MIT. Carry the original saved Snowflake input through the complete native product.
import assert from 'node:assert/strict';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--source-root', '--directory'].includes(args[i]) || !args[i + 1] || options[args[i]])
    throw new Error('Use --source-root EXISTING_COMPLETE_SOURCE --directory SAME_PRIVATE_OPERATION');
  options[args[i]] = args[i + 1];
}
if (!options['--source-root'] || !options['--directory'])
  throw new Error('Use --source-root EXISTING_COMPLETE_SOURCE --directory SAME_PRIVATE_OPERATION');
process.umask(0o077);
const sourceRoot = await realpath(resolve(options['--source-root']));
const root = resolve(options['--directory']), inputs = join(root, 'inputs');
const packaged = dirname(fileURLToPath(import.meta.url));
const product = join(sourceRoot, 'stellar/scf-starforge-20261009/sf30-seller-sdk/snowflake');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const { privateDirectory } = await import(pathToFileURL(join(product, 'merchant/files.mjs')));
const { atomicFile, atomicJson } = await import(pathToFileURL(join(sourceRoot,
  'stellar/scf-starforge-20261009/sf46-release/release-core.mjs')));
await privateDirectory(root);
await privateDirectory(inputs);
async function unchanged(path, bytes) {
  try {
    await atomicFile(path, bytes, 0o600, { exclusive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077 || await realpath(path) !== path)
      throw new Error('Original receiving input is not a private regular file.');
    assert.deepEqual(await readFile(path), bytes, 'Continue with the same complete original input.');
  }
}
const saved = atomicJson;
const selectionBytes = await readFile(join(packaged, 'input-selection.json'));
const selection = JSON.parse(selectionBytes);
assert.equal(selection.schema, 'commons.snowflake-original-merchant-input.v1');
const manifestBytes = await readFile(join(packaged, 'receiving.json'));
const manifest = JSON.parse(manifestBytes);
assert.equal(manifest.editionId, selection.originalEditionId);
assert.equal(manifest.sourceId, selection.sourceId);
assert.equal(manifest.requestId, selection.originalRequestId);
assert.equal(manifest.statementHandle, selection.originalStatementHandle);
assert.deepEqual(manifest.partitions, selection.partitions);
const { validateSnowflakeReceivingManifest } = await import(pathToFileURL(join(product, 'transfer.mjs')));
validateSnowflakeReceivingManifest(manifest);
await unchanged(join(inputs, 'receiving.json'), manifestBytes);
for (const descriptor of manifest.partitions) {
  const bytes = await readFile(join(packaged, descriptor.path));
  assert.equal(bytes.length, descriptor.bytes); assert.equal(digest(bytes), descriptor.sha256);
  await unchanged(join(inputs, descriptor.path), bytes);
}
const require = createRequire(join(sourceRoot, 'snowflake-native-receiving.mjs'));
const { StrKey } = require('@stellar/stellar-sdk');
const columns = manifest.source.queries.ledger.columns;
const draft = {
  merchant: {
    name: 'C94 retained Snowflake merchant', origin: 'https://snowflake-c94.example',
    network: 'stellar:testnet', asset: StrKey.encodeContract(Buffer.alloc(32)),
    payTo: StrKey.encodeEd25519PublicKey(Buffer.alloc(32)), maxTimeoutSeconds: 60,
  },
  queries: [{
    name: 'ledger', method: 'GET', path: '/ledger',
    sql: 'SELECT ' + columns.map(name => '"' + name.replaceAll('"', '""') + '"').join(', ') +
      ' FROM records ORDER BY __sf30_row_number',
    columns, parameters: {}, publicInput: {}, maxRows: 100, maxBytes: 917504, timeoutMs: 1000,
    description: 'Exact reviewed retained edition', amount: '1',
  }],
};
await unchanged(join(inputs, 'merchant-draft.json'), encode(draft));
await unchanged(join(root, 'input-selection.json'), selectionBytes);
const configuration = {
  directory: join(root, 'merchant-case'),
  manifestFile: join(inputs, 'receiving.json'),
  draftFile: join(inputs, 'merchant-draft.json'),
  publicationId: selection.publicationId,
  exportId: 'original-snowflake-delivery',
  workspace: 'warehouse',
};
await unchanged(join(root, 'receiving-config.json'), encode(configuration));
const sourceFiles = [
  'declaration.mjs', 'store.mjs', 'source.mjs', 'edition.mjs', 'publisher.mjs',
  'workspace.mjs', 'server.mjs', 'transfer.mjs', 'managed.mjs', 'cloud-delivery.mjs',
  'merchant/catalog.mjs', 'merchant/files.mjs', 'merchant/runtime.mjs', 'merchant/provider.mjs',
  'merchant/setup.mjs', 'merchant/client.mjs', 'merchant/receiving.mjs',
];
const sourceSelection = { sourceRoot, node: process.version, files: [] };
for (const path of sourceFiles) {
  const bytes = await readFile(join(product, path));
  sourceSelection.files.push({ path, bytes: bytes.length,
    gitBlobSha: createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex') });
}
const sourceBytes = encode(sourceSelection), sourceSha256 = digest(sourceBytes);
await unchanged(join(root, 'source-' + sourceSha256 + '.json'), sourceBytes);
console.log(JSON.stringify({ operationId: selection.operationId, state: 'NATIVE_STARTING',
  directory: root, inputKind: selection.inputKind, originalEditionId: selection.originalEditionId,
  sourceSha256, node: process.version }));
try {
  const { runSnowflakeMerchantReceiving } = await import(pathToFileURL(join(product, 'merchant/receiving.mjs')));
  const native = await runSnowflakeMerchantReceiving(configuration);
  const result = { schema: 'commons.snowflake-original-merchant-result.v1', operationId: selection.operationId,
    state: native.state, finishedAt: new Date().toISOString(), inputKind: selection.inputKind,
    sourceSha256, sourceSelection: 'source-' + sourceSha256 + '.json',
    originalEditionId: selection.originalEditionId, native };
  await saved(join(root, 'result.json'), result);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await saved(join(root, 'last-error.json'), { operationId: selection.operationId,
    sourceSha256, at: new Date().toISOString(), code: error.code ?? error.name, message: error.message });
  throw error;
}
