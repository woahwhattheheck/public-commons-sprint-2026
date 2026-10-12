// MIT. Provider-intake client on the original authenticated ERDDAP operator.
import { SHA, failure } from './mcp-client.mjs';
export const PROVIDER_PROFILE_SCHEMA = 'stellar-forge.erddap-provider-handoff.v1';
export const PROVIDER_MAX_PROFILE_BYTES = 2 * 1024 * 1024;
export const PROVIDER_MAX_REQUEST_BYTES = PROVIDER_MAX_PROFILE_BYTES + 4096;
const sourceId = id => { if (!SHA.test(id ?? '')) throw failure('PROVIDER_ID_INVALID', 'Use the full original source, review or receiving SHA256.'); return id; };
const mode = value => { if (!['review', 'ready'].includes(value)) throw failure('PROVIDER_MODE_INVALID', 'Choose the explicit review or ready export mode.'); return value; };
export class ErddapProviderHandoffClient {
  constructor(client) {
    if (!client || !['json', 'upload', 'file'].every(name => typeof client[name] === 'function'))
      throw failure('PROVIDER_CLIENT_REQUIRED', 'Use the existing configured ERDDAP client and its original operator.');
    this.client = client;
  }
  state() { return this.client.json('/api/handoffs'); }
  draft(id) { return this.client.json('/api/handoffs/draft?' + new URLSearchParams({source: sourceId(id)})); }
  preview(id, profile) { return this.client.json('/api/handoffs/previews', {source: sourceId(id), profile}, {maxRequestBytes: PROVIDER_MAX_REQUEST_BYTES}); }
  save(id, profile, expectedHead) {
    if (expectedHead !== null) sourceId(expectedHead);
    return this.client.json('/api/handoffs/reviews', {source: sourceId(id), profile, expectedHead}, {maxRequestBytes: PROVIDER_MAX_REQUEST_BYTES});
  }
  review(revision) { return this.client.json('/api/handoffs/reviews/' + sourceId(revision)); }
  history(id, {offset = 0, limit = 100} = {}) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 250)
      throw failure('PROVIDER_PAGE_INVALID', 'Use a nonnegative original history offset and 1–250 revisions.');
    return this.client.json('/api/handoffs/history?' + new URLSearchParams({source: sourceId(id), offset: String(offset), limit: String(limit)}));
  }
  export(revision, selectedMode) { return this.client.json('/api/handoffs/exports', {revision: sourceId(revision), mode: mode(selectedMode)}); }
  receive(input) {
    if (input?.kind !== 'handoff') throw failure('PROVIDER_INPUT_REQUIRED', 'Select the complete host-pinned provider handoff input.');
    sourceId(input.sha256); return this.client.upload(input);
  }
  received(id) { return this.client.json('/api/handoffs/received/' + sourceId(id)); }
  file(revision, selectedMode, directory, expectedSha256) {
    return this.client.file({kind: 'provider-handoff', revision: sourceId(revision), mode: mode(selectedMode)}, directory, expectedSha256);
  }
  receivedFile(id, directory) {
    sourceId(id); return this.client.file({kind: 'provider-received', receiptId: id}, directory, id);
  }
}
