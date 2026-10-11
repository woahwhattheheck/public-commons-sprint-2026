#!/usr/bin/env node
// MIT. One customer installation workflow for the original merchant distribution.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareRuntimeInstall, installRuntime, inspectRuntimeInstall, upgradeRuntime,
  recoverRuntime, compareRuntimeInstalls, launchRuntime } from './runtime-install.mjs';

const HELP = `Starforge customer runtime installation (Linux, Node 22.16+, Python 3.11+, npm, flock)

runtime-install prepare --dir NEW_DIRECTORY --archive ORIGINAL.tgz --sha256 HASH
  [--native] [--feature NAME ...] [--operator] [--pins EXACT_PINS.json]
runtime-install install --dir DIRECTORY [--offline] [--cache CACHE_DIRECTORY]
runtime-install resume --dir DIRECTORY [--offline] [--cache CACHE_DIRECTORY]
runtime-install inspect --dir DIRECTORY [--load] [--source]
runtime-install run --dir DIRECTORY -- ORIGINAL_STARFORGE_COMMAND [ARGUMENTS...]
runtime-install upgrade --from PREVIOUS_DIRECTORY --dir NEW_DIRECTORY
  --archive ORIGINAL.tgz --sha256 HASH [--native] [--feature NAME ...]
  [--operator] [--pins EXACT_PINS.json] [--offline] [--cache CACHE_DIRECTORY]
runtime-install recover --from PREVIOUS_DIRECTORY --dir NEW_DIRECTORY
  [--offline] [--cache CACHE_DIRECTORY]
runtime-install compare --before DIRECTORY --after DIRECTORY

Preparation unpacks and matches one original source archive, selects exact native
dependencies from that release, and writes an inspectable private installation.
Install uses the normal npm registry/cache; --offline uses only the existing cache.
The original source stays in package/ and dependencies live beside it in node_modules/.
Upgrade/recovery prepare a new runtime and keep the previous runtime available.
Use the resulting sourceRoot and dependencyRoot in the original host/container plan.`;

const COMMON_SELECTION = ['--native', '--feature', '--operator', '--pins'];
const OPTIONS = {
  prepare: ['--dir', '--archive', '--sha256', ...COMMON_SELECTION],
  install: ['--dir', '--offline', '--cache'],
  resume: ['--dir', '--offline', '--cache'],
  inspect: ['--dir', '--load', '--source'],
  run: ['--dir'],
  upgrade: ['--from', '--dir', '--archive', '--sha256', ...COMMON_SELECTION, '--offline', '--cache'],
  recover: ['--from', '--dir', '--offline', '--cache'],
  compare: ['--before', '--after'],
};
const FLAGS = new Set(['--native', '--operator', '--offline', '--load', '--source']);

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.length === 1 && args[0] === '--help') { console.log(HELP); return 0; }
  const [command, ...rest] = args, allowed = OPTIONS[command];
  if (!allowed) throw new TypeError('Unknown runtime installation command: ' + command);
  const values = {}, original = [];
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i];
    if (key === '--' && command === 'run') { original.push(...rest.slice(i + 1)); break; }
    if (!allowed.includes(key) || key !== '--feature' && Object.hasOwn(values, key))
      throw new TypeError('Unexpected or repeated option: ' + key);
    if (FLAGS.has(key)) { values[key] = true; continue; }
    if (!rest[i + 1] || rest[i + 1].startsWith('--')) throw new TypeError('Value required: ' + key);
    const value = rest[++i];
    if (key === '--feature') (values[key] ??= []).push(value);
    else values[key] = value;
  }
  const requireValue = key => {
    if (!values[key]) throw new TypeError(key + ' is required for ' + command);
    return values[key];
  };
  if (command === 'run') {
    requireValue('--dir');
    if (!original.length) throw new TypeError('Use -- followed by the original Starforge command');
    return launchRuntime({ directory: values['--dir'], args: original });
  }
  let result;
  if (command === 'compare') {
    result = await compareRuntimeInstalls({ before: requireValue('--before'), after: requireValue('--after') });
  } else {
    const directory = requireValue('--dir');
    if (command === 'install' || command === 'resume') {
      result = await installRuntime({ directory, offline: !!values['--offline'], cache: values['--cache'] });
    } else if (command === 'inspect') {
      result = await inspectRuntimeInstall({ directory, load: !!values['--load'], source: !!values['--source'] });
    } else {
      const selection = {
        ...(values['--native'] ? { native: true } : {}),
        ...(values['--operator'] ? { operator: true } : {}),
        ...(values['--feature'] ? { features: values['--feature'] } : {}),
        ...(values['--pins'] ? { pins: JSON.parse(await readFile(resolve(values['--pins']), 'utf8')) } : {}),
      };
      if (command === 'prepare') result = await prepareRuntimeInstall({ directory,
        archive: requireValue('--archive'), sha256: requireValue('--sha256'), ...selection });
      else if (command === 'recover') result = await recoverRuntime({ from: requireValue('--from'), directory,
        offline: !!values['--offline'], cache: values['--cache'] });
      else result = await upgradeRuntime({ from: requireValue('--from'), directory, ...selection,
        ...(command === 'upgrade' ? { archive: requireValue('--archive'), sha256: requireValue('--sha256') } : {}),
        offline: !!values['--offline'], cache: values['--cache'] });
    }
  }
  console.log(JSON.stringify(result, null, 2));
  return command === 'inspect' && !result.ready ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main().then(code => { process.exitCode = code; }).catch(error => {
    console.error(JSON.stringify({ error: error.code ?? 'RUNTIME_INSTALL_ERROR', message: error.message }));
    process.exitCode = error.code === 'RUNTIME_INSTALL_ALREADY_RUNNING' ? 75 : 1;
  });
