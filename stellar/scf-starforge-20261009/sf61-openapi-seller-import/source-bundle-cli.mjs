#!/usr/bin/env node
// MIT. Source preparation for the original openapi and openapi-workspace commands.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { saveSourceBundle, readSourceBundle, extractSourceBundle, writeSourceFile } from './source-bundle-files.mjs';

const help = `OpenAPI source bundles

  starforge openapi source create --root SOURCE_ROOT --entry openapi.yaml --out NEW_PACKET.json
  starforge openapi source inspect --bundle PACKET.json
  starforge openapi source extract --bundle PACKET.json --out NEW_DIRECTORY
  starforge openapi source document --bundle PACKET.json --out NEW_OPENAPI.json

Use PACKET.json directly with the existing openapi --spec option or upload it
in the existing API merchant workspace. It retains every original referenced
JSON/YAML file. inspect rebuilds the source graph from those exact saved bytes.

create follows local structural references inside SOURCE_ROOT. Examples remain
data. Outputs are private and create-only; repeating identical completed output
returns its existing identity. extract preserves edited destinations.
`;

export async function runSourceBundleCLI(args = process.argv.slice(2)) {
  if (!args.length || ['--help', '-h', 'help'].includes(args[0])) { process.stdout.write(help); return null; }
  const [command, ...tail] = args;
  const allowed = { create: ['--root', '--entry', '--out'], inspect: ['--bundle'],
    extract: ['--bundle', '--out'], document: ['--bundle', '--out'] }[command];
  if (!allowed) throw new Error('Choose create, inspect, extract or document.\n' + help);
  const options = {};
  for (let i = 0; i < tail.length; i += 2) {
    if (!allowed.includes(tail[i]) || !tail[i + 1] || tail[i + 1].startsWith('--') || Object.hasOwn(options, tail[i]))
      throw new Error('Invalid or repeated source-bundle option.\n' + help);
    options[tail[i]] = tail[i + 1];
  }
  if (!allowed.every(key => Object.hasOwn(options, key))) throw new Error('Supply ' + allowed.join(', '));
  let result;
  if (command === 'create') result = saveSourceBundle({ root: options['--root'], entry: options['--entry'], out: options['--out'] });
  else if (command === 'extract') result = extractSourceBundle({ bundle: options['--bundle'], out: options['--out'] });
  else {
    const opened = readSourceBundle(options['--bundle']);
    result = command === 'inspect' ? opened.summary : {
      ...writeSourceFile(options['--out'], opened.documentText), sourceDigest: opened.bundle.sourceDigest };
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  runSourceBundleCLI().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
