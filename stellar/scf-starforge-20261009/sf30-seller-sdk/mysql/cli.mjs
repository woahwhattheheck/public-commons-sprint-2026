#!/usr/bin/env node
// MIT. Full source→review→prepared package→original seller operator workflow.
import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeMysqlFile, openMysqlSourceFile } from './config.mjs';
import { inspectMysqlCatalog } from './catalog.mjs';
import { prepareMysqlSeller, verifyPreparedMysqlSeller } from './prepare.mjs';
import { startMysqlSeller, createMysqlNativeFactory } from './merchant.mjs';

const HELP = `MySQL/MariaDB merchant (Node 22.16+)
  init     --directory NEW_DIRECTORY
  describe --source source.json
  catalog  --source source.json [--table NAME]
  preflight --source source.json
  query    --source source.json --query NAME --input input.json [--output NEW_FILE]
  prepare  --source source.json --plan merchant-plan.json --directory NEW_DIRECTORY
  verify   --directory PREPARED_DIRECTORY
  workspace --source source.json --state PRIVATE_DIRECTORY [--port 8439]
           [--seller-port 0] [--operations-port 0] [--facilitator HTTPS_URL]
  run      --directory PREPARED_DIRECTORY [--port 8423] [--operations-port 8424]
           [--facilitator HTTPS_URL] [--allow-local-facilitator] [--no-operations] [--availability-dir PRIVATE_DIRECTORY]
  serve    --source source.json --config service.json [same run options]
Private database credentials come from the source's passwordEnv. init/describe/prepare/verify are offline.`;

async function readInput(path) {
  const handle = await open(resolve(path), 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 1048576) throw new TypeError('MYSQL_INPUT_FILE_INVALID');
    const bytes = await handle.readFile();
    if (bytes.length > 1048576) throw new TypeError('MYSQL_INPUT_FILE_TOO_LARGE');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { await handle.close(); }
}
async function writeNew(path, value) {
  const file = await open(resolve(path), 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2) + '\n'); await file.sync(); }
  finally { await file.close(); }
}

export async function initMysqlWorkspace(directory) {
  const target = resolve(directory); await mkdir(target, { mode: 0o700 });
  try {
    for (const name of ['source.json', 'merchant-plan.json', 'input.json', 'seed.sql']) {
      const bytes = await readFile(new URL('./examples/' + name, import.meta.url));
      const file = await open(resolve(target, name), 'wx', 0o600);
      try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    }
    return { directory: target, source: resolve(target, 'source.json'), plan: resolve(target, 'merchant-plan.json') };
  } catch (issue) { await rm(target, { recursive: true, force: true }); throw issue; }
}

