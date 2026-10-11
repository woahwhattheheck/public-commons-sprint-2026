#!/usr/bin/env node
// MIT. Redis source inspection, prepared customers and the original seller.
import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeRedisFile, openRedisSourceFile } from './config.mjs';
import { prepareRedisSeller, verifyPreparedRedisSeller } from './prepare.mjs';
import { startRedisSeller, createRedisNativeFactory } from './merchant.mjs';

const HELP = `Redis / Valkey merchant (Node 22.16+)
  init       --directory NEW_DIRECTORY [--transport redis|upstash-rest]
  describe   --source source.json
  inspect    --source source.json
  preflight  --source source.json
  query      --source source.json --query NAME --input input.json [--output NEW_FILE]
  prepare    --source source.json --plan merchant-plan.json --directory NEW_DIRECTORY
  verify     --directory PREPARED_DIRECTORY
  start      --directory PREPARED_DIRECTORY [--port 8423] [--operations-port 8424]
             [--facilitator HTTPS_URL] [--allow-local-facilitator] [--no-operations]
             [--max-in-flight 64] [--drain-grace-ms 60000] [--availability-dir DIRECTORY]
  run        Alias for start.
  serve      --source source.json --config service.json [same launch options]
Credentials come from the source's passwordEnv or tokenEnv. init/describe/inspect/prepare/verify are offline.
Seller documentation and operations use the original developer portal and local operator interface.`;

