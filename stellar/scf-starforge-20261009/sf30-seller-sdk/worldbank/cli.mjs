#!/usr/bin/env node
// MIT. World Bank source capture, local workspace and original merchant continuation.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openWorldBankOperator, startWorldBankWorkspace, WORLDBANK_ACTIONS } from './native.mjs';

const HELP = [
  'World Bank dataset workspace',
  '',
  'Usage:',
  '  starforge worldbank workspace --directory DIR [--port 0] [--python python3]',
  '  starforge worldbank-workspace --directory DIR [--port 0] [--python python3]',
  '  starforge worldbank status --directory DIR',
  '  starforge worldbank action ACTION --directory DIR [--input FILE | --json JSON]',
  '  starforge worldbank status --url SESSION_URL',
  '  starforge worldbank action ACTION --url SESSION_URL [--input FILE | --json JSON]',
  '',
  'The same commands work as node cli.mjs ... from this directory.',
  '--input - reads one JSON object from standard input. An omitted payload is {}.',
  'Source commands use the existing Python 3 runtime and standard library.',
  'The browser starts captures asynchronously; this CLI waits for a directly started capture.',
  'Use --url with the printed local session URL to cancel its capture or stop its seller.',
  '',
  'Source: state, save-selection, catalog, capture, capture-cancel, capture-detail,',
  '        observations, compare, review, review-read, export, export-read,',
  '        import-pages, import-package.',
  'Merchant: merchant-prepare, publisher.status, publisher.preview, publisher.reviewDraft,',
  '          publisher.publish, publisher.activateSnapshot, publisher.collect.',
  'Release: publisher.release.stage, inspect, activate, rollback, start, stop.',
  'Buyer: publisher.buyer.review, prepare, session, run, recover, account, export.',
  '',
  'publisher.release.start keeps the original seller and its local workspace alive.',
  'See NATIVE.md for payloads, immutable exports and release/buyer continuation.'
].join('\n');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => Object.assign(new TypeError(message), { code: 'WORLDBANK_CLI' });

