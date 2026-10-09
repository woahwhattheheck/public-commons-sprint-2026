#!/usr/bin/env node
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { WorkSealError } from './canonical.mjs';
import {
  artifactEvidence, artifactManifestDigest, artifactPolicyRequirement,
  buildArtifactManifest, normalizeArtifactManifest, verifyArtifactDelivery,
} from './artifact_manifest.mjs';

const USAGE = `Usage:
  node src/artifact_manifest_cli.mjs manifest ROOT PATH [PATH ...]
  node src/artifact_manifest_cli.mjs policy MANIFEST.json
  node src/artifact_manifest_cli.mjs prepare ROOT MANIFEST.json TASK.json GENERATION
  node src/artifact_manifest_cli.mjs verify ROOT MANIFEST.json TASK.json RESULT.json

Read-only. JSON goes to stdout. No key, network, wallet or settlement operation.
Use an immutable verifier-controlled ROOT, not a live worker-writable checkout.`;

async function readJson(path) {
  // A growing JSON file cannot defeat this bound. Do not use unbounded readFile.
  const maxBytes = 2 * 1024 * 1024;
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes) throw new WorkSealError('ARTIFACT_INPUT', 'JSON input must be a regular file no larger than 2 MiB');
    const bytes = Buffer.alloc(maxBytes + 1);
    let used = 0;
    while (used < bytes.length) {
      const read = await handle.read(bytes, used, bytes.length - used, null);
      if (read.bytesRead === 0) break;
      used += read.bytesRead;
    }
    if (used > maxBytes) throw new WorkSealError('ARTIFACT_INPUT', 'JSON input exceeds 2 MiB');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, used)));
  } finally { await handle.close(); }
}

async function main(args) {
  const [command, ...rest] = args;
  if (command === '--help' && rest.length === 0) { process.stdout.write(`${USAGE}\n`); return; }
  let output;
  if (command === 'manifest' && rest.length >= 2) {
    output = await buildArtifactManifest(rest[0], rest.slice(1));
  } else if (command === 'policy' && rest.length === 1) {
    const manifest = normalizeArtifactManifest(await readJson(rest[0]));
    output = { artifactDigest: artifactManifestDigest(manifest), requirement: artifactPolicyRequirement(manifest) };
  } else if ((command === 'prepare' || command === 'verify') && rest.length === 4) {
    const [root, manifestPath, taskPath, resultOrGeneration] = rest;
    const manifest = await readJson(manifestPath);
    const task = await readJson(taskPath);
    let result;
    if (command === 'prepare') {
      if (!/^[1-9][0-9]*$/.test(resultOrGeneration)) throw new WorkSealError('BAD_GENERATION', 'generation must be a positive integer');
      const generation = Number(resultOrGeneration);
      const { packet, evidence } = artifactEvidence(manifest, task, generation);
      result = {
        schema: 'workseal-result/v1', taskDigest: packet.taskDigest, workerId: packet.workerId,
        generation, artifactDigest: packet.artifactDigest, evidence: [evidence],
      };
    } else { result = await readJson(resultOrGeneration); }
    const verification = await verifyArtifactDelivery({ root, manifest, task, result });
    // prepare emits an unsigned result only after reading the actual files.
    output = command === 'prepare' ? result : verification;
  } else { throw new WorkSealError('ARTIFACT_USAGE', USAGE); }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main(process.argv.slice(2)).catch(error => {
  // Do not echo raw files, absolute paths, parser payloads, or native stacks.
  const safe = error instanceof WorkSealError;
  process.stderr.write(`${JSON.stringify({ ok: false, code: safe ? error.code : 'ARTIFACT_INPUT_OR_IO', message: safe ? error.message : 'Unable to read or parse the selected input' })}\n`);
  process.exitCode = 1;
});
