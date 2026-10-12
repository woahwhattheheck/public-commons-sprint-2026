// MIT. Complete remote client for the original RSS/Atom/OPML merchant workspace.
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { openMerchantFileClient } from './retained-download.mjs';
import { downloadFeedsDelivery, inspectFeedsDelivery, reopenFeedsDelivery } from './feeds-download.mjs';
import { FEEDS_MANIFEST_NAME, parseFeedsDeliveryManifest } from './feeds-manifest.mjs';
import {
  FEEDS_CLIENT_TOOLS, MAX_FEEDS_RESPONSE_BYTES, createFeedsRequest, validateFeedsRequest,
  readFeedsRequest, writeFeedsRequest, retainFeedsRequest, inspectFeedsRequest, withFeedsRequest,
  feedsClientAlias, feedsClientEndpoint, feedsClientFailure as fail, feedsClientSha,
  feedsClientInteger, feedsClientInput, feedsClientDirectory, plainFeedsObject as plain,
  readFeedsPrivateFile, readFeedsPrivateJson,
} from './feeds-workspace-request.mjs';
export { FEEDS_CLIENT_TOOLS, createFeedsRequest, readFeedsRequest, writeFeedsRequest,
  retainFeedsRequest, inspectFeedsRequest, downloadFeedsDelivery, inspectFeedsDelivery, reopenFeedsDelivery };

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const DIRECT_PAGES = new Set(['captures', 'review', 'records', 'changes']);
const FILE_TOOLS = new Set(['merchant_feeds_download_manifest', 'merchant_feeds_download_file', 'merchant_feeds_download_file_release']);
const DEFAULT_TIMEOUT = 300000;
const timeout = value => feedsClientInteger(value, 1, 2147483647, 'request timeout in milliseconds');
const signalOf = signals => AbortSignal.any(signals.filter(value => value !== undefined && value !== null));
function scopeReply(value, workspace, name) {
  if (!plain(value) || name !== 'merchant_feeds_workspaces' && value.workspace !== workspace)
    throw fail('FEEDS_CLIENT_REPLY_SCOPE', 'The original tool reply belongs to a different workspace.');
  return value;
}
function operationSelection({ operationId, family = 'feed', jobId } = {}) {
  if (typeof operationId !== 'string' || !ID.test(operationId) || !['feed', 'collection'].includes(family))
    throw fail('FEEDS_CLIENT_INPUT', 'Select the original operation ID and feed or collection ledger family.');
  if (jobId !== undefined) feedsClientSha(jobId, 'accepted native job ID');
  return { operationId, family, ...(jobId ? { jobId } : {}) };
}
function selectOperation(value, selected) {
  if (!plain(value) || value.schema !== 'stellar-forge.feed-operation.v1' ||
      value.id !== selected.operationId || value.family !== selected.family ||
      !plain(value.request) || typeof value.historyOnly !== 'boolean' ||
      !['RESULT_RETAINED', 'INTENT_RETAINED'].includes(value.state))
    throw fail('FEEDS_CLIENT_OPERATION_CHANGED', 'The native ledger reply differs from its original selected operation.');
  return value;
}

