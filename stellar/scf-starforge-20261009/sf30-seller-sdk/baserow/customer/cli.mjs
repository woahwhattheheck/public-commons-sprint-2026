#!/usr/bin/env node
// MIT. Complete Baserow customer packets from an existing published source.
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openBaserowPublisher } from '../publisher/model.mjs';
import { prepareBaserowCustomer, readBaserowCustomer, resumeBaserowCustomer,
  copyBaserowCustomer, BASEROW_CUSTOMER_MANIFEST } from './model.mjs';
import { check, fault, exists, readJson, same, once, bytes, privateDirectory } from './files.mjs';

const HELP = 'Baserow customer source, original dataset and complete attachment delivery\n\n' +
  '  prepare --publisher DIRECTORY --run UUID --candidate-sha256 SHA --snapshot SHA\n' +
  '    --customer-key KEY --request-id UUID --out DIRECTORY [--query ORIGINAL_QUERY]\n' +
  '  resume --directory ORIGINAL_OUTPUT\n' +
  '  inspect --directory COMPLETE_PACKET [--manifest-sha256 SHA]\n' +
  '  copy --directory COMPLETE_PACKET --manifest-sha256 SHA --out DIRECTORY\n' +
  '  client-export|client-resume|client-inspect|client-copy --help\n\n' +
  'Packet commands can add --result NEW_JSON_FILE to retain its complete result.\n' +
  'Prepare selects an existing PUBLISHED run; its original publisher must be closed\n' +
  'when using the CLI. An embedding caller can pass its existing publisher directly.\n' +
  'Keep the same request UUID and output directory for replay. Resume preserves\n' +
  'the saved selection. Inspect and completed resume/copy use retained files.\n' +
  'The paired customer.rb command receives the packet through the original SF100\n' +
  'receiver, exposes complete selected files, and supplies .dataset to RailsDataset.\n';

function parse(argv) {
  const [command, ...args] = argv, options = {};
  check(['prepare', 'resume', 'inspect', 'copy'].includes(command),
    'BASEROW_CUSTOMER_COMMAND_REQUIRED', HELP);
  const allowed = {
    prepare: ['publisher', 'run', 'candidate-sha256', 'snapshot', 'customer-key', 'request-id', 'out', 'query', 'result'],
    resume: ['directory', 'result'],
    inspect: ['directory', 'manifest-sha256', 'result'],
    copy: ['directory', 'manifest-sha256', 'out', 'result']
  }[command];
  for (let index = 0; index < args.length; index++) {
    const option = args[index], key = option?.replace(/^--/, '');
    check(option?.startsWith('--') && allowed.includes(key) && !Object.hasOwn(options, key) &&
      typeof args[index + 1] === 'string' && !args[index + 1].startsWith('--'),
      'BASEROW_CUSTOMER_OPTIONS_INVALID', HELP);
    options[key] = args[++index];
  }
  const required = {
    prepare: ['publisher', 'run', 'candidate-sha256', 'snapshot', 'customer-key', 'request-id', 'out'],
    resume: ['directory'], inspect: ['directory'], copy: ['directory', 'manifest-sha256', 'out']
  }[command];
  check(required.every(key => options[key]), 'BASEROW_CUSTOMER_SELECTION_REQUIRED', HELP);
  for (const name of ['publisher', 'directory', 'out', 'result'])
    if (options[name]) options[name] = resolve(options[name]);
  return { command, options };
}
function selectedRequest(options) {
  return { schema: 'stellar-forge.baserow-customer-request.v1',
    requestId: options['request-id'], customerKey: options['customer-key'],
    publisherDirectory: options.publisher, runId: options.run,
    expectedCandidateDigest: options['candidate-sha256'], expectedSnapshot: options.snapshot,
    query: options.query ?? '' };
}
export function customerSummary(value) {
  return { schema: 'stellar-forge.baserow-customer-result.v1', state: 'COMPLETED',
    directory: value.directory, manifestFile: value.manifestFile,
    manifestSha256: value.manifestSha256, bytes: value.bytes,
    manifest: value.manifest, source: value.source, attachments: value.attachments };
}
export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv.length === 1 && ['--help', '-h'].includes(argv[0])) {
    process.stdout.write(HELP); return;
  }
  if (argv[0]?.startsWith('client-')) return (await import('./export.mjs')).main(argv);
  const { command, options } = parse(argv);
  const controller = new AbortController(), stop = () => controller.abort();
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  let publisher;
  try {
    let result;
    const signal = controller.signal;
    if (command === 'prepare') {
      const original = selectedRequest(options);
      if (await exists(join(options.out, BASEROW_CUSTOMER_MANIFEST))) {
        same(await readJson(join(options.out, 'operation.json'), 65536), original,
          'BASEROW_CUSTOMER_ORIGINAL_REQUEST_CHANGED');
        result = await readBaserowCustomer(options.out, { signal });
      } else {
        publisher = await openBaserowPublisher({ directory: options.publisher });
        result = await prepareBaserowCustomer({ publisher, directory: options.out,
          runId: original.runId, expectedCandidateDigest: original.expectedCandidateDigest,
          expectedSnapshot: original.expectedSnapshot, customerKey: original.customerKey,
          query: original.query, requestId: original.requestId, signal });
      }
    } else if (command === 'resume') {
      result = await resumeBaserowCustomer(options.directory, { signal });
    } else if (command === 'inspect') {
      result = await readBaserowCustomer(options.directory, {
        expectedManifestSha256: options['manifest-sha256'], signal });
    } else {
      result = await copyBaserowCustomer(options.directory, options.out, {
        expectedManifestSha256: options['manifest-sha256'], signal });
    }
    const complete = customerSummary(result);
    if (options.result) {
      await privateDirectory(dirname(options.result));
      await once(options.result, bytes(complete));
    }
    process.stdout.write(JSON.stringify(complete, null, 2) + '\n');
    return complete;
  } finally {
    await publisher?.close();
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(issue => {
    process.stderr.write(JSON.stringify({ error: issue.code ?? 'BASEROW_CUSTOMER_COMMAND_FAILED',
      ...(issue.code ? { message: issue.message } : {}) }) + '\n');
    process.exitCode = 1;
  });
