#!/usr/bin/env node
// MIT. Thin operator CLI over the original Socrata workspace.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openSocrataWorkspace} from './workspace.mjs';
import {startSocrataWorkspace} from './server.mjs';

const HELP = [
  'Socrata dataset workspace',
  '',
  'Usage:',
  '  node cli.mjs workspace --directory DIR [--port 0] [--app-token-env NAME]',
  '  node cli.mjs status --directory DIR [--app-token-env NAME]',
  '  node cli.mjs action ACTION --directory DIR [--input FILE | --json JSON]',
  '                      [--app-token-env NAME]',
  '',
  'Actions:',
  '  source.configure  source.inspect  source.search',
  '  capture.start     capture.advance capture.pause  capture.resume  capture.import',
  '  mapping.save      edition.build   edition.activate  dataset.query',
  '  merchant.configure  package.export  package.import',
  '',
  'Payloads are JSON objects. --input reads one UTF-8 JSON file; --json reads a literal.',
  'An omitted payload is {}. capture.advance fetches one page unless pages is supplied.',
  'The local browser can pause between pages and resume the same retained capture.',
  'SOCRATA_APP_TOKEN is the default optional provider credential environment variable.',
  'Only the browser session URL carries its private local session token.',
  'See README.md for the complete source-to-merchant and package recovery workflow.'
].join('\n');

function parse(args) {
  if (!args.length || (args.length === 1 && ['--help', '-h', 'help'].includes(args[0]))) return {help: true};
  const command = args.shift();
  if (!['workspace', 'status', 'action'].includes(command)) throw new TypeError('Choose workspace, status or action; use --help.');
  const action = command === 'action' ? args.shift() : undefined;
  if (command === 'action' && (!action || action.startsWith('--'))) throw new TypeError('An action name is required.');
  const values = {};
  while (args.length) {
    const key = args.shift(), value = args.shift();
    if (!['--directory', '--port', '--input', '--json', '--app-token-env'].includes(key) ||
        Object.hasOwn(values, key) || value === undefined || value.startsWith('--'))
      throw new TypeError('Invalid or repeated option; use --help.');
    values[key] = value;
  }
  if (!values['--directory']?.trim()) throw new TypeError('--directory is required.');
  if (command !== 'workspace' && Object.hasOwn(values, '--port')) throw new TypeError('--port applies only to workspace.');
  if (command !== 'action' && (Object.hasOwn(values, '--input') || Object.hasOwn(values, '--json')))
    throw new TypeError('--input and --json apply only to action.');
  if (Object.hasOwn(values, '--input') && Object.hasOwn(values, '--json')) throw new TypeError('Choose --input or --json.');
  const portValue = values['--port'];
  if (portValue !== undefined && (!/^(0|[1-9][0-9]{0,4})$/.test(portValue) || Number(portValue) > 65535))
    throw new TypeError('Port must be between 0 and 65535.');
  const tokenEnvironment = values['--app-token-env'] || 'SOCRATA_APP_TOKEN';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tokenEnvironment)) throw new TypeError('Invalid credential environment variable name.');
  if (Object.hasOwn(values, '--app-token-env') && !process.env[tokenEnvironment])
    throw new TypeError('The selected credential environment variable is empty.');
  return {command, action, directory: resolve(values['--directory']),
    port: portValue === undefined ? 0 : Number(portValue),
    appToken: process.env[tokenEnvironment], input: values['--input'], json: values['--json']};
}

export async function main(args = process.argv.slice(2)) {
  const options = parse([...args]);
  if (options.help) { console.log(HELP); return; }
  const {directory, appToken} = options;
  if (options.command === 'workspace') {
    const app = await startSocrataWorkspace({directory, appToken, port: options.port});
    console.log('Socrata workspace\n' + app.url + '\nKeep this session URL private. Stop with Ctrl+C.');
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      app.close().catch(error => { console.error('Socrata workspace: ' + error.message); process.exitCode = 1; });
    };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    return app;
  }
  let payload = {};
  if (options.command === 'action' && (options.input !== undefined || options.json !== undefined)) {
    const text = options.input === undefined ? options.json :
      new TextDecoder('utf-8', {fatal: true}).decode(await readFile(resolve(options.input)));
    payload = JSON.parse(text);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('The action payload must be a JSON object.');
  }
  const workspace = await openSocrataWorkspace({directory, appToken});
  let result, originalError;
  try {
    result = options.command === 'status' ? await workspace.state() : await workspace.act(options.action, payload);
  } catch (error) { originalError = error; }
  try { await workspace.close(); } catch (error) { if (!originalError) originalError = error; }
  if (originalError) throw originalError;
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error('Socrata workspace: ' + error.message); process.exitCode = 1; });
