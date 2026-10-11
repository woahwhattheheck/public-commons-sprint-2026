// MIT. Original live Analysis transport over the same completed workbook dataset.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createNativeAnalysis } from '../../../../../stellar-forge/mcp-paid-agent/native-analysis.mjs';
import { absolute, privateDirectory, readJson, digest, jsonBytes, exists, need, object }
  from '../../../sf88-operator-buyer-cli/node/store.mjs';
import { retainSame } from './packet.mjs';

const INTAKE = 'stellar-forge.workbook-analysis-intake.v1';
const RESULT = 'stellar-forge.workbook-analysis-result.v1';
const RECOVERED_SELECTION = 'stellar-forge.workbook-analysis-selection-recovery.v1';
const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const ID = /^[a-f0-9]{32}$/;
const HASH = /^[a-f0-9]{64}$/;
const clone = value => structuredClone(value);
const same = (a, b) => jsonBytes(a).equals(jsonBytes(b));

/** Registers an already running original AnalysisWorkspace. Its exclusive
 * database lock, source CAS, import jobs, SQL engine and export jobs stay native.
 */
export class WorkbookAnalysis {
  constructor({customer, room, alias}) {
    need(customer && typeof customer.analysisSource === 'function' &&
      typeof customer.review === 'function' && typeof customer.directory === 'string',
    'WORKBOOK_CUSTOMER_REQUIRED');
    need(NAME.test(alias ?? ''), 'WORKBOOK_ANALYSIS_ALIAS_INVALID');
    this.customer = customer;
    this.room = absolute(room);
    this.alias = alias;
    this.directory = join(customer.directory, 'analysis', 'workbook-intakes');
    this._closed = false;
    this._native = createNativeAnalysis({
      manifest:{directory:customer.directory},
      completedDataset:async id => {
        const source = await customer.analysisSource(this.room);
        need(id === source.acquisitionId, 'WORKBOOK_ANALYSIS_ACQUISITION_CHANGED');
        return source;
      },
      isClosed:() => this._closed,
    });
  }
  register(database) { return this._native.register({name:this.alias, database:absolute(database)}); }
  /** Original operation, request and integer encoding are returned unchanged. */
  call(operation, request = {}, options) {
    return this._native.call({action:'analysis', analysisWorkspace:this.alias,
      analysisOperation:operation, analysisRequest:request}, options);
  }
  async _plan(id) {
    need(ID.test(id ?? ''), 'WORKBOOK_ANALYSIS_JOB_ID_INVALID');
    const plan = await readJson(join(this.directory, id, 'request.json'), 262144);
    const review = await this.customer.review();
    const source = await this.customer.analysisSource(this.room);
    need(plan.schema === INTAKE && plan.id === id &&
      plan.packetSha256 === review.packetSha256 && plan.analysisWorkspace === this.alias &&
      same(plan.nativeSource, source), 'WORKBOOK_ANALYSIS_INTAKE_CHANGED');
    return plan;
  }
  /** Retains a complete import/selection intent before the first source write.
   * Repeating the same intent reuses its original 32-hex import ID.
   */
  async receive({id, source, expectedSourceRevision = 0, columnsText = '{}',
    view, expectedViewRevision = 0, wait = true, signal, progress} = {}) {
    need(NAME.test(source ?? '') && Number.isSafeInteger(expectedSourceRevision) &&
      expectedSourceRevision >= 0, 'WORKBOOK_ANALYSIS_SOURCE_INVALID');
    need(typeof columnsText === 'string' && Buffer.byteLength(columnsText) <= 65536,
      'WORKBOOK_ANALYSIS_COLUMNS_TEXT_INVALID');
    need(view === undefined || NAME.test(view), 'WORKBOOK_ANALYSIS_VIEW_INVALID');
    need(Number.isSafeInteger(expectedViewRevision) && expectedViewRevision >= 0,
      'WORKBOOK_ANALYSIS_VIEW_REVISION_INVALID');
    const review = await this.customer.review(), nativeSource = await this.customer.analysisSource(this.room);
    const identity = {schema:INTAKE, packetSha256:review.packetSha256, analysisWorkspace:this.alias,
      nativeSource, source, expectedSourceRevision, columnsText,
      view:view ?? null, expectedViewRevision};
    id ??= digest(jsonBytes(identity)).slice(0, 32);
    need(ID.test(id), 'WORKBOOK_ANALYSIS_JOB_ID_INVALID');
    const plan = {...identity, id};
    const directory = await privateDirectory(join(this.directory, id));
    await retainSame(join(directory, 'request.json'), jsonBytes(plan));
    return this.resume(id, {wait, signal, progress});
  }
  /** Resume source registration/import/activation from the retained intent.
   * Source and activation receipts are immutable; moving job state is read from
   * the original workspace instead of copied into a second job store.
   */
  async resume(id, {wait = true, signal, progress} = {}) {
    need(typeof wait === 'boolean' && (progress === undefined || typeof progress === 'function'),
      'WORKBOOK_ANALYSIS_WAIT_OPTIONS_INVALID');
    const plan = await this._plan(id), directory = join(this.directory, id);
    const sourcePath = join(directory, 'source.json');
    let registered;
    if (await exists(sourcePath)) registered = await readJson(sourcePath, 1048576);
    else {
      registered = await this.call('attach-dataset', {
        acquisition_id:plan.nativeSource.acquisitionId, name:plan.source,
        expected_revision:plan.expectedSourceRevision,
      }, {signal});
      await retainSame(sourcePath, jsonBytes(registered));
    }
    need(registered.schema === 'stellar-forge.mcp-native-analysis.v1' &&
      registered.analysisWorkspace === this.alias && registered.operation === 'attach-dataset' &&
      registered.result?.name === plan.source && Number.isSafeInteger(registered.result.revision) &&
      registered.result.revision > 0 &&
      registered.result.configuration_sha256 === plan.nativeSource.configurationSha256 &&
      registered.result.session_id === plan.nativeSource.sessionId &&
      registered.result.native_delivery?.sourceBindingSha256 === plan.nativeSource.sourceBindingSha256,
    'WORKBOOK_ANALYSIS_SOURCE_RECEIPT_CHANGED');
    // Original start(import) validates the CURRENT source before reopening an
    // existing ID. Read the retained job first so later source revisions cannot
    // strand this completed historical import or a lost initial response.
    let job;
    try { job = await this.call('job', {id:plan.id}, {signal}); }
    catch (error) {
      if (error.code !== 'ANALYSIS_JOB_NOT_FOUND') throw error;
      job = await this.call('import', {id:plan.id, source:registered.result.name,
        source_revision:registered.result.revision, columns_text:plan.columnsText}, {signal});
    }
    this._checkImport(plan, registered.result, job);
    progress?.(job);
    if (wait && job.result.status === 'RUNNING') {
      job = await this.waitJob(plan.id, {signal, progress});
      this._checkImport(plan, registered.result, job);
    }
    let activation = null;
    if (plan.view !== null && job.result.status === 'COMPLETE') {
      const version = job.result.result?.version?.version_id;
      need(HASH.test(version ?? ''), 'WORKBOOK_ANALYSIS_IMPORTED_VERSION_REQUIRED');
      activation = await this._selection(plan, version, directory, {signal});
    }
    return {schema:RESULT, id:plan.id, packetSha256:plan.packetSha256,
      analysisWorkspace:this.alias, source:clone(registered.result), job, activation};
  }
  _checkImport(plan, registered, response) {
    const job = response?.result, selected = job?.request?.source;
    let columns;
    try { columns = JSON.parse(plan.columnsText); }
    catch { need(false, 'WORKBOOK_ANALYSIS_COLUMN_MAPPING_INVALID'); }
    need(object(columns) && Object.values(columns).every(value => typeof value === 'string'),
      'WORKBOOK_ANALYSIS_COLUMN_MAPPING_INVALID');
    need(response.schema === 'stellar-forge.mcp-native-analysis.v1' &&
      response.analysisWorkspace === this.alias && ['job','import'].includes(response.operation) &&
      job?.id === plan.id && job.kind === 'import' && job.request?.id === plan.id &&
      object(selected) &&
      ['name','revision','session_sha256','configuration_sha256','session_id','snapshot'].every(key =>
        Object.hasOwn(registered,key) && selected[key] === registered[key]) &&
      object(job.request.columns) && Object.keys(job.request.columns).length === Object.keys(columns).length &&
      Object.keys(columns).every(key => Object.hasOwn(job.request.columns,key) &&
        job.request.columns[key] === columns[key]),
    'WORKBOOK_ANALYSIS_ORIGINAL_IMPORT_CHANGED');
    // A manually registered source may lack native_delivery in the persisted
    // source record; the original attach reply still carries the verified one.
    if (selected.native_delivery !== undefined)
      need(selected.native_delivery.sourceBindingSha256 === plan.nativeSource.sourceBindingSha256 &&
        selected.native_delivery.manifestSha256 === registered.native_delivery.manifestSha256,
      'WORKBOOK_ANALYSIS_IMPORTED_SOURCE_CHANGED');
  }
  async _selection(plan, version, directory, {signal}) {
    const activationPath = join(directory, 'activation.json');
    const recoveredPath = join(directory, 'activation-recovery.json');
    let receipt;
    if (await exists(activationPath)) receipt = await readJson(activationPath, 1048576);
    else if (await exists(recoveredPath)) receipt = await readJson(recoveredPath, 1048576);
    else {
      try {
        receipt = await this.call('activate', {name:plan.view, version_id:version,
          expected_revision:plan.expectedViewRevision}, {signal});
      } catch (error) {
        if (signal?.aborted || !['DATASET_SQL_VIEW_CHANGED',
          'MCP_ANALYSIS_REPLY_UNCERTAIN_REOPEN_ORIGINAL_JOB',
          'MCP_ANALYSIS_CALL_INTERRUPTED_REOPEN_ORIGINAL_JOB'].includes(error.code)) throw error;
        // A successful native CAS may outlive its final reply. Observe the
        // original selected view; keep this as an observed-state receipt,
        // distinct from an activation response. Other revisions stay conflicts.
        const state = await this.call('state', {}, {signal});
        const selected = state.result?.views?.find(view => view.name === plan.view);
        if (!selected || selected.version_id !== version ||
          ![plan.expectedViewRevision,plan.expectedViewRevision+1].includes(selected.revision)) throw error;
        receipt = {schema:RECOVERED_SELECTION, analysisWorkspace:this.alias,
          status:'ORIGINAL_SELECTION_OBSERVED', expectedRevision:plan.expectedViewRevision,
          selected:clone(selected), state};
        await retainSame(recoveredPath, jsonBytes(receipt));
      }
      if (receipt.schema !== RECOVERED_SELECTION)
        await retainSame(activationPath, jsonBytes(receipt));
    }
    if (receipt.schema === RECOVERED_SELECTION) {
      const selected = receipt.state?.result?.views?.find(view => view.name === plan.view);
      need(receipt.analysisWorkspace === this.alias && receipt.status === 'ORIGINAL_SELECTION_OBSERVED' &&
        receipt.expectedRevision === plan.expectedViewRevision &&
        receipt.state?.schema === 'stellar-forge.mcp-native-analysis.v1' &&
        receipt.state.analysisWorkspace === this.alias && receipt.state.operation === 'state' &&
        selected?.version_id === version &&
        [plan.expectedViewRevision,plan.expectedViewRevision+1].includes(selected.revision) &&
        same(receipt.selected, selected), 'WORKBOOK_ANALYSIS_SELECTION_RECEIPT_CHANGED');
    } else need(receipt.schema === 'stellar-forge.mcp-native-analysis.v1' &&
      receipt.analysisWorkspace === this.alias && receipt.operation === 'activate' &&
      receipt.result?.name === plan.view && receipt.result?.version?.version_id === version &&
      [plan.expectedViewRevision,plan.expectedViewRevision+1].includes(receipt.result.revision),
    'WORKBOOK_ANALYSIS_SELECTION_RECEIPT_CHANGED');
    return receipt;
  }
  async waitJob(id, {signal, progress, intervalMs = 700} = {}) {
    need(ID.test(id ?? '') && Number.isSafeInteger(intervalMs) &&
      intervalMs >= 200 && intervalMs <= 60000 &&
      (progress === undefined || typeof progress === 'function'),
    'WORKBOOK_ANALYSIS_WAIT_OPTIONS_INVALID');
    for (;;) {
      const job = await this.call('job', {id}, {signal});
      need(job.result?.id === id && typeof job.result.status === 'string',
        'WORKBOOK_ANALYSIS_ORIGINAL_JOB_REQUIRED');
      progress?.(job);
      if (job.result.status !== 'RUNNING') return job;
      await delay(intervalMs, undefined, {signal});
    }
  }
  async *history() {
    if (!await exists(this.directory)) return;
    await privateDirectory(this.directory, {create:false});
    for (const id of (await readdir(this.directory)).filter(name => ID.test(name)).sort()) {
      const plan = await this._plan(id);
      yield {id, packetSha256:plan.packetSha256, analysisWorkspace:plan.analysisWorkspace,
        source:plan.source, expectedSourceRevision:plan.expectedSourceRevision,
        view:plan.view, expectedViewRevision:plan.expectedViewRevision,
        sourceRetained:await exists(join(this.directory, id, 'source.json')),
        selectionRetained:await exists(join(this.directory, id, 'activation.json')) ||
          await exists(join(this.directory, id, 'activation-recovery.json'))};
    }
  }
  async close() {
    if (this._closed) return;
    this._closed = true;
    await this._native.close();
  }
}
