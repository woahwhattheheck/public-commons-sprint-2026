#!/usr/bin/env node
// MIT. Publish retained Soroban editions through the existing event merchant.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { FeedError, integer } from '../webhook-feed/model.mjs';
import { prepareSorobanPublication, appendSorobanEdition, replaySorobanPublication,
  inspectSorobanPublication, previewSorobanPublication, saveSorobanPublicationPlan,
  prepareSorobanPublicationRelease, startSorobanPublication, snapshotSorobanPublication,
  restoreSorobanPublication, createSorobanPublicationBuyer } from './publish.mjs';

const HELP = [
  'Starforge Soroban event publication',
  '',
  'prepare  --workspace DIR --edition ID --publication NEW_DIR [--feed ID] [--source ID]',
  'append   --workspace DIR --edition ID --publication DIR',
  'replay   --publication DIR [--edition ID]',
  'inspect  --publication DIR',
  'preview  --publication DIR [--cursor OPAQUE] [--limit N] [--out NEW_FILE]',
  'plan     --publication DIR --json ORIGINAL_MERCHANT_PLAN [--expected-revision SHA]',
  'release  --publication DIR --out NEW_DIRECTORY',
  'run      --publication DIR [--port N] [--facilitator HTTPS_URL] [--allow-local-facilitator]',
  'snapshot --publication DIR --out NEW_DIRECTORY',
  'restore  --snapshot DIRECTORY --publication NEW_DIRECTORY',
  'buyer-init --publication DIR --config ORIGINAL_BUYER_JSON --dir NEW_BUYER_DIR',
  '           [--id NAME] [--page-size N] [--runtime SF88_DIRECTORY] [--buyer-state DIRECTORY]',
  '',
  'prepare imports a frozen saved workspace edition and its complete original event objects.',
  'append receives another edition from the same workspace/network/plan into the same feed.',
  'replay resumes retained editions with their original event IDs and the original store deduplication.',
  'plan takes the unchanged original stellar-forge.webhook-feed-merchant.v1 object and actual terms.',
  'run uses the existing payment engine; its returned mode identifies the active merchant lifecycle.',
  'snapshot preserves original feed identities and cursor key together with retained source editions.',
  'restore reopens the captured feed cut; replay can complete a partially received retained edition.',
  'After buyer-init, use starforge buyer-event-feed sync/recover/inspect/export with the same --dir.',
].join('\n');

const OPTIONS = {
  prepare: ['workspace', 'edition', 'publication', 'feed', 'source'],
  append: ['workspace', 'edition', 'publication'],
  replay: ['publication', 'edition'],
  inspect: ['publication'],
  preview: ['publication', 'cursor', 'limit', 'out'],
  plan: ['publication', 'json', 'expected-revision'],
  release: ['publication', 'out'],
  run: ['publication', 'port', 'facilitator', 'allow-local-facilitator'],
  snapshot: ['publication', 'out'],
  restore: ['snapshot', 'publication'],
  'buyer-init': ['publication', 'config', 'dir', 'id', 'page-size', 'runtime', 'buyer-state'],
};
function options(command, args) {
  const allowed = OPTIONS[command];
  if (!allowed) throw new FeedError('SOROBAN_PUBLICATION_COMMAND_UNKNOWN', 422);
  const result = {};
  for (let index = 0; index < args.length; index++) {
    const token = args[index];
    if (!token.startsWith('--')) throw new FeedError('SOROBAN_PUBLICATION_OPTION_REQUIRED', 422);
    const key = token.slice(2);
    if (!allowed.includes(key) || Object.hasOwn(result, key))
      throw new FeedError('SOROBAN_PUBLICATION_OPTION_INVALID', 422, { option: key });
    if (key === 'allow-local-facilitator') { result[key] = true; continue; }
    const value = args[++index];
    if (value === undefined || value.startsWith('--'))
      throw new FeedError('SOROBAN_PUBLICATION_OPTION_VALUE_REQUIRED', 422, { option: key });
    result[key] = value;
  }
  return result;
}
function required(options, key) {
  if (typeof options[key] !== 'string' || !options[key])
    throw new FeedError('SOROBAN_PUBLICATION_OPTION_VALUE_REQUIRED', 422, { option: key });
  return options[key];
}
async function readJson(filename) {
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1048576)
    throw new FeedError('SOROBAN_PUBLICATION_REGULAR_PLAN_REQUIRED', 422);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readFile(filename))); }
  catch { throw new FeedError('SOROBAN_PUBLICATION_PLAN_JSON_INVALID', 422); }
}
async function output(result, filename) {
  const text = JSON.stringify(result, null, 2) + '\n';
  if (filename) await writeFile(resolve(filename), text, { mode: 0o600, flag: 'wx' });
  else process.stdout.write(text);
  return result;
}
async function nativeFactoryFor(value, allowLocal) {
  if (!value) {
    if (allowLocal) throw new FeedError('FACILITATOR_REQUIRED', 422);
    return null;
  }
  const url = new URL(value);
  if ((url.protocol !== 'https:' && !(allowLocal && url.protocol === 'http:' && url.hostname === '127.0.0.1')) ||
    url.username || url.password || url.search || url.hash) throw new FeedError('INVALID_FACILITATOR', 422);
  const [{ HTTPFacilitatorClient }, { createNativeSellerServer }] = await Promise.all([
    import('@x402/core/server'), import('../native-factory.mjs'),
  ]);
  return compiled => createNativeSellerServer(compiled, {
    facilitatorClient: new HTTPFacilitatorClient({ url: url.href.replace(/\/$/, '') }),
  });
}

