#!/usr/bin/env node
// MIT. Source inspection and immutable native SFTP captures.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openSftpSourceFile, readSftpSourceFile, fail } from './config.mjs';
import { createFile } from '../postgres/publisher/files.mjs';

const HELP = `SFTP report source

  sftp inspect SOURCE.json
  sftp catalogue SOURCE.json [--path FOLDER] [--limit 200] [--offset 0]
  sftp sample SOURCE.json --path FILE --format csv|json|ndjson
              [--records-pointer /records] [--limit 20]
  sftp capture SOURCE.json --path FILE [--expected-sha256 SHA256]

Options:
  --capture-dir DIRECTORY  Retain full bytes, transfer checkpoints and receipts.
  --out FILE               Write the JSON result to a new private file.
  --help                   Show these commands.

Set the source's declared authentication environment references before running.
A key-file reference must contain an absolute path to a private key file.
Use sftp-publisher for original candidate review, publication and recurrence.
Use sftp-workspace for the complete source/report/merchant browser workspace.
`;
export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv.includes('--help')) { process.stdout.write(HELP); return; }
  const [command, sourceFile, ...rest] = argv;
  if (!['inspect', 'catalogue', 'sample', 'capture'].includes(command) || !sourceFile || sourceFile.startsWith('--'))
    throw fail('SFTP_COMMAND_INVALID', HELP);
  const options = Object.create(null);
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i], value = rest[i + 1];
    if (!['--capture-dir', '--out', '--path', '--limit', '--offset', '--format', '--records-pointer', '--expected-sha256'].includes(key) ||
        value === undefined || value.startsWith('--') || Object.hasOwn(options, key)) throw fail('SFTP_ARGUMENT_INVALID');
    options[key] = value;
  }
  const allowed = {
    inspect: ['--out'],
    catalogue: ['--capture-dir', '--out', '--path', '--limit', '--offset'],
    sample: ['--capture-dir', '--out', '--path', '--limit', '--format', '--records-pointer', '--expected-sha256'],
    capture: ['--capture-dir', '--out', '--path', '--expected-sha256'],
  };
  if (Object.keys(options).some(key => !allowed[command].includes(key))) throw fail('SFTP_ARGUMENT_INVALID');
  const numeric = (key, fallback) => {
    if (options[key] === undefined) return fallback;
    if (!/^(0|[1-9][0-9]*)$/.test(options[key])) throw fail('SFTP_ARGUMENT_INVALID');
    return Number(options[key]);
  };
  let result;
  if (command === 'inspect') {
    const source = await readSftpSourceFile(sourceFile);
    const { createSftpSource } = await import('./source.mjs');
    const opened = createSftpSource(source.config, { validated: true });
    try { result = { sourceHash: source.hash, sourceBytes: source.bytes, ...opened.inspect() }; }
    finally { await opened.close(); }
  } else {
    const opened = await openSftpSourceFile(sourceFile, { captureDirectory: options['--capture-dir'] ? resolve(options['--capture-dir']) : undefined });
    try {
      if (command === 'catalogue') result = await opened.source.catalogue({ path: options['--path'] ?? '',
        limit: numeric('--limit', 200), offset: numeric('--offset', 0) });
      else if (command === 'sample') result = await opened.source.sampleFile({ path: options['--path'], format: options['--format'],
        recordsPointer: options['--records-pointer'] ?? '', limit: numeric('--limit', 20), expectedSha256: options['--expected-sha256'] });
      else result = await opened.source.captureFile(options['--path'], { expectedSha256: options['--expected-sha256'] });
    } finally { await opened.source.close(); }
  }
  const output = JSON.stringify(result, null, 2) + '\n';
  if (options['--out']) await createFile(resolve(options['--out']), Buffer.from(output));
  else process.stdout.write(output);
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(issue => { process.stderr.write((issue.code ?? 'SFTP_SOURCE') + ': ' +
    (issue.code ? issue.message : 'Review the selected source inputs.') + '\n'); process.exitCode = 1; });
