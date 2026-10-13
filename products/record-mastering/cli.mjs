#!/usr/bin/env node
// MIT. Product receiving commands delegate to the original mastering and Applications owners.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareMasteringProduct, saveMasteringProduct, masteringProductStatus, connectMasteringProduct,
  startMasteringProduct, recoverMasteringProduct, stopMasteringProduct, exportMasteringProduct } from './workspace.mjs';

const HELP = `Record mastering workspace

  record-mastering-workspace prepare --directory PRIVATE_SETUP --request PRIVATE_JSON [--request-id UUID]
  record-mastering-workspace prepare --directory PRIVATE_SETUP
  record-mastering-workspace save --directory PRIVATE_SETUP
  record-mastering-workspace status --directory PRIVATE_SETUP
  record-mastering-workspace connect --directory PRIVATE_SETUP
  record-mastering-workspace start --directory PRIVATE_SETUP --request-id UUID
  record-mastering-workspace recover --directory PRIVATE_SETUP --operation-id UUID
  record-mastering-workspace stop --directory PRIVATE_SETUP --operation-id UUID
  record-mastering-workspace export --directory PRIVATE_SETUP --kind workspace|delivery --revision N --request-id UUID [--delivery-id UUID]

Prepare receives the complete original setup document, selected READY runtime,
existing editable record workspace, native Applications review and private
merchant connection. Review the returned setup, then save that same operation.
Start, stop, reconnect and recovery use the original Applications process.

The original record-mastering create, serve, import, invoke, receive and
unpack-delivery commands remain available in this same installed package.
Use the complete operating guide at products/record-mastering/OPERATING.md.
`;
const allowed = {
  prepare: ['--directory', '--request', '--request-id'], save: ['--directory'], status: ['--directory'],
  connect: ['--directory'], start: ['--directory', '--request-id'],
  recover: ['--directory', '--operation-id'], stop: ['--directory', '--operation-id'],
  export: ['--directory', '--kind', '--revision', '--request-id', '--delivery-id'],
};
function required(options, name) {
  if (!options[name]) throw Object.assign(new Error('Provide ' + name + '.'), { code: 'MASTERING_PRODUCT_ARGUMENT_REQUIRED' });
  return options[name];
}
export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv.length === 1 && argv[0] === '--help') { process.stdout.write(HELP); return; }
  const [action, ...rest] = argv, options = {};
  if (!allowed[action] || rest.length % 2) throw Object.assign(new Error('Choose a declared product command and its value options.'), { code: 'MASTERING_PRODUCT_ARGUMENTS_INVALID' });
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i], value = rest[i + 1];
    if (!allowed[action].includes(key) || Object.hasOwn(options, key) || !value || value.startsWith('--'))
      throw Object.assign(new Error('Unexpected, duplicate or empty option: ' + key), { code: 'MASTERING_PRODUCT_ARGUMENTS_INVALID' });
    options[key] = value;
  }
  const directory = resolve(required(options, '--directory'));
  let result;
  if (action === 'prepare') result = await prepareMasteringProduct({ directory,
    requestFile: options['--request'] ? resolve(options['--request']) : null, requestId: options['--request-id'] ?? null });
  else if (action === 'save') result = await saveMasteringProduct({ directory });
  else if (action === 'status') result = await masteringProductStatus({ directory });
  else if (action === 'connect') result = await connectMasteringProduct({ directory });
  else if (action === 'start') result = await startMasteringProduct({ directory, requestId: required(options, '--request-id') });
  else if (action === 'recover') result = await recoverMasteringProduct({ directory, operationId: required(options, '--operation-id') });
  else if (action === 'stop') result = await stopMasteringProduct({ directory, operationId: required(options, '--operation-id') });
  else {
    const revision = required(options, '--revision');
    if (!/^(0|[1-9][0-9]*)$/.test(revision) || !Number.isSafeInteger(Number(revision)))
      throw Object.assign(new Error('Use the actual nonnegative integer workspace revision.'), { code: 'MASTERING_PRODUCT_REVISION_INVALID' });
    result = await exportMasteringProduct({ directory, kind: required(options, '--kind'), expectedRevision: Number(revision),
      requestId: required(options, '--request-id'), ...(options['--delivery-id'] ? { deliveryId: options['--delivery-id'] } : {}) });
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main().catch(error => { process.stderr.write(JSON.stringify({ error: error.code ?? 'MASTERING_PRODUCT_ERROR', message: error.message }) + '\n'); process.exitCode = 1; });
