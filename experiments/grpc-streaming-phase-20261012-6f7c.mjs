// MIT. Streaming phases inside the ORIGINAL reflected-endpoint receiving operation.
// Imports this module; it never registers a worker, launches a browser or owns a second workspace.
import { open, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';

const METHOD = '/commons.reflection.v1.Ledger/Watch';
const PREFIX = 'stellar/scf-starforge-20261009/';
const MINIMUM = -9223372036854775808n;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const need = (value, message) => { if (!value) throw new Error(message); };
const imported = (root, path) => import(pathToFileURL(join(root, path)).href);

/** The reflection owner supplies its actual mTLS/metadata admission and AccountReply.
 * It registers this callback beside Get on the SAME reflected native Ledger service. */
export function createGrpcStreamingHandler({ grpc, authorized, response, nativeCalls }) {
  need(typeof authorized === 'function' && typeof response === 'function' && Array.isArray(nativeCalls),
    'Use the original reflected service authorization, response and native-call journal.');
  return function watch(call) {
    if (!authorized(call)) {
      call.emit('error', { code: grpc.status.UNAUTHENTICATED, details: 'Original native authorization required.' });
      return;
    }
    const mode = call.request.stream_mode || 'ok';
    if (!['ok', 'error', 'cancel'].includes(mode)) {
      call.emit('error', { code: grpc.status.INVALID_ARGUMENT, details: 'Choose ok, error or cancel in this native example.' });
      return;
    }
    const observed = { method: METHOD, input: structuredClone(call.request), mode, emitted: 0, cancelled: false };
    nativeCalls.push(observed);
    const controller = new AbortController();
    const cancelled = () => { observed.cancelled = true; controller.abort(); };
    call.once('cancelled', cancelled);
    void (async () => {
      const count = mode === 'ok' ? 4 : 2;
      for (let index = 0; index < count; index++) {
        controller.signal.throwIfAborted();
        const value = { ...response(call), sequence: String(MINIMUM + BigInt(index)) };
        if (!call.write(value)) await new Promise((resolve, reject) => {
          const finish = issue => {
            call.off('drain', drained); call.off('error', failed);
            controller.signal.removeEventListener('abort', aborted);
            issue ? reject(issue) : resolve();
          };
          const drained = () => finish(), failed = issue => finish(issue);
          const aborted = () => finish(new Error('Original native stream cancelled.'));
          call.once('drain', drained); call.once('error', failed);
          controller.signal.addEventListener('abort', aborted, { once: true });
          if (controller.signal.aborted) aborted();
        });
        observed.emitted++;
        await pause(20, undefined, { signal: controller.signal });
      }
      if (mode === 'error') {
        observed.sentStatus = 'UNAVAILABLE';
        call.emit('error', { code: grpc.status.UNAVAILABLE, details: 'Deliberate original native incomplete stream.' });
      } else if (mode === 'cancel') {
        // The operator's original cancel action, not a synthetic local end, closes this RPC.
        await pause(300000, undefined, { signal: controller.signal });
      } else { observed.sentStatus = 'OK'; call.end(); }
    })().catch(issue => {
      if (!controller.signal.aborted) {
        observed.failure = issue.message;
        call.emit('error', { code: grpc.status.INTERNAL, details: 'Native stream example failed.' });
      }
    }).finally(() => { observed.finished = true; call.off('cancelled', cancelled); });
  };
}

function workspaceApi(workspace) {
  const selected = new URL(workspace.url);
  return async (action, body, options = {}) => {
    const response = await fetch(selected.origin + '/api/' + action, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: options.signal,
      headers: { origin: selected.origin, 'x-workspace-token': selected.hash.slice(1),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error('Original workspace ' + action + ': ' + response.status + ' ' + await response.text());
    return response.json();
  };
}
async function fileInfo(path) {
  const handle = await open(path, 'r'), hash = createHash('sha256'), buffer = Buffer.alloc(65536);
  let bytes = 0;
  try {
    const expected = (await handle.stat()).size;
    while (bytes < expected) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, expected - bytes), bytes);
      need(bytesRead > 0, 'The original retained file ended during readback.');
      hash.update(buffer.subarray(0, bytesRead)); bytes += bytesRead;
    }
    need((await handle.stat()).size === expected, 'The original retained file changed during readback.');
    return { bytes, sha256: hash.digest('hex') };
  } finally { await handle.close(); }
}
async function originalDownload(api, workspace, id, path, expected) {
  const ticket = await api('stream-download', { id }), target = new URL(ticket.url, workspace.origin);
  need(target.origin === workspace.origin && ticket.sha256 === expected.sha256 && ticket.bytes === expected.bytes &&
    ticket.complete === expected.complete, 'The original stream ticket changed its retained output binding.');
  const response = await fetch(target, { redirect: 'error' });
  need(response.ok && response.headers.get('x-content-sha256') === expected.sha256,
    'The exact retained stream download did not use its original digest.');
  const handle = await open(path, 'wx', 0o600), hash = createHash('sha256');
  let bytes = 0;
  try {
    for await (const chunk of response.body) {
      bytes += chunk.length; need(bytes <= expected.bytes, 'The original stream exceeded its retained byte count.');
      hash.update(chunk); await handle.writeFile(chunk);
    }
    await handle.sync();
  } finally { await handle.close(); }
  need(bytes === expected.bytes && hash.digest('hex') === expected.sha256, 'The original stream download changed bytes.');
  const consumed = await fetch(target, { redirect: 'error' }); await consumed.body?.cancel();
  need(consumed.status === 404, 'The original stream capability was reusable after its download.');
  return { file: path, bytes, sha256: expected.sha256, complete: expected.complete, consumedStatus: consumed.status };
}
function outputOf(value) {
  const output = value?.stream ?? value?.output;
  need(output?.type === 'grpc-ndjson' && output.terminalObserved && output.durable,
    'The original call has no durable native stream terminal.');
  return output;
}
function checkRows(rows, input, count) {
  need(rows.length === count, 'The original native stream has a different record count.');
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    need(row.account_id === input.account_id && row.sequence === String(MINIMUM + BigInt(index)) &&
      row.tags?.largest === '9223372036854775807' && row.tags?.smallest === '-9223372036854775808' &&
      Object.hasOwn(row, 'note') && row.note === '' && Object.keys(row.defaults ?? {}).length === 0 &&
      row.evidence === Buffer.from('native-reflected-contract').toString('base64'),
      'The original stream changed exact integer/map/optional/bytes/default values.');
  }
}
async function readRows(path, expected) {
  // The authored native example is four small records; production export above remains streamed.
  need(expected.bytes <= 65536, 'This original native example unexpectedly exceeds its declared small payload.');
  const bytes = await readFile(path);
  need(bytes.length === expected.bytes && digest(bytes) === expected.sha256 && bytes.at(-1) === 10,
    'The original NDJSON bytes/digest/final frame changed.');
  return bytes.toString('utf8').trimEnd().split('\n').filter(Boolean).map(row => JSON.parse(row));
}
async function waitForPrefix(path, minimumRecords) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const info = await stat(path);
      if (info.size > 0 && info.size <= 65536) {
        const bytes = await readFile(path);
        if (bytes.toString('utf8').split('\n').length - 1 >= minimumRecords) return;
      }
    } catch (issue) { if (issue.code !== 'ENOENT') throw issue; }
    await pause(25);
  }
  throw new Error('The original native cancellation call did not retain its two emitted records.');
}

