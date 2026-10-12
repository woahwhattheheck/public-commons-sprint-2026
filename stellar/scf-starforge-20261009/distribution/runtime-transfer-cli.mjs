#!/usr/bin/env node
// MIT. Terminal workflow over the original runtime dependency transfer.
import { regular } from './runtime-workspace/storage.mjs';
import { MAX_MANIFEST_BYTES } from './runtime-transfer-lock.mjs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { reviewRuntimeTransfer, exportRuntimeTransfer, inspectRuntimeTransfer, beginRuntimeTransferReceive,
  receiveRuntimeTransferPart, completeRuntimeTransferReceive, installReceivedRuntime } from './runtime-transfer.mjs';

const HELP = 'Original runtime offline transfer\n\n' +
  '  runtime-transfer review --runtime READY_DIRECTORY\n' +
  '  runtime-transfer export --runtime READY_DIRECTORY --directory NEW_TRANSFER --cache NPM_CACHE\n' +
  '      [--expect-lock SHA256] [--online] [--part-bytes BYTES] [--npm EXECUTABLE]\n' +
  '  runtime-transfer inspect --directory TRANSFER_DIRECTORY [--verify]\n' +
  '  runtime-transfer receive --directory NEW_RECEIVER --manifest MANIFEST_JSON --sha256 SHA256\n' +
  '      [--parts PART_DIRECTORY] [--npm EXECUTABLE]\n' +
  '  runtime-transfer receive-part --directory RECEIVER --index NUMBER --file PART_FILE\n' +
  '  runtime-transfer complete --directory RECEIVER [--files-only] [--npm EXECUTABLE]\n' +
  '  runtime-transfer install --directory RECEIVER --runtime NEW_RUNTIME [--prepare-only]\n' +
  '      [--node-headers PREFIX] [--python EXECUTABLE] [--npm EXECUTABLE]\n' +
  '  runtime-transfer recover --directory RECEIVER --from RETAINED_RUNTIME --runtime NEW_RUNTIME\n' +
  '      [--prepare-only] [--node-headers PREFIX] [--python EXECUTABLE] [--npm EXECUTABLE]\n\n' +
  'Export reopens its own partial directory and retains the reviewed original source/profile/lock.\n' +
  'Export uses the selected populated npm cache offline; --online explicitly permits missing public tarballs.\n' +
  'Copy manifest.json and its declared part files. The receiver requires the exact manifest SHA256.\n' +
  'Receive with --parts imports available parts, completes intact cohorts, and populates its private cache.\n' +
  'The original installer owns native preparation and readiness. Native build inputs stay host-selected.\n';
const FIELDS = {
  review: ['--runtime'],
  export: ['--runtime', '--directory', '--cache', '--expect-lock', '--online', '--part-bytes', '--npm'],
  inspect: ['--directory', '--verify'],
  receive: ['--directory', '--manifest', '--sha256', '--parts', '--npm'],
  'receive-part': ['--directory', '--index', '--file'],
  complete: ['--directory', '--files-only', '--npm'],
  install: ['--directory', '--runtime', '--prepare-only', '--node-headers', '--python', '--npm'],
  recover: ['--directory', '--runtime', '--from', '--prepare-only', '--node-headers', '--python', '--npm'],
};
const BOOLEANS = new Set(['--online', '--verify', '--files-only', '--prepare-only']);
function bad(message) { throw Object.assign(new Error(message), { code: 'RUNTIME_TRANSFER_ARGUMENTS_INVALID' }); }
function parse(argv) {
  const [command, ...args] = argv;
  if (!FIELDS[command]) bad('Unknown transfer command');
  const values = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!FIELDS[command].includes(key) || Object.hasOwn(values, key)) bad('Unknown or duplicate argument: ' + key);
    if (BOOLEANS.has(key)) values[key] = true;
    else {
      if (!args[index + 1] || args[index + 1].startsWith('--')) bad('Missing value: ' + key);
      values[key] = args[++index];
    }
  }
  return { command, values };
}
function required(values, key) { if (!values[key]) bad('Required argument: ' + key); return values[key]; }
function integer(value, key) { if (!/^(?:0|[1-9][0-9]*)$/.test(value ?? '') || !Number.isSafeInteger(Number(value))) bad('Invalid number: ' + key); return Number(value); }
export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv[0] === '--help' || argv[0] === 'help') return { help: HELP };
  const { command, values } = parse(argv);
  const npm = values['--npm'] ?? 'npm';
  if (command === 'review') return reviewRuntimeTransfer({ runtimeDirectory: resolve(required(values, '--runtime')) });
  const directory = resolve(required(values, '--directory'));
  if (command === 'export') return exportRuntimeTransfer({
    runtimeDirectory: resolve(required(values, '--runtime')), directory,
    cache: resolve(required(values, '--cache')), npm, offline: !values['--online'],
    ...(values['--expect-lock'] ? { expectedLockSha256: values['--expect-lock'] } : {}),
    ...(values['--part-bytes'] ? { partBytes: integer(values['--part-bytes'], '--part-bytes') } : {}),
  });
  if (command === 'inspect') return inspectRuntimeTransfer({ directory, verify: !!values['--verify'] });
  if (command === 'receive') {
    const manifestFile = resolve(required(values, '--manifest'));
    const manifest = await regular(manifestFile, MAX_MANIFEST_BYTES), manifestSha256 = required(values, '--sha256');
    let received = await beginRuntimeTransferReceive({ directory, manifest, manifestSha256 });
    if (values['--parts']) {
      const parts = resolve(values['--parts']);
      for (const index of received.missingParts) {
        const part = received.manifest.parts[index];
        try { await receiveRuntimeTransferPart({ directory, index, file: join(parts, part.name) }); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      received = await inspectRuntimeTransfer({ directory, verify: true });
      if (received.complete) return completeRuntimeTransferReceive({ directory, npm });
    }
    return received;
  }
  if (command === 'receive-part') return receiveRuntimeTransferPart({
    directory, index: integer(required(values, '--index'), '--index'), file: resolve(required(values, '--file')),
  });
  if (command === 'complete') return completeRuntimeTransferReceive({ directory, npm, populateCache: !values['--files-only'] });
  return installReceivedRuntime({
    directory, runtimeDirectory: resolve(required(values, '--runtime')), npm,
    python: values['--python'] ?? 'python3', nodeHeaders: values['--node-headers'] ? resolve(values['--node-headers']) : null,
    install: !values['--prepare-only'],
    recoverFrom: command === 'recover' ? resolve(required(values, '--from')) : null,
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(result => process.stdout.write(result?.help ?? JSON.stringify(result, null, 2) + '\n')).catch(error => {
    process.stderr.write(JSON.stringify({ error: error.code ?? 'RUNTIME_TRANSFER_FAILED', message: error.message }) + '\n');
    process.exitCode = 1;
  });
}
