#!/usr/bin/env node
// MIT. Bind the reviewed source declaration, then use the one original Datasette CLI.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectDatasetteBinding} from './managed-binding.mjs';
import {parseDatasetteArguments, runDatasetteCLI} from './cli.mjs';
const fail = message => Object.assign(new Error(message), {code: 'DATASETTE_MANAGED_INPUT'});

export async function runManagedDatasetteCLI(argv = process.argv.slice(2), streams = {}) {
  try {
    if (argv.includes('--help')) {
      (streams.stdout ?? process.stdout).write('Managed Datasette application\n\n' +
        'Use the original datasette serve options with --expected-binding-sha256 HASH.\n' +
        'Applications prepares this command from the selected existing workspace.\n');
      return 0;
    }
    const flags = argv.flatMap((value, index) => value === '--expected-binding-sha256' ? [index] : []);
    if (flags.length !== 1 || !/^[a-f0-9]{64}$/.test(argv[flags[0] + 1] ?? ''))
      throw fail('Retain the complete workspace binding prepared by Applications.');
    const expected = argv[flags[0] + 1];
    const selected = argv.filter((_, index) => index !== flags[0] && index !== flags[0] + 1);
    const args = parseDatasetteArguments(selected);
    if (args.command !== 'serve' || args.create || !args.directory || !args['expected-workspace-id'] ||
        !args['connection-file']) throw fail('Reopen the original managed workspace with its identity and connection file.');
    const binding = await inspectDatasetteBinding({directory: resolve(args.directory)});
    if (binding.bindingSha256 !== expected || binding.workspaceId !== args['expected-workspace-id'])
      throw fail('The workspace declaration changed. Review its current selection in Applications.');
    return await runDatasetteCLI(selected, streams);
  } catch (error) {
    (streams.stderr ?? process.stderr).write(JSON.stringify({error: error.code ?? 'DATASETTE_MANAGED_FAILED',
      message: error.message}) + '\n');
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  process.exitCode = await runManagedDatasetteCLI();