/** Call after the original second revision AND complete seven-file customer receive.
 * Additional context: merchantUrl is the existing MCP server URL; nativeCalls is
 * the same array passed to createGrpcStreamingHandler. No new servers are registered. */
export async function runGrpcStreamingPhase({ call, phase, checkpoint, report, state, out, environment,
  sourceRoot, workspace, endpoint, grpc, merchantUrl, nativeCalls }) {
  need(state.secondRevision && state.customerExport && merchantUrl && Array.isArray(nativeCalls),
    'Run inside the original reflected revision/customer operation with its MCP URL and native-call journal.');
  const revision = state.secondRevision.revision, api = workspaceApi(workspace);
  const input = JSON.parse(await readFile(join(out, 'request.json'), 'utf8'));
  state.streaming ??= { revision, ids: { ok: randomUUID(), error: randomUUID(), cancel: randomUUID() }, calls: {} };
  const retained = state.streaming;
  need(retained.revision === revision, 'Keep the original selected streaming revision.');
  await checkpoint();
  await phase('original-native-grpc-stream-completion-failure-cancellation', async () => {
    const selected = await workspace.model.open({ revision });
    need(selected.methods.some(row => row.path === METHOD && row.responseStream && row.selectable) &&
      selected.source.limits.stream, 'The reviewed reflected merchant does not contain its explicitly bounded server stream.');
    for (const mode of ['ok', 'error', 'cancel']) {
      const id = retained.ids[mode], request = { ...input, stream_mode: mode };
      let result = await call('attempt', { operationId: id });
      if (result.state === 'NOT_FOUND') {
        const pending = call('call', { revision, operationId: id, method: METHOD, input: request });
        if (mode === 'cancel') {
          try {
            await waitForPrefix(join(workspace.model.stateDirectory, 'attempts', id + '.ndjson'), 2);
            const cancelled = await call('cancel_call', { operationId: id });
            need(cancelled.cancellationRequested, 'The operator did not cancel its original active call.');
          } catch (issue) {
            await call('cancel_call', { operationId: id }).catch(() => {});
            await pending.catch(() => {}); throw issue;
          }
        }
        result = await pending;
      }
      const count = mode === 'ok' ? 4 : 2, complete = mode === 'ok';
      const output = outputOf(result);
      need(output.complete === complete && output.records === count && output.grpcCode ===
        (mode === 'ok' ? grpc.status.OK : mode === 'error' ? grpc.status.UNAVAILABLE : grpc.status.CANCELLED) &&
        result.phase === (complete ? 'COMPLETED' : 'OUTCOME_UNCONFIRMED'),
        'The original native terminal/completion/cancellation classification changed for ' + mode + '.');
      const path = join(workspace.model.stateDirectory, 'attempts', id + '.ndjson');
      checkRows(await readRows(path, output), request, count);
      const before = nativeCalls.length;
      const repeated = await call('call', { revision, operationId: id, method: METHOD, input: request });
      const recovered = await call('attempt', { operationId: id });
      need(nativeCalls.length === before && repeated.responseSha256 === result.responseSha256 &&
        outputOf(recovered).sha256 === output.sha256,
        'Retained stream recovery dispatched another application RPC or changed the original bytes.');
      retained.calls[mode] = { id, revision, method: METHOD, input: request, phase: result.phase,
        responseSha256: result.responseSha256, output };
      await checkpoint();
    }
    return { revision, calls: retained.calls, originalNativeStreamCalls: nativeCalls.filter(row => row.method === METHOD),
      recoveryCallsDispatched: 0 };
  });
  await phase('original-grpc-stream-exact-operator-and-agent-receiving', async () => {
    const { downloadGrpcExport } = await imported(sourceRoot, 'stellar-forge/mcp-merchant-operator/grpc-workspace-download.mjs');
    const delivered = [];
    for (const mode of ['ok', 'error', 'cancel']) {
      const saved = retained.calls[mode], path = join(out, 'stream-' + mode + '.ndjson');
      try { await stat(path); need((await fileInfo(path)).sha256 === saved.output.sha256, 'An earlier native download changed.'); }
      catch (issue) { if (issue.code !== 'ENOENT') throw issue; await originalDownload(api, workspace, saved.id, path, saved.output); }
      const exported = await call('export', { kind: 'attempt', operationId: saved.id });
      const file = exported.files.find(row => row.path === 'grpc-stream.ndjson');
      need(exported.files.length === 2 && file?.sha256 === saved.output.sha256 && file.bytes === saved.output.bytes,
        'The original agent attempt export omitted the exact retained NDJSON.');
      const directory = join(out, 'stream-agent-' + mode);
      const received = await downloadGrpcExport({ url: merchantUrl, exportId: exported.exportId, directory,
        tokenEnv: 'GRPC_REFLECTION_MCP_TOKEN', environment, expectedManifestSha256: exported.manifestFile.sha256 });
      const repeated = await downloadGrpcExport({ url: merchantUrl, exportId: exported.exportId, directory,
        tokenEnv: 'GRPC_REFLECTION_MCP_TOKEN', environment, expectedManifestSha256: exported.manifestFile.sha256 });
      const metadata = JSON.parse(await readFile(join(directory, 'grpc-attempt.json'), 'utf8'));
      need(metadata.id === saved.id && metadata.responseSha256 === saved.responseSha256 &&
        outputOf(metadata).complete === saved.output.complete &&
        (await fileInfo(join(directory, 'grpc-stream.ndjson'))).sha256 === saved.output.sha256 &&
        received.exportId === repeated.exportId, 'The original resumable receiving changed its attempt, result or NDJSON.');
      checkRows(await readRows(path, saved.output), saved.input, saved.output.records);
      delivered.push({ mode, operationId: saved.id, exportId: exported.exportId,
        manifestSha256: exported.manifestFile.sha256, ...await fileInfo(path), complete: saved.output.complete });
    }
    retained.delivered = delivered; await checkpoint(); return { delivered };
  });
  await phase('original-native-sdk-paid-ndjson-customer-capture', async () => {
    if (retained.purchase) {
      const actual = await fileInfo(retained.purchase.saved.path);
      need(actual.sha256 === retained.purchase.saved.sha256 && actual.bytes === retained.purchase.saved.bytes,
        'The completed original native buyer output changed during continuation.');
      return retained.purchase;
    }
    need(!retained.purchaseStarted, 'The same local buyer attempt has no completed result; reconcile its retained output before continuing.');
    const { startGrpcMerchant } = await imported(sourceRoot, PREFIX + 'sf30-seller-sdk/grpc/merchant.mjs');
    const { createNativeSellerServer } = await imported(sourceRoot, PREFIX + 'sf30-seller-sdk/native-factory.mjs');
    const { X402BuyerClient } = await imported(sourceRoot, PREFIX + 'sf31-buyer-client/buyer.mjs');
    const { prepareBuyerResponseFile } = await imported(sourceRoot, PREFIX + 'sf31-buyer-client/response-file.mjs');
    const generated = await import(pathToFileURL(join(state.customerExport.customerDirectory, 'seller-client.mjs')).href);
    const methods = JSON.parse(await readFile(join(out, 'customer', 'methods.json'), 'utf8'));
    need(methods.routes['account-events']?.responseStream === true &&
      methods.routes['account-events'].responseFormat === 'ndjson',
      'The same seven-file customer contract lost its streaming response method.');
    const counters = { verifies: 0, settles: 0, approvals: 0, signatures: 0 };
    // Same explicit controlled-local SDK fixture as the completed original
    // ClickHouse native-flow.mjs. There is no authentic chain signature or receipt.
    const facilitatorClient = {
      async getSupported() { return { kinds: [{ x402Version: 2, scheme: 'exact', network: 'stellar:testnet' }],
        extensions: ['bazaar'], signers: {} }; },
      async verify() { counters.verifies++; return { isValid: true, payer: 'LOCAL_ACCEPTANCE_NO_WALLET' }; },
      async settle() { counters.settles++; return { success: true, network: 'stellar:testnet',
        transaction: 'LOCAL_ACCEPTANCE_NO_CHAIN', payer: 'LOCAL_ACCEPTANCE_NO_WALLET' }; },
    };
    const session = await startGrpcMerchant({
      directory: join(workspace.model.stateDirectory, 'prepared', state.ids.secondPreparation),
      env: environment, port: 0, operationsPort: 0, drainGraceMs: 2000,
      nativeFactory: compiled => createNativeSellerServer(compiled, { facilitatorClient }),
    });
    const destination = join(out, 'original-buyer-stream.ndjson');
    let writer;
    try {
      writer = await prepareBuyerResponseFile({ destination, maxBytes: 1048576, timeoutMs: 10000,
        stream: { format: 'ndjson', maxRecordBytes: 65536, maxRecords: 8 } });
      const client = new X402BuyerClient({ fetchImpl: (resource, options) => {
        const selected = new URL(resource); return fetch(session.url + selected.pathname + selected.search, options);
      } });
      const request = generated.buildRequest('account-events', { body: { ...input, stream_mode: 'ok' } },
        { intentId: 'grpc-stream-' + report.runId, maxAtomic: '25000' });
      retained.purchaseStarted = true; await checkpoint();
      const result = await client.call({ ...request, approve: async () => { counters.approvals++; return true; },
        sign: async ({ challenge, accepted }) => {
          counters.signatures++; return { ...challenge, accepted, payload: { acceptance: 'LOCAL_ONLY_NO_SIGNATURE' } };
        } });
      const rows = [], saved = await writer.save(result, { onRecord: row => { rows.push(row.value); } });
      need(result.status === 'PAYMENT_OUTCOME_UNKNOWN' && result.httpStatus === 200 &&
        saved.stream.complete && saved.stream.records === 4 && counters.verifies === 1 && counters.settles === 1 &&
        counters.approvals === 1 && counters.signatures === 1,
        'The original SDK stream/capture changed its controlled-local payment or exact native call count.');
      checkRows(rows, input, 4);
      retained.purchase = { status: result.status, httpStatus: result.httpStatus, reason: result.reason,
        attempts: result.attempts, counters, saved, chainTransactions: 0,
        paymentEnvironment: 'Original native SDK with explicit controlled-local facilitator; no blockchain signature, transfer or financial receipt.' };
      await checkpoint(); return retained.purchase;
    } finally { try { await writer?.abort(); } finally { await session.close(); } }
  });
  return retained;
}