export async function main(args = process.argv.slice(2)) {
  if (args[0] === 'workspace') return (await import('./workspace/server.mjs')).main(args.slice(1));
  if (!args.length || args.includes('--help')) { process.stdout.write(HELP + '\n'); return; }
  const command = args[0], options = new Map();
  for (let i = 1; i < args.length; i++) {
    const flag = args[i];
    if (options.has(flag)) throw new TypeError('MYSQL_DUPLICATE_OPTION');
    if (['--allow-local-facilitator', '--no-operations'].includes(flag)) { options.set(flag, true); continue; }
    if (!['--directory', '--source', '--config', '--plan', '--table', '--query', '--input', '--output',
      '--port', '--operations-port', '--facilitator', '--availability-dir'].includes(flag) || !args[i + 1] || args[i + 1].startsWith('--'))
      throw new TypeError(HELP);
    options.set(flag, args[++i]);
  }
  const required = (...keys) => { for (const key of keys) if (!options.has(key)) throw new TypeError('Missing ' + key); };
  const launch = ['--port', '--operations-port', '--facilitator', '--allow-local-facilitator', '--no-operations', '--availability-dir'];
  const allowed = { init: ['--directory'], describe: ['--source'], catalog: ['--source', '--table'],
    preflight: ['--source'], query: ['--source', '--query', '--input', '--output'],
    prepare: ['--source', '--plan', '--directory'], verify: ['--directory'],
    run: ['--directory', ...launch], serve: ['--source', '--config', ...launch] };
  if (!Object.hasOwn(allowed, command)) throw new TypeError(HELP);
  if ([...options.keys()].some(flag => !allowed[command].includes(flag))) throw new TypeError('MYSQL_OPTION_NOT_VALID_FOR_COMMAND');
  const sourceFile = options.has('--source') ? resolve(options.get('--source')) : undefined;
  let result;
  if (command === 'init') { required('--directory'); result = await initMysqlWorkspace(options.get('--directory')); }
  else if (command === 'describe') { required('--source'); result = await describeMysqlFile(sourceFile); }
  else if (command === 'catalog') { required('--source'); result = await inspectMysqlCatalog(sourceFile, { table: options.get('--table') }); }
  else if (command === 'prepare') {
    required('--source', '--plan', '--directory');
    result = await prepareMysqlSeller({ sourceFile, planFile: options.get('--plan'), directory: options.get('--directory') });
  } else if (command === 'verify') { required('--directory'); result = await verifyPreparedMysqlSeller(options.get('--directory')); }
  else if (command === 'preflight' || command === 'query') {
    required('--source'); if (command === 'query') required('--query', '--input');
    const { source } = await openMysqlSourceFile(sourceFile);
    try { result = command === 'preflight' ? source.inspect() : await source.query(options.get('--query'), await readInput(options.get('--input'))); }
    finally { await source.close(); }
    if (options.has('--output')) { await writeNew(options.get('--output'), result); result = { output: resolve(options.get('--output')), rowCount: result.rowCount }; }
  } else if (['run', 'serve'].includes(command)) {
    let database = sourceFile, configFile = options.get('--config');
    if (command === 'run') {
      required('--directory'); const prepared = await verifyPreparedMysqlSeller(options.get('--directory'));
      database = resolve(prepared.directory, 'source.json'); configFile = resolve(prepared.directory, 'service.json');
    } else required('--source', '--config');
    if (options.has('--no-operations') && options.has('--operations-port') || options.has('--allow-local-facilitator') && !options.has('--facilitator'))
      throw new TypeError('MYSQL_LAUNCH_OPTIONS_CONFLICT');
    const nativeFactory = await createMysqlNativeFactory({ facilitator: options.get('--facilitator'),
      allowLocalFacilitator: options.has('--allow-local-facilitator') });
    const session = await startMysqlSeller({ sourceFile: database, configFile,
      port: Number(options.get('--port') ?? 8423), operationsPort: options.has('--no-operations') ? null : Number(options.get('--operations-port') ?? 8424), nativeFactory,
      ...(options.has('--availability-dir') ? { availabilityDirectory: resolve(options.get('--availability-dir')) } : {}) });
    result = { url: session.url, mode: session.mode, docs: session.url + '/_seller/docs',
      openapi: session.url + '/_seller/openapi.json', ...(session.operations ? { operations: session.operations.url,
        availability: session.operations.availabilityUrl, availabilityControl: session.operations.availabilityControlUrl } : {}),
      dataSource: 'MySQL/MariaDB approved named queries', database: session.source.inspect().serverVersion };
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
      session.close().then(() => { process.exitCode = 0; }, () => { process.exitCode = 1; });
    });
    process.stdout.write(JSON.stringify(result) + '\n'); return session;
  } else throw new TypeError(HELP);
  process.stdout.write(JSON.stringify(result) + '\n'); return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(issue => {
  process.stderr.write(JSON.stringify({ error: issue.code ?? issue.message ?? 'MYSQL_OPERATION_FAILED',
    ...(issue.query ? { query: issue.query } : {}), ...(issue.sqlState ? { sqlState: issue.sqlState } : {}) }) + '\n'); process.exitCode = 1;
});
