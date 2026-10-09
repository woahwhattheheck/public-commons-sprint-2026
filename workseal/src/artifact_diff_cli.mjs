#!/usr/bin/env node
/** Read-only, bounded manifest comparison for dispute and judge review. */
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { compareArtifactManifests, artifactDeltaMarkdown } from './artifact_diff.mjs';

const USAGE = 'usage: node src/artifact_diff_cli.mjs EXPECTED.json OBSERVED.json [--markdown]';
async function readManifest(path) {
  const limit = 2 * 1024 * 1024;
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > limit) throw new Error('invalid manifest input');
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > limit) throw new Error('oversized manifest input');
    const value = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
    return JSON.parse(value);
  } finally {
    await handle.close();
  }
}
async function main(argv) {
  if (argv.length === 1 && argv[0] === '--help') {
    process.stdout.write(USAGE + '\n');
    return;
  }
  if ((argv.length !== 2 && argv.length !== 3) ||
      (argv.length === 3 && argv[2] !== '--markdown')) throw new Error('usage');
  const expected = await readManifest(argv[0]);
  const observed = await readManifest(argv[1]);
  const delta = compareArtifactManifests(expected, observed);
  process.stdout.write(argv[2] === '--markdown'
    ? artifactDeltaMarkdown(delta) : JSON.stringify(delta, null, 2) + '\n');
  if (delta.comparison !== 'SAME_DECLARATION') process.exitCode = 1;
}
main(process.argv.slice(2)).catch(() => {
  // Deliberately avoid printing raw manifest contents, host paths, or exception stacks.
  process.stderr.write('ARTIFACT_DELTA_INPUT_ERROR: ' + USAGE + '\n');
  process.exitCode = 2;
});
