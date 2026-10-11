#!/usr/bin/env node
// MIT. Launch the maintained private conversion operator with one original root.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startConversionWorkspace } from './server.mjs';

const HELP = `Conversion operator workspace — Node.js 22+

node revenue/erp-conversion-assurance/scap-workspace/cli.mjs \
  --directory PRIVATE_SERVICE_DIRECTORY [--port 8470] [--profile PROFILE.json] [--extension EXTENSION.mjs]

Optional first-creation service limits:
  --max-input-bytes NUMBER   --max-report-bytes NUMBER
  --timeout-ms NUMBER        --max-heap-mib NUMBER

Open the private URL printed at startup. The same directory reopens the original
bundles, jobs, exact reports and reviewer decisions. Existing workers continue
when this browser host closes. The default profile covers the SCAP conversion
workflow; --profile accepts another qualified implementation profile as JSON.
--extension imports a trusted local profile module for its retained metadata and
same-host UI. It uses the original service and access controls.
Linux flock and tar are required.\n`;
const OPTIONS = new Map([['--directory', 'directory'], ['--port', 'port'], ['--profile', 'profilePath'], ['--extension', 'extensionPath'],
  ['--max-input-bytes', 'maxInputBytes'], ['--max-report-bytes', 'maxReportBytes'],
  ['--timeout-ms', 'timeoutMs'], ['--max-heap-mib', 'maxHeapMiB']]);

export async function main(args = process.argv.slice(2), { write = text => process.stdout.write(text) } = {}) {
  if (args.length === 1 && args[0] === '--help') { write(HELP); return null; }
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = OPTIONS.get(args[i]), value = args[i + 1];
    if (!key || !value || value.startsWith('--') || Object.hasOwn(options, key)) throw new Error(`Invalid or repeated option: ${args[i] ?? ''}`);
    if (['directory', 'profilePath', 'extensionPath'].includes(key)) options[key] = resolve(value);
    else {
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error(`Invalid integer: ${args[i]}`);
      options[key] = Number(value);
    }
  }
  if (!options.directory) throw new Error('Provide --directory PRIVATE_SERVICE_DIRECTORY.');
  if (options.profilePath) {
    const bytes = await readFile(options.profilePath);
    if (bytes.length > 256 * 1024) throw new Error('The profile exceeds 256 KiB.');
    options.profile = JSON.parse(bytes.toString('utf8')); delete options.profilePath;
  }
  if (options.extensionPath) {
    options.extension = (await import(pathToFileURL(options.extensionPath).href)).default;
    if (!options.extension) throw new Error('The local extension must export its trusted configuration as default.');
    delete options.extensionPath;
  }
  const session = await startConversionWorkspace(options);
  const stop = () => session.close().catch(error => { process.stderr.write(`${error.code ?? 'WORKSPACE_CLOSE_FAILED'}\n`); process.exitCode = 1; });
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const close = async () => { process.off('SIGINT', stop); process.off('SIGTERM', stop); await session.close(); };
  write(JSON.stringify({ application: 'conversion-workspace', profile: session.model.profile.id,
    directory: options.directory, workspace: session.url, configuration: session.model.configuration }) + '\n');
  return { ...session, close };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main().catch(error => { process.stderr.write((error.code ?? error.message ?? 'WORKSPACE_FAILED') + '\n'); process.exitCode = 1; });