/** Invoke on the parent's existing page after its own reflection editing checks.
 * These are read/download continuations of the original three calls, with no RPC. */
export async function runGrpcStreamingBrowserPhase({ page, phase, checkpoint, state, out, nativeCalls }) {
  need(state.streaming?.delivered?.length === 3, 'Complete the same native stream and receiving phases first.');
  return phase('original-browser-stream-history-and-exact-downloads', async () => {
    const before = nativeCalls.length, files = [];
    const idle = () => page.waitForFunction(() => !document.getElementById('refresh').disabled);
    for (const mode of ['ok', 'error', 'cancel']) {
      const saved = state.streaming.calls[mode];
      await page.locator('[data-view="history"]').click(); await idle();
      const card = page.locator('#attempts').locator(':scope > *').filter({ hasText: saved.id.slice(0, 12) });
      await card.getByRole('button', { name: 'Open retained outcome', exact: true }).click(); await idle();
      const status = await page.locator('#call-status').innerText();
      need(status.includes(saved.id) && status.includes(saved.output.sha256) &&
        status.includes(saved.output.complete ? 'Complete native stream' : 'Partial or unconfirmed stream'),
        'The original operator history changed its native complete/partial stream meaning.');
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download retained NDJSON', exact: true }).click();
      const download = await pending, path = join(out, 'browser-stream-' + mode + '.ndjson');
      await download.saveAs(path); await idle();
      const actual = await fileInfo(path);
      need(actual.bytes === saved.output.bytes && actual.sha256 === saved.output.sha256,
        'The browser download changed the original stream bytes.');
      files.push({ mode, ...actual, complete: saved.output.complete });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: join(out, 'grpc-stream-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    need(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      'The original stream outcome workspace overflowed its narrow viewport.');
    await page.screenshot({ path: join(out, 'grpc-stream-mobile.png'), fullPage: true });
    need(nativeCalls.length === before, 'Reading/downloading retained streams dispatched another native application RPC.');
    state.streaming.browser = files; await checkpoint();
    return { files, replayedCalls: 0, desktop: 'grpc-stream-desktop.png', mobile: 'grpc-stream-mobile.png' };
  });
}
