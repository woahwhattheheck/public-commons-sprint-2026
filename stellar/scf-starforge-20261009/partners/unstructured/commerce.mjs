#!/usr/bin/env node
// MIT. Document preparation into the original SF66 commerce session and research inbox.
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectUnstructuredMerchant } from './merchant.mjs';
import { preparePartitionRequest } from '../../sf88-operator-buyer-cli/node/unstructured/purchase.mjs';
import { need, object, same, UNSTRUCTURED_SOURCE, validatePartitionManifest } from '../../sf88-operator-buyer-cli/node/unstructured/contract.mjs';
import { prepareCommerceSetup, inspectCommerceSetup } from '../../sf66-demo-launcher/commerce-setup.mjs';
import { absolute, parseJson, readPrivateFile } from '../../sf103-native-buyer-signer/operator.mjs';
import {
  acquireInitialization, initializationDirectory, initializationJson,
  retainInitializationFile, retainInitializationRecord, verifyInitializationFile,
} from '../../sf88-operator-buyer-cli/initialization.mjs';

const CONFIG = 'stellar-forge.unstructured-commerce.v1';
const SCHEMA = 'stellar-forge.prepared-unstructured-commerce.v1';
const SOURCE = 'stellar-forge.unstructured-document-source.v1';
const FIXED_FILES = ['configuration.json', 'partition-manifest.json', 'request-reviews.json',
  'commerce-setup.json', 'document-source.json'];
const sha = value => createHash('sha256').update(value).digest('hex');
const descriptor = (name, bytes) => ({ name, bytes: bytes.length, sha256: sha(bytes) });
const thisCli = fileURLToPath(import.meta.url);
const runtimeDefault = resolve(fileURLToPath(new URL('../../sf88-operator-buyer-cli/', import.meta.url)));
const nativeCli = fileURLToPath(new URL('../../sf66-demo-launcher/commerce-cli.mjs', import.meta.url));
const consoleCli = fileURLToPath(new URL('../../sf66-demo-launcher/commerce-console.mjs', import.meta.url));
const researchCli = fileURLToPath(new URL('../../sf88-operator-buyer-cli/research-dossiers/server.mjs', import.meta.url));

function fields(value, allowed, code) {
  need(object(value) && Object.keys(value).every(key => allowed.includes(key)), code);
  return value;
}
function parseConfiguration(bytes) {
  const input = fields(parseJson(bytes), ['schema', 'merchantDirectory', 'facilitatorConfig',
    'operator', 'workspaceId', 'documents', 'runtimeDirectory', 'sellerPort', 'operationsPort'],
  'UNSTRUCTURED_COMMERCE_CONFIGURATION_INVALID');
  need(input.schema === CONFIG, 'UNSTRUCTURED_COMMERCE_SCHEMA_INVALID');
  absolute(input.merchantDirectory); absolute(input.facilitatorConfig);
  need(object(input.operator), 'UNSTRUCTURED_ORIGINAL_OPERATOR_REQUIRED');
  absolute(input.operator.python);
  need(typeof input.workspaceId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(input.workspaceId),
    'UNSTRUCTURED_DOCUMENT_WORKSPACE_ID_REQUIRED');
  absolute(input.runtimeDirectory ?? runtimeDefault);
  need(Array.isArray(input.documents) && input.documents.length > 0 && input.documents.length <= 64,
    'UNSTRUCTURED_DOCUMENT_SELECTION_REQUIRED');
  const ids = new Set();
  for (const document of input.documents) {
    fields(document, ['profile', 'file', 'filename', 'mediaType', 'intentId', 'maxAtomic', 'acceptIndex'],
      'UNSTRUCTURED_DOCUMENT_SELECTION_INVALID');
    absolute(document.file);
    need(typeof document.intentId === 'string' && !ids.has(document.intentId),
      'UNSTRUCTURED_ORIGINAL_INTENT_REQUIRED');
    ids.add(document.intentId);
  }
  for (const value of [input.sellerPort, input.operationsPort])
    need(value === undefined || Number.isInteger(value) && value >= 0 && value <= 65535,
      'UNSTRUCTURED_COMMERCE_PORT_INVALID');
  return input;
}

function sourceFor(input, directory) {
  return {
    schema: SOURCE, workspaceId: input.workspaceId,
    inboxDirectory: join(directory, 'commerce', 'session', 'inbox'),
    runtimeDirectory: input.runtimeDirectory ?? runtimeDefault,
  };
}