/** One client owns its HTTP calls, local receiving and request-record leases. */
export class FeedsWorkspaceClient {
  #transport; #workspace; #lifetime; #timeout; #resultsDirectory;
  #controller = new AbortController(); #pending = new Set(); #cleanups = new Map();
  #closing = false; #close = null;
  constructor(transport, { workspace, signal, timeoutMs = DEFAULT_TIMEOUT, resultsDirectory } = {}) {
    if (!transport || typeof transport.call !== 'function')
      throw fail('FEEDS_CLIENT_INPUT', 'Open the original merchant protocol client.');
    this.#transport = Object.freeze({ endpoint: feedsClientEndpoint(transport.endpoint), call: transport.call.bind(transport) });
    this.#workspace = feedsClientAlias(workspace); this.#timeout = timeout(timeoutMs);
    this.#lifetime = signal; this.#resultsDirectory = resultsDirectory;
  }
  get endpoint() { return this.#transport.endpoint; }
  get workspace() { return this.#workspace; }
  get closing() { return this.#closing; }
  #remember(error) {
    if (typeof error?.close === 'function' && !this.#cleanups.has(error.close))
      this.#cleanups.set(error.close, () => error.close());
  }
  #run(options = {}, action) {
    if (this.#closing) return Promise.reject(fail('FEEDS_CLIENT_CLOSING', 'The feed client is closing.'));
    const signal = signalOf([this.#controller.signal, this.#lifetime, options.signal]);
    const pending = Promise.resolve().then(() => { signal.throwIfAborted(); return action(signal); })
      .catch(error => { this.#remember(error); throw error; });
    this.#pending.add(pending);
    return pending.finally(() => this.#pending.delete(pending));
  }
  async #tool(name, args, signal, options = {}) {
    const value = await this.#transport.call(name, args,
      { requestSignal: signal, timeoutMs: timeout(options.timeoutMs ?? this.#timeout) });
    return scopeReply(value, this.#workspace, name);
  }
  #files(signal, options = {}) {
    return Object.freeze({ endpoint: this.endpoint, call: async (name, args, callOptions = {}) => {
      if (!FILE_TOOLS.has(name) || args.workspace !== undefined && args.workspace !== this.#workspace)
        throw fail('FEEDS_CLIENT_SCOPE', 'Select an original file tool in this workspace.');
      // The original downloader releases a read after abort, with its own
      // two-second deadline. Keep that cleanup inside the accepted transfer.
      const release = name === 'merchant_feeds_download_file_release' && callOptions.requestSignal === null;
      const selected = release ? null : signalOf([signal, callOptions.requestSignal]);
      const { workspace: ignored, ...input } = args;
      return this.#tool(name, feedsClientInput(name, input, this.#workspace), selected,
        { timeoutMs: callOptions.timeoutMs ?? options.timeoutMs });
    } });
  }
  async #directory(reply, options) {
    if (options.directory !== undefined) return options.directory;
    const selected = options.resultsDirectory ?? this.#resultsDirectory;
    if (selected === undefined)
      throw fail('FEEDS_CLIENT_RESULT_DIRECTORY', 'Select resultsDirectory or a private delivery directory for the complete original result.');
    const root = await feedsClientDirectory(selected, true);
    return join(root, feedsClientSha(reply.completeResult?.exportId, 'complete result export ID'));
  }
  async #complete(reply, options, signal) {
    scopeReply(reply, this.#workspace, 'merchant_feeds_read');
    if (Object.hasOwn(reply, 'native')) return { workspace: this.#workspace, native: reply.native, delivery: null };
    const info = reply.completeResult;
    if (!plain(info) || info.state !== 'MANIFEST_RETAINED' || info.workspace !== this.#workspace || info.kind !== 'result' ||
        !Array.isArray(info.files) || info.files.length !== 1 || info.files[0]?.name !== 'result.json' ||
        info.manifestFile?.name !== FEEDS_MANIFEST_NAME)
      throw fail('FEEDS_CLIENT_COMPLETE_RESULT', 'Resolve the complete original native reply or its retained result.json delivery.');
    feedsClientInteger(info.files[0].bytes, 1, MAX_FEEDS_RESPONSE_BYTES, 'complete native JSON byte count');
    feedsClientSha(info.files[0].sha256, 'complete native JSON SHA256');
    feedsClientInteger(info.manifestFile.bytes, 1, 65000, 'original manifest byte count');
    const digest = feedsClientSha(info.manifestSha256, 'native result manifest SHA256');
    if (info.manifestFile.sha256 !== digest) throw fail('FEEDS_CLIENT_COMPLETE_RESULT', 'The native result has a different manifest identity.');
    const directory = await this.#directory(reply, options);
    const saved = await downloadFeedsDelivery({ workspace: this.#workspace, client: this.#files(signal, options),
      exportId: feedsClientSha(info.exportId, 'native result export ID'), directory,
      expectedManifestSha256: digest, signal, chunkSize: options.chunkSize, onProgress: options.onProgress });
    const manifestBytes = await readFeedsPrivateFile(join(saved.directory, FEEDS_MANIFEST_NAME), 65000,
      { signal, expectedSha256: digest, expectedBytes: info.manifestFile.bytes });
    const manifest = parseFeedsDeliveryManifest(manifestBytes, info.exportId), file = manifest.files[0];
    if (manifest.workspace !== this.#workspace || manifest.kind !== 'result' || manifest.files.length !== 1 ||
        file.name !== 'result.json' || file.bytes !== info.files[0].bytes || file.sha256 !== info.files[0].sha256)
      throw fail('FEEDS_CLIENT_COMPLETE_RESULT', 'The retained native JSON differs from the selected response.');
    const native = await readFeedsPrivateJson(join(saved.directory, file.name), MAX_FEEDS_RESPONSE_BYTES,
      { signal, expectedSha256: file.sha256, expectedBytes: file.bytes });
    return { workspace: this.#workspace, native, delivery: { ...saved, manifest, resultPath: join(saved.directory, file.name) } };
  }
  call(name, input = {}, options = {}) {
    const args = feedsClientInput(name, input, this.#workspace);
    return this.#run(options, signal => this.#tool(name, args, signal, options));
  }
  workspaces(options) { return this.call('merchant_feeds_workspaces', {}, options); }
  status(options) { return this.call('merchant_feeds_status', {}, options); }
  inventory(input, options) { return this.call('merchant_feeds_inventory', input, options); }
  read(input, options) { return this.call('merchant_feeds_read', input, options); }
  action(action, input, options) { return this.call('merchant_feeds_action', { action, input }, options); }
  register(input, options) { return this.action('register', input, options); }
  capture(input, options) { return this.action('capture', input, options); }
  resume(input, options) { return this.action('resume', input, options); }
  apply(input, options) { return this.action('apply', input, options); }
  annotate(input, options) { return this.action('annotate', input, options); }
  edition(input, options) { return this.action('edition', input, options); }
  query(input, options) { return this.action('query', input, options); }
  compare(input, options) { return this.action('compare', input, options); }
  saveCollection(input, options) { return this.action('collection-save', input, options); }
  captureCollection(input, options) { return this.action('collection-capture', input, options); }
  resumeCollection(input, options) { return this.action('collection-resume', input, options); }
  collectionEdition(input, options) { return this.action('collection-edition', input, options); }
  intake(input, options) { return this.call('merchant_feeds_intake', input, options); }
  cancel(jobId, options) { return this.call('merchant_feeds_cancel', { jobId }, options); }
  export(input, options) { return this.call('merchant_feeds_export', input, options); }
  exports(input = {}, options) { return this.call('merchant_feeds_exports', input, options); }
  receive(input, options) { return this.call('merchant_feeds_receive', input, options); }
  preparePublisher(input, options) { return this.call('merchant_feeds_publisher_prepare', input, options); }
  publishers(input = {}, options) { return this.call('merchant_feeds_publishers', input, options); }
  publisher(productId, action, input = {}, options) {
    return this.call('merchant_feeds_publisher', { productId, action, input }, options);
  }
  publisherExport(input, options) { return this.call('merchant_feeds_publisher_export', input, options); }
  manifest(exportId, options) { return this.call('merchant_feeds_download_manifest', { exportId }, options); }
  readFile(input, options) { return this.call('merchant_feeds_download_file', input, options); }
  releaseFile(input, options) { return this.call('merchant_feeds_download_file_release', input, options); }
  resolveResult(reply, options = {}) { return this.#run(options, signal => this.#complete(reply, options, signal)); }
  inspectDelivery(input, options = {}) {
    return this.#run(options, signal => inspectFeedsDelivery({ ...input, workspace: this.#workspace,
      client: this.#files(signal, options), url: undefined, signal }));
  }
  downloadDelivery(input, options = {}) {
    return this.#run(options, signal => downloadFeedsDelivery({ ...input, workspace: this.#workspace,
      client: this.#files(signal, options), url: undefined, signal }));
  }
  reopenDelivery(input, options = {}) {
    return this.#run(options, signal => reopenFeedsDelivery({ ...input, workspace: this.#workspace, signal }));
  }
  /** The same native export operation is followed by all complete original files. */
  exportAndDownload(input, receiving, options = {}) {
    const args = feedsClientInput('merchant_feeds_export', input, this.#workspace);
    return this.#run(options, async signal => {
      const exported = await this.#tool('merchant_feeds_export', args, signal, options);
      if (exported.state !== 'MANIFEST_RETAINED') throw fail('FEEDS_CLIENT_EXPORT', 'The original export has not retained its complete manifest.');
      const download = await downloadFeedsDelivery({ ...receiving, workspace: this.#workspace,
        client: this.#files(signal, options), url: undefined, exportId: exported.exportId,
        expectedManifestSha256: exported.manifestSha256, signal });
      return { workspace: this.#workspace, exported, download };
    });
  }
  /** Receive the acquisition manifest, CSV, JSONL and review of one saved customer. */
  customerAndDownload(input, receiving, options = {}) {
    const args = feedsClientInput('merchant_feeds_publisher_export', { ...input, kind: 'customer' }, this.#workspace);
    return this.#run(options, async signal => {
      const exported = await this.#tool('merchant_feeds_publisher_export', args, signal, options);
      if (exported.state !== 'MANIFEST_RETAINED' || exported.kind !== 'publisher-customer' ||
          !Array.isArray(exported.files) || exported.files.length !== 4 ||
          exported.selection?.productId !== input.productId || exported.selection?.id !== input.id)
        throw fail('FEEDS_CLIENT_CUSTOMER_FILES', 'Receive the original customer’s complete four-file acquisition.');
      const download = await downloadFeedsDelivery({ ...receiving, workspace: this.#workspace,
        client: this.#files(signal, options), url: undefined, exportId: exported.exportId,
        expectedManifestSha256: exported.manifestSha256, signal });
      return { workspace: this.#workspace, exported, download };
    });
  }
  async *#pages(tool, input, options, snapshots, inline = false) {
    let offset = feedsClientInteger(input.offset ?? 0, 0, Number.MAX_SAFE_INTEGER, 'native page offset');
    const limit = feedsClientInteger(input.limit ?? 50, 1, 250, 'native page limit');
    let snapshot = input.expectedSnapshot, count = 0;
    if (options.maxPages !== undefined) feedsClientInteger(options.maxPages, 1, Number.MAX_SAFE_INTEGER, 'selected page count');
    while (true) {
      const args = { ...input, offset, limit, ...(snapshots && snapshot ? { expectedSnapshot: snapshot } : {}) };
      const reply = await this.call(tool, args, options);
      const complete = inline ? { workspace: this.#workspace, native: reply, delivery: null }
        : await this.resolveResult(reply, { ...options, directory: undefined });
      const page = complete.native;
      if (!plain(page) || !Object.hasOwn(page, 'nextOffset') ||
          page.offset !== undefined && page.offset !== offset)
        throw fail('FEEDS_CLIENT_PAGE', 'The original response does not contain this selected native page.');
      if (snapshots) {
        feedsClientSha(page.snapshot, 'original page snapshot');
        if (snapshot !== undefined && page.snapshot !== snapshot)
          throw fail('FEEDS_CLIENT_PAGE_CHANGED', 'The original page snapshot changed during receiving.');
        snapshot = page.snapshot;
      }
      const next = page.nextOffset;
      if (next !== null && (!Number.isSafeInteger(next) || next <= offset ||
          page.total !== undefined && next > page.total))
        throw fail('FEEDS_CLIENT_PAGE', 'The original nextOffset did not advance within its native result.');
      yield complete; count++;
      if (next === null || options.maxPages !== undefined && count >= options.maxPages) return;
      offset = next;
    }
  }
  inventoryPages(input, options = {}) { return this.#pages('merchant_feeds_inventory', input, options, true); }
  readPages(input, options = {}) {
    if (!plain(input)) throw fail('FEEDS_CLIENT_INPUT', 'Select an original native read.');
    const direct = DIRECT_PAGES.has(input.kind);
    if (direct && (input.expectedSnapshot !== undefined || input.array !== undefined))
      throw fail('FEEDS_CLIENT_INPUT', 'This native live page uses its own nextOffset; omit array and expectedSnapshot.');
    if (!direct && input.kind !== 'requests' && !input.array)
      throw fail('FEEDS_CLIENT_INPUT', 'Select an original response array for snapshot pagination.');
    return this.#pages('merchant_feeds_read', input, options, !direct);
  }
  exportPages(input = {}, options = {}) { return this.#pages('merchant_feeds_exports', input, options, true, true); }
  operation(input, options) {
    const selected = operationSelection(input);
    return this.read({ kind: 'operation', id: selected.operationId, family: selected.family }, options);
  }
  async #status(options, signal) {
    const reply = await this.#tool('merchant_feeds_status', feedsClientInput('merchant_feeds_status', {}, this.#workspace), signal, options);
    const resolved = await this.#complete(reply, options, signal);
    if (!plain(resolved.native) || !plain(resolved.native.activity))
      throw fail('FEEDS_CLIENT_ACTIVITY', 'Read the original feed console’s actual worker state.');
    return resolved;
  }
  async #operation(selected, options, signal) {
    const reply = await this.#tool('merchant_feeds_read', feedsClientInput('merchant_feeds_read',
      { kind: 'operation', id: selected.operationId, family: selected.family }, this.#workspace), signal, options);
    const resolved = await this.#complete(reply, options, signal);
    return { ...resolved, native: selectOperation(resolved.native, selected) };
  }
  waitForOperation(input, options = {}) {
    const selected = operationSelection(input), pollMs = feedsClientInteger(options.pollMs ?? 1000, 250, 60000, 'poll interval');
    const waitMs = timeout(options.maximumWaitMs ?? 1800000);
    return this.#run(options, async admittedSignal => {
      const signal = signalOf([admittedSignal, AbortSignal.timeout(waitMs)]);
      while (true) {
        const status = await this.#status(options, signal), activity = status.native.activity;
        let state, operation = null;
        if (activity.state === 'RUNNING') {
          const same = selected.jobId ? activity.id === selected.jobId : activity.operationId === selected.operationId &&
            (String(activity.action).startsWith('collection-') ? 'collection' : 'feed') === selected.family;
          state = same ? 'RUNNING' : 'CONSOLE_BUSY';
        }
        else if (selected.jobId && activity.id === selected.jobId && activity.state === 'FAILED') state = 'JOB_FAILED';
        else {
          try { operation = await this.#operation(selected, options, signal); }
          catch (error) { if (error.code !== 'FEEDS_CONSOLE_HTTP_404') throw error; }
          state = !operation ? 'OPERATION_NOT_FOUND' : operation.native.historyOnly ? 'HISTORY_RETAINED'
            : operation.native.state === 'RESULT_RETAINED' ? 'RESULT_RETAINED'
            : operation.native.continuation ? 'CONTINUATION_AVAILABLE' : 'INTENT_RETAINED';
        }
        const result = { schema: 'stellar-forge.feeds-client-operation.v1', workspace: this.#workspace,
          selection: selected, state, activity, operation: operation?.native ?? null,
          deliveries: [status.delivery, operation?.delivery].filter(Boolean) };
        await options.onActivity?.(result);
        if (activity.state !== 'RUNNING') return result;
        await pause(pollMs, undefined, { signal });
      }
    });
  }
  waitForJob(jobId, options = {}) {
    feedsClientSha(jobId, 'accepted native job ID');
    const pollMs = feedsClientInteger(options.pollMs ?? 1000, 250, 60000, 'poll interval');
    const waitMs = timeout(options.maximumWaitMs ?? 1800000);
    return this.#run(options, async admittedSignal => {
      const signal = signalOf([admittedSignal, AbortSignal.timeout(waitMs)]);
      while (true) {
        const status = await this.#status(options, signal), activity = status.native.activity;
        const result = { schema: 'stellar-forge.feeds-client-job.v1', workspace: this.#workspace,
          jobId, state: activity.id === jobId ? activity.state : 'JOB_NO_LONGER_CURRENT',
          activity, delivery: status.delivery };
        await options.onActivity?.(result);
        if (activity.id !== jobId || activity.state !== 'RUNNING') return result;
        await pause(pollMs, undefined, { signal });
      }
    });
  }
  prepare(tool, input = {}, { recovery } = {}) {
    return createFeedsRequest({ endpoint: this.endpoint, workspace: this.#workspace, tool, input, recovery });
  }
  #selectedRequest(request) {
    const selected = validateFeedsRequest(request);
    if (selected.workspace !== this.#workspace || selected.endpoint !== this.endpoint)
      throw fail('FEEDS_CLIENT_REQUEST_SCOPE', 'Connect the exact endpoint and workspace of the original prepared request.');
    return selected;
  }
  /** Persist the original invocation first; an ambiguous reply requires explicit repeat. */
  execute(request, options = {}) {
    request = this.#selectedRequest(request);
    if (options.repeat !== undefined && typeof options.repeat !== 'boolean')
      throw fail('FEEDS_CLIENT_INPUT', 'repeat must explicitly select the unchanged original request.');
    return this.#run(options, signal => withFeedsRequest({ directory: options.directory, request, signal }, async record => {
      if (record.response) return inspectFeedsRequest({ directory: record.directory, signal });
      if (record.invocation && options.repeat !== true) {
        const error = fail('FEEDS_CLIENT_RECONCILE_REQUEST', 'Read the original operation and accepted worker before explicitly repeating this saved request.');
        error.record = { directory: record.directory, state: record.state, requestSha256: request.requestSha256 };
        throw error;
      }
      record.assertHeld(); await record.markInvocation();
      const reply = await this.#tool(request.tool, request.arguments, signal, options);
      record.assertHeld(); return record.retainResponse(reply);
    }));
  }
  /** Read original native observations without changing the saved client response. */
  reconcile({ directory, ...options } = {}) {
    return this.#run(options, async signal => {
      const record = await inspectFeedsRequest({ directory, signal }), request = this.#selectedRequest(record.request);
      const status = await this.#status(options, signal);
      let operation = null, publisher = null;
      if (status.native.activity.state !== 'RUNNING' && request.recovery) {
        try { operation = await this.#operation(operationSelection(request.recovery), options, signal); }
        catch (error) { if (error.code !== 'FEEDS_CONSOLE_HTTP_404') throw error; }
      }
      if (status.native.activity.state !== 'RUNNING' && request.arguments.productId) {
        const reply = await this.#tool('merchant_feeds_publishers', feedsClientInput('merchant_feeds_publishers',
          { productId: request.arguments.productId }, this.#workspace), signal, options);
        publisher = await this.#complete(reply, options, signal);
      }
      return { schema: 'stellar-forge.feeds-client-reconciliation.v1', workspace: this.#workspace,
        state: 'NATIVE_OBSERVATION', directory: record.directory, recordState: record.state, request,
        invocation: record.invocation, response: record.response, activity: status.native.activity,
        operation: operation?.native ?? null, publisher: publisher?.native ?? null,
        deliveries: [status.delivery, operation?.delivery, publisher?.delivery].filter(Boolean) };
    });
  }
  requestClose() {
    this.#closing = true;
    if (!this.#controller.signal.aborted)
      this.#controller.abort(fail('FEEDS_CLIENT_CLOSING', 'The feed client is closing.'));
  }
  close() {
    this.requestClose();
    if (this.#close) return this.#close;
    this.#close = (async () => {
      await Promise.allSettled([...this.#pending]);
      const failures = [];
      for (const [key, close] of this.#cleanups) {
        try { await close(); this.#cleanups.delete(key); } catch (error) { failures.push(error); }
      }
      if (failures.length) throw new AggregateError(failures, 'Original feed client owners require their same close continuation.');
    })().catch(error => { this.#close = null; throw error; });
    return this.#close;
  }
}

export async function openFeedsWorkspaceClient({ url, client, workspace, tokenEnv, environment, signal,
  timeoutMs = DEFAULT_TIMEOUT, resultsDirectory, maximumResponseBytes = 2 * 1024 * 1024 } = {}) {
  feedsClientAlias(workspace); timeout(timeoutMs); signal?.throwIfAborted();
  if (client !== undefined && (url !== undefined || !client || typeof client.call !== 'function'))
    throw fail('FEEDS_CLIENT_INPUT', 'Select one original protocol client or its MCP URL.');
  const transport = client ?? await openMerchantFileClient({ url, tokenEnv, environment, signal,
    maximumResponseBytes, errorPrefix: 'FEEDS', clientName: 'starforge-feeds-workspace' });
  feedsClientEndpoint(transport.endpoint);
  return new FeedsWorkspaceClient(transport, { workspace, signal, timeoutMs, resultsDirectory });
}
