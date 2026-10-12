// MIT. Typed merchant caller and complete publisher download through the shared retained transport.
import { setTimeout as delay } from 'node:timers/promises';
import { createRetainedDownload, openMerchantFileClient } from './retained-download.mjs';
import { PUBLISHER_MANIFEST_NAME, PUBLISHER_MAX_FILE, PUBLISHER_MAX_MANIFEST, PUBLISHER_SHA, PUBLISHER_ALIAS,
  check, counter, digest, encode, failure, parsePublisherManifest } from './360giving-contract.mjs';

const receiver = createRetainedDownload({
  manifestName: PUBLISHER_MANIFEST_NAME, parseManifest: parsePublisherManifest,
  maximumBytes: PUBLISHER_MAX_FILE, maximumManifestBytes: PUBLISHER_MAX_MANIFEST, maximumCheckpointBytes: PUBLISHER_MAX_MANIFEST,
  stateSchema: 'stellar-forge.360giving-merchant-download-state.v1', resultSchema: 'stellar-forge.360giving-merchant-download.v1',
  toolPrefix: 'merchant_360giving', errorPrefix: 'PUBLISHER360', clientName: 'starforge-360giving-publisher',
  validateExportId: value => check(value, PUBLISHER_SHA, 'complete publisher export ID'),
  describe: value => ({ workspace: value.workspace, kind: value.kind, selection: value.selection })
});

/** Borrow the original authenticated MCP listener and fix every call to one declared publisher alias. */
export async function open360GivingMerchantClient({ workspace, signal, ...options } = {}) {
  check(workspace, PUBLISHER_ALIAS, 'workspace alias');
  const lifetime = new AbortController(), pending = new Set(), admissions = new Map(); let closed = false;
  const mutations = new Set(['intake','decisions','candidate','build','compare','export','receive','resume'].map(name => 'merchant_360giving_' + name));
  const combined = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
  const original = await openMerchantFileClient({ ...options, signal: combined, errorPrefix: 'PUBLISHER360',
    clientName: 'starforge-360giving-publisher', maximumResponseBytes: 128 * 1024 * 1024 });
  const client = {
    workspace, endpoint: original.endpoint + '#publisher-360giving=' + workspace,
    async call(name, args = {}, requestOptions = {}) {
      const releasing = name === 'merchant_360giving_file_release';
      if (closed && !releasing) throw failure('CLIENT_CLOSED', 'The borrowed merchant client is closed.');
      if (!name.startsWith('merchant_360giving_') || args.workspace !== undefined && args.workspace !== workspace)
        throw failure('CLIENT_SELECTION', 'Use this client for its original configured publisher.');
      const selectedSignal = requestOptions.requestSignal === null && releasing ? null :
        requestOptions.requestSignal ? AbortSignal.any([combined, requestOptions.requestSignal]) : combined;
      const task = original.call(name, name === 'merchant_360giving_workspaces' ? {} : { ...args, workspace },
        { ...requestOptions, requestSignal: selectedSignal });
      pending.add(task);
      try {
        const result = await task, record = result.request;
        if (mutations.has(name) && record?.status === 'interrupted') admissions.set(record.id, digest(encode(record)));
        else if (mutations.has(name) && record?.id) admissions.delete(record.id);
        return result;
      } finally { pending.delete(task); }
    },
    async close() {
      closed = true; lifetime.abort(failure('CLIENT_CLOSED', 'The borrowed merchant client is closing.'));
      await Promise.allSettled([...pending]);
    }
  };
  for (const [method, tool] of Object.entries({
    workspaces: 'workspaces', status: 'status', inventory: 'inventory', review: 'review', upload: 'upload', uploadText: 'upload_text',
    intake: 'intake', decisions: 'decisions', candidate: 'candidate', build: 'build', query: 'query', compare: 'compare',
    changes: 'changes', export: 'export', changesExport: 'changes_export', exports: 'exports', manifest: 'manifest',
    file: 'file', fileRelease: 'file_release', receive: 'receive'
  })) client[method] = (args = {}, requestOptions) => client.call('merchant_360giving_' + tool, args, requestOptions);
  client.request = (requestId, requestOptions) => client.call('merchant_360giving_request', { requestId }, requestOptions);
  client.resume = (requestId, requestOptions) => client.call('merchant_360giving_resume', { requestId }, requestOptions);
  client.wait = (requestId, { timeoutMs = 240000, pollMs = 500, signal: waitSignal } = {}) => {
    const task = (async () => {
      counter(timeoutMs, 'Original request wait', 900000); counter(pollMs, 'Poll interval', 60000);
      if (!timeoutMs || !pollMs) throw failure('INVALID_PARAMS', 'Use positive original request wait and poll intervals.');
      const waiting = waitSignal ? AbortSignal.any([combined, waitSignal]) : combined;
      const deadline = Date.now() + timeoutMs; let latest;
      try {
        for (;;) {
          waiting.throwIfAborted();
          const result = await client.request(requestId, { requestSignal: waiting,
            timeoutMs: Math.min(120000, Math.max(1, deadline - Date.now())) });
          const record = result.request; latest = record;
          if (record?.id !== requestId) throw failure('REQUEST_CHANGED', 'The merchant returned another saved request.');
          if (record.status === 'complete') { admissions.delete(requestId); return result; }
          if (record.status === 'interrupted') {
            if (admissions.get(requestId) !== digest(encode(record)))
              throw failure('REQUEST_INTERRUPTED', record.error?.message ?? 'Resume this original saved publisher request.');
          } else {
            if (!['pending','running'].includes(record.status))
              throw failure('REQUEST_CHANGED', 'The original request has an unknown saved state.');
            admissions.delete(requestId);
          }
          if (Date.now() >= deadline)
            throw failure('REQUEST_PENDING', 'The original publisher request is still accepted; continue this same request ID.');
          await delay(Math.min(pollMs, deadline - Date.now()), undefined, { signal: waiting });
        }
      } catch (error) {
        if (!(error instanceof Error)) error = Object.assign(failure('REQUEST_INTERRUPTED', 'The original request wait was interrupted.'), { cause: error });
        error.requestId ??= requestId; if (latest) error.record ??= latest; throw error;
      }
    })();
    pending.add(task); task.finally(() => pending.delete(task)).catch(() => {}); return task;
  };
  return Object.freeze(client);
}
async function withClient(options, operation) {
  const { client: supplied, workspace, url, tokenEnv, environment, signal, ...selection } = options;
  if (supplied && (url !== undefined || workspace !== undefined && supplied.workspace !== workspace))
    throw failure('CLIENT_SELECTION', 'Supply one original scoped merchant client or its endpoint and publisher alias.');
  const client = supplied ?? await open360GivingMerchantClient({ workspace, url, tokenEnv, environment, signal });
  if (!client || typeof client.call !== 'function' || typeof client.endpoint !== 'string' || !PUBLISHER_ALIAS.test(client.workspace ?? ''))
    throw failure('CLIENT_SELECTION', 'Use the original publisher-scoped merchant client.');
  try { return await operation({ ...selection, signal, client }); } finally { if (!supplied) await client.close(); }
}
/** Receive every original file. Reuse the same directory to resume a durable verified prefix. */
export function download360GivingExport(options = {}) { return withClient(options, selected => receiver.download(selected)); }
/** Read the complete source-bound manifest without creating another native export or local download. */
export function inspect360GivingExport(options = {}) { return withClient(options, selected => receiver.inspect(selected)); }
