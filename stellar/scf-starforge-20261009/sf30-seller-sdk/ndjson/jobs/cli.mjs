#!/usr/bin/env node
// MIT. Installed customer receiving through the original owned native-process host.
import { resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNativeProcessHost } from '../../jobs/processes-host.mjs';

export async function runDatasetJobCommand(argv = process.argv.slice(2), { print = value => {
  process.stdout.write(JSON.stringify(value) + '\n');
} } = {}) {
  if (!argv.length || ['--help', 'help'].includes(argv[0])) {
    print({ command: 'dataset-ndjson-job receive --file RESULT.zip --out PRIVATE_DIRECTORY --python ABSOLUTE_PYTHON [--sha256 RESULT_SHA256]',
      description: 'Receive the complete dataset job, rebuild its original projects, repeat its query and comparison, and reopen the customer workspace.' });
    return;
  }
  if (argv[0] !== 'receive') throw new TypeError('Choose receive; see --help');
  const options = {};
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index], value = argv[index + 1];
    if (!['--file', '--out', '--python', '--sha256'].includes(key) || !value || Object.hasOwn(options, key))
      throw new TypeError('Supply one value per declared option; see --help');
    options[key] = value;
  }
  const python = options['--python'] ?? process.env.SF30_NDJSON_PYTHON;
  if (!options['--file'] || !options['--out'] || typeof python !== 'string' || !isAbsolute(python))
    throw new TypeError('Supply --file, --out and an absolute --python (or SF30_NDJSON_PYTHON)');
  const host = createNativeProcessHost({ env: { ...process.env, SF30_XML_NODE: process.env.SF30_XML_NODE ?? process.execPath } });
  let interrupted = false;
  const stop = () => { interrupted = true; void host.close().catch(() => {}); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const command = [python, '-B', '-I', fileURLToPath(new URL('./receiving.py', import.meta.url)),
      '--file', resolve(options['--file']), '--directory', resolve(options['--out'])];
    if (options['--sha256']) command.push('--sha256', options['--sha256']);
    const result = await host.run({ command, maxStdoutBytes: 2097152, maxStderrBytes: 65536 });
    if (interrupted) throw new Error('Dataset receiving was interrupted; repeat the same original command to resume.');
    if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr).trim() || 'Dataset receiving failed');
    print(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result.stdout)));
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    await host.close();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runDatasetJobCommand().catch(error => { process.stderr.write(JSON.stringify({ error: error.message }) + '\n'); process.exitCode = 1; });
}
