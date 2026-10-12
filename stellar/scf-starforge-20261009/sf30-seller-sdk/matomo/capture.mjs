// MIT. Complete native processed-report pages, distinct subtable actions and retained source lineage.
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { privateDirectory, bytes, identity, digest, fault, stamp } from '../postgres/publisher/files.mjs';
import { reportingScope, selection, reportIdentity, identifier, plain, only, text } from './contract.mjs';
import { parseNative, encodeNative, nativeHash, scalarText, nativeInteger, shown, cell } from './values.mjs';
import { writeNew, readRetained as readPrivate } from './store.mjs';

const objectRow = row => row ? {...row, data: JSON.parse(row.data), ...(row.scope ? {scope: JSON.parse(row.scope)} : {}),
  ...(row.selection ? {selection: JSON.parse(row.selection)} : {})} : null;
function scalarParameters(parameters) {
  const result = {};
  for (const [key, value] of Object.entries(parameters ?? {})) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(key) || value === null || typeof value === 'object' && !value?.toString)
      throw fault('MATOMO_REPORT_PARAMETERS_UNSUPPORTED');
    result[key] = scalarText(value);
  }
  return result;
}
function catalogReports(value) {
  if (!Array.isArray(value) || value.length > 4096) throw fault('MATOMO_REPORT_CATALOG_SHAPE');
  const seen = new Set();
  return value.map(raw => {
    const id = reportIdentity(raw);
    if (seen.has(id)) throw fault('MATOMO_REPORT_CATALOG_DUPLICATE');
    seen.add(id);
    let parameters, parameterError = null;
    try { parameters = scalarParameters(raw.parameters ?? {}); }
    catch (error) { parameters = shown(raw.parameters ?? {}); parameterError = error.code; }
    return {...shown(raw), id, sourceSha256: nativeHash(raw), parameters, parameterError};
  });
}
function reportPage(value, report) {
  if (!plain(value) || !plain(value.metadata) || !Object.hasOwn(value, 'reportData')) throw fault('MATOMO_PROCESSED_REPORT_SHAPE');
  if (value.metadata.module && value.metadata.module !== report.module ||
      value.metadata.action && value.metadata.action !== report.action) throw fault('MATOMO_PROCESSED_REPORT_IDENTITY');
  let rows, shape;
  if (Array.isArray(value.reportData)) { rows = value.reportData; shape = 'array'; }
  else if (plain(value.reportData)) { rows = [value.reportData]; shape = 'object'; }
  else throw fault('MATOMO_PROCESSED_REPORT_ROWS');
  if (rows.some(row => !plain(row))) throw fault('MATOMO_PROCESSED_REPORT_ROW');
  const supplied = value.reportMetadata ?? [];
  let metadata;
  if (Array.isArray(supplied)) {
    if (supplied.length !== 0 && supplied.length !== rows.length) throw fault('MATOMO_PROCESSED_METADATA_ALIGNMENT');
    metadata = supplied.length ? supplied : rows.map(() => ({}));
  } else if (plain(supplied) && Object.keys(supplied).length === 0) metadata = rows.map(() => ({}));
  else throw fault('MATOMO_PROCESSED_METADATA_ALIGNMENT');
  if (metadata.some(row => !plain(row))) throw fault('MATOMO_PROCESSED_ROW_METADATA');
  return {rows, metadata, shape, native: value};
}
function subtableId(row, metadata) {
  const value = Object.hasOwn(metadata, 'idsubdatatable') ? metadata.idsubdatatable : row.idsubdatatable;
  if (value === undefined || value === null || value === false || scalarText(value) === '0') return null;
  const integer = nativeInteger(value, {minimum: 1});
  return String(integer);
}
function summaryState(row, metadata) {
  for (const key of ['is_aggregate', 'isSummaryRow']) {
    const value = Object.hasOwn(metadata, key) ? metadata[key] : row[key];
    if (value !== undefined && value !== null) {
      const flag = scalarText(value);
      if (flag === 'true' || flag === '1') return true;
      if (flag === 'false' || flag === '0') return false;
    }
  }
  return null;
}
function requestDescriptor(store, id) {
  const retained = store.db.prepare('SELECT * FROM requests WHERE id=?').get(id);
  if (!retained || retained.state !== 'COMPLETE') throw fault('MATOMO_CAPTURE_REQUEST_INCOMPLETE');
  const attempt = store.db.prepare('SELECT * FROM attempts WHERE request_id=? AND number=?').get(id, retained.accepted_attempt);
  const result = JSON.parse(attempt.result);
  return {id, kind: retained.kind, attempt: retained.accepted_attempt, path: attempt.body_path,
    receiptPath: 'requests/' + id + '-' + retained.accepted_attempt + '.receipt.json',
    sha256: result.bodySha256, bytes: result.bodyBytes, startedAt: result.startedAt, completedAt: result.completedAt, status: result.status};
}
export function createMatomoCaptures(store) {
  const {db} = store;
  function catalog(id) {
    const value = objectRow(db.prepare('SELECT * FROM catalogs WHERE id=?').get(identifier(id, 'catalog')));
    if (!value) throw fault('MATOMO_CATALOG_NOT_FOUND', 'Choose a retained report catalog.', 404);
    return value;
  }
  function capture(id) {
    const value = objectRow(db.prepare('SELECT * FROM captures WHERE id=?').get(identifier(id, 'capture')));
    if (!value) throw fault('MATOMO_CAPTURE_NOT_FOUND', 'Choose a retained report capture.', 404);
    return value;
  }
  function tables(id) {
    capture(id);
    return db.prepare('SELECT * FROM capture_tables WHERE capture_id=? ORDER BY rowid').all(id).map(objectRow);
  }
  function table(id, tableId) {
    const value = objectRow(db.prepare('SELECT * FROM capture_tables WHERE capture_id=? AND id=?').get(id, tableId));
    if (!value) throw fault('MATOMO_TABLE_NOT_FOUND', 'Choose a retained native report table.', 404);
    return value;
  }
  function updateCapture(id, state, patch) {
    const current = capture(id), data = {...current.data, ...patch};
    db.prepare('UPDATE captures SET state=?,data=?,updated_at=? WHERE id=?').run(state, JSON.stringify(data), stamp(), id);
    return {...current, state, data};
  }
  async function runCatalog(id, {signal, retry}) {
    let current = catalog(id);
    if (current.data.manifestPending) {
      const pending = current.data.manifestPending;
      let raw = null;
      try { raw = await readPrivate(join(store.directory, pending.path), 16777216); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (raw) {
        if (raw.length !== pending.bytes || digest(raw) !== pending.sha256) throw fault('MATOMO_CATALOG_MANIFEST_CHANGED');
        store.transaction(() => {
          const {manifestPending, ...data} = current.data;
          db.prepare('UPDATE catalogs SET state=?,data=? WHERE id=?').run('COMPLETE', JSON.stringify({...data, manifest: pending}), id);
          store.event('CATALOG_FINALIZATION_RECOVERED', id);
        });
        return {catalog: catalog(id)};
      }
    }
    const owner = 'catalog/' + id, outcomes = {...current.data.outcomes};
    try {
      const reportResult = await store.request(owner, 'reports', {scope: current.scope}, {signal, retry});
      const reports = catalogReports(reportResult.value);
      outcomes.reports = {requestId: reportResult.id, ok: true};
      store.transaction(() => {
        db.prepare('UPDATE catalogs SET state=?,data=? WHERE id=?').run('DISCOVERING', JSON.stringify({...current.data, reports, outcomes}), id);
        store.event('CATALOG_REPORTS_RETAINED', id, {reports: reports.length, requestId: reportResult.id});
      });
      for (const kind of ['segments', 'site', 'version']) {
        signal.throwIfAborted();
        if (outcomes[kind]) continue;
        try {
          const response = await store.request(owner, kind, {scope: current.scope}, {signal, retry});
          outcomes[kind] = {requestId: response.id, ok: true, value: shown(response.value)};
        } catch (error) {
          if (signal.aborted) throw error;
          outcomes[kind] = {ok: false, error: error.code ?? 'MATOMO_METADATA_UNAVAILABLE'};
        }
        store.transaction(() => {
          current = catalog(id);
          db.prepare('UPDATE catalogs SET data=? WHERE id=?').run(JSON.stringify({...current.data, reports, outcomes}), id);
          store.event('CATALOG_CONTEXT_RETAINED', id, {kind, ok: outcomes[kind].ok});
        });
      }
      current = catalog(id);
      const {manifestPending: oldPending, ...priorData} = current.data;
      const data = {...priorData, reports, outcomes, completedAt: current.data.completedAt ?? stamp(),
        semantics: 'Native report catalog and observed source capabilities; report availability and segment permission remain server controlled.'};
      store.transaction(() => db.prepare('UPDATE catalogs SET state=?,data=? WHERE id=?').run('FINALIZING', JSON.stringify(data), id));
      const document = {schema: 'stellar-forge.matomo-catalog.v1', id, sourceSha256: store.settings.sourceSha256,
        source: store.settings.source, scope: current.scope, createdAt: current.created_at, ...data};
      const content = bytes(document), path = join(store.directory, 'catalogs', id + '.json');
      if (content.length > 16777216) throw fault('MATOMO_CATALOG_MANIFEST_LIMIT');
      store.transaction(() => db.prepare('UPDATE catalogs SET data=? WHERE id=?').run(JSON.stringify({...data, manifestPending: {path: 'catalogs/' + id + '.json', sha256: digest(content), bytes: content.length}}), id));
      await writeNew(path, content);
      store.transaction(() => {
        db.prepare('UPDATE catalogs SET state=?,data=? WHERE id=?').run('COMPLETE', JSON.stringify({...data, manifest: {path: 'catalogs/' + id + '.json', sha256: digest(content), bytes: content.length}}), id);
        store.event('CATALOG_COMPLETED', id, {reports: reports.length});
      });
      return {catalog: catalog(id)};
    } catch (error) {
      store.transaction(() => {
        current = catalog(id);
        db.prepare('UPDATE catalogs SET state=?,data=? WHERE id=?').run(signal.aborted ? 'CANCELLED' : 'FAILED', JSON.stringify({...current.data, error: error.code ?? 'MATOMO_CATALOG_FAILED'}), id);
        store.event('CATALOG_STOPPED', id, {error: error.code ?? 'MATOMO_CATALOG_FAILED'});
      });
      throw error;
    }
  }
  async function discover(input) {
    only(input, ['operationId', 'expectedRevision', 'scope']);
    const scope = reportingScope(input.scope), id = identifier(input.operationId, 'catalog');
    return store.perform('discover', input, async ({signal}) => {
      store.transaction(() => {
        db.prepare('INSERT INTO catalogs(id,scope,state,data,created_at) VALUES(?,?,?,?,?)').run(id, JSON.stringify(scope), 'DISCOVERING', JSON.stringify({outcomes: {}}), stamp());
      });
      return runCatalog(id, {signal, retry: false});
    });
  }
  async function resumeCatalog(input) {
    only(input, ['operationId', 'expectedRevision', 'catalogId']);
    const selected = catalog(input.catalogId);
    return store.perform('resume-catalog', input, async ({signal}) => {
      if (selected.state === 'COMPLETE') return {catalog: selected};
      return runCatalog(selected.id, {signal, retry: true});
    });
  }
  function childReport(selectedCatalog, report, responseMetadata, rules) {
    const override = rules[report.id];
    if (override) {
      const selected = selectedCatalog.data.reports.find(item => item.id === override);
      if (!selected || selected.parameterError) throw fault('MATOMO_SUBTABLE_RULE_REPORT');
      return selected;
    }
    const declared = responseMetadata.actionToLoadSubTables ?? report.actionToLoadSubTables;
    if (typeof declared !== 'string' || !declared) return null;
    const parts = declared.split('.');
    const module = parts.length === 2 ? parts[0] : report.module, action = parts.length === 2 ? parts[1] : declared;
    const matching = selectedCatalog.data.reports.filter(item => item.module === module && item.action === action && !item.parameterError);
    const exact = matching.filter(item => identity(item.parameters ?? {}) === identity(report.parameters ?? {}));
    return exact.length === 1 ? exact[0] : matching.length === 1 ? matching[0] : null;
  }
  function insertTable(captureId, value) {
    db.prepare('INSERT INTO capture_tables(capture_id,id,data) VALUES(?,?,?)').run(captureId, value.id, JSON.stringify(value));
  }
  function updateTable(captureId, value) {
    db.prepare('UPDATE capture_tables SET data=? WHERE capture_id=? AND id=?').run(JSON.stringify(value), captureId, value.id);
  }
  async function runCapture(id, {signal, retry}) {
    let current = capture(id), selectedCatalog = catalog(current.selection.catalogId);
    const selected = current.selection, owner = 'capture/' + id;
    if (current.data.manifestPending) {
      const pending = current.data.manifestPending;
      let raw = null;
      try { raw = await readPrivate(join(store.directory, pending.path), 16777216); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (raw) {
        if (raw.length !== pending.bytes || digest(raw) !== pending.sha256) throw fault('MATOMO_CAPTURE_MANIFEST_CHANGED');
        store.transaction(() => { updateCapture(id, 'COMPLETE', {manifest: pending}); store.event('CAPTURE_FINALIZATION_RECOVERED', id); });
        return {capture: capture(id), tables: tables(id)};
      }
    }
    store.transaction(() => { updateCapture(id, 'CAPTURING', {error: null}); store.event('CAPTURE_CONTINUED', id); });
    try {
      for (;;) {
        signal.throwIfAborted();
        current = capture(id);
        const pending = tables(id).find(item => ['PENDING', 'NEEDS_MAPPING'].includes(item.data.state));
        if (!pending) break;
        let item = pending.data;
        if (item.state === 'NEEDS_MAPPING') {
          const parent = table(id, item.parentTable).data;
          const chosen = childReport(selectedCatalog, parent.report, parent.responseMetadata ?? {}, current.data.subtableRules);
          if (!chosen) {
            store.transaction(() => { updateCapture(id, 'NEEDS_SUBTABLE_MAPPING', {pendingTable: item.id, error: null}); store.event('CAPTURE_MAPPING_REQUIRED', id, {tableId: item.id, parentReportId: parent.report.id}); });
            return {capture: capture(id), tables: tables(id)};
          }
          item = {...item, report: chosen, state: 'PENDING'};
          store.transaction(() => updateTable(id, item));
        }
        const limits = current.data.limits;
        if (item.depth > limits.maxDepth) throw fault('MATOMO_CAPTURE_DEPTH_LIMIT');
        const progress = current.data.progress;
        if (progress.requests >= limits.maxRequests || progress.rows > limits.maxRows || progress.bytes >= limits.maxBytes) throw fault('MATOMO_CAPTURE_LIMIT_REACHED');
        const response = await store.request(owner, 'processed', {scope: selected.scope, report: {
          module: item.report.module, action: item.report.action, parameters: item.report.parameters ?? {}},
          idSubtable: item.idSubtable, offset: item.offset, limit: selected.pageSize}, {signal, retry});
        const page = reportPage(response.value, item.report);
        if (page.rows.length > selected.pageSize && page.shape === 'array') throw fault('MATOMO_PAGE_LIMIT_NOT_APPLIED');
        if (progress.rows + page.rows.length > limits.maxRows || progress.bytes + response.raw.length > limits.maxBytes) throw fault('MATOMO_CAPTURE_LIMIT_REACHED');
        const reportMetadata = shown(page.native.metadata), columns = shown(page.native.columns ?? {});
        const newIssues = [];
        if (item.columnsHash && item.columnsHash !== nativeHash(page.native.columns ?? {})) newIssues.push({code: 'COLUMNS_CHANGED_BETWEEN_PAGES', tableId: item.id, requestId: response.id});
        if (item.totalHash && item.totalHash !== nativeHash(page.native.reportTotal ?? null)) newIssues.push({code: 'TOTAL_CHANGED_BETWEEN_PAGES', tableId: item.id, requestId: response.id});
        const rows = page.rows.map((data, index) => {
          const metadata = page.metadata[index], rowIndex = item.offset + index;
          const rowId = identity({captureId: id, tableId: item.id, index: rowIndex});
          const label = Object.hasOwn(data, 'label') ? cell(data.label) : {kind: 'absent', text: null};
          const context = {tableId: item.id, parentRowId: item.parentRowId, parentTable: item.parentTable,
            depth: item.depth, path: [...item.path, label], reportId: item.report.id, rowIndex,
            isSummary: summaryState(data, metadata), idSubtable: subtableId(data, metadata)};
          return {id: rowId, rowIndex, sourceIndex: index, data, metadata, context};
        });
        const candidateChild = childReport(selectedCatalog, item.report, reportMetadata, current.data.subtableRules);
        store.transaction(() => {
          for (const row of rows) {
            db.prepare('INSERT INTO report_rows(capture_id,id,table_id,row_index,source_request,source_index,data_json,metadata_json,context) VALUES(?,?,?,?,?,?,?,?,?)')
              .run(id, row.id, item.id, row.rowIndex, response.id, row.sourceIndex, encodeNative(row.data), encodeNative(row.metadata), JSON.stringify(row.context));
            if (row.context.idSubtable && selected.subtables) {
              const chainKey = item.report.module + '.' + item.report.action + '/' + row.context.idSubtable;
              if (item.ancestors.includes(chainKey)) {
                newIssues.push({code: 'SUBTABLE_CYCLE', rowId: row.id, idSubtable: row.context.idSubtable}); continue;
              }
              const childId = identity({parent: row.id, idSubtable: row.context.idSubtable});
              insertTable(id, {id: childId, parentRowId: row.id, parentTable: item.id, depth: item.depth + 1,
                path: row.context.path, idSubtable: row.context.idSubtable, report: candidateChild,
                ancestors: [...item.ancestors, chainKey], offset: 0, pages: [], state: candidateChild ? 'PENDING' : 'NEEDS_MAPPING'});
            }
          }
          const terminal = page.shape === 'object' || page.rows.length < selected.pageSize;
          item = {...item, state: terminal ? 'COMPLETE' : 'PENDING', offset: item.offset + page.rows.length,
            responseMetadata: reportMetadata, columns, columnsHash: nativeHash(page.native.columns ?? {}),
            totalHash: nativeHash(page.native.reportTotal ?? null), reportTotal: shown(page.native.reportTotal ?? null),
            prettyDate: shown(page.native.prettyDate ?? null), website: shown(page.native.website ?? null),
            pages: [...item.pages, {requestId: response.id, offset: item.offset, returned: page.rows.length, terminal, shape: page.shape}]};
          updateTable(id, item);
          current = capture(id);
          updateCapture(id, 'CAPTURING', {progress: {requests: progress.requests + 1, rows: progress.rows + rows.length, bytes: progress.bytes + response.raw.length},
            issues: [...current.data.issues, ...newIssues]});
          store.event('REPORT_PAGE_RETAINED', id, {tableId: item.id, requestId: response.id, rows: page.rows.length, terminal});
        });
      }
      current = capture(id);
      const tableRecords = tables(id).map(row => {
        const {responseMetadata, report, ...data} = row.data;
        return {...data, report: {id: report.id, module: report.module, action: report.action, parameters: report.parameters, sourceSha256: report.sourceSha256}};
      });
      const rowDigest = createHash('sha256');
      let summaryRows = 0, childReferences = 0;
      for (const row of db.prepare('SELECT * FROM report_rows WHERE capture_id=? ORDER BY rowid').iterate(id)) {
        rowDigest.update(row.id + '\n' + row.data_json + '\n' + row.metadata_json + '\n' + row.context + '\n');
        const context = JSON.parse(row.context); if (context.isSummary === true) summaryRows++; if (context.idSubtable) childReferences++;
      }
      const requests = db.prepare("SELECT id FROM requests WHERE owner=? AND state='COMPLETE' ORDER BY rowid").all(owner).map(row => requestDescriptor(store, row.id));
      const coverage = {state: current.data.issues.some(item => item.code === 'SUBTABLE_CYCLE') ? 'INCOMPLETE_SUBTABLE_GRAPH' : selected.subtables ? 'RETAINED_ARCHIVE_TRAVERSED' : 'ROOT_TABLE_ONLY',
        rawEventPopulation: 'NOT_ASSERTED', atomicSnapshot: false, archiveTruncation: 'Provider archive limits and native summary rows may already aggregate omitted detail.',
        paging: 'Every selected native offset page, including each terminal page; fixed report date and segment.',
        rows: current.data.progress.rows, tables: tableRecords.length, requests: requests.length, summaryRows,
        childReferences, unselectedChildReferences: selected.subtables ? 0 : childReferences,
        processedValues: 'format_metrics=0 and showRawMetrics=1; Matomo processed-report transformations are retained, not reversed.'};
      const completedAt = current.data.completedAt ?? stamp();
      store.transaction(() => updateCapture(id, 'FINALIZING', {completedAt, coverage}));
      const manifest = {schema: 'stellar-forge.matomo-capture.v1', id, sourceSha256: store.settings.sourceSha256,
        source: {mode: store.settings.source.mode, endpoint: store.settings.source.endpoint, siteId: store.settings.source.siteId, label: store.settings.source.label},
        catalogId: selectedCatalog.id, catalogManifest: selectedCatalog.data.manifest, selection: selected,
        sourceReport: current.data.report, subtableRules: current.data.subtableRules, limits: current.data.limits,
        limitHistory: current.data.limitHistory, createdAt: current.created_at, completedAt, coverage,
        issues: current.data.issues, rowDigest: rowDigest.digest('hex'), tables: tableRecords, requests};
      const content = bytes(manifest), folder = join(store.directory, 'captures', id);
      if (content.length > 16777216) throw fault('MATOMO_CAPTURE_MANIFEST_LIMIT');
      const pending = {path: 'captures/' + id + '/manifest.json', sha256: digest(content), bytes: content.length};
      store.transaction(() => updateCapture(id, 'FINALIZING', {manifestPending: pending}));
      await privateDirectory(folder, true); await writeNew(join(folder, 'manifest.json'), content);
      store.transaction(() => {
        updateCapture(id, 'COMPLETE', {manifest: {path: 'captures/' + id + '/manifest.json', sha256: digest(content), bytes: content.length}});
        store.event('CAPTURE_COMPLETED', id, coverage);
      });
      return {capture: capture(id), tables: tables(id)};
    } catch (error) {
      store.transaction(() => {
        updateCapture(id, signal.aborted ? 'CANCELLED' : /^MATOMO_CAPTURE_.*LIMIT/.test(error.code ?? '') ? 'LIMIT_REACHED' : 'FAILED',
          {error: error.code ?? 'MATOMO_CAPTURE_FAILED'});
        store.event('CAPTURE_STOPPED', id, {error: error.code ?? 'MATOMO_CAPTURE_FAILED'});
      });
      throw error;
    }
  }
  async function captureReport(input) {
    only(input, ['operationId', 'expectedRevision', 'selection']);
    const selected = selection(input.selection), selectedCatalog = catalog(selected.catalogId), id = identifier(input.operationId, 'capture');
    if (selectedCatalog.state !== 'COMPLETE') throw fault('MATOMO_COMPLETE_CATALOG_REQUIRED');
    if (['period', 'date', 'language'].some(key => selected.scope[key] !== selectedCatalog.scope[key]))
      throw fault('MATOMO_CATALOG_PERIOD_CHANGED', 'Discover this exact report period before selecting its period-dependent metadata.', 409);
    const report = selectedCatalog.data.reports.find(item => item.id === selected.reportId);
    if (!report || report.parameterError) throw fault('MATOMO_REPORT_SELECTION_UNSUPPORTED', 'Select a retained report variant with supported native parameters.');
    for (const child of Object.values(selected.subtableRules)) if (!selectedCatalog.data.reports.some(item => item.id === child && !item.parameterError)) throw fault('MATOMO_SUBTABLE_RULE_REPORT');
    return store.perform('capture', input, async ({signal}) => {
      const rootId = identity({captureId: id, reportId: report.id, root: true});
      const limits = Object.fromEntries(['maxRows', 'maxRequests', 'maxBytes', 'maxDepth'].map(key => [key, selected[key]]));
      store.transaction(() => {
        const time = stamp();
        db.prepare('INSERT INTO captures(id,selection,state,data,created_at,updated_at) VALUES(?,?,?,?,?,?)')
          .run(id, JSON.stringify(selected), 'CAPTURING', JSON.stringify({report, progress: {requests: 0, rows: 0, bytes: 0},
            issues: [], subtableRules: selected.subtableRules, limits, limitHistory: []}), time, time);
        insertTable(id, {id: rootId, parentRowId: null, parentTable: null, depth: 0, path: [], idSubtable: null,
          report, ancestors: [], offset: 0, pages: [], state: 'PENDING'});
      });
      return runCapture(id, {signal, retry: false});
    });
  }
  async function resumeCapture(input) {
    only(input, ['operationId', 'expectedRevision', 'captureId', 'limits', 'subtableRules', 'note']);
    const current = capture(input.captureId);
    return store.perform('resume-capture', input, async ({signal}) => {
      if (current.state === 'COMPLETE') return {capture: current, tables: tables(current.id)};
      if (current.data.manifestPending) {
        if (Object.keys(input.limits ?? {}).length || Object.keys(input.subtableRules ?? {}).length) throw fault('MATOMO_CAPTURE_ALREADY_FINALIZING');
        return runCapture(current.id, {signal, retry: true});
      }
      const limits = {...current.data.limits}, rules = {...current.data.subtableRules};
      only(input.limits ?? {}, ['maxRows', 'maxRequests', 'maxBytes', 'maxDepth']);
      for (const [name, value] of Object.entries(input.limits ?? {})) {
        const maximum = {maxRows: 1000000, maxRequests: 10000, maxBytes: 536870912, maxDepth: 128}[name];
        if (!Number.isSafeInteger(value) || value < limits[name] || value > maximum) throw fault('MATOMO_LIMIT_EXTENSION_INVALID');
        limits[name] = value;
      }
      only(input.subtableRules ?? {}, Object.keys(input.subtableRules ?? {}));
      const selectedCatalog = catalog(current.selection.catalogId);
      for (const [parentId, childId] of Object.entries(input.subtableRules ?? {})) {
        if (!selectedCatalog.data.reports.some(row => row.id === parentId) ||
            !selectedCatalog.data.reports.some(row => row.id === childId && !row.parameterError) ||
            rules[parentId] && rules[parentId] !== childId) throw fault('MATOMO_SUBTABLE_RULE_CONFLICT');
        rules[parentId] = childId;
      }
      const note = text(input.note ?? 'Continue the same retained native source scope.', 'the continuation note', 2000);
      store.transaction(() => updateCapture(current.id, 'CAPTURING', {limits, subtableRules: rules,
        limitHistory: [...current.data.limitHistory, {operationId: input.operationId, limits, subtableRules: rules, note, at: stamp()}]}));
      return runCapture(current.id, {signal, retry: true});
    });
  }
  function rows(id, {tableId, offset = 0, limit = 50} = {}) {
    capture(id);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 250) throw fault('MATOMO_ROW_PAGE_INVALID');
    const clause = tableId ? 'capture_id=? AND table_id=?' : 'capture_id=?', parameters = tableId ? [id, tableId] : [id];
    const total = db.prepare('SELECT COUNT(*) AS n FROM report_rows WHERE ' + clause).get(...parameters).n;
    const data = db.prepare('SELECT * FROM report_rows WHERE ' + clause + ' ORDER BY rowid LIMIT ? OFFSET ?').all(...parameters, limit, offset)
      .map(row => ({id: row.id, tableId: row.table_id, index: row.row_index, sourceRequest: row.source_request, sourceIndex: row.source_index,
        context: JSON.parse(row.context), cells: Object.fromEntries(Object.entries(parseNative(row.data_json)).map(([key, value]) => [key, cell(value)])),
        metadata: shown(parseNative(row.metadata_json))}));
    return {captureId: id, tableId: tableId ?? null, rows: data, page: {offset, limit, total, next: offset + data.length < total ? offset + data.length : null}};
  }
  async function manifest(id) {
    const current = capture(id);
    if (current.state !== 'COMPLETE' || !current.data.manifest) throw fault('MATOMO_COMPLETE_CAPTURE_REQUIRED');
    const raw = await readPrivate(join(store.directory, current.data.manifest.path), 16777216);
    if (raw.length !== current.data.manifest.bytes || digest(raw) !== current.data.manifest.sha256) throw fault('MATOMO_CAPTURE_MANIFEST_CHANGED');
    return {raw, value: JSON.parse(raw), capture: current};
  }
  return Object.freeze({catalog, capture, tables, table, discover, resumeCatalog, captureReport, resumeCapture, rows, manifest});
}
