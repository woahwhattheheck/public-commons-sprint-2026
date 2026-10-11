#!/usr/bin/env node
// MIT. Routescan operator lifecycle through the original merchant runtime.
import { readFile, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readRoutescanMerchant, merchantReview, json, fail } from './config.mjs';
import { openProject } from './project.mjs';
import { startRoutescanMerchant, routescanNativeFactory } from './merchant.mjs';

export const HELP = `Routescan gas data merchant
  inspect --config MERCHANT.json
  init --project PRIVATE_DIRECTORY --config MERCHANT.json
  save --project PRIVATE_DIRECTORY --config MERCHANT.json --revision N
  status --project PRIVATE_DIRECTORY
  preview --project PRIVATE_DIRECTORY --product ID --input REQUEST.json --revision N [--id STABLE_ID]
  result --project PRIVATE_DIRECTORY --id STABLE_ID [--out NEW_FILE]
  export --project PRIVATE_DIRECTORY --revision N [--id STABLE_ID]
  serve --config MERCHANT.json [--quota-directory PRIVATE_DIRECTORY]
    [--port 8423] [--operations-port 8424] [--facilitator HTTPS_URL] [--allow-local-facilitator]
    [--availability-directory PRIVATE_DIRECTORY] [--history-directory PRIVATE_DIRECTORY]
    [--max-in-flight 64] [--drain-grace-ms 60000]

Run with node routescan/cli.mjs COMMAND. Preview makes one provider read and
retains its exact bytes. result reopens that record. All services sharing the
same Routescan account use the same quota directory. See routescan/README.md.`;

function parse(args) {
  const command = args[0], allowed = {
    inspect: ['--config'], init: ['--project', '--config'], save: ['--project', '--config', '--revision'],
    status: ['--project'], preview: ['--project', '--product', '--input', '--revision', '--id'],
    result: ['--project', '--id', '--out'], export: ['--project', '--revision', '--id'],
    serve: ['--config', '--quota-directory', '--port', '--operations-port', '--facilitator', '--allow-local-facilitator',
      '--availability-directory', '--history-directory', '--max-in-flight', '--drain-grace-ms'],
  };
  if (!allowed[command]) fail(HELP);
  const options = {};
  for (let i = 1; i < args.length; i++) {
    const key = args[i];
    if (!allowed[command].includes(key) || Object.hasOwn(options, key)) fail('Unknown or repeated option: ' + key);
    if (key === '--allow-local-facilitator') options[key] = true;
    else { const value = args[++i]; if (value === undefined || value.startsWith('--')) fail('Missing value: ' + key); options[key] = value; }
  }
  const required = { inspect: ['--config'], init: ['--project', '--config'], save: ['--project', '--config', '--revision'],
    status: ['--project'], preview: ['--project', '--product', '--input', '--revision'], result: ['--project', '--id'],
    export: ['--project', '--revision'], serve: ['--config'] };
  if (required[command].some(key => !options[key])) fail(HELP);
  for (const name of ['--revision', '--port', '--operations-port', '--max-in-flight', '--drain-grace-ms']) {
    if (options[name] !== undefined) {
      if (!/^\d+$/.test(options[name]) || !Number.isSafeInteger(Number(options[name]))) fail('Use an integer for ' + name + '.');
      options[name] = Number(options[name]);
    }
  }
  return { command, options };
}
async function inputFile(file) {
  const bytes = await readFile(resolve(file));
  if (bytes.length > 1048576) fail('Input JSON exceeds 1 MiB.');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
const print = value => process.stdout.write(json(value));
const withoutBody = ({ bodyBase64, ...value }) => value;
export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && ['--help', 'help'].includes(args[0])) { process.stdout.write(HELP + '\n'); return null; }
  const { command, options: o } = parse(args);
  if (command === 'inspect') { const review = merchantReview(await readRoutescanMerchant(o['--config'])); print(review); return review; }
  if (command === 'serve') {
    const compiled = await readRoutescanMerchant(o['--config']);
    const nativeFactory = await routescanNativeFactory(o['--facilitator'], { allowLocalFacilitator: o['--allow-local-facilitator'] });
    const session = await startRoutescanMerchant(compiled, { nativeFactory,
      quotaDirectory: o['--quota-directory'] ? resolve(o['--quota-directory']) : undefined,
      port: o['--port'] ?? 8423, operationsPort: o['--operations-port'] ?? 8424,
      availabilityDirectory: o['--availability-directory'] ? resolve(o['--availability-directory']) : undefined,
      historyDirectory: o['--history-directory'] ? resolve(o['--history-directory']) : undefined,
      maxInFlight: o['--max-in-flight'] ?? 64, drainGraceMs: o['--drain-grace-ms'] ?? 60000 });
    print(await session.snapshot());
    let stopping = false;
    const stop = async () => {
      if (stopping) return; stopping = true;
      process.off('SIGINT', stop); process.off('SIGTERM', stop);
      try { print({ state: 'CLOSED', ...await session.close() }); }
      catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
    };
    process.on('SIGINT', stop); process.on('SIGTERM', stop); return session;
  }
  const project = await openProject(resolve(o['--project']));
  try {
    let result;
    if (command === 'init' || command === 'save') result = await project.save({ input: await inputFile(o['--config']), expectedRevision: o['--revision'] ?? 0 });
    if (command === 'status') result = { directory: project.root, quotaDirectory: project.quotaDirectory,
      project: await project.read(), history: await project.history(), previews: await project.listPreviews(), exports: await project.listExports() };
    if (command === 'preview') {
      const id = o['--id'] ?? randomUUID(); print({ operation: id });
      result = withoutBody(await project.preview({ id, product: o['--product'], request: await inputFile(o['--input']), expectedRevision: o['--revision'] }));
    }
    if (command === 'result') {
      const saved = await project.readPreview(o['--id']); result = withoutBody(saved);
      if (o['--out']) {
        if (saved.state === 'STARTED') fail('This source operation has no completed result.');
        const output = await open(resolve(o['--out']), 'wx', 0o600);
        try { await output.writeFile(Buffer.from(saved.bodyBase64, 'base64')); await output.sync(); }
        finally { await output.close(); }
        result.outputPath = resolve(o['--out']);
      }
    }
    if (command === 'export') result = await project.export({ expectedRevision: o['--revision'], id: o['--id'] ?? randomUUID() });
    print(result); return result;
  } finally { await project.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { process.stderr.write((error.code ?? 'ROUTESCAN_ERROR') + ': ' + error.message + '\n'); process.exitCode = 1; });
