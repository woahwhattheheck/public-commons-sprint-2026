// MIT. Complete Lab client over the original merchant MCP and retained-file transport.
import { mkdir, open, realpath } from 'node:fs/promises';
import { wqxReadPrivate } from './wqx-workspace-connection.mjs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { openMerchantFileClient } from './retained-download.mjs';
import { WqxWorkspaceClient, uploadWqxInput, downloadWqxFile, reopenWqxDownload } from './wqx-workspace-client.mjs';
import { labWorkspaceTools } from './catalog/lab-edd-workspaces.mjs';
import { failure, identifier, plain, privateSupportDirectory, writePrivate } from './host-files.mjs';

const names = new Set(labWorkspaceTools(name => name));
const fileMethods = new Set(['input_begin', 'input_status', 'input_append', 'input_finish', 'file_read', 'file_release']);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = (code, text) => { throw failure('LAB_CLIENT_' + code, text); };

export class LaboratoryWorkspaceClient {
  #client; #workspace; #lifetime = new AbortController(); #files;
  constructor({ client, workspace } = {}) {
    if (!client || typeof client.call !== 'function' || typeof client.endpoint !== 'string' ||
        !client.endpoint || client.endpoint.length > 4096 || /[\x00-\x1f\x7f]/.test(client.endpoint))
      fail('CONFIGURATION', 'Use the original merchant client with its stable MCP endpoint identity.');
    if (workspace !== undefined) identifier(workspace, 'Laboratory workspace alias');
    this.#client = client; this.#workspace = workspace;
    // Preserve the original file metadata/range/replay validators and complete transfer implementation.
    this.#files = new WqxWorkspaceClient({ client: { endpoint: client.endpoint,
      call: (name, args, options = {}) => {
        const action = name.slice('merchant_wqx_'.length);
        if (!fileMethods.has(action)) fail('FILE_METHOD', 'Select an original retained input or file operation.');
        return this.call('merchant_lab_' + action, args,
          { signal: options.requestSignal, timeoutMs: options.timeoutMs });
      } } });
  }
  get workspace() { return this.#workspace; }
  get endpoint() { return this.#client.endpoint; }
  get closed() { return this.#lifetime.signal.aborted; }
  close() {
    this.#files.close();
    this.#lifetime.abort(failure('LAB_CLIENT_CLOSED', 'The laboratory client is closed.'));
  }
  async call(name, args = {}, options = {}) {
    if (!names.has(name) || !plain(args)) fail('INPUT', 'Select one declared laboratory operation and its complete arguments.');
    const input = { ...args };
    if (input.workspace !== undefined && this.#workspace !== undefined && input.workspace !== this.#workspace)
      fail('WORKSPACE_CHANGED', 'Continue on the same configured original laboratory desk.');
    input.workspace ??= this.#workspace;
    if (name !== 'merchant_lab_status' || input.workspace !== undefined) identifier(input.workspace, 'Laboratory workspace alias');
    if (input.workspace === undefined) delete input.workspace;
    const signal = options.signal ? AbortSignal.any([this.#lifetime.signal, options.signal]) : this.#lifetime.signal;
    signal.throwIfAborted();
    return this.#client.call(name, input, { requestSignal: signal,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) });
  }
  status(args = {}, options) { return this.call('merchant_lab_status', args, options); }
  profiles(args = {}, options) { return this.call('merchant_lab_profiles', args, options); }
  discover(args = {}, options) { return this.call('merchant_lab_discover', args, options); }
  requestCreate(args = {}, options) { return this.call('merchant_lab_request_create', args, options); }
  requests(args = {}, options) { return this.call('merchant_lab_requests', args, options); }
  request(args = {}, options) { return this.call('merchant_lab_request', args, options); }
  select(args = {}, options) { return this.call('merchant_lab_select', args, options); }
  remove(args = {}, options) { return this.call('merchant_lab_remove', args, options); }
  inspect(args = {}, options) { return this.call('merchant_lab_inspect', args, options); }
  rows(args = {}, options) { return this.call('merchant_lab_rows', args, options); }
  issues(args = {}, options) { return this.call('merchant_lab_issues', args, options); }
  groups(args = {}, options) { return this.call('merchant_lab_groups', args, options); }
  preview(args = {}, options) { return this.call('merchant_lab_preview', args, options); }
  table(args = {}, options) { return this.call('merchant_lab_table', args, options); }
  tableImport(args = {}, options) { return this.call('merchant_lab_table_import', args, options); }
  reviewSave(args = {}, options) { return this.call('merchant_lab_review_save', args, options); }
  reviews(args = {}, options) { return this.call('merchant_lab_reviews', args, options); }
  review(args = {}, options) { return this.call('merchant_lab_review', args, options); }
  reviewApply(args = {}, options) { return this.call('merchant_lab_review_apply', args, options); }
  intake(args = {}, options) { return this.call('merchant_lab_intake', args, options); }
  accessRefresh(args = {}, options) { return this.call('merchant_lab_access_refresh', args, options); }
  checkouts(args = {}, options) { return this.call('merchant_lab_checkouts', args, options); }
  checkout(args = {}, options) { return this.call('merchant_lab_checkout', args, options); }
  checkoutAction(args = {}, options) { return this.call('merchant_lab_checkout_action', args, options); }
  approval(args = {}, options) { return this.call('merchant_lab_approval', args, options); }
  approvalDecide(args = {}, options) { return this.call('merchant_lab_approval_decide', args, options); }
  customers(args = {}, options) { return this.call('merchant_lab_customers', args, options); }
  customer(args = {}, options) { return this.call('merchant_lab_customer', args, options); }
  customerAction(args = {}, options) { return this.call('merchant_lab_customer_action', args, options); }
  merchantStatus(args = {}, options) { return this.call('merchant_lab_merchant_status', args, options); }
  merchantJob(args = {}, options) { return this.call('merchant_lab_merchant_job', args, options); }
  jobAction(args = {}, options) { return this.call('merchant_lab_job_action', args, options); }
  worker(args = {}, options) { return this.call('merchant_lab_worker', args, options); }
  resultOpen(args = {}, options) { return this.call('merchant_lab_result_open', args, options); }
  result(args = {}, options) { return this.call('merchant_lab_result', args, options); }
  files(args = {}, options) { return this.call('merchant_lab_files', args, options); }
  inputBegin(args, options) { return this.#files.inputBegin(args, options); }
  inputStatus(args, options) { return this.#files.inputStatus(args, options); }
  inputAppend(args, options) { return this.#files.inputAppend(args, options); }
  inputFinish(args, options) { return this.#files.inputFinish(args, options); }
  fileRead(args, options) { return this.#files.fileRead(args, options); }
  fileRelease(args, options) { return this.#files.fileRelease(args, options); }
}
export async function openLaboratoryWorkspaceClient({ client, workspace, url, tokenEnv, environment, signal } = {}) {
  if (client !== undefined && url !== undefined) fail('CONFIGURATION', 'Select an existing native MCP client or its endpoint.');
  const original = client ?? await openMerchantFileClient({ url, tokenEnv, environment, signal,
    errorPrefix: 'LAB', clientName: 'starforge-laboratory-workspace' });
  return new LaboratoryWorkspaceClient({ client: original, workspace });
}
export const uploadLaboratoryInput = uploadWqxInput;
export const downloadLaboratoryFile = downloadWqxFile;
export const reopenLaboratoryDownload = reopenWqxDownload;

/** A large operator response keeps its full native JSON in the same original file transport. */
export async function receiveLaboratoryReply(client, value, { directory, signal, timeoutMs } = {}) {
  if (value?.delivery !== 'COMPLETE_FILE') return { value, download: null };
  if (value.schema !== 'stellar-forge.lab-complete-response.v1' || !value.file)
    fail('REPLY', 'Use the original full-response descriptor.');
  const download = await downloadWqxFile(client, { file: value.file, directory }, { signal, timeoutMs });
  const raw = await wqxReadPrivate(download.filename, 134217728, value.file.sha256);
  if (raw.length !== value.file.bytes || digest(raw) !== value.file.sha256)
    fail('REPLY_CHANGED', 'The complete operator response differs from its original file.');
  let decoded; try { decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
  catch { fail('REPLY', 'The original complete response is not UTF-8 JSON.'); }
  return { value: decoded, download };
}

/** Receive every immutable saved-review file and a directly usable offline editor directory. */
export async function downloadLaboratoryReview(client, { reviewId, expectedReviewSha256, directory } = {}, options = {}) {
  if (typeof directory !== 'string' || !directory || !/^[0-9a-f]{64}$/.test(expectedReviewSha256 ?? ''))
    fail('CONFIGURATION', 'Choose the exact saved review hash and its private receiving directory.');
  const root = resolve(directory);
  await mkdir(root, { recursive: true, mode: 0o700 }); await privateSupportDirectory(root);
  if (await realpath(root) !== root) fail('CONFIGURATION', 'Use the canonical private review receiving directory.');
  const reply = await client.review({ reviewId }, options);
  const original = (await receiveLaboratoryReply(client, reply, { directory: join(root, 'record'), ...options })).value;
  if (original.schema !== 'starforge.lab-edd-operator-review.v1' || original.reviewId !== reviewId ||
      original.reviewSha256 !== expectedReviewSha256 || !plain(original.files))
    fail('REVIEW_CHANGED', 'The selected immutable review identity differs.');
  const request = { schema: 'stellar-forge.lab-review-download.v1', endpoint: client.endpoint,
    workspace: client.workspace ?? null, reviewId, reviewSha256: expectedReviewSha256 };
  const identityPath = join(root, 'request.json');
  try { await writePrivate(identityPath, request); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (JSON.stringify(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await wqxReadPrivate(identityPath, 65536)))) !== JSON.stringify(request))
      fail('REVIEW_CHANGED', 'This receiving directory belongs to another original review.');
  }
  const output = join(root, 'review'), transfers = join(root, 'transfers');
  await mkdir(output, { recursive: true, mode: 0o700 }); await mkdir(transfers, { recursive: true, mode: 0o700 });
  await privateSupportDirectory(output); await privateSupportDirectory(transfers);
  if (await realpath(output) !== output || await realpath(transfers) !== transfers)
    fail('CONFIGURATION', 'Keep the original review output paths canonical.');
  const files = [], selectedNames = new Map();
  for (const [role, file] of Object.entries(original.files)) {
    options.signal?.throwIfAborted();
    identifier(role.toLowerCase(), 'Saved file role');
    const prior = selectedNames.get(file.name);
    if (prior && prior !== file.sha256) fail('REVIEW_CHANGED', 'Two original review members claim the same filename with different bytes.');
    selectedNames.set(file.name, file.sha256);
    const downloaded = await downloadWqxFile(client, { file, directory: join(transfers, role.toLowerCase()) }, options);
    const bytes = await wqxReadPrivate(downloaded.filename, 134217728, file.sha256);
    if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) fail('FILE_CHANGED', 'A downloaded review member changed.');
    const target = join(output, file.name);
    let handle;
    try { handle = await open(target, 'wx', 0o600); await handle.writeFile(bytes); await handle.sync(); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = await wqxReadPrivate(target, 134217728, file.sha256);
      if (existing.length !== file.bytes || digest(existing) !== file.sha256) fail('FILE_CHANGED', 'An existing offline editor member belongs to another edition.');
    } finally { await handle?.close(); }
    files.push({ role, name: file.name, bytes: file.bytes, sha256: file.sha256, path: target, download: downloaded });
  }
  const raw = Buffer.from(JSON.stringify(original, null, 2) + '\n');
  try { await writePrivate(join(output, 'saved-review.json'), raw); }
  catch (error) { if (error.code !== 'EEXIST' || !(await wqxReadPrivate(join(output, 'saved-review.json'), 2097152)).equals(raw)) throw error; }
  return { ...request, status: 'COMPLETE', directory: output, files,
    editor: join(output, original.files.currentReport.name),
    correspondenceEditor: original.files.correspondenceReport ? join(output, original.files.correspondenceReport.name) : null };
}