/** Prepare exact document bytes once, then initialize the existing seller/buyer session. */
export async function prepareUnstructuredCommerce({ configFile, directory } = {},
  { environment = process.env, resume = false } = {}) {
  absolute(configFile); absolute(directory);
  const configBytes = await readPrivateFile(configFile, 1048576);
  const input = parseConfiguration(configBytes);
  const merchant = await inspectUnstructuredMerchant(input.merchantDirectory);
  const manifestBytes = await readPrivateFile(merchant.manifestFile, 1048576);
  need(same(parseJson(manifestBytes), merchant.manifest), 'UNSTRUCTURED_MERCHANT_MANIFEST_CHANGED');
  const identity = {
    schema: SCHEMA, source: UNSTRUCTURED_SOURCE, configurationSha256: sha(configBytes),
    merchantConfigurationSha256: merchant.configurationSha256,
    merchantFiles: merchant.files, workspaceId: input.workspaceId,
  };
  await initializationDirectory(dirname(directory));
  const lease = await acquireInitialization(directory, { python: input.operator.python, resume });
  try {
    await retainInitializationRecord(join(directory, 'initializing.json'), identity, { resume });
    const fixed = [
      ['configuration.json', configBytes],
      ['partition-manifest.json', manifestBytes],
    ];
    for (const [name, bytes] of fixed) await verifyInitializationFile(join(directory, name), bytes);
    for (const [name, bytes] of fixed)
      await retainInitializationFile(join(directory, name), bytes, { resume });
    await initializationDirectory(join(directory, 'bodies'), { create: true });
    const reviews = [], purchases = [], bodyFiles = [];
    for (const [index, document] of input.documents.entries()) {
      const name = 'bodies/' + String(index + 1).padStart(2, '0') + '.bin';
      const prepared = await preparePartitionRequest({
        runtimeDirectory: input.runtimeDirectory ?? runtimeDefault,
        manifest: merchant.manifest, ...document, bodyFile: join(directory, name),
      });
      // The native helper retains the original random multipart boundary on resume.
      // Its selected ceiling is checked against the complete advertised option.
      const { reused: _wireReused, purchase, ...review } = prepared;
      purchases.push(purchase);
      reviews.push({ intentId: document.intentId, profileId: document.profile, ...review });
      bodyFiles.push({ name, bytes: prepared.bodyBytes, sha256: prepared.bodySha256 });
    }
    const originalSetup = {
      schema: 'stellar-forge.commerce-setup.v1',
      seller: {
        config: merchant.sellerFile, upstreams: merchant.upstreamsFile,
        allowLoopbackUpstream: merchant.allowLoopbackUpstream,
        facilitatorConfig: input.facilitatorConfig,
        ...(input.sellerPort === undefined ? {} : { port: input.sellerPort }),
      },
      operator: input.operator, purchases,
      ...(input.operationsPort === undefined ? {} : { operationsPort: input.operationsPort }),
    };
    const documentSource = sourceFor(input, directory);
    fixed.push(['request-reviews.json', initializationJson(reviews)],
      ['commerce-setup.json', initializationJson(originalSetup)],
      ['document-source.json', initializationJson(documentSource)]);
    for (const [name, bytes] of fixed) await verifyInitializationFile(join(directory, name), bytes);
    for (const [name, bytes] of fixed)
      await retainInitializationFile(join(directory, name), bytes, { resume: true });
    const native = await prepareCommerceSetup({
      configFile: join(directory, 'commerce-setup.json'), directory: join(directory, 'commerce'),
    }, { environment, resume });
    const session = parseJson(await readPrivateFile(join(native.session.directory, 'session.json'), 1048576));
    need(session.directory === join(directory, 'commerce', 'session') &&
      session.queueRoot === documentSource.inboxDirectory,
    'UNSTRUCTURED_ORIGINAL_INBOX_BINDING_CHANGED');
    await retainInitializationRecord(join(directory, 'prepared.json'), {
      ...identity, completedAt: new Date().toISOString(),
      files: [...fixed.map(([name, bytes]) => descriptor(name, bytes)), ...bodyFiles],
      nativeDirectory: join(directory, 'commerce'), documentSource,
    }, { resume, ignore: ['completedAt'] });
    return inspectUnstructuredCommerce(directory);
  } finally { await lease.close(); }
}

