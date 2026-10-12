// MIT. Full original managed water-quality work through the maintained merchant operator.
import { exact, failure, identifier, plain } from './host-files.mjs';
import { WQX_MAX_FILE_BYTES, WqxWorkspaceConnection, wqxDecode, wqxDigest, wqxHash,
  wqxId, wqxInteger, wqxJson, wqxLaunchView, wqxPublic } from './wqx-workspace-connection.mjs';
import { WqxWorkspaceFiles, wqxFileName, wqxPage } from './wqx-workspace-files.mjs';
import { WQX_NATIVE_OPERATIONS, wqxWorkspaceTools } from './catalog/wqx-workspace.mjs';

export { readWqxWorkspaceConfiguration, WQX_WORKSPACE_CONNECTION_SCHEMA } from './wqx-workspace-connection.mjs';
const BULK_BYTES = 64 * 1024 * 1024;
const REVIEW_BUNDLE_BYTES = 96 * 1024 * 1024;
const MAX_INLINE_FIELD_BYTES = 48 * 1024;
const own = (value, key) => Object.hasOwn(value, key);
const definitions = new Map(wqxWorkspaceTools((name, description, properties, required) =>
  [name, { properties, required }]));
const inventoryKeys = Object.freeze({ captures: 'captures', reviews: 'reviews', plans: 'openWaters',
  decisions: 'reviewSheets', editions: 'editions', jobs: 'jobs' });
const recordRoots = Object.freeze({ capture: '/api/captures/', review: '/api/reviews/',
  plan: '/api/open-waters/', decision: '/api/review-sheets/', edition: '/api/editions/' });
