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
      registered.result.revision > 0, 'WORKBOOK_ANALYSIS_SOURCE_RECEIPT_CHANGED');
    let job = await this.call('import', {id:plan.id, source:registered.result.name,
      source_revision:registered.result.revision, columns_text:plan.columnsText}, {signal});
    progress?.(job);
    if (wait && job.result?.status === 'RUNNING')
      job = await this.waitJob(plan.id, {signal, progress});
    need(job.result?.id === plan.id && job.result.kind === 'import',
      'WORKBOOK_ANALYSIS_ORIGINAL_IMPORT_REQUIRED');
    let activation = null;
    if (plan.view !== null && job.result.status === 'COMPLETE') {
      const version = job.result.result?.version?.version_id;
      need(HASH.test(version ?? ''), 'WORKBOOK_ANALYSIS_IMPORTED_VERSION_REQUIRED');
      const activationPath = join(directory, 'activation.json');
      if (await exists(activationPath)) activation = await readJson(activationPath, 1048576);
      else {
        activation = await this.call('activate', {name:plan.view, version_id:version,
          expected_revision:plan.expectedViewRevision}, {signal});
        await retainSame(activationPath, jsonBytes(activation));
      }
      need(activation.schema === 'stellar-forge.mcp-native-analysis.v1' &&
        activation.analysisWorkspace === this.alias && activation.operation === 'activate' &&
        activation.result?.version?.version_id === version,
      'WORKBOOK_ANALYSIS_SELECTION_RECEIPT_CHANGED');
    }
    return {schema:RESULT, id:plan.id, packetSha256:plan.packetSha256,
      analysisWorkspace:this.alias, source:clone(registered.result), job, activation};
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
        selectionRetained:await exists(join(this.directory, id, 'activation.json'))};
    }
  }
  async close() {
    if (this._closed) return;
    this._closed = true;
    await this._native.close();
  }
}
