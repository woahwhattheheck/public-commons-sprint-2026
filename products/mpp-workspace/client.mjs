// MIT. Native MPP product clients retain original console jobs, purchases and receiving.
import { join, dirname } from 'node:path';
import { digest, need, plain, privateDirectory, readJSON } from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';
import { readMppProduct, privateFile, writePrivate, fullPath, sha, decode,
  MPP_PRODUCT_SESSION_SCHEMA } from './workspace.mjs';

export class MppProductError extends Error {
  constructor(code, message, { purchaseId, jobId, cause, status } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'MppProductError'; this.code = code;
    if (purchaseId !== undefined) this.purchaseId = purchaseId;
    if (jobId !== undefined) this.jobId = jobId;
    if (status !== undefined) this.status = status;
  }
}
const id = value => {
  need(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/.test(value),
    'MPP_PRODUCT_ID_REQUIRED', 'Use the original retained purchase or delivery ID.');
  return value;
};
const jobId = value => {
  need(typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value),
    'MPP_PRODUCT_JOB_ID_REQUIRED');
  return value;
};
const revisions = value => {
  need(Number.isSafeInteger(value) && value >= 0, 'MPP_PRODUCT_REVISION_REQUIRED');
  return value;
};
function endpoint(value) {
  const url = new URL(value);
  need(url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
    !url.username && !url.password && url.pathname === '/' && !url.search &&
    /^[a-f0-9]{64}$/.test(url.hash.slice(1)), 'MPP_PRODUCT_PRIVATE_URL_INVALID');
  return { origin: url.origin, token: url.hash.slice(1) };
}
function sameIdentity(identity, selected) {
  need(identity.schema === 'stellar-forge.mpp-console-identity.v1' &&
    identity.workspace === selected.workspace && identity.createdAt === selected.workspaceCreatedAt &&
    identity.pid === selected.pid && identity.ppid === selected.ppid && identity.origin === selected.origin,
  'MPP_PRODUCT_SESSION_CHANGED', 'Reopen this product’s retained original session.');
}
export class MppProductClient {
  #selected; #fetch; #timeout; #closed = false; #pending = new Set(); #close;
  constructor(selected, { fetchImpl = globalThis.fetch, timeoutMs = 30000 } = {}) {
    need(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 120000,
      'MPP_PRODUCT_TIMEOUT_INVALID');
    this.#selected = selected; this.#fetch = fetchImpl; this.#timeout = timeoutMs;
  }
  get directory() { return this.#selected.directory; }
  get workspaceDirectory() { return this.#selected.workspace; }
  async #send(path, body, { raw = false, purchaseId, jobId: retainedJob, maximum = 16 * 1024 * 1024 } = {}) {
    if (this.#closed) throw new MppProductError('MPP_PRODUCT_CLIENT_CLOSED', 'This client has closed.');
    need(path.startsWith('/api/') && !path.includes('\\') && !path.startsWith('//'), 'MPP_PRODUCT_ROUTE_INVALID');
    const controller = new AbortController();
    const task = (async () => {
      const timer = setTimeout(() => controller.abort(), this.#timeout);
      try {
        const response = await this.#fetch(this.#selected.origin + path, {
          method: body === undefined ? 'GET' : 'POST',
          headers: { authorization: 'Bearer ' + this.#selected.token, origin: this.#selected.origin,
            accept: raw ? 'application/octet-stream, application/json' : 'application/json',
            ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          redirect: 'error', signal: controller.signal
        });
        const pieces = []; let count = 0;
        if (response.body) {
          const reader = response.body.getReader();
          try {
            while (true) {
              const part = await reader.read(); if (part.done) break;
              count += part.value.byteLength;
              need(count <= maximum, 'MPP_PRODUCT_RESPONSE_LIMIT', 'Read original records in smaller pages.');
              pieces.push(Buffer.from(part.value));
            }
          } catch (error) { await reader.cancel().catch(() => {}); throw error; }
          finally { reader.releaseLock(); }
        }
        const bytes = Buffer.concat(pieces);
        if (!response.ok) {
          let reason; try { reason = decode(bytes).error; } catch {}
          throw new MppProductError(typeof reason === 'string' && /^[A-Z0-9_]{1,96}$/.test(reason) ?
            reason : 'MPP_PRODUCT_CONSOLE_REJECTED',
          'The original native console rejected this operation.', { purchaseId, jobId: retainedJob, status: response.status });
        }
        return raw ? { bytes, contentType: response.headers.get('content-type'),
          sha256: digest(bytes), responseHeaders: Object.fromEntries(response.headers) } : decode(bytes);
      } catch (error) {
        if (error instanceof MppProductError) throw error;
        throw new MppProductError(error.code ?? 'MPP_PRODUCT_REQUEST_INTERRUPTED',
          'The original console request did not complete. Inspect the retained purchase or job before retrying.',
          { purchaseId, jobId: retainedJob, cause: error });
      } finally { clearTimeout(timer); }
    })();
    this.#pending.add(task);
    task.then(() => this.#pending.delete(task), () => this.#pending.delete(task));
    return task;
  }
  async identity() {
    const value = await this.#send('/api/identity');
    sameIdentity(value, this.#selected); return value;
  }
  async #request(path, body, options) {
    try { await this.identity(); return await this.#send(path, body, options); }
    catch (error) {
      if (error instanceof MppProductError && options) {
        if (options.purchaseId !== undefined) error.purchaseId ??= options.purchaseId;
        if (options.jobId !== undefined) error.jobId ??= options.jobId;
      }
      throw error;
    }
  }
  channelState() { return this.#request('/api/channel/state'); }
  channelAction(name,input={}) {
    need(typeof name==='string' && /^[a-z]+(?:-[a-z]+)*$/.test(name),'MPP_CHANNEL_OPERATION_INVALID');
    return this.#request('/api/channel/'+name,input);
  }
  channelRecord(kind,key) {
    need(['tasks','purchases','contracts','funders','funding','settlements','observations'].includes(kind),'MPP_CHANNEL_RECORD_KIND');
    return this.#request('/api/channel/'+kind+'/'+encodeURIComponent(id(key)));
  }
  channelResponse(purchaseId) {
    return this.#request('/api/channel/responses/'+encodeURIComponent(id(purchaseId)),undefined,{raw:true});
  }
  channelHandover(sha256) {
    return this.#request('/api/channel/handovers/'+sha(sha256),undefined,{raw:true,maximum:128*1024*1024});
  }
  state() { return this.#request('/api/state'); }
  catalog() { return this.#request('/api/customer'); }
  handoff(kind, profileId) {
    need(['contract', 'openapi', 'package'].includes(kind), 'MPP_PRODUCT_HANDOFF_KIND');
    return this.#request('/api/customer/' + kind + '?' + new URLSearchParams({ profileId: sha(profileId) }),
      undefined, { raw: true, maximum: 3 * 1024 * 1024 });
  }
  configureProfile(kind, profile, revision) {
    need(['merchant', 'buyer', 'customer'].includes(kind), 'MPP_PRODUCT_PROFILE_KIND');
    return this.#request('/api/profile', { kind, profile, revision: revisions(revision) });
  }
  startMerchant(port = 8788) {
    need(Number.isInteger(port) && port >= 0 && port <= 65535, 'MPP_PRODUCT_PORT_INVALID');
    return this.#request('/api/merchant/start', { port });
  }
  stopMerchant() { return this.#request('/api/merchant/stop', {}); }
  recoverDelivery(deliveryId) {
    return this.#request('/api/delivery/recover', { id: id(deliveryId) });
  }
  customerStatus({ offset = 0, limit = 25 } = {}) {
    need(Number.isSafeInteger(offset) && offset >= 0 && Number.isInteger(limit) && limit >= 1 && limit <= 100,
      'MPP_PRODUCT_PAGE_INVALID');
    return this.#request('/api/customer-workbench?' + new URLSearchParams({ offset, limit }));
  }
  intake(document) { return this.#request('/api/customer-workbench/intake', { document }); }
  fetchContract(origin, transport) {
    return this.#request('/api/customer-workbench/fetch', { origin, ...(transport ? { transport } : {}) });
  }
  reviewCustomer(profile, revision) {
    return this.#request('/api/customer-workbench/review', { profile, revision: revisions(revision) });
  }
  configureCustomer(profile, revision) {
    return this.#request('/api/customer-workbench/configure', { profile, revision: revisions(revision) });
  }
  preview({ profileId, offerId, inputs = {} }) {
    return this.#request('/api/customer-workbench/preview', { profileId: sha(profileId), offerId: id(offerId), inputs });
  }
  prepare({ profileId, offerId, purchaseId, query, json, challengeId } = {}) {
    id(purchaseId);
    const options = { purchaseId, ...(query !== undefined ? { query } : {}),
      ...(json !== undefined ? { json } : {}), ...(challengeId !== undefined ? { challengeId } : {}) };
    return this.#request('/api/customer-workbench/prepare',
      { profileId: sha(profileId), offerId: id(offerId), options }, { purchaseId });
  }
  retryPrepare(purchaseId) { return this.#action('retry-prepare', purchaseId); }
  execute(purchaseId) { return this.#action('execute', purchaseId); }
  resume(purchaseId) { return this.#action('resume', purchaseId); }
  finalize(purchaseId) { return this.#action('finalize', purchaseId); }
  #action(action, purchaseId) {
    id(purchaseId);
    return this.#request('/api/customer-workbench/' + action, { id: purchaseId }, { purchaseId });
  }
  purchase(purchaseId) {
    return this.#request('/api/customer-workbench/purchases/' + encodeURIComponent(id(purchaseId)), undefined, { purchaseId });
  }
  responsePreview(purchaseId) {
    return this.#request('/api/customer-workbench/purchases/' + encodeURIComponent(id(purchaseId)) + '/preview',
      undefined, { purchaseId });
  }
  async job(retainedJob, { purchaseId } = {}) {
    jobId(retainedJob);
    try { return await this.#request('/api/jobs/' + retainedJob, undefined, { purchaseId, jobId: retainedJob }); }
    catch (error) {
      if (error.code !== 'MPP_JOB_NOT_FOUND' || !purchaseId) throw error;
      return { id: retainedJob, state: 'JOB_NOT_RETAINED', purchaseId,
        purchase: await this.purchase(purchaseId) };
    }
  }
  async waitJob(retainedJob, { purchaseId, timeoutMs = 30000, intervalMs = 500, signal } = {}) {
    need(Number.isSafeInteger(timeoutMs) && timeoutMs >= 0 && timeoutMs <= 3600000 &&
      Number.isSafeInteger(intervalMs) && intervalMs >= 100 && intervalMs <= 5000, 'MPP_PRODUCT_WAIT_INVALID');
    const deadline = Date.now() + timeoutMs;
    while (true) {
      signal?.throwIfAborted();
      const value = await this.job(retainedJob, { purchaseId });
      if (value.state !== 'RUNNING' || Date.now() >= deadline) return value;
      await new Promise((done, reject) => {
        let timer;
        const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', aborted); };
        const aborted = () => { cleanup(); reject(signal.reason ?? new Error('Aborted')); };
        timer = setTimeout(() => { cleanup(); done(); }, Math.min(intervalMs, Math.max(1, deadline - Date.now())));
        signal?.addEventListener('abort', aborted, { once: true });
        if (signal?.aborted) aborted();
      });
    }
  }
  async receiveCustomer({ profileId, directory, expectedBundleSha256 } = {}) {
    fullPath(directory);
    const { parseCustomerBundle, receiveCustomerBundle } =
      await import('../../stellar/scf-starforge-20261009/mpp-charge/customer/export.mjs');
    const handoff = await this.handoff('package', profileId), bundle = parseCustomerBundle(handoff.bytes);
    if (expectedBundleSha256 !== undefined)
      need(bundle.sha256 === sha(expectedBundleSha256), 'MPP_PRODUCT_CUSTOMER_SOURCE_CHANGED');
    // Native receiving recognizes the complete original contract and all twelve generated files.
    let resume = false;
    try { await privateDirectory(directory); resume = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const received = await receiveCustomerBundle({ bundle, directory, resume });
    return { ...received, sourceBytes: handoff.bytes.length, sourceSha256: handoff.sha256 };
  }
  async downloadResponse({ purchaseId, path, expectedSha256 } = {}) {
    id(purchaseId); fullPath(path);
    const selected = await this.responsePreview(purchaseId);
    const expected = sha(expectedSha256 ?? selected.sha256);
    need(selected.sha256 === expected, 'MPP_PRODUCT_RESPONSE_CHANGED');
    const result = await this.#request('/api/customer-workbench/purchases/' + encodeURIComponent(purchaseId) + '/response',
      undefined, { raw: true, purchaseId });
    need(result.sha256 === expected && result.bytes.length === selected.bytes,
      'MPP_PRODUCT_RESPONSE_CHANGED', 'The original response bytes differ from the inspected purchase.');
    await privateDirectory(dirname(path));
    await writePrivate(path, result.bytes);
    const record = { schema: 'stellar-forge.mpp-product-response.v1', purchaseId,
      workspace: this.#selected.workspace, workspaceCreatedAt: this.#selected.workspaceCreatedAt,
      path, bytes: result.bytes.length, sha256: expected, contractSha256: selected.contractSha256,
      offerId: selected.offerId, transaction: selected.transaction, receipt: selected.receipt,
      accounting: selected.accounting, contentType: selected.headers?.['content-type'] ?? result.contentType };
    // Accounting may advance independently of immutable response bytes; each observed record has its own identity.
    const recordPath = path + '.' + digest(JSON.stringify(record)).slice(0,16) + '.mpp.json';
    await writePrivate(recordPath, record);
    return { ...record, recordPath };
  }
  close() {
    this.#closed = true;
    return this.#close ??= Promise.allSettled([...this.#pending]).then(() => undefined);
  }
}
/** Attach through the private retained product URL. This client never owns another Workspace lease. */
export async function connectMppProduct({ directory, fetchImpl, timeoutMs } = {}) {
  const profile = await readMppProduct(fullPath(directory));
  const session = decode(await privateFile(profile.sessionFile, 65536));
  need(session.schema === MPP_PRODUCT_SESSION_SCHEMA && session.state === 'OPEN' &&
    session.directory === profile.directory && session.workspace === profile.workspaceDirectory &&
    session.workspaceCreatedAt === profile.workspaceCreatedAt && session.console === 'native',
  'MPP_PRODUCT_SESSION_REQUIRED', 'Open this product’s original managed application or CLI session first.');
  const selected = { ...session, ...endpoint(session.browserUrl) };
  const client = new MppProductClient(selected, { fetchImpl, timeoutMs });
  try { await client.identity(); return client; } catch (error) { await client.close(); throw error; }
}
/** Named methods over the original merchant MCP. Values and accounting remain with the native host. */
export async function connectMppAgent({ directory, environment = process.env, signal } = {}) {
  const profile = await readMppProduct(fullPath(directory));
  const session = decode(await privateFile(profile.sessionFile, 65536));
  need(session.schema === MPP_PRODUCT_SESSION_SCHEMA && session.state === 'OPEN' &&
    session.directory === profile.directory && session.workspace === profile.workspaceDirectory &&
    session.workspaceCreatedAt === profile.workspaceCreatedAt && session.mcpUrl,
  'MPP_PRODUCT_AGENT_REQUIRED', 'Open this product with its original merchant agent.');
  const consoleClient = await connectMppProduct({ directory });
  await consoleClient.close();
  const { openMerchantFileClient } = await import('../../stellar-forge/mcp-merchant-operator/retained-download.mjs');
  const original = await openMerchantFileClient({ url: session.mcpUrl, tokenEnv: session.tokenEnv,
    environment, signal, errorPrefix: 'MPP_PRODUCT', clientName: 'starforge-mpp-workspace' });
  const call = (name, args = {}, options) => {
    need(name.startsWith('merchant_mpp_'), 'MPP_PRODUCT_AGENT_TOOL_INVALID');
    return original.call(name, args, options);
  };
  const consoles = await original.call('merchant_mpp_consoles', {});
  const expectedIdentity = digest(JSON.stringify({ createdAt: profile.workspaceCreatedAt,
    schema: 'stellar-forge.mpp-console-identity.v1', workspace: profile.workspaceDirectory }));
  need(consoles.consoles?.some(value => value.console === 'native' && value.workspaceIdentity === expectedIdentity),
    'MPP_PRODUCT_AGENT_CHANGED', 'The original agent must select this product’s native workspace.');
  const selected = args => ({ ...args, console: 'native' });
  return Object.freeze({
    endpoint: original.endpoint, console: 'native', call,
    consoles: () => call('merchant_mpp_consoles'),
    status: (options = {}) => call('merchant_mpp_status', selected(options)),
    catalog: () => call('merchant_mpp_catalog', selected()),
    fetchContract: (customer, origin) => call('merchant_mpp_contract', selected({ customer, origin })),
    review: input => call('merchant_mpp_customer_review', selected(input)),
    reviewStatus: reviewId => call('merchant_mpp_customer_review_status', selected({ reviewId })),
    configure: (reviewId, expectedReviewSha256) =>
      call('merchant_mpp_customer_configure', selected({ reviewId, expectedReviewSha256 })),
    preview: input => call('merchant_mpp_preview', selected(input)),
    prepare: input => call('merchant_mpp_prepare', selected(input)),
    retryPrepare: purchaseId => call('merchant_mpp_retry_prepare', selected({ purchaseId })),
    execute: purchaseId => call('merchant_mpp_execute', selected({ purchaseId })),
    resume: purchaseId => call('merchant_mpp_resume', selected({ purchaseId })),
    finalize: purchaseId => call('merchant_mpp_finalize', selected({ purchaseId })),
    job: (jobId, purchaseId) => call('merchant_mpp_job', selected({ jobId, ...(purchaseId ? { purchaseId } : {}) })),
    purchase: purchaseId => call('merchant_mpp_purchase', selected({ purchaseId })),
    responsePreview: purchaseId => call('merchant_mpp_response_preview', selected({ purchaseId })),
    export: input => call('merchant_mpp_export', selected(input)),
    async download({ exportId, directory: output, expectedManifestSha256, chunkSize } = {}) {
      const { downloadMppExport } = await import('../../stellar-forge/mcp-merchant-operator/mpp-download.mjs');
      return downloadMppExport({ url: session.mcpUrl, exportId, directory: fullPath(output),
        tokenEnv: session.tokenEnv, environment, signal,
        ...(expectedManifestSha256 ? { expectedManifestSha256 } : {}), ...(chunkSize ? { chunkSize } : {}) });
    }
  });
}
/** Receive a retained package from a local file using the original trusted twelve-file generator. */
export async function receiveMppCustomer({ file, directory, resume = false }) {
  const { readCustomerBundleFile, receiveCustomerBundle } =
    await import('../../stellar/scf-starforge-20261009/mpp-charge/customer/export.mjs');
  return receiveCustomerBundle({ bundle: await readCustomerBundleFile(fullPath(file)),
    directory: fullPath(directory), resume });
}
export async function inspectMppCustomer(directory) {
  return (await import('../../stellar/scf-starforge-20261009/mpp-charge/customer/export.mjs'))
    .inspectCustomerExport(fullPath(directory));
}
export async function resumeMppCustomer(directory) {
  return (await import('../../stellar/scf-starforge-20261009/mpp-charge/customer/export.mjs'))
    .resumeCustomerExport(fullPath(directory));
}