/** Reopen the same native inbox and request bytes, including after a completed purchase. */
export async function inspectUnstructuredCommerce(directory) {
  absolute(directory); await initializationDirectory(directory);
  const record = parseJson(await readPrivateFile(join(directory, 'prepared.json'), 1048576));
  need(record.schema === SCHEMA && same(record.source, UNSTRUCTURED_SOURCE) &&
    record.nativeDirectory === join(directory, 'commerce') &&
    Array.isArray(record.files) && record.files.length >= FIXED_FILES.length + 1 &&
    record.files.length <= FIXED_FILES.length + 64,
  'UNSTRUCTURED_COMMERCE_PREPARATION_INVALID');
  const retained = new Map();
  for (const [index, item] of record.files.entries()) {
    const expected = index < FIXED_FILES.length ? FIXED_FILES[index] :
      'bodies/' + String(index - FIXED_FILES.length + 1).padStart(2, '0') + '.bin';
    need(item.name === expected && Number.isSafeInteger(item.bytes) && item.bytes > 0 &&
      item.bytes <= 16777216 && /^[a-f0-9]{64}$/.test(item.sha256 ?? ''),
    'UNSTRUCTURED_COMMERCE_FILE_INVALID');
    const bytes = await readPrivateFile(join(directory, item.name), 16777216);
    need(bytes.length === item.bytes && sha(bytes) === item.sha256,
      'UNSTRUCTURED_COMMERCE_RETAINED_FILE_CHANGED');
    if (index < FIXED_FILES.length) retained.set(item.name, bytes);
  }
  need(sha(retained.get('configuration.json')) === record.configurationSha256,
    'UNSTRUCTURED_COMMERCE_CONFIGURATION_CHANGED');
  const input = parseConfiguration(retained.get('configuration.json'));
  need(record.workspaceId === input.workspaceId, 'UNSTRUCTURED_DOCUMENT_WORKSPACE_CHANGED');
  const manifest = validatePartitionManifest(parseJson(retained.get('partition-manifest.json')));
  const reviews = parseJson(retained.get('request-reviews.json'));
  const documentSource = parseJson(retained.get('document-source.json'));
  need(same(documentSource, record.documentSource) && same(documentSource, sourceFor(input, directory)) &&
    Array.isArray(reviews) && reviews.length === input.documents.length &&
    record.files.length === FIXED_FILES.length + reviews.length,
  'UNSTRUCTURED_DOCUMENT_RECEIVING_BINDING_CHANGED');
  const native = await inspectCommerceSetup(record.nativeDirectory);
  const session = parseJson(await readPrivateFile(join(native.session.directory, 'session.json'), 1048576));
  need(session.queueRoot === documentSource.inboxDirectory &&
    session.directory === join(directory, 'commerce', 'session'),
  'UNSTRUCTURED_ORIGINAL_INBOX_BINDING_CHANGED');
  for (const [index, review] of reviews.entries()) {
    const expected = input.documents[index];
    const selection = native.selections.find(value => value.intentId === expected.intentId);
    const profile = manifest.profiles.find(value => value.id === expected.profile);
    need(review.intentId === expected.intentId && review.profileId === expected.profile &&
      review.maximumAtomic === expected.maxAtomic && profile &&
      review.parametersSha256 === profile.parametersSha256 && selection &&
      selection.routeId === profile.operationId && selection.method === 'POST' &&
      selection.url === profile.url && selection.acceptIndex === expected.acceptIndex &&
      selection.paymentFlow === 'authorization' &&
      same(selection.originalTerms, profile.paymentOptions[expected.acceptIndex]) &&
      review.bodySha256 === selection.bodySha256 && review.bodyBytes === selection.bodyBytes &&
      same(review.originalTerms, selection.originalTerms) &&
      BigInt(selection.originalTerms.amount) <= BigInt(review.maximumAtomic),
    'UNSTRUCTURED_ORIGINAL_PURCHASE_BINDING_CHANGED');
  }
  return {
    schema: SCHEMA, state: 'PREPARED', directory, completedAt: record.completedAt,
    source: record.source, workspaceId: record.workspaceId,
    publicOrigin: manifest.publicOrigin, documents: reviews,
    documentSourceFile: join(directory, 'document-source.json'),
    originalCommerce: native,
    commands: {
      inspect: [process.execPath, thisCli, 'inspect', '--directory', directory],
      start: [process.execPath, nativeCli, 'start', '--directory', native.session.directory],
      console: [process.execPath, consoleCli, 'start', '--directory', native.session.directory],
      research: [process.execPath, researchCli, '--dir', join(directory, 'research-dossiers'),
        '--document-source', join(directory, 'document-source.json'), '--port', '8846'],
    },
  };
}

const HELP = 'Unstructured document commerce\n' +
  '  node commerce.mjs prepare|resume --config /private/document-commerce.json --directory /private/document-session\n' +
  '  node commerce.mjs inspect --directory /private/document-session\n' +
  'Preparation retains the document wire and original SF66 session. Returned start/console/research argv use the existing native operators.\n';
export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && ['help', '--help'].includes(args[0])) {
    process.stdout.write(HELP); return;
  }
  const [command, ...rest] = args, opt = {};
  need(['prepare', 'resume', 'inspect'].includes(command) && rest.length % 2 === 0,
    'UNSTRUCTURED_COMMERCE_COMMAND_REQUIRED');
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    need((command === 'inspect' ? ['--directory'] : ['--config', '--directory']).includes(flag) &&
      !Object.hasOwn(opt, flag) && typeof rest[i + 1] === 'string' && !rest[i + 1].startsWith('--'),
    'UNSTRUCTURED_COMMERCE_OPTION_INVALID');
    opt[flag] = rest[i + 1];
  }
  absolute(opt['--directory']);
  const result = command === 'inspect' ? await inspectUnstructuredCommerce(opt['--directory']) :
    await prepareUnstructuredCommerce({ configFile: opt['--config'], directory: opt['--directory'] },
      { resume: command === 'resume' });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    const code = /^[A-Z0-9_]{1,120}$/.test(error.code ?? '') ? error.code : 'UNSTRUCTURED_COMMERCE_FAILED';
    process.stderr.write(JSON.stringify({ error: code }) + '\n'); process.exitCode = 1;
  });
}
