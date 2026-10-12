#!/usr/bin/env node
// MIT. Complete customer control and verified receiving for the original Huwise / Opendatasoft workbench.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { opendatasoftActions, openOpendatasoftClient, downloadOpendatasoftExport,
  inspectOpendatasoftExport, reopenOpendatasoftExport } from './opendatasoft-client.mjs';

const HELP = [
  'Starforge Huwise / Opendatasoft MCP customer',
  '',
  '  opendatasoft tools',
  '  opendatasoft call --url MCP_URL --action ACTION --arguments PRIVATE_JSON [--token-env NAME] [--output NEW_JSON]',
  '  opendatasoft inspect --url MCP_URL --export EXPORT_ID [--token-env NAME] [--output NEW_JSON]',
  '  opendatasoft download --url MCP_URL --export EXPORT_ID --directory PRIVATE_DIRECTORY [--manifest-sha256 SHA] [--token-env NAME] [--chunk-size BYTES] [--output NEW_JSON]',
  '  opendatasoft reopen --export EXPORT_ID --directory PRIVATE_DIRECTORY [--manifest-sha256 SHA] [--output NEW_JSON]',
  '',
  'tools prints every exact native action schema. call accepts its short action or full tool name.',
  'Open a host-declared original Huwise workspace and keep the returned instance and operation IDs.',
  'After an interrupted reply, inspect the same native operation before continuing.',
  'Edition exports require the actual capture SHA256 and notes revision, plus a stable export ID.',
  'The same original workbench owns capture, field selection, review, publication and buyer preparation.',
  'download continues the same verified partial bytes. reopen verifies the complete local manifest',
  'and original files under the existing download lease, including when both listeners are closed.',
  ''
].join('\n');
function fail(message) { throw Object.assign(new Error(message), { code: 'OPENDATASOFT_CLI' }); }
function options(args, allowed, required = []) {
  const out = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index], value = args[index + 1];
    if (!allowed.includes(name) || typeof value !== 'string' || !value || Object.hasOwn(out, name))
      fail('Use each declared option once with its value.');
    out[name] = value;
  }
  if (required.some(name => !Object.hasOwn(out, name))) fail('Supply every required option shown in help.');
  return out;
}
async function argumentsFile(path) {
  const handle = await open(resolve(path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 4_194_304 || process.platform !== 'win32' && info.mode & 0o077)
      fail('Use a private regular UTF-8 argument file no larger than 4 MiB.');
    const data = await handle.readFile();
    if (data.length > 4_194_304) fail('The retained argument file exceeded its size limit.');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
  } finally { await handle.close(); }
}
async function output(result, path) {
  const data = Buffer.from(JSON.stringify(result, null, 2) + '\n');
  if (path) {
    const handle = await open(resolve(path), 'wx', 0o600);
    try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
    process.stdout.write(JSON.stringify({ saved: resolve(path), bytes: data.length }) + '\n');
  } else process.stdout.write(data);
  return result;
}
export async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  if (!command || command === 'help' || command === '--help') { process.stdout.write(HELP); return; }
  if (command === 'tools') {
    if (rest.length) fail('tools accepts no options.');
    return output(opendatasoftActions);
  }
  const shared = ['--output'], remote = ['--url','--token-env'];
  let args, result;
  if (command === 'call') {
    args = options(rest, [...shared,...remote,'--action','--arguments'], ['--url','--action','--arguments']);
    const original = await openOpendatasoftClient({ url: args['--url'], tokenEnv: args['--token-env'] });
    result = await original.call(args['--action'], await argumentsFile(args['--arguments']));
  } else if (command === 'inspect') {
    args = options(rest, [...shared,...remote,'--export'], ['--url','--export']);
    result = await inspectOpendatasoftExport({ url: args['--url'], tokenEnv: args['--token-env'], exportId: args['--export'] });
  } else if (command === 'download') {
    args = options(rest, [...shared,...remote,'--export','--directory','--manifest-sha256','--chunk-size'], ['--url','--export','--directory']);
    if (args['--chunk-size'] !== undefined && !/^[1-9][0-9]*$/.test(args['--chunk-size'])) fail('Use a positive integer chunk size.');
    result = await downloadOpendatasoftExport({ url: args['--url'], tokenEnv: args['--token-env'],
      exportId: args['--export'], directory: args['--directory'], expectedManifestSha256: args['--manifest-sha256'],
      ...(args['--chunk-size'] === undefined ? {} : { chunkSize: Number(args['--chunk-size']) }) });
  } else if (command === 'reopen') {
    args = options(rest, [...shared,'--export','--directory','--manifest-sha256'], ['--export','--directory']);
    result = await reopenOpendatasoftExport({ directory: args['--directory'], exportId: args['--export'],
      expectedManifestSha256: args['--manifest-sha256'] });
  } else fail('Choose tools, call, inspect, download or reopen.');
  return output(result, args['--output']);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { process.stderr.write((error.code ?? 'OPENDATASOFT_CLI') + ': ' + error.message + '\n'); process.exitCode = 2; });