export async function main(args = process.argv.slice(2)) {
  if (!args.length || ['help', '--help'].includes(args[0])) {
    process.stdout.write(HELP + '\n'); return null;
  }
  const [command, ...rest] = args;
  const selected = options(command, rest), directory = resolve(required(selected, 'publication'));
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once('SIGINT', abort); process.once('SIGTERM', abort);
  let session, keepOpen = false;
  try {
    let result;
    if (command === 'prepare' || command === 'append') {
      const input = { directory, workspaceDirectory: resolve(required(selected, 'workspace')),
        editionId: required(selected, 'edition'), signal: controller.signal };
      result = command === 'prepare'
        ? await prepareSorobanPublication({ ...input, feedId: selected.feed, sourceId: selected.source })
        : await appendSorobanEdition(input);
    } else if (command === 'replay') {
      result = await replaySorobanPublication({ directory, editionId: selected.edition, signal: controller.signal });
    } else if (command === 'inspect') {
      result = await inspectSorobanPublication({ directory });
    } else if (command === 'preview') {
      result = await previewSorobanPublication({ directory, cursor: selected.cursor,
        ...(selected.limit !== undefined ? { limit: integer(selected.limit, 'limit', 1, 1000) } : {}) });
    } else if (command === 'plan') {
      result = await saveSorobanPublicationPlan({ directory, plan: await readJson(resolve(required(selected, 'json'))),
        expectedRevision: selected['expected-revision'] ?? null });
    } else if (command === 'release') {
      result = await prepareSorobanPublicationRelease({ directory, destination: resolve(required(selected, 'out')) });
    } else if (command === 'snapshot') {
      result = await snapshotSorobanPublication({ directory, destination: resolve(required(selected, 'out')) });
    } else if (command === 'restore') {
      result = await restoreSorobanPublication({ directory: resolve(required(selected, 'snapshot')), destination: directory });
    } else if (command === 'buyer-init') {
      result = await createSorobanPublicationBuyer({ directory,
        buyerDirectory: resolve(required(selected, 'dir')), config: resolve(required(selected, 'config')),
        id: selected.id, pageSize: integer(selected['page-size'], 'page-size', 1, 1000, 100),
        runtimeDirectory: selected.runtime, buyerStateDirectory: selected['buyer-state'] });
    } else if (command === 'run') {
      session = await startSorobanPublication({ directory,
        port: integer(selected.port, 'port', 0, 65535, 8492),
        nativeFactory: await nativeFactoryFor(selected.facilitator, selected['allow-local-facilitator']) });
      process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort);
      let closing;
      const close = () => closing ??= session.close();
      const stop = () => close().catch(() => { process.exitCode = 1; });
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
      if (controller.signal.aborted) { await close(); return null; }
      const summary = { directory, url: session.url, mode: session.mode, feeds: session.feeds,
        storeId: session.publication.storeId, sourceId: session.publication.sourceId,
        feedId: session.publication.feedId };
      await output(summary);
      keepOpen = true;
      return { ...session, close };
    }
    return await output(result, command === 'preview' ? selected.out : undefined);
  } finally {
    process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort);
    if (!keepOpen) await session?.close();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => {
    process.stderr.write(JSON.stringify({
      error: error instanceof FeedError ? error.code : error.code ?? 'SOROBAN_PUBLICATION_COMMAND_FAILED',
      ...(error instanceof FeedError ? error.details : {}),
      ...(error.publicationDirectory ? { publicationDirectory: error.publicationDirectory, recovery: error.recovery } : {}),
    }) + '\n');
    process.exitCode = 1;
  });
