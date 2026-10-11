#!/usr/bin/env node
// MIT — SF88 operator command: source-native review, discovery and handoff.
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { config, operation, responseFile, bytes, need } from './config.mjs';

const print = data => process.stdout.write(JSON.stringify(data, null, 2) + '\n');
const sha256 = data => createHash('sha256').update(data).digest('hex');
let cancellationExitCode;

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
    preparedFrom:c.preparedFrom ?? null,
    next:'Execute an original approved single operation using the private operator module'
  });
}
async function discover(c) {
  const { discoverCatalog } = await import('./discovery.mjs');
  print(await discoverCatalog(c.catalog));
}
async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Usage: node cli.mjs --review|--discover|--execute --config /absolute/operator.json [--response-out /absolute/output]\n' +
      '       node cli.mjs --prepare --discovery /absolute/catalog.json --row 0 --accept 0 --intent-id stable-id --url https://seller.example/resource --method GET --out /absolute/review.json [--response-out /absolute/product]\n');
    process.stdout.write('       node cli.mjs --init-workspace --config /absolute/review.json --dir /absolute/new-workspace --actor operator-id --service seller-id --payer G... --python /usr/bin/python3 [--secret-env STELLAR_SECRET | --signer-provider /absolute/wallet.mjs] [--rpc https://rpc.example] [--total-atomic 1000] [--daily-atomic 1000]\n' +
      '       node cli.mjs --review-workspace|--diagnose-workspace|--execute-workspace --dir /absolute/workspace\n');
    return;
  }
  if (args[0] === '--prepare') {
    const { prepare } = await import('./prepare.mjs');
    return print(await prepare(args.slice(1)));
  }
  if (args[0] === '--init-workspace') {
    const {initializeWorkspace} = await import('./workspace.mjs');
    return print(await initializeWorkspace(args.slice(1)));
  }
  if (args[0] === '--diagnose-workspace') {
    const {diagnoseWorkspace} = await import('./workspace.mjs');
    const result = await diagnoseWorkspace(args.slice(1));
    if (result.status === 'SETUP_REQUIRED') process.exitCode = 1;
    return print(result);
  }
  let c, operatorEnvironment;
  if (['--review-workspace', '--execute-workspace'].includes(args[0])) {
    const {openWorkspace} = await import('./workspace.mjs');
    const workspace = await openWorkspace(args.slice(1), {execute:args[0] === '--execute-workspace'});
    c = workspace.config;
    operatorEnvironment = workspace.operatorEnvironment;
    if (args[0] === '--review-workspace') return review(c);
  } else {
  need((args.length === 3 || args.length === 5 && args[3] === '--response-out') &&
    ['--review','--discover','--execute'].includes(args[0]) &&
    args[1] === '--config', 'USAGE_MODE_AND_CONFIG_REQUIRED');
  c = await config(args[2]);
  if (args.length === 5) {
    need(args[0] !== '--discover', 'RESPONSE_OUT_REQUIRES_REVIEW_OR_EXECUTE');
    need(c.responseFile === undefined, 'RESPONSE_FILE_CONFIG_AND_FLAG_CONFLICT');
    c.responseFile = { destination:args[4] };
  }
  if (args[0] === '--review') return review(c);
  if (args[0] === '--discover') return discover(c);
  }
  const controller = new AbortController();
  const cancel = exitCode => {
    if (controller.signal.aborted) return;
    cancellationExitCode = exitCode;
    controller.abort();
  };
  const onInterrupt = () => cancel(130);
  const onTerminate = () => cancel(143);
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);
  try {
    const { execute } = await import('./execute.mjs');
    return await execute(c, { signal:controller.signal, environment:operatorEnvironment });
  } finally {
    process.off('SIGINT', onInterrupt);
    process.off('SIGTERM', onTerminate);
    // Let execution finish its cleanup and original outcome summary before exit.
    if (cancellationExitCode !== undefined) process.exitCode = cancellationExitCode;
  }
}
main(process.argv.slice(2)).catch(error => {
  const safeCode = (value, fallback) => typeof value === 'string' && /^[A-Z0-9_]{1,120}$/.test(value)
    ? value : fallback;
  const code = safeCode(error?.code, 'OPERATION_FAILED_RECONCILE_ORIGINAL_LEDGER');
  const warnings = values => values.filter(value => value !== null && typeof value === 'object' &&
    !Array.isArray(value)).map(value => ({
      code:safeCode(value.code, 'RESPONSE_FILE_CLEANUP_FAILED'),
      ...(typeof value.path === 'string' || value.path === null ? {path:value.path} : {})
    }));
  const detail = {};
  if (Number.isSafeInteger(error?.bytes) && error.bytes >= 0) detail.bytes = error.bytes;
  if (typeof error?.partialPath === 'string' || error?.partialPath === null) detail.partialPath = error.partialPath;
  if (Array.isArray(error?.cleanupWarnings)) detail.cleanupWarnings = warnings(error.cleanupWarnings);
  const cleanup = error?.responseCleanupError;
  if (cleanup !== null && typeof cleanup === 'object' && !Array.isArray(cleanup))
    detail.responseCleanupError = {
      code:safeCode(cleanup.code, 'RESPONSE_FILE_CLEANUP_FAILED'),
      cleanupWarnings:Array.isArray(cleanup.cleanupWarnings) ? warnings(cleanup.cleanupWarnings) : []
    };
  process.stderr.write(JSON.stringify({error:code,retry:'NO_AUTOMATIC_RETRY',...detail}) + '\n');
  process.exitCode = cancellationExitCode ?? 1;
});