const formats = Object.freeze({
  review: ['html', 'json', 'csv', 'geojson', 'bundle'],
  plan: ['json', 'locations', 'results', 'crosswalk', 'report', 'bundle', 'references'],
  decision: ['csv', 'tsv', 'json', 'report', 'bundle', 'native-locations', 'native-results',
    'native-crosswalk', 'native-report', 'native-references', 'native-bundle'],
});
function choose(value, values, label) {
  if (!values.includes(value)) throw failure('INVALID_PARAMS', 'Choose one original ' + label + ': ' + values.join(', ') + '.');
  return value;
}
function boundedText(value, maximum, label) {
  if (typeof value !== 'string' || value.length > maximum || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))
    throw failure('INVALID_PARAMS', 'Use the original ' + label + ' within ' + maximum + ' characters.');
  return value;
}
function shape(value) {
  if (value === null) return { type: 'null', value };
  if (Array.isArray(value)) return { type: 'array', count: value.length };
  if (plain(value)) return { type: 'object', count: Object.keys(value).length };
  if (typeof value === 'string') return { type: 'string', characters: value.length };
  return { type: typeof value, value };
}
function small(value, maximum = MAX_INLINE_FIELD_BYTES) {
  const visible = wqxPublic(value);
  return Buffer.byteLength(JSON.stringify(visible)) <= maximum ? { value: visible } : {};
}
function compact(value) {
  if (!plain(value)) return { ...shape(value), ...small(value) };
  const result = {}, sections = [];
  let used = 0;
  for (const [key, item] of Object.entries(wqxPublic(value))) {
    const bytes = Buffer.byteLength(JSON.stringify(item));
    if (bytes <= MAX_INLINE_FIELD_BYTES && used + bytes <= 192 * 1024) { result[key] = item; used += bytes; }
    else sections.push({ key, pointer: '/' + key.replaceAll('~', '~0').replaceAll('/', '~1'), ...shape(item), bytes });
  }
  if (sections.length) result.retainedSections = sections;
  return result;
}
function pointerValue(document, pointer = '') {
  boundedText(pointer, 1024, 'JSON pointer');
  if (pointer === '') return document;
  if (!pointer.startsWith('/') || /~(?![01])/u.test(pointer)) throw failure('INVALID_PARAMS', 'Use an exact RFC6901 JSON pointer.');
  let value = document;
  for (const encoded of pointer.slice(1).split('/')) {
    const key = encoded.replaceAll('~1', '/').replaceAll('~0', '~');
    if (!value || typeof value !== 'object' || !own(value, key) ||
        Array.isArray(value) && !/^(?:0|[1-9]\d*)$/.test(key))
      throw failure('WQX_POINTER_NOT_FOUND', 'This JSON pointer is absent from the complete original document.');
    value = value[key];
  }
  return value;
}
function inspectDocument(document, pointer, input) {
  const value = pointerValue(document, pointer);
  if (!plain(value) && !Array.isArray(value)) return { pointer, ...shape(value), ...small(value) };
  const entries = (Array.isArray(value) ? value.map((item, index) => [String(index), item]) : Object.entries(value))
    .map(([key, item]) => ({ key, pointer: pointer + '/' + key.replaceAll('~', '~0').replaceAll('/', '~1'), ...shape(item), ...small(item) }));
  // The whole-document hash binds all pages; wqxPage's independent list snapshot is returned for inspection.
  const selected = wqxPage(entries, { offset: input.offset, limit: input.limit,
    expectedSnapshot: (input.offset ?? 0) > 0 ? wqxHash(wqxJson(entries)) : undefined });
  return { pointer, type: Array.isArray(value) ? 'array' : 'object', ...selected };
}
function responseLength(response) {
  const value = response.headers.get('content-length');
  if (value === null) return undefined;
  if (!/^\d+$/.test(value)) throw failure('WQX_RESPONSE_INCOMPLETE', 'The native response has an invalid complete byte length.');
  return wqxInteger(Number(value), 0, WQX_MAX_FILE_BYTES, 'native complete response length');
}
function responseName(response, fallback) {
  const disposition = response.headers.get('content-disposition');
  const name = disposition?.match(/(?:^|;)\s*filename="([^"]+)"/i)?.[1] ?? fallback;
  return wqxFileName(name);
}
function nativeBody(definition, value) {
  exact(value, definition.keys, definition.required);
  for (const key of ['operationId', 'captureId', 'comparisonCaptureId', 'reviewId', 'planId', 'editionId', 'intentId'])
    if (value[key] !== undefined) wqxId(value[key], key);
  for (const key of ['expectedCaptureSha256', 'expectedReviewSha256'])
    if (value[key] !== undefined) wqxDigest(value[key], key);
  if (value.expectedRevision !== undefined) wqxInteger(value.expectedRevision, 0, Number.MAX_SAFE_INTEGER, 'project revision');
  for (const key of ['selection', 'options', 'payment', 'query'])
    if (value[key] !== undefined && !plain(value[key])) throw failure('INVALID_PARAMS', 'Use the original ' + key + ' object.');
  for (const key of ['allowLocalFacilitator', 'challengeOnly'])
    if (value[key] !== undefined && typeof value[key] !== 'boolean') throw failure('INVALID_PARAMS', 'Choose true or false for ' + key + '.');
  return value;
}

