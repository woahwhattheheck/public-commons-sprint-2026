// MIT. One laboratory operator over original SF88 intake, native jobs and complete retained files.
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { exact, failure, identifier, plain } from './host-files.mjs';
import { WqxWorkspaceFiles } from './wqx-workspace-files.mjs';
import { labWorkspaceTools } from './catalog/lab-edd-workspaces.mjs';
import { openJobWorkspace } from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/job-workspace/model.mjs';
import { createNativeProcessHost } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/processes-host.mjs';
import { openLaboratoryOperator } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/lab-edd/operator.mjs';
import { laboratoryParameters } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/lab-edd/operator-model.mjs';
import { canonical, sha256, validateCatalog } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/intake/protocol.mjs';

const MAX_REPLY_BYTES = 480 * 1024;
const definitions = new Map(labWorkspaceTools((name, description, properties, required) =>
  ({ name, properties, required })).map(value => [value.name, value]));
const fault = (code, message) => failure('LAB_OPERATOR_' + code, message);
const fail = (code, message) => { throw fault(code, message); };
const same = (left, right) => canonical(left) === canonical(right);
const bytesOf = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const fileInfo = value => ({ fileId: value.fileId, name: value.name, contentType: value.contentType,
  bytes: value.bytes, sha256: value.sha256 });
const domainActions = {
  inspect: 'inspect', rows: 'rows', issues: 'issues', groups: 'groups', preview: 'preview', table: 'table',
  table_import: 'importTable', review_save: 'save', review_apply: 'apply',
};
function validate(value, schema, label) {
  const type = schema.type;
  if (!(type === 'integer' ? Number.isSafeInteger(value) : type === 'object' ? plain(value) :
      type === 'array' ? Array.isArray(value) : typeof value === type))
    fail('INPUT', 'Use the declared value type for ' + label + '.');
  if (schema.enum && !schema.enum.includes(value) ||
      type === 'integer' && (schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum) ||
      type === 'string' && (schema.minLength !== undefined && value.length < schema.minLength ||
        schema.maxLength !== undefined && value.length > schema.maxLength || schema.pattern && !new RegExp(schema.pattern).test(value)))
    fail('INPUT', 'Use the complete value within the original constraints for ' + label + '.');
  if (type === 'object' && schema.properties) {
    if (schema.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(schema.properties, key)))
      fail('INPUT', 'Use only declared fields in ' + label + '.');
    for (const [key, item] of Object.entries(value)) if (schema.properties[key]) validate(item, schema.properties[key], label + '.' + key);
  }
  if (type === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems || schema.maxItems !== undefined && value.length > schema.maxItems ||
        schema.uniqueItems && new Set(value.map(canonical)).size !== value.length) fail('INPUT', 'Use the declared distinct list for ' + label + '.');
    if (schema.items) for (const item of value) validate(item, schema.items, label);
  }
}
function token(selected, environment) {
  if (!selected.intakeTokenEnv) return null;
  const value = environment[selected.intakeTokenEnv];
  if (typeof value !== 'string' || !/^[\x21-\x7e]{16,1024}$/.test(value))
    fail('ACCESS', 'Supply the selected original intake token in its configured host environment variable.');
  return value;
}
function matchingRequest(row, selected) {
  if (row.merchant.origin !== selected.origin || row.merchant.functionId !== selected.functionId)
    fail('SOURCE', 'Select an original request for this configured laboratory merchant and function.');
  return row;
}
function matchingCheckout(row, selected) {
  if (new URL(row.ticket.sellerUrl).origin !== selected.origin || row.ticket.functionId !== selected.functionId)
    fail('SOURCE', 'Select the checkout belonging to this configured original laboratory function.');
  return row;
}
function matchingCustomer(row, selected) {
  if (new URL(row.receipt.acceptance.statusUrl).origin !== selected.origin ||
      row.receipt.acceptance.functionId !== selected.functionId)
    fail('SOURCE', 'Select the accepted original customer entry for this laboratory function.');
  return row;
}