function parse(args) {
  if (!args.length || args.length === 1 && ['help', '--help', '-h'].includes(args[0])) return { help: true };
  const command = ['--directory', '--port', '--python'].includes(args[0]) ? 'workspace' : args.shift();
  if (!['workspace', 'status', 'action'].includes(command)) throw fail('Choose workspace, status or action; use --help.');
  const action = command === 'action' ? args.shift() : undefined;
  if (command === 'action' && !WORLDBANK_ACTIONS.includes(action)) throw fail('Choose a supported action; use --help.');
  const options = {};
  while (args.length) {
    const key = args.shift(), value = args.shift();
    if (!['--directory', '--port', '--input', '--json', '--python', '--url'].includes(key) ||
        Object.hasOwn(options, key) || value === undefined)
      throw fail('Invalid, repeated or missing option; use --help.');
    options[key] = value;
  }
  if (options['--url']) {
    if (command === 'workspace' || ['--directory', '--port', '--python'].some(key => Object.hasOwn(options, key)))
      throw fail('--url controls an existing workspace; choose status or action without local directory options.');
  } else if (!options['--directory']?.trim()) throw fail('--directory is required for a local operation.');
  if (command !== 'workspace' && Object.hasOwn(options, '--port')) throw fail('--port applies to workspace.');
  if (command !== 'action' && ['--input', '--json'].some(key => Object.hasOwn(options, key)))
    throw fail('--input and --json apply to action.');
  if (Object.hasOwn(options, '--input') && Object.hasOwn(options, '--json')) throw fail('Choose --input or --json.');
  const port = options['--port'] ?? '0';
  if (!/^(0|[1-9][0-9]{0,4})$/.test(port) || Number(port) > 65535) throw fail('Port must be between 0 and 65535.');
  return { command, action, directory: options['--directory'] ? resolve(options['--directory']) : undefined,
    port: Number(port), python: options['--python'], url: options['--url'], input: options['--input'], json: options['--json'] };
}
async function inputValue(options) {
  if (options.input === undefined && options.json === undefined) return {};
  const maximum = ['import-pages', 'import-package'].includes(options.action) ? 256 * 1024 * 1024 : 1024 * 1024;
  let bytes;
  if (options.input === '-') {
    const chunks = []; let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > maximum) throw fail('The input exceeds this action\'s capacity of ' + maximum + ' bytes.');
      chunks.push(chunk);
    }
    bytes = Buffer.concat(chunks);
  } else bytes = options.input === undefined ? Buffer.from(options.json) : await readFile(resolve(options.input));
  if (bytes.length > maximum) throw fail('The input exceeds this action\'s capacity of ' + maximum + ' bytes.');
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!object(value)) throw fail('The action payload must be a JSON object.');
  return value;
}
async function remote(options, payload) {
  let target;
  try { target = new URL(options.url); } catch { throw fail('Use the local session URL printed by the running workspace.'); }
  const token = target.hash.slice(1);
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.username || target.password ||
      target.pathname !== '/' || target.search || !/^[A-Za-z0-9_-]{43}$/.test(token))
    throw fail('Use the complete 127.0.0.1 workspace URL, including its session fragment.');
  const route = options.command === 'status' ? '/api/state' : '/api/action';
  const response = await fetch(target.origin + route, {
    method: options.command === 'status' ? 'GET' : 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    ...(options.command === 'status' ? {} : { body: JSON.stringify({ action: options.action, payload }) })
  });
  let result;
  try { result = await response.json(); } catch { throw fail('The local workspace returned an unreadable response.'); }
  if (!response.ok) throw Object.assign(new Error(result?.error?.message || 'The workspace action failed.'),
    { code: result?.error?.code || 'WORLDBANK_REMOTE', status: response.status,
      sourceDetails: object(result?.error) ? result.error : {} });
  console.log(JSON.stringify(result, null, 2));
  return result;
}
function onSignals(close) {
  let closing;
  const stop = () => closing ??= Promise.resolve().then(close);
  const handler = () => stop().catch(error => { console.error(error.message); process.exitCode = 1; });
  process.once('SIGINT', handler); process.once('SIGTERM', handler);
  return { stop, detach() { process.removeListener('SIGINT', handler); process.removeListener('SIGTERM', handler); } };
}

export async function main(args = process.argv.slice(2)) {
  const options = parse([...args]);
  if (options.help) { console.log(HELP); return; }
  const payload = await inputValue(options);
  if (options.url) return remote(options, payload);
  if (options.command === 'workspace') {
    const app = await startWorldBankWorkspace(options);
    console.log('World Bank workspace\n' + app.url + '\nStop with Ctrl+C.');
    onSignals(() => app.close());
    return app;
  }
  const operator = await openWorldBankOperator(options);
  let retain = false, signals = onSignals(() => operator.close());
  try {
    let result = options.command === 'status' ? await operator.state() : await operator.act(options.action, payload);
    if (options.action === 'capture') {
      const job = await operator.waitCapture(payload.id);
      let state = null, stateError;
      try { state = await operator.state(); } catch (error) { stateError = { code: error.code, message: error.message }; }
      result = { result: job, state, ...(stateError ? { stateError } : {}) };
      if (job.status !== 'COMPLETE') process.exitCode = 1;
    }
    if (options.action === 'publisher.release.start') {
      const app = await startWorldBankWorkspace({ directory: options.directory, operator });
      signals.detach();
      const shutdown = onSignals(async () => {
        let error;
        try { await app.close(); } catch (failure) { error = failure; }
        try { await operator.close(); } catch (failure) { error ??= failure; }
        if (error) throw error;
      });
      retain = true;
      console.log(JSON.stringify(result, null, 2));
      console.log('Original dataset seller running. Manage this session at:\n' + app.url + '\nStop with Ctrl+C.');
      return { result, url: app.url, close: shutdown.stop };
    }
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    if (!retain) { signals.detach(); await signals.stop(); }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => {
    console.error(JSON.stringify({ error: { ...(object(error.sourceDetails) ? error.sourceDetails : {}),
      code: error.code || 'WORLDBANK_CLI', message: error.message } }));
    process.exitCode = 1;
  });

