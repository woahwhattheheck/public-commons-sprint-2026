// MIT. Installed identity and typed methods over the original shared Tyk HTTP/file client.
import { join } from 'node:path';
import { TykWorkspaceHttpClient } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/tyk/workspace/http-client.mjs';
import { TYK_WORKSPACE_ACTIONS, validateTykAction } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/tyk/workspace/actions.mjs';
import { readTykProduct } from './workspace.mjs';
import { SESSION_SCHEMA, WORKSPACE_SCHEMA, HASH, UUID, RECORD, canonical, need, plain,
  failure, absolute, privateBytes, privateUrl, decode } from './common.mjs';

export { TYK_WORKSPACE_ACTIONS };
export const tykProductActions = () => Object.entries(TYK_WORKSPACE_ACTIONS).map(([name, action]) => ({ name, ...action }));

export class TykProductClient {
  #directory; #fetch; #signal; #timeoutMs; #expectedWorkspaceId;
  #clients = new Map(); #pending = new Set(); #latest; #closing = false; #close;
  constructor({ directory, fetch = globalThis.fetch, signal, timeoutMs = 3600000, expectedWorkspaceId } = {}) {
    this.#directory = absolute(directory);
    need(typeof fetch === 'function' && Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 3600000,
      'Select the original HTTP client and a request timeout of at most one hour.');
    need(expectedWorkspaceId === undefined || UUID.test(expectedWorkspaceId), 'Select the original workspace UUID.');
    this.#fetch = fetch; this.#signal = signal; this.#timeoutMs = timeoutMs;
    this.#expectedWorkspaceId = expectedWorkspaceId;
  }
  get directory() { return this.#directory; }
  async connection() {
    const { profile } = await readTykProduct(this.#directory);
    const record = decode(await privateBytes(profile.connectionFile, false, 65536));
    need(plain(record) && record.schema === SESSION_SCHEMA && record.state === 'OPEN' &&
      record.directory === profile.directory && record.workspaceDirectory === profile.workspaceDirectory &&
      record.productId === profile.productId && record.connectionFile === profile.connectionFile &&
      record.browserUrlFile === profile.browserUrlFile && UUID.test(record.instanceId ?? '') &&
      UUID.test(record.workspaceId ?? '') && HASH.test(record.bindingSha256 ?? '') &&
      HASH.test(record.resourceId ?? '') && HASH.test(record.sourceSha256 ?? '') &&
      (this.#expectedWorkspaceId === undefined || record.workspaceId === this.#expectedWorkspaceId),
    'Open the original saved Tyk product before calling its workspace.', 'CONNECTION_UNAVAILABLE');
    const url = privateUrl(record.browserUrl);
    const retained = (await privateBytes(profile.browserUrlFile, false, 16384)).toString('utf8').trim();
    const nativeIdentity = decode(await privateBytes(join(profile.workspaceDirectory, 'workspace.json'), false, 65536));
    need(retained === record.browserUrl && nativeIdentity.schema === WORKSPACE_SCHEMA &&
      nativeIdentity.workspaceId === record.workspaceId,
    'The original product URL and native workspace must select the same owner.', 'CONNECTION_CHANGED');
    return { record, origin: url.origin, token: url.hash.slice(1) };
  }

  #run(fn) {
    if (this.#closing) return Promise.reject(failure('CLIENT_CLOSED', 'The installed client is closed.'));
    const task = Promise.resolve().then(fn); this.#pending.add(task);
    task.then(() => this.#pending.delete(task), () => this.#pending.delete(task));
    return task;
  }
  async #retireIdle() {
    const closing = [];
    for (const [key, entry] of this.#clients) if (key !== this.#latest && entry.users === 0) {
      this.#clients.delete(key); closing.push(entry.client.close());
    }
    await Promise.all(closing);
  }
  #use(fn) {
    return this.#run(async () => {
      const selected = await this.connection();
      need(!this.#closing, 'The installed client is closed.', 'CLIENT_CLOSED');
      const key = canonical([selected.record.productId, selected.record.workspaceId,
        selected.record.instanceId, selected.record.browserUrl]);
      let entry = this.#clients.get(key);
      if (!entry) {
        const client = new TykWorkspaceHttpClient({ url: selected.record.browserUrl,
          workspaceId: selected.record.workspaceId, fetch: this.#fetch,
          signal: this.#signal, timeoutMs: this.#timeoutMs });
        entry = { client, users: 0, ready: undefined };
        this.#clients.set(key, entry);
      }
      entry.users++; this.#latest = key;
      try {
        await this.#retireIdle();
        entry.ready ??= entry.client.ready().then(value => {
          need(value?.schema === WORKSPACE_SCHEMA && value.workspaceId === selected.record.workspaceId &&
            value.directory === selected.record.workspaceDirectory,
          'The live original workspace changed.', 'CONNECTION_CHANGED');
          return value;
        }).catch(error => { entry.ready = undefined; throw error; });
        await entry.ready;
        return await fn(entry.client, selected);
      } catch (error) {
        if (error && typeof error === 'object') {
          error.workspaceId ??= selected.record.workspaceId;
          error.instanceId ??= selected.record.instanceId;
        }
        throw error;
      } finally { entry.users--; await this.#retireIdle(); }
    });
  }
  call(method, args = {}) {
    validateTykAction(method, args);
    return this.#use(client => client.action(method, args));
  }
  /** Retain a complete original JSON reply without materializing it in the caller. */
  callToFile(method, args, { path } = {}) {
    validateTykAction(method, args); path = absolute(path);
    return this.#use((client, selected) => client.actionToFile(method, args, path).then(file => ({
      ...file, productId: selected.record.productId, workspaceId: selected.record.workspaceId,
      method, ...(typeof args.requestId === 'string' ? { requestId: args.requestId } : {}),
    })));
  }
  view() {
    return this.#use(async (client, selected) => {
      const result = await client.action('view', {});
      need(result.schema === WORKSPACE_SCHEMA && result.workspaceId === selected.record.workspaceId &&
        result.directory === selected.record.workspaceDirectory,
      'The live original workspace changed.', 'CONNECTION_CHANGED');
      return result;
    });
  }
  status() { return this.view(); }
  listRecords(input = {}) { return this.call('listRecords', input); }
  getRecord(input) { return this.call('getRecord', input); }
  readDefinition(input) { return this.call('readDefinition', input); }
  adaptDefinition(input) { return this.call('adaptDefinition', input); }
  readReview(input) { return this.call('readReview', input); }
  readSource(input) { return this.call('readSource', input); }
  saveConnection(input) { return this.call('saveConnection', input); }
  capture(input) { return this.call('capture', input); }
  importCapture(input) { return this.call('importCapture', input); }
  createCohort(input) { return this.call('createCohort', input); }
  createCommissioning(input) { return this.call('createCommissioning', input); }
  readCommissioning(input) { return this.call('readCommissioning', input); }
  prepareCommissioningStep(input) { return this.call('prepareCommissioningStep', input); }
  recordCommissioningReview(input) { return this.call('recordCommissioningReview', input); }
  refreshCommissioning(input) { return this.call('refreshCommissioning', input); }
  prepareRollout(input) { return this.call('prepareRollout', input); }
  dispatchRollout(input) { return this.call('dispatchRollout', input); }
  reconcileRollout(input) { return this.call('reconcileRollout', input); }
  exportWorkspace(input) { return this.call('exportWorkspace', input); }
  inspectDelivery(input) { return this.call('inspectDelivery', input); }
  adoptDelivery(input) { return this.call('adoptDelivery', input); }

  /** Stream the already-exported native file through the shared original receiver. */
  downloadDelivery({ id, path, expectedSha256 } = {}) {
    need(RECORD.test(id ?? '') && (expectedSha256 === undefined || HASH.test(expectedSha256)),
      'Select the original exported delivery ID and SHA-256.');
    path = absolute(path);
    return this.#use(async (client, selected) => {
      const record = await client.action('getRecord', { kind: 'delivery', id });
      const file = record.value?.file;
      need(record.kind === 'delivery' && record.id === id && record.value.state === 'EXPORTED' &&
        HASH.test(file?.sha256 ?? '') && Number.isSafeInteger(file?.bytes) && file.bytes > 0 &&
        (expectedSha256 === undefined || file.sha256 === expectedSha256),
      'Select the exact completed original delivery.', 'DELIVERY_CHANGED');
      const received = await client.downloadDelivery(id, path,
        { expectedSha256: file.sha256, expectedBytes: file.bytes });
      need(received.bytes === file.bytes && received.sha256 === file.sha256,
        'The received file changed from the selected original delivery.', 'DELIVERY_CHANGED');
      return { ...received, schema: 'stellar-forge.tyk-product-delivery.v1', state: 'RETAINED',
        productId: selected.record.productId, workspaceId: selected.record.workspaceId,
        deliveryId: id, deliveryRevision: record.revision, recordSha256: record.sha256 };
    });
  }
  /** Read an exact original source or complete field-review report through its file endpoint. */
  downloadSource({ reference, path } = {}) {
    validateTykAction('readSource', { reference }); path = absolute(path);
    return this.#use((client, selected) => client.downloadSource(reference, path).then(file => ({
      ...file, productId: selected.record.productId, workspaceId: selected.record.workspaceId,
      reference,
    })));
  }
  /** Inspect this exact private file with the original request UUID and native transaction. */
  inspectDeliveryFile({ requestId, path, label = 'Imported workspace handover', expectedSha256 } = {}) {
    path = absolute(path);
    return this.#use(client => client.inspectFile(path, { requestId, label, expectedSha256 }));
  }
  /** Close only this SDK's HTTP requests; the installed application keeps its own lifecycle. */
  close() {
    if (this.#close) return this.#close;
    this.#closing = true;
    const clients = [...this.#clients.values()].map(entry => entry.client.close());
    this.#close = Promise.allSettled([...clients, ...this.#pending]).then(() => { this.#clients.clear(); });
    return this.#close;
  }
}