// A caller may wait for an original long-lived task. Stop that same native task
// on cancellation before draining its wait; keep its original lease and journal open.
async function nativeWait(signal, { read, stop, wait, expectedTaskId }) {
  const before = await read(), taskId = before.task?.id;
  if (expectedTaskId !== undefined && expectedTaskId !== taskId) fail('TASK_CHANGED', 'Select the exact original native task.');
  if (!taskId || !['RUNNING', 'CANCELLING'].includes(before.task.state)) { signal.throwIfAborted(); return before; }
  let stopping;
  const stopOriginal = () => stopping ??= (async () => {
    const current = await read();
    if (taskId && current.task?.id === taskId && ['RUNNING', 'CANCELLING'].includes(current.task.state))
      await stop(taskId);
  })();
  const abort = () => { stopOriginal().catch(() => {}); };
  if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  let failure, value;
  try { value = await wait(taskId); }
  catch (error) { failure = error; }
  finally {
    signal.removeEventListener('abort', abort);
    if (stopping) try { await stopping; }
    catch (error) { failure = failure ? new AggregateError([failure, error], 'LAB_ORIGINAL_TASK_STOP_FAILED') : error; }
  }
  if (failure) throw failure;
  signal.throwIfAborted();
  return value;
}

/** The paid merchant is borrowed. This provider owns and drains its original customer desk. */
export class MerchantLaboratoryWorkspaces {
  #config; #paid; #environment; #workspaceFactory; #desks = new Map(); #active = new Set();
  #controllers = new Set(); #closing = false; #closed; #queues = new Map();
  constructor(config, { paidJobWorkspaces, environment = process.env, workspaceFactory = openJobWorkspace } = {}) {
    this.#config = config.labWorkspaces?.workspaces ?? Object.create(null);
    this.#paid = paidJobWorkspaces; this.#environment = environment; this.#workspaceFactory = workspaceFactory;
  }
  get summary() {
    return { configured: Object.keys(this.#config).length > 0, ownership: 'ORIGINAL_SF88_CUSTOMER_AND_PAID_JOB_MERCHANT',
      workspaces: Object.entries(this.#config).map(([workspace, value]) => ({
        workspace, label: value.label, merchant: value.merchant, origin: value.origin,
        functionId: value.functionId, opened: this.#desks.has(workspace), approvalMode: value.approvalMode,
      })), activeCalls: this.#active.size, closing: this.#closing };
  }
  #selected(alias) {
    identifier(alias, 'Laboratory workspace alias');
    const selected = this.#config[alias];
    if (!selected) fail('WORKSPACE', 'Choose a configured original laboratory desk.');
    return selected;
  }
  async #open(alias) {
    const selected = this.#selected(alias);
    let pending = this.#desks.get(alias);
    if (!pending) {
      pending = (async () => {
        let workspace, files, desk, closing;
        const close = () => closing ??= (async () => {
          const failures = [];
          try { await desk?.close(); } catch (error) { failures.push(error); }
          try { await files?.close(); } catch (error) { failures.push(error); }
          try { await workspace?.close(); } catch (error) { failures.push(error); }
          if (failures.length) throw new AggregateError(failures, 'LAB_ORIGINAL_DESK_CLOSE_FAILED');
        })();
        try {
          workspace = await this.#workspaceFactory({
            directory: selected.directory,
            ...(selected.buyerRoots === undefined ? {} : { buyerRoots: selected.buyerRoots }),
            ...(selected.fileRoots === undefined ? {} : { fileRoots: selected.fileRoots }),
            transport: selected.transport, requestTimeoutMs: selected.requestTimeoutMs,
            transferTimeoutMs: selected.transferTimeoutMs, maxConcurrent: selected.maxConcurrent,
            inputFileStorage: selected.inputFileStorage,
            checkout: { ...selected.checkout, environment: this.#environment },
          });
          files = new WqxWorkspaceFiles({ exportsDirectory: join(workspace.directory, 'artifacts') },
            { namespace: 'laboratory-edd', sourceConfiguration: { inputs: {}, captures: {} } });
          desk = await openLaboratoryOperator({ workspace, files, alias });
          if (selected.approvalMode === 'operator') await workspace.checkout.enableBrowserApproval();
          const owned = { alias, selected, workspace, files, desk, close };
          if (this.#closing) { await close(); fail('CLOSING', 'The laboratory owner is closing.'); }
          return owned;
        } catch (error) {
          try { await close(); } catch (closed) { throw new AggregateError([error, closed], 'LAB_ORIGINAL_DESK_OPEN_FAILED'); }
          throw error;
        }
      })();
      this.#desks.set(alias, pending);
      pending.catch(() => { if (this.#desks.get(alias) === pending) this.#desks.delete(alias); });
    }
    return pending;
  }
  async #reply(owned, action, value) {
    const bytes = bytesOf(value);
    if (bytes.length <= MAX_REPLY_BYTES) return { ...value, workspace: owned.alias };
    const file = await owned.files.retain({ workspace: owned.alias, source: { kind: 'laboratory-complete-operator-response', action },
      name: 'laboratory-' + action.replaceAll('_', '-') + '.json', contentType: 'application/json', bytes });
    const identity = Object.fromEntries(['bindingSha256', 'comparisonSha256', 'previewSha256', 'reviewSha256',
      'resultId', 'requestId', 'revision', 'total', 'offset', 'limit', 'nextOffset', 'state', 'status']
      .filter(key => ['string', 'number', 'boolean'].includes(typeof value?.[key]) || value?.[key] === null)
      .map(key => [key, value[key]]));
    return { schema: 'stellar-forge.lab-complete-response.v1', workspace: owned.alias, action,
      ...identity, delivery: 'COMPLETE_FILE', file: fileInfo(file) };
  }
  async #scientific(owned, action, args, signal) {
    const prior = this.#queues.get(owned.alias) ?? Promise.resolve();
    const work = prior.catch(() => {}).then(async () => {
      signal.throwIfAborted();
      const processes = createNativeProcessHost({ env: this.#environment,
        temporaryDirectory: owned.selected.temporaryDirectory ?? tmpdir() });
      let closed;
      const close = () => closed ??= processes.close();
      const stop = () => { close().catch(() => {}); };
      signal.addEventListener('abort', stop, { once: true });
      try {
        const { requestId, ...options } = args;
        return await owned.desk[domainActions[action]](requestId, { ...options, signal, processes });
      } finally { signal.removeEventListener('abort', stop); await close(); }
    });
    this.#queues.set(owned.alias, work);
    work.finally(() => { if (this.#queues.get(owned.alias) === work) this.#queues.delete(owned.alias); }).catch(() => {});
    return work;
  }
  async #paidCall(owned, action, input = {}) {
    if (!this.#paid?.call) fail('MERCHANT', 'Configure the original paid-job merchant dependency.');
    return this.#paid.call('merchant_jobs_' + action, { workspace: owned.selected.merchant, ...input });
  }
  async #execute(action, alias, args, signal) {
    signal.throwIfAborted();
    if (action === 'status' && alias === undefined) return this.summary;
    const owned = await this.#open(alias), { selected, workspace, files, desk } = owned;
    signal.throwIfAborted();
    if (args.requestId) matchingRequest(await workspace.intake.get(args.requestId), selected);
    if (args.checkoutId) matchingCheckout(workspace.checkout.get(args.checkoutId), selected);
    if (args.entryId) matchingCustomer(workspace.get(args.entryId), selected);
    let value;
    if (Object.hasOwn(domainActions, action)) {
      value = await this.#scientific(owned, action, args, signal);
    } else switch (action) {
      case 'status':
        value = { ...this.summary, selected: { workspace: alias, merchant: selected.merchant, origin: selected.origin,
          functionId: selected.functionId }, customer: workspace.status() }; break;
      case 'profiles': value = { profiles: desk.profiles() }; break;
      case 'discover': {
        const catalog = await workspace.intake.discover({ origin: selected.origin, signal });
        const definition = catalog.functions.find(item => item.id === selected.functionId);
        if (!definition || !definition.inputFiles?.slots?.source)
          fail('FUNCTION', 'The current original merchant catalogue does not expose the configured complete laboratory function.');
        const file = await files.retain({ workspace: alias, source: { kind: 'original-laboratory-intake-catalogue',
          origin: selected.origin, catalogSha256: catalog.catalogSha256 }, name: 'laboratory-catalogue.json',
          contentType: 'application/json', bytes: bytesOf(catalog) });
        value = { catalogSha256: catalog.catalogSha256, catalogRef: 'file:' + file.fileId, file: fileInfo(file), function: definition }; break;
      }
      case 'request_create': {
        const catalog = validateCatalog(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
          await files.readInput(args.catalogRef, 1048576))), selected.origin);
        if (catalog.publicOrigin !== selected.origin || catalog.catalogSha256 !== args.expectedCatalogSha256)
          fail('CATALOGUE_CHANGED', 'Use the exact retained catalogue for this original merchant.');
        const definition = catalog.functions.find(item => item.id === selected.functionId);
        if (!definition?.inputFiles?.slots?.source) fail('FUNCTION', 'Select the configured complete laboratory function.');
        const parameters = laboratoryParameters(args.parameters);
        if (Object.hasOwn(args.parameters, '$files')) fail('SOURCE', 'Select original source files after creating the native request.');
        const requestId = sha256(canonical(['job-intake', selected.origin, args.reference]));
        let prior = null;
        try { prior = await workspace.intake.get(requestId); }
        catch (error) { if (error.code !== 'JOB_INTAKE_REQUEST_NOT_FOUND') throw error; }
        if (prior) {
          matchingRequest(prior, selected);
          if (!same(laboratoryParameters(prior.input), parameters) || prior.label !== (args.label ?? args.reference) ||
              prior.merchant.catalogSha256 !== catalog.catalogSha256 || prior.merchant.functionSha256 !== definition.functionSha256)
            fail('REQUEST_EXISTS', 'This original reference already belongs to different source parameters or merchant terms.');
          value = { request: prior, reused: true };
        } else value = await workspace.intake.draft({ catalog, functionId: selected.functionId, input: parameters,
          reference: args.reference, label: args.label, accessToken: token(selected, this.#environment) });
        break;
      }
      case 'requests': value = workspace.intake.list(args); break;
      case 'request': value = await workspace.intake.get(args.requestId); break;
      case 'select': {
        const input = await files.inputDescription(args.inputRef);
        if (input.sha256 !== args.expectedSha256) fail('SOURCE_CHANGED', 'Select the complete source file with its original SHA256.');
        await workspace.intake.inputFiles.local(args.requestId, { slot: args.slot, path: input.path,
          filename: input.name, contentType: input.contentType.split(';')[0],
          expectedRevision: args.expectedRevision, signal });
        value = await workspace.intake.get(args.requestId); break;
      }
      case 'remove':
        value = await workspace.intake.inputFiles.remove(args.requestId,
          { slot: args.slot, expectedRevision: args.expectedRevision, signal }); break;
      case 'reviews': value = await desk.reviews(args); break;
      case 'review': value = await desk.saved(args.reviewId); break;
      case 'intake': {
        const { requestId, action: operation, ...options } = args;
        if (operation === 'wait') value = await nativeWait(signal, { expectedTaskId: options.taskId,
          read: () => workspace.intake.get(requestId), stop: taskId => workspace.intake.cancel(requestId, { taskId }),
          wait: taskId => workspace.intake.wait(requestId, { taskId }) });
        else if (operation === 'stop') value = await workspace.intake.cancel(requestId, { taskId: options.taskId });
        else {
          if (options.expectedRevision === undefined) fail('REVISION', 'Use the original request revision for this native intake operation.');
          value = await workspace.intake.start(requestId, { kind: operation, ...options });
        }
        break;
      }
      case 'access_refresh':
        value = await workspace.intake.setAccess(args.requestId, { expectedRevision: args.expectedRevision,
          accessToken: token(selected, this.#environment) }); break;
      case 'checkouts': value = workspace.checkout.list(args); break;
      case 'checkout': value = workspace.checkout.get(args.checkoutId); break;
      case 'checkout_action': {
        const { checkoutId, action: operation, ...options } = args;
        if (operation === 'wait') value = await nativeWait(signal, { expectedTaskId: options.taskId,
          read: () => workspace.checkout.get(checkoutId), stop: taskId => workspace.checkout.cancel(checkoutId, { taskId }),
          wait: taskId => workspace.checkout.wait(checkoutId, { taskId }) });
        else if (operation === 'stop') value = await workspace.checkout.cancel(checkoutId, { taskId: options.taskId });
        else {
          if (options.expectedRevision === undefined) fail('REVISION', 'Use this original checkout revision and its actual review state.');
          value = await workspace.checkout.start(checkoutId, { kind: operation, expectedRevision: options.expectedRevision });
        }
        break;
      }
      case 'approval': value = workspace.checkout.approval(args.checkoutId); break;
      case 'approval_decide': {
        const { checkoutId, ...decision } = args;
        value = await workspace.checkout.decideApproval(checkoutId, decision); break;
      }
      case 'customers': value = workspace.list(args); break;
      case 'customer': value = workspace.get(args.entryId); break;
      case 'customer_action': {
        const { entryId, action: operation, ...options } = args;
        value = operation === 'wait' ? await nativeWait(signal, { expectedTaskId: options.taskId,
          read: () => workspace.get(entryId), stop: taskId => workspace.cancel(entryId, { taskId }),
          wait: taskId => workspace.wait(entryId, { taskId }) }) : operation === 'stop' ? await workspace.cancel(entryId, { taskId: options.taskId }) :
          await workspace.start(entryId, { kind: operation, ...options });
        break;
      }
      case 'merchant_status': value = await this.#paidCall(owned, 'status'); break;
      case 'merchant_job':
      case 'job_action': {
        const job = await this.#paidCall(owned, 'job', { jobId: args.jobId });
        if (job.functionId !== selected.functionId) fail('FUNCTION', 'Select the original laboratory job in this merchant.');
        value = action === 'merchant_job' ? job : await this.#paidCall(owned, args.action,
          { jobId: args.jobId, expectedRevision: args.expectedRevision, reason: args.reason });
        break;
      }
      case 'worker': value = await this.#paidCall(owned, 'worker', { action: args.action }); break;
      case 'result_open': value = await desk.completeResult({ ...args, signal }); break;
      case 'result': value = await desk.result(args.resultId, { member: args.member, offset: args.offset, limit: args.limit, signal }); break;
      case 'files': value = await files.files(args); break;
      case 'file_read': return files.read(args);
      case 'file_release': value = await files.release(args); break;
      case 'input_begin': value = await files.inputBegin(args); break;
      case 'input_status': value = await files.inputStatus(args.inputId); break;
      case 'input_append': value = await files.inputAppend(args); break;
      case 'input_finish': value = await files.inputFinish(args); break;
      default: fail('TOOL', 'Select an original laboratory operation.');
    }
    signal.throwIfAborted();
    return this.#reply(owned, action, value);
  }
  call(name, args = {}) {
    if (this.#closing) return Promise.reject(fault('CLOSING', 'The laboratory owner is closing.'));
    const definition = definitions.get(name);
    if (!definition) return Promise.reject(fault('TOOL', 'Unknown laboratory operator tool.'));
    exact(args, Object.keys(definition.properties), definition.required);
    for (const [key, value] of Object.entries(args)) validate(value, definition.properties[key], key);
    const controller = new AbortController(); this.#controllers.add(controller);
    const { workspace, ...input } = structuredClone(args), action = name.slice('merchant_lab_'.length);
    const work = this.#execute(action, workspace, input, controller.signal);
    this.#active.add(work);
    work.finally(() => { this.#active.delete(work); this.#controllers.delete(controller); }).catch(() => {});
    return work;
  }
  cancel() {
    this.#closing = true;
    for (const controller of this.#controllers) controller.abort(fault('CLOSING', 'The laboratory owner is closing.'));
  }
  close() {
    return this.#closed ??= (async () => {
      this.cancel();
      await Promise.allSettled([...this.#active]);
      const opened = await Promise.allSettled([...this.#desks.values()]);
      const closed = await Promise.allSettled(opened.filter(value => value.status === 'fulfilled').map(value => value.value.close()));
      const failures = closed.filter(value => value.status === 'rejected').map(value => value.reason);
      if (failures.length) throw new AggregateError(failures, 'LAB_ORIGINAL_DESKS_CLOSE_FAILED');
      this.#desks.clear();
    })();
  }
}
