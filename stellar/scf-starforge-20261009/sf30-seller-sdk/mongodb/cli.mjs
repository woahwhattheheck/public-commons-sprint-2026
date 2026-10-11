#!/usr/bin/env node
// MIT. One native MongoDB inspector, report authoring store, package and seller.
import { mkdir, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeMongoFile, openMongoSourceFile } from './config.mjs';
import { inspectMongoSourceFile } from './catalog.mjs';
import { prepareMongoSeller, verifyPreparedMongoSeller } from './prepare.mjs';
import { startMongoSeller, createMongoNativeFactory } from './merchant.mjs';
import { createMongoWorkspace, openMongoWorkspace, saveMongoWorkspacePlan, listMongoWorkspaceRevisions,
  previewMongoWorkspace, prepareMongoWorkspace } from './onboarding.mjs';
import { readJson, writeNew, encode, fail } from './common.mjs';

const HELP = `MongoDB merchant — Node 22.16+, official driver 7.7.0
  init --directory NEW_DIRECTORY
  describe --source SOURCE
  catalog --source SOURCE [--collection NAME] [--sample-size 200]
  preflight --source SOURCE
  query --source SOURCE --query NAME --input INPUT [--output NEW_FILE]
  prepare --source SOURCE --plan PLAN --directory NEW_PACKAGE
  verify --directory PACKAGE
  create --source SOURCE --plan PLAN --directory NEW_WORKSPACE
  inspect --directory WORKSPACE [--revision NUMBER]
  history --directory WORKSPACE [--before NUMBER] [--limit 20]
  save --directory WORKSPACE --plan PLAN --expected-revision NUMBER [--source SOURCE]
  preview --directory WORKSPACE --query NAME --input INPUT [--expected-revision NUMBER] [--output NEW_FILE]
  export --directory WORKSPACE --destination NEW_PACKAGE --expected-revision NUMBER
  run --directory PACKAGE [--port 8423] [--operations-port 8424]
      [--facilitator HTTPS_URL] [--allow-local-facilitator] [--no-operations] [--availability-dir PRIVATE_DIRECTORY]
  serve --source SOURCE --config SERVICE [same run options]
  workspace --state WORKSPACE [browser options]
The source names a URI environment variable; credentials remain in the launcher environment.`;

