// MIT. Complete Baserow/Rails customer source around the original Ruby export.
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { exportNativeRubyClient, completeNativeRubyClient, inspectNativeRubyClient,
  NATIVE_RUBY_CLIENT_MANIFEST } from '../../developer/ruby-client/export.mjs';
import { bytes, digest, identity, privateDirectory, readPrivate, readJson, hashPrivate,
  acquireWorkspace, rootDirectory, once, exists, check, fault, copyExact, HASH } from './files.mjs';

export const BASEROW_RUBY_CLIENT_SCHEMA = 'stellar-forge.baserow-ruby-client.v1';
export const BASEROW_RUBY_CLIENT_MANIFEST = 'baserow-ruby-client.json';
export const BASEROW_RUBY_CLIENT_FILES = Object.freeze([
  'baserow/customer/baserow_customer.rb',
  'baserow/customer/baserow_customer_receiving.rb',
  'baserow/customer/customer.rb',
  'baserow/customer/lifecycle.rb',
  'baserow/customer/README.md'
]);
const ORIGINAL_NATIVE_DIRECTORY = 'developer/ruby-client';
const ORIGINAL_NATIVE_SELECTION = 'native-client-source.json';
const SELECTION = 'client-source.json';
const SOURCE_SCHEMA = 'stellar-forge.baserow-ruby-source.v1';
const MAX_FILE = 8388608;
const sourceRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const descendant = (root, path) => path === root || path.startsWith(root + '/');
const record = (name, raw) => ({ name, bytes: raw.length, sha256: digest(raw) });

