#!/usr/bin/env node
// MIT. Installed operation commands delegate to the original Finage receiving program.
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FinageReceivingError, inspectFinageReceivingInstallation, prepareFinageReceivingOperation,
  inspectFinageReceivingOperation, runFinageReceivingOperation,
} from './installed.mjs';

const HELP = `Finage customer receiving

  starforge finage-receive info [--source-commit FULL_SHA]
  starforge finage-receive prepare --first ORIGINAL_EXPORT --second ORIGINAL_EXPORT
    --output NEW_OPERATION_DIRECTORY --actor NAME --operation-id STABLE_ID
    [--config CONFIG_JSON] [--first-sha SHA256] [--second-sha SHA256]
    [--first-label LABEL] [--second-label LABEL] [--filter-json ORIGINAL_FILTER]
    [--python EXECUTABLE] [--source-commit FULL_SHA]
    [--playwright-module EXISTING_MODULE --chromium EXISTING_EXECUTABLE
     --browser-node EXISTING_NODE]
  starforge finage-receive run --config CONFIG_JSON
  starforge finage-receive resume --config CONFIG_JSON
  starforge finage-receive inspect --config CONFIG_JSON

prepare writes one private, create-only configuration from the two original
manifest identities and this installation's exact source. An identical repeat
reuses it. The original receiving program owns the warehouse, all decisions,
query/export, backup and interruption recovery.

run and resume stream that original program's actual stage/command output and
return its exit status. The complete reading stage uses your existing Chromium
and Playwright runtime. Individual warehouse operations need only Python 3.11+:
  starforge finage-warehouse --help

Use the same configuration, output and selected source installation to resume.
The self-contained customer backup uses its bundled receiver.py --profile finage.
`;

function fail(message) { throw new FinageReceivingError('ARGUMENTS', message); }
function parse(args) {
  if (!Array.isArray(args) || !args.every(value => typeof value === 'string')) fail('Use string command arguments.');
  if (!args.length || args.includes('--help') || args[0] === 'help') return { action: 'help', options: {} };
  const [action, ...rest] = args;
  const allowed = {
    info: ['source-commit'],
    prepare: ['first', 'second', 'output', 'actor', 'operation-id', 'config', 'first-sha', 'second-sha',
      'first-label', 'second-label', 'filter-json', 'python', 'source-commit',
      'playwright-module', 'chromium', 'browser-node'],
    run: ['config'], resume: ['config'], inspect: ['config'],
  };
  if (!allowed[action]) fail('Unknown receiving action: ' + action);
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index];
    if (!name.startsWith('--') || !allowed[action].includes(name.slice(2))) fail('Unknown option: ' + name);
    const key = name.slice(2), value = rest[index + 1];
    if (value === undefined || Object.hasOwn(options, key)) fail('Provide each option exactly once with its value: ' + name);
    options[key] = value;
  }
  return { action, options };
}
function required(options, key) {
  if (!options[key]?.trim()) fail('Missing --' + key);
  return options[key];
}
export async function main(args = process.argv.slice(2)) {
  const { action, options } = parse(args);
  if (action === 'help') return { help: HELP };
  if (action === 'info') return inspectFinageReceivingInstallation({ sourceCommit: options['source-commit'] });
  if (action === 'inspect') return inspectFinageReceivingOperation({ configFile: required(options, 'config') });
  if (action === 'run' || action === 'resume') {
    return { nativeRun: true, ...await runFinageReceivingOperation({
      configFile: required(options, 'config'), resume: action === 'resume',
    }) };
  }
  let filter;
  if (options['filter-json'] !== undefined) {
    try { filter = JSON.parse(options['filter-json']); }
    catch { fail('--filter-json must be the original complete query object.'); }
  }
  let browser;
  if (options['playwright-module'] || options.chromium || options['browser-node']) {
    browser = {
      node: options['browser-node'] ?? process.execPath,
      playwright_module: required(options, 'playwright-module'),
      chromium_executable: required(options, 'chromium'),
    };
  }
  return prepareFinageReceivingOperation({
    operationId: required(options, 'operation-id'), actor: required(options, 'actor'),
    output: required(options, 'output'), configFile: options.config,
    sourceCommit: options['source-commit'], python: options.python,
    deliveries: [
      { directory: required(options, 'first'), manifest_sha256: options['first-sha'], label: options['first-label'] },
      { directory: required(options, 'second'), manifest_sha256: options['second-sha'], label: options['second-label'] },
    ],
    filter, browser,
  });
}
if (process.argv[1] && await realpath(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  main().then(result => {
    if (result.nativeRun) process.exitCode = result.code;
    else if (result.help) process.stdout.write(result.help);
    else process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  }).catch(error => {
    process.stderr.write(JSON.stringify({ error: {
      code: error.code ?? error.name, message: error.message, details: error.details ?? {},
    } }) + '\n');
    process.exitCode = 1;
  });
}
