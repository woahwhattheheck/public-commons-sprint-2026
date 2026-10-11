#!/usr/bin/env node
// MIT — Export explicit already-saved dataset pages from the original inbox.
import {exportQueueDataset, readDatasetSelection} from './queue-dataset.mjs';
import {need} from './config.mjs';

async function main(tokens) {
  if (tokens.length === 1 && tokens[0] === '--help') {
    process.stdout.write('Usage: node queue-dataset-cli.mjs --root ABS --intents ABS --out ABS\n' +
      '--intents is a private JSON array of saved buyer intent IDs in page order.\n' +
      'Exports original response files; does not perform buyer requests. See DATASET_DELIVERY.md.\n');
    return;
  }
  need(tokens.length === 6, 'DATASET_EXPLICIT_ARGUMENTS_REQUIRED');
  const flags = new Map();
  for (let i = 0; i < tokens.length; i += 2) {
    need(['--root','--intents','--out'].includes(tokens[i]) && !flags.has(tokens[i]) &&
      typeof tokens[i + 1] === 'string', 'DATASET_ARGUMENT_INVALID');
    flags.set(tokens[i], tokens[i + 1]);
  }
  const result = await exportQueueDataset({root:flags.get('--root'),
    intents:await readDatasetSelection(flags.get('--intents')), destination:flags.get('--out')});
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

main(process.argv.slice(2)).catch(error => {
  const code = /^[A-Z0-9_]{1,120}$/.test(error?.code ?? '') ? error.code : 'DATASET_DELIVERY_FAILED';
  process.stderr.write(JSON.stringify({error:code,
    message:typeof error.message === 'string' ? error.message.slice(0, 512) : code}) + '\n');
  process.exitCode = 1;
});
