#!/usr/bin/env node
// MIT. One operator command for receiving, publishing, inspecting and restoring feeds.
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventFeedStore } from './store.mjs';
import { FeedError, integer } from './model.mjs';
import { startWebhookReceiver } from './receiver.mjs';
import { buildWebhookFeedService, prepareWebhookFeedRelease, startWebhookFeedMerchant } from './merchant.mjs';
import { startWebhookFeedWorkspace } from './workspace.mjs';
import { createSnapshot, restoreSnapshot } from './snapshots.mjs';

const HELP = [
  'Starforge webhook-feed',
  '',
  'init | status                         --state DIRECTORY',
  'source | feed                         --state DIRECTORY --json DEFINITION [--expected-revision SHA]',
  'events                                --state DIRECTORY [--after N] [--limit N] [--source ID]',
  'event                                 --state DIRECTORY --sequence N [--out FILE]',
  'preview                               --state DIRECTORY --feed ID [--cursor OPAQUE] [--limit N] [--out FILE]',
  'plan                                  --state DIRECTORY --json PLAN [--expected-revision SHA]',
  'prepare                               --state DIRECTORY [--plan FILE] --out NEW_DIRECTORY [--state-env NAME]',
  'snapshot                              --state DIRECTORY --out NEW_DIRECTORY',
  'restore                               --snapshot DIRECTORY --state NEW_DIRECTORY',
  'receiver | workspace                  --state DIRECTORY [--port N]',
  'merchant                              --state DIRECTORY [--plan FILE] [--port N] [--facilitator HTTPS_URL]',
  'run                                   --state DIRECTORY [--plan FILE]',
  '                                      [--receiver-port 8491] [--merchant-port 8492] [--workspace-port 8493]',
  '                                      [--facilitator HTTPS_URL] [--allow-local-facilitator]',
  'retention                             --state DIRECTORY --through N --expected-high-watermark N',
  '',
  'Receiver and workspace listeners bind to 127.0.0.1. Publish only webhook and paid merchant paths through your HTTPS proxy.',
  'Run uses the existing seller payment engine. Without --facilitator it advertises real payment challenges.',
  'See README.md for source definitions, exact Standard Webhooks signatures and the buyer page contract.',
].join('\n');
const VALUES = new Set(['state', 'json', 'expected-revision', 'sequence', 'after', 'source', 'feed', 'cursor', 'limit',
  'out', 'port', 'receiver-port', 'merchant-port', 'workspace-port', 'plan', 'facilitator', 'through',
  'expected-high-watermark', 'snapshot', 'state-env']);