async function sourceFile(name) {
  const path = join(sourceRoot, name);
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const before = await handle.stat({ bigint: true });
    check(before.isFile() && before.size >= 1n && before.size <= BigInt(MAX_FILE) &&
      await realpath(path) === path, 'BASEROW_RUBY_SOURCE_FILE_INVALID');
    const raw = await handle.readFile(), after = await handle.stat({ bigint: true });
    check(raw.length === Number(before.size) && ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key =>
      before[key] === after[key]), 'BASEROW_RUBY_SOURCE_CHANGED');
    return raw;
  } finally { await handle.close(); }
}
function checkCustomerFiles(files) {
  check(Array.isArray(files) && files.length === BASEROW_RUBY_CLIENT_FILES.length &&
    files.every((file, index) => file && file.name === BASEROW_RUBY_CLIENT_FILES[index] &&
      Number.isSafeInteger(file.bytes) && file.bytes > 0 && file.bytes <= MAX_FILE &&
      HASH.test(file.sha256 ?? '')), 'BASEROW_RUBY_SOURCE_MANIFEST_INVALID');
}
function checkFile(file, allowed) {
  check(file && allowed.has(file.name) && Number.isSafeInteger(file.bytes) &&
    file.bytes > 0 && file.bytes <= MAX_FILE && HASH.test(file.sha256 ?? ''),
    'BASEROW_RUBY_SOURCE_MANIFEST_INVALID');
}
async function packetFile(directory, file) {
  await privateDirectory(dirname(join(directory, file.name)));
  const raw = await readPrivate(join(directory, file.name), MAX_FILE);
  check(raw.length === file.bytes && digest(raw) === file.sha256, 'BASEROW_RUBY_SOURCE_FILE_CHANGED');
  return raw;
}
async function originalFiles(directory, native) {
  const names = [...native.manifest.files.map(file => file.name), ORIGINAL_NATIVE_SELECTION, NATIVE_RUBY_CLIENT_MANIFEST];
  const result = [];
  for (const name of names) {
    const full = ORIGINAL_NATIVE_DIRECTORY + '/' + name;
    const current = await hashPrivate(join(directory, full), MAX_FILE);
    result.push({ name: full, bytes: current.bytes, sha256: current.hash });
  }
  return result;
}
export async function inspectBaserowRubyClient({ directory, expectedManifestSha256 } = {}) {
  directory = resolve(directory ?? '');
  await rootDirectory(directory);
  if (!await exists(join(directory, BASEROW_RUBY_CLIENT_MANIFEST)))
    return { schema: BASEROW_RUBY_CLIENT_SCHEMA, state: 'INCOMPLETE', directory };
  const raw = await readPrivate(join(directory, BASEROW_RUBY_CLIENT_MANIFEST), MAX_FILE);
  const manifestSha256 = digest(raw);
  if (expectedManifestSha256 !== undefined)
    check(HASH.test(expectedManifestSha256) && expectedManifestSha256 === manifestSha256,
      'BASEROW_RUBY_CLIENT_MANIFEST_CHANGED');
  let manifest;
  try { manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
  catch { throw fault('BASEROW_RUBY_SOURCE_MANIFEST_INVALID'); }
  check(manifest?.schema === BASEROW_RUBY_CLIENT_SCHEMA &&
    manifest.native?.directory === ORIGINAL_NATIVE_DIRECTORY &&
    manifest.native?.manifest === NATIVE_RUBY_CLIENT_MANIFEST &&
    HASH.test(manifest.native?.manifestSha256 ?? '') &&
    manifest.selection?.name === SELECTION && Array.isArray(manifest.files),
    'BASEROW_RUBY_SOURCE_MANIFEST_INVALID');
  checkCustomerFiles(manifest.customerFiles);
  const native = await inspectNativeRubyClient({ directory: join(directory, ORIGINAL_NATIVE_DIRECTORY) });
  check(native.state === 'COMPLETE' && native.manifestSha256 === manifest.native.manifestSha256,
    'BASEROW_RUBY_ORIGINAL_NATIVE_CLIENT_CHANGED');
  const required = new Set([SELECTION, ...BASEROW_RUBY_CLIENT_FILES,
    ...native.manifest.files.map(file => ORIGINAL_NATIVE_DIRECTORY + '/' + file.name),
    ORIGINAL_NATIVE_DIRECTORY + '/' + ORIGINAL_NATIVE_SELECTION,
    ORIGINAL_NATIVE_DIRECTORY + '/' + NATIVE_RUBY_CLIENT_MANIFEST]);
  check(manifest.files.length === required.size, 'BASEROW_RUBY_COMPLETE_SOURCE_REQUIRED');
  let count = 0;
  for (const file of manifest.files) {
    checkFile(file, required); required.delete(file.name);
    await packetFile(directory, file); count += file.bytes;
  }
  check(required.size === 0 && count <= 67108864, 'BASEROW_RUBY_COMPLETE_SOURCE_REQUIRED');
  for (const file of manifest.customerFiles)
    check(identity(manifest.files.find(item => item.name === file.name)) === identity(file),
      'BASEROW_RUBY_CUSTOMER_SOURCE_CHANGED');
  const selected = manifest.files.find(file => file.name === SELECTION);
  check(identity(selected) === identity(manifest.selection), 'BASEROW_RUBY_SOURCE_SELECTION_CHANGED');
  const selection = JSON.parse((await packetFile(directory, selected)).toString('utf8'));
  check(selection?.schema === SOURCE_SCHEMA && identity(selection.files) === identity(manifest.customerFiles),
    'BASEROW_RUBY_SOURCE_SELECTION_CHANGED');
  const nativeSelected = manifest.files.find(file => file.name === ORIGINAL_NATIVE_DIRECTORY + '/' + ORIGINAL_NATIVE_SELECTION);
  const nativeCompleted = manifest.files.find(file => file.name === ORIGINAL_NATIVE_DIRECTORY + '/' + NATIVE_RUBY_CLIENT_MANIFEST);
  check(nativeSelected.sha256 === native.manifestSha256 && nativeCompleted.sha256 === native.manifestSha256,
    'BASEROW_RUBY_ORIGINAL_NATIVE_SOURCE_CHANGED');
  check(digest(await readPrivate(join(directory, BASEROW_RUBY_CLIENT_MANIFEST), MAX_FILE)) === manifestSha256,
    'BASEROW_RUBY_CLIENT_MANIFEST_CHANGED');
  return { schema: BASEROW_RUBY_CLIENT_SCHEMA, state: 'COMPLETE', directory,
    manifestFile: join(directory, BASEROW_RUBY_CLIENT_MANIFEST), manifestSha256, manifest,
    bytes: count, entry: join(directory, 'baserow/customer/customer.rb'),
    lifecycle: join(directory, 'baserow/customer/lifecycle.rb'),
    nativeManifestSha256: native.manifestSha256 };
}
export async function exportBaserowRubyClient({ out } = {}) {
  check(typeof out === 'string' && out, 'BASEROW_RUBY_OUTPUT_REQUIRED');
  const directory = resolve(out);
  check(!descendant(sourceRoot, directory) && !descendant(directory, sourceRoot),
    'BASEROW_RUBY_SEPARATE_OUTPUT_REQUIRED');
  await rootDirectory(directory, true);
  const release = await acquireWorkspace(directory);
  try {
    if (await exists(join(directory, BASEROW_RUBY_CLIENT_MANIFEST)))
      return inspectBaserowRubyClient({ directory });
    const payloads = new Map();
    for (const name of BASEROW_RUBY_CLIENT_FILES) payloads.set(name, await sourceFile(name));
    const customerFiles = [...payloads].map(([name, raw]) => record(name, raw));
    const selection = bytes({ schema: SOURCE_SCHEMA, files: customerFiles });
    await once(join(directory, SELECTION), selection);
    for (const [name, raw] of payloads) {
      await privateDirectory(dirname(join(directory, name)), true);
      await once(join(directory, name), raw);
    }
    await privateDirectory(join(directory, 'developer'), true);
    const nativeDirectory = join(directory, ORIGINAL_NATIVE_DIRECTORY);
    const native = await exists(nativeDirectory) ?
      await completeNativeRubyClient({ directory: nativeDirectory }) :
      await exportNativeRubyClient({ out: nativeDirectory });
    check(native.state === 'COMPLETE', 'BASEROW_RUBY_ORIGINAL_NATIVE_COMPLETION_REQUIRED');
    const files = [record(SELECTION, selection), ...customerFiles, ...await originalFiles(directory, native)];
    const manifest = { schema: BASEROW_RUBY_CLIENT_SCHEMA,
      native: { directory: ORIGINAL_NATIVE_DIRECTORY, manifest: NATIVE_RUBY_CLIENT_MANIFEST,
        manifestSha256: native.manifestSha256 }, selection: files[0], customerFiles, files };
    await once(join(directory, BASEROW_RUBY_CLIENT_MANIFEST), bytes(manifest));
    return inspectBaserowRubyClient({ directory });
  } finally { await release(); }
}
export async function completeBaserowRubyClient({ directory } = {}) {
  const current = await inspectBaserowRubyClient({ directory });
  if (current.state === 'COMPLETE') return current;
  await readJson(join(current.directory, SELECTION), MAX_FILE);
  return exportBaserowRubyClient({ out: current.directory });
}
export async function copyBaserowRubyClient({ directory, out, expectedManifestSha256 } = {}) {
  check(typeof directory === 'string' && typeof out === 'string' && HASH.test(expectedManifestSha256 ?? ''),
    'BASEROW_RUBY_COPY_SELECTION_REQUIRED');
  directory = resolve(directory); out = resolve(out);
  check(!descendant(directory, out) && !descendant(out, directory), 'BASEROW_RUBY_SEPARATE_OUTPUT_REQUIRED');
  const current = await inspectBaserowRubyClient({ directory, expectedManifestSha256 });
  check(current.state === 'COMPLETE', 'BASEROW_RUBY_COMPLETE_SOURCE_REQUIRED');
  await rootDirectory(out, true);
  const release = await acquireWorkspace(out);
  try {
    await once(join(out, 'client-copy.json'), bytes({
      schema: 'stellar-forge.baserow-ruby-client-copy.v1', manifestSha256: expectedManifestSha256 }));
    for (const file of current.manifest.files) {
      await privateDirectory(dirname(join(out, file.name)), true);
      await copyExact(join(directory, file.name), join(out, file.name), file);
    }
    const raw = await readPrivate(join(directory, BASEROW_RUBY_CLIENT_MANIFEST), MAX_FILE);
    check(digest(raw) === expectedManifestSha256, 'BASEROW_RUBY_CLIENT_MANIFEST_CHANGED');
    await once(join(out, BASEROW_RUBY_CLIENT_MANIFEST), raw);
    return inspectBaserowRubyClient({ directory: out, expectedManifestSha256 });
  } finally { await release(); }
}
const HELP = 'Complete Baserow/Rails customer source\n\n' +
  '  client-export --out DIRECTORY\n' +
  '  client-resume --directory ORIGINAL_OUTPUT\n' +
  '  client-inspect --directory COMPLETE_CLIENT [--manifest-sha256 SHA]\n' +
  '  client-copy --directory COMPLETE_CLIENT --manifest-sha256 SHA --out DIRECTORY\n\n' +
  'The packet retains the original native Ruby package and Baserow adapter in\n' +
  'their working relative directories. Supply an installed original checkout\n' +
  'for the initial SF100 receiver; completed deliveries reopen in Ruby alone.\n';
export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv.includes('--help')) { process.stdout.write(HELP); return; }
  const [command, ...rest] = argv, options = {};
  const allowed = command === 'client-export' ? ['out'] :
    command === 'client-resume' ? ['directory'] :
    command === 'client-inspect' ? ['directory', 'manifest-sha256'] :
    command === 'client-copy' ? ['directory', 'manifest-sha256', 'out'] : [];
  check(allowed.length && rest.length % 2 === 0, 'BASEROW_RUBY_COMMAND_INVALID', HELP);
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index].replace(/^--/, '');
    check(rest[index].startsWith('--') && allowed.includes(key) && !Object.hasOwn(options, key) &&
      rest[index + 1] && !rest[index + 1].startsWith('--'), 'BASEROW_RUBY_OPTIONS_INVALID', HELP);
    options[key] = rest[index + 1];
  }
  check((command === 'client-export' ? ['out'] : command === 'client-copy' ?
    ['directory', 'manifest-sha256', 'out'] : ['directory']).every(key => options[key]),
    'BASEROW_RUBY_SELECTION_REQUIRED', HELP);
  const result = await ({
    'client-export': exportBaserowRubyClient, 'client-resume': completeBaserowRubyClient,
    'client-inspect': inspectBaserowRubyClient, 'client-copy': copyBaserowRubyClient
  }[command])({ directory: options.directory, out: options.out, expectedManifestSha256: options['manifest-sha256'] });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(issue => { process.stderr.write(JSON.stringify({ error: issue.code ?? 'BASEROW_RUBY_EXPORT_FAILED' }) + '\n'); process.exitCode = 1; });