export class MerchantWqxWorkspaces {
  #config; #files; #closing = false; #active = new Set(); #close;
  constructor(config) {
    if (!config.wqxWorkspaces) throw failure('CONFIGURATION_ERROR', 'Configure the original WQX workspace connection.');
    this.#config = config.wqxWorkspaces; this.#files = new WqxWorkspaceFiles(config);
  }
  get summary() {
    return { ownership: 'ORIGINAL_MANAGED_WQX_HOST', workspaces: Object.entries(this.#config.workspaces)
      .map(([workspace, item]) => ({ workspace, label: item.label, projectBindingId: item.projectBindingId })),
      ...this.#files.summary };
  }
  async #connection(workspace) {
    const entry = this.#config.workspaces[identifier(workspace, 'Workspace alias')];
    if (!entry) throw failure('WQX_WORKSPACE_NOT_FOUND', 'Choose one original configured WQX project.');
    return new WqxWorkspaceConnection(entry).open();
  }
  async #input(input, key = 'request', referenceKey = 'inputRef', maximum = 2 * 1024 * 1024) {
    if (own(input, key) === own(input, referenceKey)) throw failure('INVALID_PARAMS', 'Supply exactly one ' + key + ' or complete ' + referenceKey + '.');
    const value = own(input, key) ? input[key] : wqxDecode(await this.#files.readInput(input[referenceKey], maximum));
    if (!plain(value)) throw failure('INVALID_PARAMS', 'Use one complete original ' + key + ' object.');
    if (Buffer.byteLength(JSON.stringify(value)) > maximum) throw failure('WQX_INPUT_TOO_LARGE', 'The complete request exceeds this original native operation limit.');
    return value;
  }
  async #retainResponse(connection, workspace, path, response, selector, fallback) {
    return this.#files.retain({ workspace, source: { ...selector, path,
      projectBindingId: connection.launch.value.projectBindingId, managedSourceSha256: connection.launch.value.sourceSha256 },
      name: responseName(response, fallback), contentType: response.headers.get('content-type') ?? 'application/octet-stream',
      stream: response.body ?? [], expectedBytes: responseLength(response), assertSource: () => connection.assertCurrent() });
  }
  async #nativeResult(connection, workspace, operation, path, request, maximumRequestBytes = 2 * 1024 * 1024) {
    const response = await connection.request(path, request, { maximumRequestBytes });
    const file = await this.#retainResponse(connection, workspace, path, response,
      { kind: 'native-response', operation, ...(request === undefined ? {} : { requestSha256: wqxHash(wqxJson(request)) }) },
      operation + '-result.json');
    const value = wqxDecode(await this.#files.readInput('file:' + file.fileId));
    return { workspace, launch: wqxLaunchView(connection.launch), httpStatus: response.status, result: compact(value), file };
  }
  async #status(input) {
    const aliases = input.workspace === undefined ? Object.keys(this.#config.workspaces) : [identifier(input.workspace)];
    const workspaces = [];
    for (const workspace of aliases) {
      const entry = this.#config.workspaces[workspace];
      if (!entry) throw failure('WQX_WORKSPACE_NOT_FOUND', 'Choose one original configured WQX project.');
      try {
        const connection = await this.#connection(workspace), view = connection.workspace;
        workspaces.push({ workspace, label: entry.label, status: 'OPEN', launch: wqxLaunchView(connection.launch),
          project: wqxPublic(view.project), buyerConfigured: view.buyerConfigured,
          runtime: wqxPublic(view.runtime), counts: Object.fromEntries(Object.entries(inventoryKeys).map(([kind, key]) => [kind, view[key]?.length ?? 0])) });
      } catch (error) {
        workspaces.push({ workspace, label: entry.label, projectBindingId: entry.projectBindingId,
          status: error.code === 'ENOENT' || error.code === 'WQX_MANAGED_NOT_RUNNING' ? 'STOPPED' : 'UNAVAILABLE',
          error: { code: error.code ?? 'WQX_WORKSPACE_UNAVAILABLE', message: error.message } });
      }
    }
    return { schema: 'stellar-forge.wqx-operator-status.v1', workspaces, retained: this.#files.summary };
  }
  async #inventory(input) {
    const key = inventoryKeys[choose(input.kind, Object.keys(inventoryKeys), 'inventory')];
    const connection = await this.#connection(input.workspace);
    const result = wqxPage(wqxPublic(connection.workspace[key] ?? []), input);
    return { workspace: input.workspace, kind: input.kind, launch: wqxLaunchView(connection.launch), ...result };
  }
  async #record(input) {
    const root = recordRoots[choose(input.family, Object.keys(recordRoots), 'record family')];
    wqxId(input.id); const pointer = input.pointer ?? '';
    if ((input.offset ?? 0) > 0 && input.expectedDocumentSha256 === undefined)
      throw failure('WQX_SNAPSHOT_REQUIRED', 'Repeat the whole original document hash for a following record page.');
    const connection = await this.#connection(input.workspace), path = root + encodeURIComponent(input.id);
    const response = await connection.request(path);
    const file = await this.#retainResponse(connection, input.workspace, path, response,
      { kind: 'record', family: input.family, id: input.id }, input.id + '-' + input.family + '.json');
    if (input.expectedDocumentSha256 !== undefined && wqxDigest(input.expectedDocumentSha256) !== file.sha256)
      throw failure('WQX_DOCUMENT_CHANGED', 'The original document changed. Reopen its first record page.');
    const document = wqxDecode(await this.#files.readInput('file:' + file.fileId));
    return { workspace: input.workspace, family: input.family, id: input.id, documentSha256: file.sha256,
      launch: wqxLaunchView(connection.launch), file, ...inspectDocument(document, pointer, input) };
  }
  async #targets(input) {
    wqxId(input.planId);
    const offset = wqxInteger(input.offset ?? 0, 0, Number.MAX_SAFE_INTEGER, 'target offset');
    const limit = wqxInteger(input.limit ?? 100, 1, 1000, 'target page length');
    if (offset > 0 && input.expectedPlanSha256 === undefined) throw failure('WQX_SNAPSHOT_REQUIRED', 'Repeat the original plan hash on every following target page.');
    const query = new URLSearchParams({ offset: String(offset), limit: String(limit) });
    if (input.kind !== undefined) choose(input.kind, ['settings', 'location', 'activity', 'result', 'translation', 'limit', 'reference'], 'target kind');
    for (const key of ['kind', 'field', 'search', 'status'])
      if (input[key] !== undefined) query.set(key, boundedText(input[key], key === 'search' ? 500 : 96, key));
    if (input.attentionOnly !== undefined) {
      if (typeof input.attentionOnly !== 'boolean') throw failure('INVALID_PARAMS', 'Choose true or false for attentionOnly.');
      query.set('attentionOnly', String(input.attentionOnly));
    }
    const connection = await this.#connection(input.workspace);
    const result = await connection.json('/api/review-sheets/source/' + encodeURIComponent(input.planId) + '/targets?' + query);
    if (input.expectedPlanSha256 !== undefined && result.source?.sourcePlanSha256 !== wqxDigest(input.expectedPlanSha256))
      throw failure('WQX_PLAN_CHANGED', 'The target page differs from the original selected plan.');
    if (!Array.isArray(result.rows) || !Number.isSafeInteger(result.total) || result.offset !== offset ||
        result.rows.length > limit || offset + result.rows.length > result.total)
      throw failure('WQX_TARGET_PAGE_INCOMPLETE', 'The original target page does not account for its complete cohort.');
    return { workspace: input.workspace, launch: wqxLaunchView(connection.launch), ...result,
      nextOffset: offset + result.rows.length < result.total ? offset + result.rows.length : null };
  }
  async #result(input) {
    wqxId(input.captureId);
    if (typeof input.id !== 'string' || !/^wqx-record-[0-9a-f]{64}$/.test(input.id)) throw failure('INVALID_PARAMS', 'Use the exact original result identifier.');
    const query = new URLSearchParams({ id: input.id, sourceSha256: wqxDigest(input.sourceSha256),
      sourceIndex: String(wqxInteger(input.sourceIndex, 0, Number.MAX_SAFE_INTEGER, 'source index')), captureSha256: wqxDigest(input.captureSha256) });
    const connection = await this.#connection(input.workspace);
    return this.#nativeResult(connection, input.workspace, 'original-result',
      '/api/captures/' + encodeURIComponent(input.captureId) + '/result?' + query, undefined);
  }
  async #file(input) {
    choose(input.family, ['capture', 'review', 'plan', 'decision', 'customer'], 'file family'); wqxId(input.id);
    const connection = await this.#connection(input.workspace);
    let path, format = input.format;
    if (input.family === 'capture') {
      if (format !== undefined) choose(format, ['json', 'source'], 'capture format');
      path = '/api/captures/' + encodeURIComponent(input.id);
      if (input.index !== undefined) path += '/files/' + wqxInteger(input.index, 0, Number.MAX_SAFE_INTEGER, 'source file index');
      else if (format === 'source') throw failure('INVALID_PARAMS', 'Choose the exact source file index from the capture record.');
    } else if (input.family === 'customer') {
      if (format !== undefined) choose(format, ['original'], 'customer file format');
      path = '/api/customer/files/' + encodeURIComponent(input.id) + '/' + encodeURIComponent(wqxId(input.intentId, 'purchase intent'));
    } else {
      format = choose(format ?? 'json', formats[input.family], 'native file format');
      path = recordRoots[input.family] + encodeURIComponent(input.id);
      if (!(input.family === 'plan' && format === 'json')) path += '/' + format;
    }
    if (input.index !== undefined && input.family !== 'capture' || input.intentId !== undefined && input.family !== 'customer')
      throw failure('INVALID_PARAMS', 'Use the original selectors for this file family.');
    const response = await connection.request(path);
    return this.#retainResponse(connection, input.workspace, path, response,
      { kind: 'export', family: input.family, id: input.id, ...(format ? { format } : {}),
        ...(input.index !== undefined ? { index: input.index } : {}), ...(input.intentId ? { intentId: input.intentId } : {}) },
      input.id + '-' + (format ?? input.family) + '.json');
  }
  async #tableExport(input) {
    const format = choose(input.format, ['csv', 'tsv'], 'table format');
    const document = await this.#input(input, 'document', 'documentRef', BULK_BYTES);
    const connection = await this.#connection(input.workspace);
    const value = await connection.json('/api/review-sheets/table', { document, format }, { maximumRequestBytes: BULK_BYTES });
    if (typeof value.text !== 'string') throw failure('WQX_TABLE_INCOMPLETE', 'The original table exporter did not return the complete text.');
    return this.#files.retain({ workspace: input.workspace,
      source: { kind: 'table', format, documentSha256: wqxHash(wqxJson(document)), projectBindingId: connection.launch.value.projectBindingId,
        managedSourceSha256: connection.launch.value.sourceSha256 },
      name: wqxFileName(value.filename), contentType: value.mime, bytes: Buffer.from(value.text, 'utf8'), assertSource: () => connection.assertCurrent() });
  }
  async #tableImport(input) {
    const format = choose(input.format, ['csv', 'tsv'], 'table format');
    const bytes = await this.#files.readInput(input.inputRef, BULK_BYTES); let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw failure('WQX_TABLE_UTF8', 'Use the complete original UTF-8 receiving table.'); }
    const connection = await this.#connection(input.workspace);
    return this.#nativeResult(connection, input.workspace, 'table-import', '/api/review-sheets/import-table', { text, format }, BULK_BYTES);
  }
  async #decisions(input, save) {
    const document = await this.#input(input, 'document', 'documentRef', BULK_BYTES);
    const request = { document, newPlanId: wqxId(input.newPlanId, 'new plan identifier') };
    if (save) { request.reviewId = wqxId(input.reviewId, 'decision review identifier'); request.expectedPreviewSha256 = wqxDigest(input.expectedPreviewSha256); }
    const connection = await this.#connection(input.workspace);
    return this.#nativeResult(connection, input.workspace, save ? 'decisions-save' : 'decisions-preview',
      save ? '/api/review-sheets' : '/api/review-sheets/preview', request, BULK_BYTES);
  }
  async #receive(input) {
    const kind = choose(input.kind, ['review', 'plan', 'decision'], 'complete bundle');
    const maximum = kind === 'review' ? REVIEW_BUNDLE_BYTES : WQX_MAX_FILE_BYTES;
    const bundle = wqxDecode(await this.#files.readInput(input.inputRef, maximum));
    const path = kind === 'review' ? '/api/receive' : kind === 'plan' ? '/api/open-waters/receive' : '/api/review-sheets/receive';
    const connection = await this.#connection(input.workspace);
    return this.#nativeResult(connection, input.workspace, kind + '-receive', path, { bundle }, maximum);
  }
  async #captureImport(input) {
    const source = this.#config.captures[identifier(input.source, 'Capture source alias')];
    if (!source) throw failure('WQX_CAPTURE_SOURCE_NOT_FOUND', 'Choose one host-configured original capture source.');
    const { readCapture } = await import('../../stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/provider.mjs');
    const original = await readCapture(source.directory);
    if (original.captureSha256 !== source.captureSha256) throw failure('WQX_CAPTURE_CHANGED', 'The original configured capture differs from its full source hash.');
    const connection = await this.#connection(input.workspace);
    const request = { sourceDirectory: source.directory, expectedRevision: wqxInteger(input.expectedRevision, 0, Number.MAX_SAFE_INTEGER, 'project revision'),
      ...(input.title === undefined ? {} : { title: boundedText(input.title, 200, 'project title') }) };
    const result = await this.#nativeResult(connection, input.workspace, 'capture-import', '/api/import-capture', request);
    if (result.result.captureSha256 !== source.captureSha256) throw failure('WQX_CAPTURE_CHANGED', 'The native imported capture differs from the configured original source.');
    return result;
  }
  async #call(name, input) {
    switch (name) {
      case 'merchant_wqx_status': return this.#status(input);
      case 'merchant_wqx_inventory': return this.#inventory(input);
      case 'merchant_wqx_record': return this.#record(input);
      case 'merchant_wqx_result': return this.#result(input);
      case 'merchant_wqx_targets': return this.#targets(input);
      case 'merchant_wqx_file': return this.#file(input);
      case 'merchant_wqx_files': return this.#files.files(input);
      case 'merchant_wqx_file_read': return this.#files.read(input);
      case 'merchant_wqx_file_release': return this.#files.release(input);
      case 'merchant_wqx_input_begin': return this.#files.inputBegin(input);
      case 'merchant_wqx_input_append': return this.#files.inputAppend(input);
      case 'merchant_wqx_input_finish': return this.#files.inputFinish(input);
      case 'merchant_wqx_input_status': return this.#files.inputStatus(input.inputId);
      case 'merchant_wqx_input_files': return this.#files.inputFiles();
      case 'merchant_wqx_table_export': return this.#tableExport(input);
      case 'merchant_wqx_table_import': return this.#tableImport(input);
      case 'merchant_wqx_decisions_preview': return this.#decisions(input, false);
      case 'merchant_wqx_decisions_save': return this.#decisions(input, true);
      case 'merchant_wqx_receive': return this.#receive(input);
      case 'merchant_wqx_capture_import': return this.#captureImport(input);
      case 'merchant_wqx_capture_cancel': {
        const connection = await this.#connection(input.workspace);
        return this.#nativeResult(connection, input.workspace, 'capture-cancel',
          '/api/captures/' + encodeURIComponent(wqxId(input.captureId)) + '/cancel', {});
      }
      default: {
        const operation = name.slice('merchant_wqx_'.length), definition = WQX_NATIVE_OPERATIONS[operation];
        if (!definition) throw failure('TOOL_NOT_FOUND', 'Choose an original configured WQX operation.');
        const request = nativeBody(definition, await this.#input(input)), connection = await this.#connection(input.workspace);
        return this.#nativeResult(connection, input.workspace, operation, definition.path, request);
      }
    }
  }
  async call(name, input = {}) {
    if (this.#closing) throw failure('WQX_OPERATOR_CLOSING', 'The original WQX operator is closing.');
    const definition = definitions.get(name);
    if (!definition) throw failure('TOOL_NOT_FOUND', 'Choose an original WQX operation.');
    exact(input, Object.keys(definition.properties), definition.required);
    const promise = this.#call(name, input); this.#active.add(promise);
    try { return await promise; } finally { this.#active.delete(promise); }
  }
  close() {
    this.#closing = true;
    return this.#close ??= (async () => {
      await Promise.allSettled([...this.#active]); await this.#files.close();
      return { closed: true, ownership: 'ORIGINAL_MANAGED_WQX_HOST' };
    })();
  }
}
