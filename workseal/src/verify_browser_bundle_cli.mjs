#!/usr/bin/env node
/** Independent offline receipt review. No provider, RPC or wallet calls. */
import { open } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { buildDemoBundle, verifyBrowserBundle } from '../web/core.mjs';

const MAX_BUNDLE_BYTES = 2 * 1024 * 1024;
if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto;

async function readBoundedJson(filePath) {
  const handle = await open(filePath, 'r');
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error('bundle path is not a regular file');
    if (metadata.size > MAX_BUNDLE_BYTES) throw new Error('bundle exceeds 2 MiB limit');
    const chunks = [];
    let position = 0;
    while (position <= MAX_BUNDLE_BYTES) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, MAX_BUNDLE_BYTES + 1 - position));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      position += bytesRead;
    }
    if (position > MAX_BUNDLE_BYTES) throw new Error('bundle exceeds 2 MiB limit');
    const contents = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    return JSON.parse(contents);
  } finally {
    await handle.close();
  }
}

function parseArgs(argv) {
  let source = null;
  let filePath = null;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--file' && !source && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      source = 'file';
      filePath = argv[++i];
    } else if (arg === '--demo' && !source) {
      source = 'synthetic-demo';
    } else if (arg === '--json' && !json) {
      json = true;
    } else {
      throw new Error('usage: node src/verify_browser_bundle_cli.mjs (--file <signed-bundle.json> | --demo) [--json]');
    }
  }
  if (!source) throw new Error('usage: node src/verify_browser_bundle_cli.mjs (--file <signed-bundle.json> | --demo) [--json]');
  return { source, filePath, json };
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
    return;
  }
  try {
    const bundle = opts.source === 'file' ? await readBoundedJson(opts.filePath) : await buildDemoBundle();
    const verified = await verifyBrowserBundle(bundle);
    if (verified.verdict !== 'PASS' || verified.writePerformed !== false || verified.externalAuthorityGranted !== false) {
      throw new Error('verifier failed closed or returned unexpected authority flags');
    }
    const receipt = {
      schema: 'workseal-offline-verification/v1',
      status: 'PASS',
      source: opts.source,
      taskDigest: verified.taskDigest,
      resultDigest: verified.resultDigest,
      evidenceDigest: verified.evidenceDigest,
      acceptanceDigest: verified.acceptanceDigest,
      settlementIntentDigest: verified.settlementIntentDigest,
      localCryptographicConsistencyOnly: true,
      independentlyConfirmedProviderEvidence: false,
      networkCalls: false,
      walletWritePerformed: false,
      externalAuthorityGranted: false,
    };
    if (opts.json) console.log(JSON.stringify(receipt));
    else {
      console.log(`PASS | WorkSeal offline signature + evidence consistency | ${opts.source}`);
      console.log(`Task: ${receipt.taskDigest}`);
      console.log(`Result: ${receipt.resultDigest}`);
      console.log(`Settlement intent: ${receipt.settlementIntentDigest}`);
      console.log('Provider run authenticity NOT independently confirmed; no chain write or payment authorization.');
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'verification failed';
    const receipt = { schema: 'workseal-offline-verification/v1', status: 'HOLD', source: opts.source, reason, networkCalls: false, walletWritePerformed: false, externalAuthorityGranted: false };
    if (opts.json) console.log(JSON.stringify(receipt));
    else console.error(`HOLD | WorkSeal bundle rejected: ${reason}`);
    process.exitCode = 1;
  }
}

await main();
