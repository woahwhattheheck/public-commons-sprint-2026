#!/usr/bin/env node
// MIT — SF88 operator command: source-native review, discovery and handoff.
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { X402BuyerClient } from '../sf31-buyer-client/buyer.mjs';
import { createPublicHttpsFetch } from '../sf31-buyer-client/public-transport.mjs';
import { config, catalog, operation, responseFile, bytes, need } from './config.mjs';

const print = data => process.stdout.write(JSON.stringify(data, null, 2) + '\n');
const sha256 = data => createHash('sha256').update(data).digest('hex');

async function review(c) {
  const op = operation(c.operation);
  const download = responseFile(c);
  const body = op.bodyFile === undefined ? undefined :
    await bytes(op.bodyFile, 1048576, 'BODY_FILE_INVALID');
  print({
    mode:'OFFLINE_REVIEW', intentId:op.intentId,
    sellerUrl:op.url, method:op.method,
    acceptedTerms:op.expect, headers:op.headers,
    bodyPresent:body !== undefined,
    bodyBytes:body?.byteLength ?? 0,
    bodySha256:sha256(body ?? new Uint8Array()),
    operatorId:c.operator?.actor ?? null,
    serviceId:c.operator?.service ?? null,
    signerFilename:c.signerModule ? basename(c.signerModule) : null,
    responseFile:download ? { ...download, prepared:false } : null,
    next:'Execute an original approved single operation using the private operator module'
  });
}
async function discover(c) {
  const input = catalog(c.catalog);
  const result = await new X402BuyerClient({fetchImpl:createPublicHttpsFetch()}).discover(input);
  print({
    mode:'ORIGINAL_UNSIGNED_CATALOG', source:result.source,
    sourceEnvelope:result.sourceEnvelope,
    pagination:result.pagination, originalListings:result.resources
  });
}
async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Usage: node cli.mjs --review|--discover|--execute --config /absolute/operator.json [--response-out /absolute/output]\n');
    return;
  }
  need((args.length === 3 || args.length === 5 && args[3] === '--response-out') &&
    ['--review','--discover','--execute'].includes(args[0]) &&
    args[1] === '--config', 'USAGE_MODE_AND_CONFIG_REQUIRED');
  const c = await config(args[2]);
  if (args.length === 5) {
    need(args[0] !== '--discover', 'RESPONSE_OUT_REQUIRES_REVIEW_OR_EXECUTE');
    need(c.responseFile === undefined, 'RESPONSE_FILE_CONFIG_AND_FLAG_CONFLICT');
    c.responseFile = { destination:args[4] };
  }
  if (args[0] === '--review') return review(c);
  if (args[0] === '--discover') return discover(c);
  const { execute } = await import('./execute.mjs');
  return execute(c);
}
main(process.argv.slice(2)).catch(error => {
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
    ? error.code : 'OPERATION_FAILED_RECONCILE_ORIGINAL_LEDGER';
  process.stderr.write(JSON.stringify({error:code,retry:'NO_AUTOMATIC_RETRY'}) + '\n');
  process.exitCode = 1;
});