function options(args) {
  const result = {};
  for (let index = 0; index < args.length; index++) {
    const token = args[index]; if (!token.startsWith('--')) throw new FeedError('OPTION_REQUIRED', 422);
    const name = token.slice(2); if (Object.hasOwn(result, name)) throw new FeedError('DUPLICATE_OPTION', 422, { name });
    if (name === 'allow-local-facilitator') { result[name] = true; continue; }
    if (!VALUES.has(name) || args[index + 1] === undefined || args[index + 1].startsWith('--')) throw new FeedError('INVALID_OPTION', 422, { name });
    result[name] = args[++index];
  }
  return result;
}
async function readJson(filename) {
  if (!filename) throw new FeedError('JSON_FILE_REQUIRED', 422);
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1048576) throw new FeedError('REGULAR_JSON_FILE_REQUIRED', 422);
  return JSON.parse(await readFile(filename, 'utf8'));
}
async function output(value, filename) {
  const text = JSON.stringify(value, null, 2) + '\n';
  if (filename) await writeFile(resolve(filename), text, { mode: 0o600, flag: 'wx' });
  else process.stdout.write(text);
  return value;
}
async function nativeFactoryFor(value, allowLocal) {
  if (!value) { if (allowLocal) throw new FeedError('FACILITATOR_REQUIRED', 422); return null; }
  const url = new URL(value);
  if ((url.protocol !== 'https:' && !(allowLocal && url.protocol === 'http:' && url.hostname === '127.0.0.1')) || url.username || url.password || url.search || url.hash) throw new FeedError('INVALID_FACILITATOR', 422);
  const [{ HTTPFacilitatorClient }, { createNativeSellerServer }] = await Promise.all([
    import('@x402/core/server'), import('../native-factory.mjs'),
  ]);
  return compiled => createNativeSellerServer(compiled, { facilitatorClient: new HTTPFacilitatorClient({ url: url.href.replace(/\/$/, '') }) });
}
export async function main(args = process.argv.slice(2)) {
  if (!args.length || args[0] === '--help' || args[0] === 'help') { process.stdout.write(HELP + '\n'); return null; }
  const [command, ...rest] = args, option = options(rest);
  if (!option.state) throw new FeedError('STATE_DIRECTORY_REQUIRED', 422);
  if (command === 'restore') {
    if (!option.snapshot) throw new FeedError('SNAPSHOT_DIRECTORY_REQUIRED', 422);
    return output(await restoreSnapshot({ directory: option.snapshot, destination: option.state }));
  }
  const store = new EventFeedStore(option.state), sessions = [];
  let keepOpen = false;
  try {
    if (['init', 'status'].includes(command)) return output(store.status());
    if (['source', 'feed'].includes(command)) return output(store.saveDefinition(command, await readJson(option.json), option['expected-revision'] ?? null));
    if (command === 'events') return output(store.listEvents({
      after: integer(option.after, 'after', 0, Number.MAX_SAFE_INTEGER, 0),
      limit: integer(option.limit, 'limit', 1, 200, 50), ...(option.source ? { sourceId: option.source } : {}),
    }), option.out);
    if (command === 'event') return output(store.inspectEvent(integer(option.sequence, 'sequence', 1, Number.MAX_SAFE_INTEGER)), option.out);
    if (command === 'preview') return output(store.readPage(option.feed, {
      ...(option.cursor ? { cursor: option.cursor } : {}), ...(option.limit ? { limit: option.limit } : {}),
    }), option.out);
    if (command === 'plan') {
      const plan = await readJson(option.json); buildWebhookFeedService({ store, plan });
      return output(store.saveMerchantPlan(plan, option['expected-revision'] ?? null));
    }
    if (command === 'retention') return output(store.purge(integer(option.through, 'through', 0, Number.MAX_SAFE_INTEGER),
      integer(option['expected-high-watermark'], 'expected-high-watermark', 0, Number.MAX_SAFE_INTEGER)));
    if (command === 'snapshot') {
      if (!option.out) throw new FeedError('NEW_OUTPUT_DIRECTORY_REQUIRED', 422);
      return output(await createSnapshot({ store, directory: option.out }));
    }
    const plan = option.plan ? await readJson(option.plan) : store.merchantPlan().plan;
    if (command === 'prepare') {
      if (!option.out) throw new FeedError('NEW_OUTPUT_DIRECTORY_REQUIRED', 422);
      return output(await prepareWebhookFeedRelease({ store, plan, directory: option.out, stateEnv: option['state-env'] ?? 'STARFORGE_WEBHOOK_STATE' }));
    }
    if (!['receiver', 'merchant', 'workspace', 'run'].includes(command)) throw new FeedError('UNKNOWN_COMMAND', 422);
    const result = { schema: 'stellar-forge.webhook-feed-session.v1', storeId: store.storeId };
    if (['receiver', 'run'].includes(command)) {
      const receiver = await startWebhookReceiver({ store, port: integer(command === 'receiver' ? option.port : option['receiver-port'], 'receiver-port', 0, 65535, 8491) });
      sessions.push(receiver); result.receiver = receiver.url;
    }
    if (['merchant', 'run'].includes(command)) {
      const merchant = await startWebhookFeedMerchant({ store, plan,
        port: integer(command === 'merchant' ? option.port : option['merchant-port'], 'merchant-port', 0, 65535, 8492),
        nativeFactory: await nativeFactoryFor(option.facilitator, option['allow-local-facilitator']) });
      sessions.push(merchant); result.merchant = { url: merchant.url, mode: merchant.mode, feeds: merchant.feeds };
    }
    if (['workspace', 'run'].includes(command)) {
      const workspace = await startWebhookFeedWorkspace({ store, port: integer(command === 'workspace' ? option.port : option['workspace-port'], 'workspace-port', 0, 65535, 8493) });
      sessions.push(workspace); result.workspace = workspace.url;
    }
    let closing;
    const close = () => closing ??= (async () => { for (const session of [...sessions].reverse()) await session.close(); store.close(); })();
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => close().catch(() => { process.exitCode = 1; }));
    keepOpen = true; await output(result);
    return { store, sessions, result, close };
  } finally {
    if (!keepOpen) { for (const session of [...sessions].reverse()) await session.close(); store.close(); }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  process.stderr.write(JSON.stringify({ error: error instanceof FeedError ? error.code : error.code ?? 'WEBHOOK_FEED_COMMAND_FAILED',
    ...(error instanceof FeedError ? error.details : {}) }) + '\n'); process.exitCode = 1;
});