async function readInput(filename) {
  const handle = await open(resolve(filename), 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > 1048576) throw new TypeError('REDIS_INPUT_FILE_INVALID');
    const bytes = Buffer.alloc(before.size + 1); let total = 0;
    while (total < bytes.length) {
      const { bytesRead } = await handle.read(bytes, total, bytes.length - total, null);
      if (!bytesRead) break;
      total += bytesRead;
    }
    const after = await handle.stat();
    if (total !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs)
      throw new TypeError('REDIS_INPUT_FILE_CHANGED');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, total)));
  } finally { await handle.close(); }
}
async function writeNew(filename, bytes) {
  const file = await open(resolve(filename), 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
}
const encode = value => JSON.stringify(value, null, 2) + '\n';
const print = value => process.stdout.write(JSON.stringify(value) + '\n');

export async function initRedisWorkspace(directory, { transport = 'redis' } = {}) {
  if (!['redis', 'upstash-rest'].includes(transport)) throw new TypeError('REDIS_TRANSPORT_INVALID');
  const template = transport === 'upstash-rest' ? 'example-upstash-source.json' : 'example-source.json';
  const target = resolve(directory); await mkdir(target, { mode: 0o700 });
  try {
    for (const [input, output] of [[template, 'source.json'], ['example-merchant-plan.json', 'merchant-plan.json']])
      await writeNew(resolve(target, output), await readFile(new URL('./' + input, import.meta.url)));
    await writeNew(resolve(target, 'input.json'), encode({}));
    if (process.platform !== 'win32') {
      const dir = await open(target, 'r'); try { await dir.sync(); } finally { await dir.close(); }
    }
    return { directory: target, source: resolve(target, 'source.json'), plan: resolve(target, 'merchant-plan.json'),
      input: resolve(target, 'input.json') };
  } catch (issue) { await rm(target, { recursive: true, force: true }); throw issue; }
}

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.includes('--help')) { process.stdout.write(HELP + '\n'); return; }
  const command = args[0], options = new Map();
  const switches = ['--allow-local-facilitator', '--no-operations'];
  const launch = ['--port', '--operations-port', '--facilitator', '--allow-local-facilitator', '--no-operations',
    '--max-in-flight', '--drain-grace-ms', '--availability-dir'];
  for (let index = 1; index < args.length; index++) {
    const flag = args[index];
    if (options.has(flag)) throw new TypeError('REDIS_DUPLICATE_OPTION');
    if (switches.includes(flag)) { options.set(flag, true); continue; }
    if (!['--directory', '--transport', '--source', '--config', '--plan', '--query', '--input', '--output', ...launch].includes(flag) ||
        !args[index + 1] || args[index + 1].startsWith('--')) throw new TypeError(HELP);
    options.set(flag, args[++index]);
  }
  const allowed = { init: ['--directory', '--transport'], describe: ['--source'], inspect: ['--source'], preflight: ['--source'],
    query: ['--source', '--query', '--input', '--output'], prepare: ['--source', '--plan', '--directory'], verify: ['--directory'],
    start: ['--directory', ...launch], run: ['--directory', ...launch], serve: ['--source', '--config', ...launch] };
  if (!Object.hasOwn(allowed, command)) throw new TypeError(HELP);
  if ([...options.keys()].some(flag => !allowed[command].includes(flag))) throw new TypeError('REDIS_OPTION_NOT_VALID_FOR_COMMAND');
  const required = (...keys) => {
    for (const key of keys) if (!options.has(key)) throw new TypeError('Missing ' + key);
  };
  const integer = (flag, fallback) => {
    const value = options.get(flag) ?? String(fallback);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new TypeError('REDIS_INTEGER_OPTION_INVALID:' + flag);
    return Number(value);
  };
  const sourceFile = options.has('--source') ? resolve(options.get('--source')) : undefined;
  let result;
  if (command === 'init') {
    required('--directory'); result = await initRedisWorkspace(options.get('--directory'), { transport: options.get('--transport') });
  } else if (command === 'describe' || command === 'inspect') {
    required('--source'); result = await describeRedisFile(sourceFile);
  } else if (command === 'prepare') {
    required('--source', '--plan', '--directory');
    result = await prepareRedisSeller({ sourceFile, planFile: options.get('--plan'), directory: options.get('--directory') });
  } else if (command === 'verify') {
    required('--directory'); result = await verifyPreparedRedisSeller(options.get('--directory'));
  } else if (command === 'preflight' || command === 'query') {
    required('--source'); if (command === 'query') required('--query', '--input');
    const input = command === 'query' ? await readInput(options.get('--input')) : undefined;
    const { source } = await openRedisSourceFile(sourceFile);
    try {
      result = command === 'query' ? await source.query(options.get('--query'), input) :
        { source: await source.inspect(), status: await source.status() };
    } finally { await source.close(); }
    if (options.has('--output')) {
      await writeNew(options.get('--output'), encode(result));
      result = { output: resolve(options.get('--output')), rowCount: result.rowCount,
        truncated: result.truncated, ...(result.nextInput ? { nextInput: result.nextInput } : {}) };
    }
  } else {
    let database = sourceFile, configFile = options.get('--config');
    if (command === 'start' || command === 'run') {
      required('--directory'); const prepared = await verifyPreparedRedisSeller(options.get('--directory'));
      database = resolve(prepared.directory, 'source.json'); configFile = resolve(prepared.directory, 'service.json');
    } else required('--source', '--config');
    if (options.has('--no-operations') && options.has('--operations-port') ||
        options.has('--allow-local-facilitator') && !options.has('--facilitator'))
      throw new TypeError('REDIS_LAUNCH_OPTIONS_CONFLICT');
    const port = integer('--port', 8423), operationsPort = options.has('--no-operations') ? null : integer('--operations-port', 8424);
    const maxInFlight = integer('--max-in-flight', 64), drainGraceMs = integer('--drain-grace-ms', 60000);
    if (port > 65535 || operationsPort > 65535 || maxInFlight < 1 || maxInFlight > 1024 || drainGraceMs < 1000 || drainGraceMs > 300000)
      throw new RangeError('REDIS_LAUNCH_LIMIT_INVALID');
    const nativeFactory = await createRedisNativeFactory({ facilitator: options.get('--facilitator'),
      allowLocalFacilitator: options.has('--allow-local-facilitator') });
    const session = await startRedisSeller({ sourceFile: database, configFile, port, operationsPort,
      maxInFlight, drainGraceMs, nativeFactory,
      ...(options.has('--availability-dir') ? { availabilityDirectory: resolve(options.get('--availability-dir')) } : {}) });
    const stop = () => { void session.close().then(() => { process.exitCode = 0; }, () => { process.exitCode = 1; }); };
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
    const originalClose = session.close.bind(session);
    session.close = async () => {
      try { return await originalClose(); }
      finally { for (const signal of ['SIGINT', 'SIGTERM']) process.removeListener(signal, stop); }
    };
    print({ url: session.url, mode: session.mode, docs: session.url + '/_seller/docs',
      openapi: session.url + '/_seller/openapi.json', dataSource: 'Redis / Valkey named read products',
      ...(session.operations ? { operations: session.operations.url, availability: session.operations.availabilityUrl,
        availabilityControl: session.operations.availabilityControlUrl } : {}) });
    return session;
  }
  print(result); return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(issue => {
  process.stderr.write(JSON.stringify({ error: issue.code ?? issue.message ?? 'REDIS_OPERATION_FAILED',
    ...(issue.query ? { query: issue.query } : {}) }) + '\n'); process.exitCode = 1;
});
