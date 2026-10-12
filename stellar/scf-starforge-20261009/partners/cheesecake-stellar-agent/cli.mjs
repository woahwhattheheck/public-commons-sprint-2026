#!/usr/bin/env node
// MIT. The original buyer owns native approval, signing, the attempt and recovery.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadApplication, loadConfiguration, inspectHandoff } from './configuration.mjs';

const commands = new Set(['list','verify-source','review','execute','status','recover','read','export']);
const fail = code => Object.assign(new Error(code), { code });
function parse(args) {
  const [command, ...tail] = args;
  if (!command || command === '--help') return { help: true };
  if (!commands.has(command) || tail.length % 2) throw fail('APPLICATION_CLI_COMMAND_INVALID');
  const options = {};
  const allowed = command === 'read' ? ['config','intent','format','limit-bytes'] :
    command === 'export' ? ['config','intent','out'] :
    command === 'list' || command === 'verify-source' ? ['config'] : ['config','intent'];
  for (let i = 0; i < tail.length; i += 2) {
    const key = tail[i].slice(2);
    if (!tail[i].startsWith('--') || !allowed.includes(key) || Object.hasOwn(options, key) ||
      !tail[i + 1] || tail[i + 1].startsWith('--')) throw fail('APPLICATION_CLI_OPTIONS_INVALID');
    options[key] = tail[i + 1];
  }
  if (!options.config || (!['list','verify-source'].includes(command) && !options.intent) ||
    (command === 'export' && !options.out)) throw fail('APPLICATION_CLI_REQUIRED_OPTION');
  return { command, options };
}
export async function main(args = process.argv.slice(2)) {
  const input = parse(args);
  if (input.help) {
    process.stdout.write(
      'Usage: node cli.mjs list|verify-source --config /private/application.json\n' +
      '       node cli.mjs review|execute|status|recover --config FILE --intent ORIGINAL_INTENT\n' +
      '       node cli.mjs read --config FILE --intent ORIGINAL_INTENT [--format json|text|base64|file] [--limit-bytes N]\n' +
      '       node cli.mjs export --config FILE --intent ORIGINAL_INTENT --out NEW_ABSOLUTE_FILE\n' +
      '\nUse one configuration and original intent through review, execution and recovery.\n' +
      'Execute enters the original native operator and its existing approval/signing configuration.\n');
    return;
  }
  const { command, options: o } = input;
  if (command === 'verify-source') {
    const c = await loadConfiguration(o.config), source = await inspectHandoff(c.handoffDirectory);
    const output = { handoffId: source.manifest.handoffId, manifestSha256: source.manifestSha256,
      fileCount: source.manifest.files.length, totalBytes: source.manifest.totalBytes,
      requests: [...source.requests.values()].map(x => x.view) };
    process.stdout.write(JSON.stringify(output, null, 2) + '\n'); return output;
  }
  const loaded = await loadApplication(o.config), controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  try {
    const result = command === 'list' ? await loaded.application.requests(loaded.context) :
      await loaded.application.call(loaded.context, command, o.intent, {
        signal: controller.signal,
        ...(o.format ? { format: o.format } : {}),
        ...(o['limit-bytes'] ? { limitBytes: Number(o['limit-bytes']) } : {}),
        ...(o.out ? { destination: resolve(o.out) } : {}),
      });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  } finally {
    process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
    await loaded.close();
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => {
  const code = error.code ?? 'APPLICATION_COMMAND_FAILED';
  process.stderr.write(JSON.stringify({ error: /^[A-Z][A-Z0-9_]{1,100}$/.test(code) ? code : 'APPLICATION_COMMAND_FAILED' }) + '\n');
  process.exitCode = 1;
});