export async function initMongoWorkspace(directory) {
  const target = resolve(directory); await mkdir(target, { mode: 0o700 });
  try {
    for (const name of ['source.json', 'merchant-plan.json', 'input.json'])
      await writeNew(resolve(target, name), await readFile(new URL('./examples/' + name, import.meta.url)));
    return { directory: target, source: resolve(target, 'source.json'), plan: resolve(target, 'merchant-plan.json') };
  } catch (issue) { await rm(target, { recursive: true, force: true }); throw issue; }
}
export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.includes('--help')) { process.stdout.write(HELP + '\n'); return; }
  if (args[0] === 'workspace') return (await import('./workspace/server.mjs')).main(args.slice(1));
  const command = args[0], options = new Map();
  const flags = ['--directory', '--destination', '--source', '--config', '--plan', '--collection', '--sample-size', '--query', '--input',
    '--output', '--port', '--operations-port', '--facilitator', '--availability-dir', '--revision', '--expected-revision', '--before', '--limit'];
  for (let index = 1; index < args.length; index++) {
    const flag = args[index]; if (options.has(flag)) fail('MONGODB_DUPLICATE_OPTION');
    if (['--allow-local-facilitator', '--no-operations'].includes(flag)) { options.set(flag, true); continue; }
    if (!flags.includes(flag) || !args[index + 1] || args[index + 1].startsWith('--')) fail('MONGODB_OPTION_INVALID');
    options.set(flag, args[++index]);
  }
  const launch = ['--port', '--operations-port', '--facilitator', '--allow-local-facilitator', '--no-operations', '--availability-dir'];
  const allowed = { init: ['--directory'], describe: ['--source'], catalog: ['--source', '--collection', '--sample-size'],
    preflight: ['--source'], query: ['--source', '--query', '--input', '--output'], prepare: ['--source', '--plan', '--directory'],
    verify: ['--directory'], create: ['--directory', '--source', '--plan'], inspect: ['--directory', '--revision'],
    history: ['--directory', '--before', '--limit'], save: ['--directory', '--source', '--plan', '--expected-revision'],
    preview: ['--directory', '--query', '--input', '--expected-revision', '--output'], export: ['--directory', '--destination', '--expected-revision'],
    run: ['--directory', ...launch], serve: ['--source', '--config', ...launch] };
  if (!allowed[command] || [...options.keys()].some(flag => !allowed[command].includes(flag))) fail('MONGODB_OPTION_NOT_VALID_FOR_COMMAND');
  const required = (...names) => { for (const name of names) if (!options.has(name)) fail('MONGODB_REQUIRED_OPTION:' + name); };
  const get = name => options.get('--' + name), number = name => get(name) === undefined ? undefined : Number(get(name));
  let result;
  if (command === 'init') { required('--directory'); result = await initMongoWorkspace(get('directory')); }
  else if (command === 'describe') { required('--source'); result = await describeMongoFile(get('source')); }
  else if (command === 'catalog') {
    required('--source'); result = await inspectMongoSourceFile(get('source'), {
      ...(get('collection') ? { collections: [get('collection')] } : {}), ...(get('sample-size') ? { sampleSize: number('sample-size') } : {}) });
  } else if (command === 'prepare') {
    required('--source', '--plan', '--directory'); result = await prepareMongoSeller({ sourceFile: get('source'), planFile: get('plan'), directory: get('directory') });
  } else if (command === 'verify') { required('--directory'); result = await verifyPreparedMongoSeller(get('directory')); }
  else if (command === 'create') {
    required('--source', '--plan', '--directory'); result = await createMongoWorkspace({ sourceFile: get('source'), planFile: get('plan'), directory: get('directory') });
  } else if (command === 'inspect') { required('--directory'); result = await openMongoWorkspace(get('directory'), { revision: number('revision') }); }
  else if (command === 'history') {
    required('--directory'); result = await listMongoWorkspaceRevisions(get('directory'), { before: number('before'), ...(get('limit') ? { limit: number('limit') } : {}) });
  } else if (command === 'save') {
    required('--directory', '--plan', '--expected-revision'); result = await saveMongoWorkspacePlan({ directory: get('directory'), plan: await readJson(get('plan')),
      ...(get('source') ? { source: await readJson(get('source')) } : {}), expectedRevision: number('expected-revision') });
  } else if (command === 'export') {
    required('--directory', '--destination', '--expected-revision'); result = await prepareMongoWorkspace({ directory: get('directory'),
      destination: get('destination'), expectedRevision: number('expected-revision') });
  } else if (command === 'preview') {
    required('--directory', '--query', '--input'); result = await previewMongoWorkspace({ directory: get('directory'), query: get('query'),
      input: await readJson(get('input')), expectedRevision: number('expected-revision') });
  } else if (command === 'preflight' || command === 'query') {
    required('--source'); if (command === 'query') required('--query', '--input');
    const { source } = await openMongoSourceFile(get('source'));
    try { result = command === 'preflight' ? source.inspect() : await source.query(get('query'), await readJson(get('input'))); }
    finally { await source.close(); }
  } else {
    let sourceFile = get('source'), configFile = get('config');
    if (command === 'run') {
      required('--directory'); const prepared = await verifyPreparedMongoSeller(get('directory'));
      sourceFile = resolve(prepared.directory, 'source.json'); configFile = resolve(prepared.directory, 'service.json');
    } else required('--source', '--config');
    if (options.has('--no-operations') && options.has('--operations-port') || options.has('--allow-local-facilitator') && !get('facilitator'))
      fail('MONGODB_LAUNCH_OPTIONS_CONFLICT');
    const nativeFactory = await createMongoNativeFactory({ facilitator: get('facilitator'), allowLocalFacilitator: options.has('--allow-local-facilitator') });
    const session = await startMongoSeller({ sourceFile, configFile, port: number('port') ?? 8423,
      operationsPort: options.has('--no-operations') ? null : number('operations-port') ?? 8424, nativeFactory,
      ...(get('availability-dir') ? { availabilityDirectory: resolve(get('availability-dir')) } : {}) });
    result = { url: session.url, mode: session.mode, docs: session.url + '/_seller/docs', openapi: session.url + '/_seller/openapi.json',
      ...(session.operations ? { operations: session.operations.url } : {}), database: session.source.inspect() };
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { session.close().catch(() => { process.exitCode = 1; }); });
    process.stdout.write(JSON.stringify(result) + '\n'); return session;
  }
  if (get('output')) { await writeNew(resolve(get('output')), encode(result)); result = { output: resolve(get('output')), rowCount: result.rowCount }; }
  process.stdout.write(JSON.stringify(result) + '\n'); return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(issue => {
  const code = typeof issue.code === 'string' && /^[A-Z0-9_:-]{1,160}$/.test(issue.code) ? issue.code : 'MONGODB_OPERATION_FAILED';
  process.stderr.write(JSON.stringify({ error: code, ...(issue.query ? { query: issue.query } : {}) }) + '\n'); process.exitCode = 1;
});
