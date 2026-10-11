import { gzipSync, gunzipSync } from 'node:zlib';
import { triage } from '../triage.mjs';
import { openStore } from './store.mjs';
import { DEFAULT_CONFIG, normalizeConfig, sourceProperties, recordBasis, validateRecord, importDeals, normalizeSchema, selectedRecords, validateCapturedDefinitions, mappedContext, makeProvider } from './source.mjs';
import { canonical, decode64, digest, id, iso, jsonBytes, now, page, parse, portableError, requireThat, sha, summary, text, WorkspaceError } from './common.mjs';
import { installActions } from './actions.mjs';

const emptyReview = () => ({ version: 0, status: 'open', actor: '', note: '', assignee: '', dueAt: null, updatedAt: null });
export async function openWorkspace(options) {
  const store = await openStore(options.directory), background = new Map();
  const provider = makeProvider(options);
  for (const job of store.all('job')) if (['queued', 'running', 'waiting'].includes(job.status)) store.put('job', { ...job, status: 'interrupted', updatedAt: now(), error: { code: 'PROCESS_INTERRUPTED', message: 'The previous process ended; resume this retained capture', at: now() } });
  for (const run of store.all('run')) if (run.status === 'queued') store.put('run', { ...run, status: 'interrupted', error: { code: 'PROCESS_INTERRUPTED', message: 'Run was retained before the previous process ended; retry its same source and configuration', at: now() } });
  for (const action of store.all('action')) if (action.status === 'executing') store.put('action', { ...action, version: action.version + 1, status: 'uncertain', error: { code: 'PROCESS_INTERRUPTED', message: 'The previous process ended during execution. Reconcile the original attempt.', at: now() } });

  function readRecords(snapshotId) {
    store.get(snapshotId, 'snapshot');
    return store.db.prepare('SELECT value,sha256 FROM records WHERE snapshot_id=? ORDER BY deal_id').all(snapshotId).map(row => { const value = JSON.parse(row.value); requireThat(digest(value) === row.sha256, 'SOURCE_CHANGED', 'A retained deal changed'); return value; });
  }
  function record(snapshotId, dealId) {
    const row = store.db.prepare('SELECT value,sha256 FROM records WHERE snapshot_id=? AND deal_id=?').get(snapshotId, dealId);
    requireThat(row, 'NOT_FOUND', 'Deal does not occur in this source version', 404);
    const value = JSON.parse(row.value); requireThat(digest(value) === row.sha256, 'SOURCE_CHANGED', 'Retained deal changed'); return value;
  }
  function saveSnapshot(projectId, data, records) {
    const snapshot = { id: id(), projectId, createdAt: now(), capturedAt: now(), ...data, recordCount: records.length, sourceSha256: digest(records) };
    const insert = store.db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)');
    for (const row of records) insert.run(snapshot.id, row.id, String(row.properties.pipeline ?? ''), String(row.properties.hubspot_owner_id ?? ''), digest(row), JSON.stringify(row));
    store.put('snapshot', snapshot); return snapshot;
  }
  function capturedSchema(projectId, kind, name, bytes) {
    normalizeSchema(kind, parse(bytes)); const file = store.file(projectId, name, bytes);
    return store.put('schema', { id: id(), projectId, schemaKind: kind, name, sha256: file.sha256, fileId: file.id, createdAt: now(), capturedAt: now() });
  }
  function launch(key, work) {
    requireThat(!background.has(key), 'OPERATION_RUNNING', 'This operation is already running', 409);
    const controller = new AbortController();
    const completion = new Promise(resolve => setImmediate(resolve)).then(() => work(controller.signal)).finally(() => background.delete(key));
    background.set(key, { controller, completion }); completion.catch(() => {}); return completion;
  }
  function traceProvider(projectId, objectId, fileIds = null) {
    return makeProvider({ ...options, trace(metadata, bytes) {
      store.transaction(() => {
        const file = store.file(projectId, `${objectId}-${id()}.json`, bytes);
        if (fileIds) fileIds.push(file.id);
        store.event(projectId, objectId, 'provider_response', { ...metadata, fileId: file.id, sha256: file.sha256, bytes: bytes.length });
      });
    } });
  }
  async function performSync(jobId, signal) {
    let job = store.get(jobId, 'job');
    try {
      requireThat(job.credentialBinding === provider.binding(), 'PROVIDER_CHANGED', 'Provider environment changed; start a separate capture instead of joining two accounts');
      requireThat(!job.retryAt || Date.parse(job.retryAt) <= Date.now(), 'PROVIDER_RETRY_TIME', `Provider requested retry after ${job.retryAt}`);
      job = { ...job, status: 'running', error: null, retryAt: null, updatedAt: now() }; store.put('job', job);
      const client = traceProvider(job.projectId, job.id);
      if (!job.schemaIds) {
        const schemas = {};
        for (const [kind, path] of [['properties', '/crm/v3/properties/deals'], ['pipelines', '/crm/v3/pipelines/deals']]) {
          const response = await client.request(path, { signal });
          schemas[kind] = store.transaction(() => capturedSchema(job.projectId, kind, `hubspot-${kind}.json`, response.bytes)).id;
        }
        job.schemaIds = schemas; store.put('job', job);
      }
      const properties = sourceProperties(job.capturedConfig);
      const seen = new Map();
      for (const fileId of job.pageFiles) for (const row of parse(store.readFile(fileId).data).results) {
        const old = seen.get(row.id); requireThat(!old || canonical(old) === canonical(row), 'DUPLICATE_CHANGED', 'A resumed source has conflicting deal values'); seen.set(row.id, row);
      }
      const seenCursors = new Set(job.cursors);
      while (!job.paginationComplete) {
        signal.throwIfAborted();
        const query = new URLSearchParams({ limit: '100', properties: properties.join(','), archived: 'false' });
        if (job.nextAfter !== null) query.set('after', job.nextAfter);
        const response = await client.request('/crm/v3/objects/deals?' + query, { signal, onRetry({ status: providerHttpStatus, ...retry }) { store.put('job', { ...job, ...retry, status: 'waiting', providerHttpStatus, updatedAt: now() }); } });
        requireThat(Array.isArray(response.data.results), 'PROVIDER_SHAPE', 'HubSpot deals response has no results array');
        let duplicates = 0;
        for (const row of response.data.results) {
          validateRecord(row); const old = seen.get(row.id);
          if (old) { requireThat(canonical(old) === canonical(row), 'DUPLICATE_CHANGED', `Deal ${row.id} changed across source pages; retain this partial capture and start another full scan`); duplicates++; }
          else seen.set(row.id, row);
        }
        requireThat(seen.size <= 100000 && job.sourceBytes + response.bytes.length <= 128 * 1024 * 1024, 'SOURCE_CAPACITY', 'Capture exceeds 100,000 deals or 128 MiB; use an account export with the agreed pilot scope');
        const nextAfter = response.data.paging?.next?.after ?? null;
        if (nextAfter !== null) requireThat((typeof nextAfter === 'string' || Number.isSafeInteger(nextAfter)) && String(nextAfter).length <= 200 && !seenCursors.has(String(nextAfter)), 'CURSOR_LOOP', 'Provider returned an invalid or repeated continuation');
        job = store.transaction(() => {
          const file = store.file(job.projectId, `deals-page-${job.pages + 1}.json`, response.bytes);
          const updated = { ...job, pages: job.pages + 1, records: seen.size, duplicateCount: job.duplicateCount + duplicates, pageFiles: [...job.pageFiles, file.id], sourceBytes: job.sourceBytes + response.bytes.length, nextAfter: nextAfter === null ? null : String(nextAfter), paginationComplete: nextAfter === null, cursors: nextAfter === null ? job.cursors : [...job.cursors, String(nextAfter)], status: 'running', retryAt: null, updatedAt: now() };
          store.put('job', updated); return updated;
        });
        if (nextAfter === null) break;
        seenCursors.add(String(nextAfter));
      }
      store.transaction(() => {
        const snapshot = saveSnapshot(job.projectId, { name: job.name, kind: 'HUBSPOT_SYNC', providerKind: provider.info().kind, complete: true, completeness: 'PAGINATION_EXHAUSTED', observedFrom: job.startedAt, observedThrough: now(), scope: { kind: 'PERMITTED_ACCOUNT_DEALS', analysisScope: job.capturedConfig.scope }, pageCount: job.pages, duplicateCount: job.duplicateCount, sourceFiles: job.pageFiles, schemaIds: job.schemaIds, jobId: job.id }, [...seen.values()]);
        store.put('job', { ...job, status: 'completed', snapshotId: snapshot.id, updatedAt: now(), retryAt: null });
        const project = store.project(job.projectId); project.schemaIds = job.schemaIds;
        store.bump(project, job.actor, 'source_capture_completed', { snapshotId: snapshot.id, jobId: job.id });
      });
    } catch (error) {
      job = store.get(jobId, 'job');
      store.put('job', { ...job, status: signal.aborted ? 'cancelled' : 'failed', error: portableError(error), retryAt: error.retryAt ?? null, updatedAt: now() });
      store.event(job.projectId, job.id, 'source_capture_stopped', { status: signal.aborted ? 'cancelled' : 'failed', error: portableError(error) });
    }
  }
  function performRun(runId) {
    let run = store.get(runId, 'run');
    try {
      const records = selectedRecords(readRecords(run.snapshotId), run.config);
      const snapshot = store.get(run.snapshotId, 'snapshot'), schemas = {};
      for (const [kind, schemaId] of Object.entries(snapshot.schemaIds ?? {})) {
        const schema = store.get(schemaId, 'schema'); schemas[kind] = parse(store.readFile(schema.fileId).data);
      }
      validateCapturedDefinitions(run.config, records, schemas);
      for (const row of records) {
        requireThat(Object.hasOwn(run.config.triage.stageStatus, row.properties.dealstage), 'UNMAPPED_STAGE', `Map native stage ${String(row.properties.dealstage)} before running the selected source`);
        const amount = run.config.context.amountProperty ? row.properties[run.config.context.amountProperty] : null;
        requireThat(amount === undefined || amount === null || typeof amount === 'string', 'AMOUNT_REPRESENTATION', 'Keep the original amount property as decimal text; numeric money is not accepted for manager display');
      }
      const report = triage({ results: records }, { ...run.config.triage, asOf: run.asOf });
      const byId = new Map(records.map(row => [row.id, row]));
      const alerts = report.alerts.map(alert => {
        const row = byId.get(alert.dealId), basis = recordBasis(row, run.config);
        const fingerprint = digest({ dealId: alert.dealId, basis, reasons: alert.reasons, configuration: run.config });
        return { ...alert, fingerprint, recordSha256: digest(row), basisSha256: digest(basis), context: mappedContext(row, run.config) };
      });
      const byOwner = new Map(); for (const alert of alerts) byOwner.set(alert.ownerId, (byOwner.get(alert.ownerId) ?? 0) + 1);
      store.transaction(() => {
        const reportFile = store.file(run.projectId, 'original-triage-report.json', jsonBytes(report));
        const alertsFile = store.file(run.projectId, 'manager-alert-context.json', jsonBytes(alerts));
        const stats = { inputCount: report.inputCount, closedInWindow: report.closedInWindow, unknownAges: report.unknownAges, futureCreated: report.futureCreated, alerts: alerts.length, alertCandidates: report.alertCandidates, suppressedAlertCount: report.suppressedAlertCount, missingNextActions: report.missingNextActions, cohortCount: report.cohorts.length, ownerAttention: [...byOwner].map(([ownerId, alerts]) => ({ ownerId, alerts })), basis: 'Original deterministic triage over this retained source and explicit as-of time' };
        run = { ...run, status: 'completed', completedAt: now(), reportFileId: reportFile.id, alertsFileId: alertsFile.id, summary: stats, error: null }; store.put('run', run); store.event(run.projectId, run.id, 'analysis_completed', { reportFileId: reportFile.id, inputCount: records.length, actor: run.actor });
      });
    } catch (error) { store.put('run', { ...run, status: 'failed', error: portableError(error) }); }
  }
  function runReport(runId) { const run = store.get(runId, 'run'); requireThat(run.status === 'completed', 'RUN_NOT_COMPLETE', 'This original analysis is not complete', 409); return { run, report: parse(store.readFile(run.reportFileId).data), alerts: parse(store.readFile(run.alertsFileId).data) }; }
  function review(projectId, fingerprint) { const value = store.db.prepare('SELECT value FROM reviews WHERE project_id=? AND fingerprint=?').get(projectId, fingerprint); return value ? JSON.parse(value.value) : emptyReview(); }
  const workspace = {
    store, provider, background, launch, traceProvider, record, runReport,
    state() { return { projects: store.all('project').map(({ id, name, revision, createdAt }) => ({ id, name, revision, createdAt })), provider: provider.info(), defaults: { config: structuredClone(DEFAULT_CONFIG) } }; },
    createProject(input) { return store.mutation('create_project', input, () => { const project = { id: id(), name: text(input.name, 'project name'), revision: 1, config: structuredClone(DEFAULT_CONFIG), schemaIds: {}, createdAt: now(), updatedAt: now() }; store.put('project', project); store.event(project.id, project.id, 'project_created', { actor: input.actor }); return { project }; }); },
    project(projectId) {
      const totals = {}; for (const [key, kind] of Object.entries({ snapshots: 'snapshot', runs: 'run', jobs: 'job', actions: 'action', exports: 'export', schemas: 'schema' })) totals[key] = store.db.prepare('SELECT count(*) AS n FROM objects WHERE project_id=? AND kind=?').get(projectId, kind).n;
      return { project: store.project(projectId), snapshots: store.list(projectId, 'snapshot').map(summary), runs: store.list(projectId, 'run').map(summary), jobs: store.list(projectId, 'job').map(summary), actions: store.list(projectId, 'action').map(summary), exports: store.list(projectId, 'export').map(summary), history: store.events(projectId), totals };
    },
    saveConfig(projectId, input) { return store.mutation('config:' + projectId, input, () => { const p = store.project(projectId, input.revision); p.config = normalizeConfig(input.config); return { project: store.bump(p, input.actor, 'configuration_saved', { configSha256: digest(p.config) }) }; }); },
    importSource(projectId, input) {
      const bytes = decode64(input.contentBase64); const imported = importDeals(bytes, input.declaredComplete === true);
      return store.mutation('import:' + projectId, input, () => {
        const p = store.project(projectId, input.revision), file = store.file(projectId, text(input.filename, 'filename', 240), bytes);
        const { records, ...metadata } = imported;
        const snapshot = saveSnapshot(projectId, { name: text(input.name, 'capture name'), kind: 'IMPORT', providerKind: 'OPERATOR_FILE', sourceFiles: [file.id], schemaIds: p.schemaIds, scope: { kind: 'OPERATOR_EXPORT', analysisScope: p.config.scope }, observedFrom: null, observedThrough: null, ...metadata }, records);
        return { snapshot, project: store.bump(p, input.actor, 'source_imported', { snapshotId: snapshot.id, fileId: file.id }) };
      });
    },
    importSchema(projectId, input) { const bytes = decode64(input.contentBase64, 16 * 1024 * 1024); normalizeSchema(input.kind, parse(bytes)); return store.mutation('schema:' + projectId, input, () => { const p = store.project(projectId, input.revision), schema = capturedSchema(projectId, input.kind, text(input.filename, 'filename', 240), bytes); p.schemaIds = { ...p.schemaIds, [input.kind]: schema.id }; return { schema, project: store.bump(p, input.actor, 'schema_imported', { schemaId: schema.id, kind: input.kind }) }; }); },
    schema(projectId) {
      const p = store.project(projectId), schemas = store.list(projectId, 'schema');
      const selected = kind => { const schema = p.schemaIds?.[kind] ? store.get(p.schemaIds[kind], 'schema') : schemas.find(x => x.schemaKind === kind); return schema ? parse(store.readFile(schema.fileId).data).results : []; };
      return { properties: selected('properties'), pipelines: selected('pipelines'), schemas: schemas.map(x => ({ ...x, kind: x.schemaKind })) };
    },
    snapshot(snapshotId) {
      const snapshot = store.get(snapshotId, 'snapshot'), rows = readRecords(snapshotId), fields = new Set(), inventory = new Map();
      for (const row of rows) { Object.keys(row.properties).forEach(x => fields.add(x)); const pipeline = String(row.properties.pipeline ?? ''), stage = String(row.properties.dealstage ?? ''), key = canonical([pipeline, stage]); const old = inventory.get(key) ?? { pipeline, stage, count: 0 }; old.count++; inventory.set(key, old); }
      return { snapshot, sourceFiles: snapshot.sourceFiles.map(fileId => { const { data, ...file } = store.readFile(fileId); return file; }), observedFields: [...fields].sort(), stageInventory: [...inventory.values()] };
    },
    deals(snapshotId, options = {}) {
      store.get(snapshotId, 'snapshot'); const { offset, limit } = page(options); const values = [snapshotId], clauses = ['snapshot_id=?'];
      if (options.pipeline) { clauses.push('pipeline=?'); values.push(options.pipeline); } if (options.owner) { clauses.push('owner=?'); values.push(options.owner); }
      if (options.search) { clauses.push('instr(deal_id,?)>0'); values.push(options.search); }
      const where = clauses.join(' AND '), total = store.db.prepare(`SELECT count(*) AS n FROM records WHERE ${where}`).get(...values).n;
      const deals = store.db.prepare(`SELECT value FROM records WHERE ${where} ORDER BY deal_id LIMIT ? OFFSET ?`).all(...values, limit, offset).map(x => JSON.parse(x.value)); return { deals, total, offset, limit };
    },
    startSync(projectId, input) {
      const result = store.mutation('sync:' + projectId, input, () => {
        const p = store.project(projectId, input.revision); requireThat(provider.info().configured, 'PROVIDER_NOT_CONFIGURED', 'Configure the local HubSpot environment before starting a live capture');
        const job = { id: id(), projectId, name: text(input.name, 'capture name'), kind: 'source_sync', status: 'queued', actor: input.actor, capturedConfig: p.config, configSha256: digest(p.config), credentialBinding: provider.binding(), pages: 0, records: 0, nextAfter: null, cursors: [], pageFiles: [], duplicateCount: 0, sourceBytes: 0, schemaIds: null, snapshotId: null, error: null, retryAt: null, createdAt: now(), startedAt: now(), updatedAt: now() };
        store.put('job', job); store.bump(p, input.actor, 'source_capture_requested', { jobId: job.id }); return { job: summary(job) };
      }); if (store.get(result.job.id, 'job').status === 'queued' && !background.has(result.job.id)) launch(result.job.id, signal => performSync(result.job.id, signal)); return result;
    },
    job(jobId) { const job = store.get(jobId, 'job'); return { job: { ...summary(job), resumable: ['failed', 'cancelled', 'interrupted'].includes(job.status), terminal: ['completed', 'failed', 'cancelled', 'interrupted'].includes(job.status) } }; },
    cancelJob(jobId, input) {
      let requested = false;
      const result = store.mutation('cancel_job:' + jobId, input, () => { const job = store.get(jobId, 'job'); requireThat(background.has(jobId), 'JOB_IDLE', 'This capture is not running', 409); store.event(job.projectId, job.id, 'capture_cancel_requested', { actor: input.actor }); requested = true; return { job: summary(job) }; });
      if (requested) background.get(jobId)?.controller.abort(new Error('Cancelled by operator')); return result;
    },
    resumeJob(jobId, input) {
      const result = store.mutation('resume_job:' + jobId, input, () => { const job = store.get(jobId, 'job'); requireThat(['failed', 'cancelled', 'interrupted'].includes(job.status) && !background.has(jobId), 'JOB_STATE', 'Only a stopped incomplete capture can resume', 409); requireThat(job.credentialBinding === provider.binding(), 'PROVIDER_CHANGED', 'Provider environment changed; start a separate capture'); requireThat(!job.retryAt || Date.parse(job.retryAt) <= Date.now(), 'PROVIDER_RETRY_TIME', `Wait until ${job.retryAt} before resuming`, 429); job.status = 'queued'; job.updatedAt = now(); store.put('job', job); store.event(job.projectId, job.id, 'capture_resume_requested', { actor: input.actor }); return { job: summary(job) }; }); if (!background.has(jobId) && store.get(jobId, 'job').status === 'queued') launch(jobId, signal => performSync(jobId, signal)); return result;
    },
    startRun(projectId, input) {
      const result = store.mutation('run:' + projectId, input, () => { const p = store.project(projectId, input.revision), snapshot = store.get(input.snapshotId, 'snapshot'); requireThat(snapshot.projectId === projectId, 'SOURCE_PROJECT', 'Choose a source in this project'); const config = normalizeConfig(p.config); const run = { id: id(), projectId, name: text(input.name, 'run name'), snapshotId: snapshot.id, sourceSha256: snapshot.sourceSha256, config, configSha256: digest(config), asOf: iso(input.asOf, 'asOf'), actor: input.actor, status: 'queued', summary: null, createdAt: now(), error: null }; store.put('run', run); store.bump(p, input.actor, 'analysis_requested', { runId: run.id }); return { run: summary(run) }; }); if (store.get(result.run.id, 'run').status === 'queued' && !background.has(result.run.id)) launch(result.run.id, () => performRun(result.run.id)); return result;
    },
    retryRun(runId, input) { const result = store.mutation('retry_run:' + runId, input, () => { const old = store.get(runId, 'run'); requireThat(['failed', 'interrupted'].includes(old.status), 'RUN_STATE', 'This run does not need retry', 409); const run = { ...old, id: id(), retryOf: old.id, status: 'queued', createdAt: now(), error: null }; store.put('run', run); store.event(run.projectId, run.id, 'analysis_retry_requested', { actor: input.actor }); return { run: summary(run) }; }); if (store.get(result.run.id, 'run').status === 'queued' && !background.has(result.run.id)) launch(result.run.id, () => performRun(result.run.id)); return result; },
    run(runId) {
      const run = store.get(runId, 'run'), reviewSummary = { open: 0, confirmed: 0, dismissed: 0, resolved: 0, deferred: 0 };
      if (run.status === 'completed') for (const alert of runReport(runId).alerts) reviewSummary[review(run.projectId, alert.fingerprint).status]++;
      return { run, summary: run.summary, reviewSummary };
    },
    alerts(runId, options = {}) {
      const { run, alerts } = runReport(runId), { offset, limit } = page(options);
      let entries = alerts.map(alert => ({ ...alert, review: review(run.projectId, alert.fingerprint) }));
      if (options.owner) entries = entries.filter(x => x.ownerId === options.owner);
      if (options.status) entries = entries.filter(x => x.review.status === options.status);
      if (options.reason) entries = entries.filter(x => x.reasons.includes(options.reason));
      if (options.search) entries = entries.filter(x => `${x.dealId} ${x.stage} ${x.leadSource} ${x.review.note}`.toLowerCase().includes(options.search.toLowerCase()));
      return { alerts: entries.slice(offset, offset + limit), total: entries.length, offset, limit };
    },
    review(runId, dealId, input) {
      const { run, alerts } = runReport(runId), alert = alerts.find(x => x.dealId === dealId); requireThat(alert, 'ALERT_NOT_FOUND', 'This deal is not in this run\'s original emitted alert list', 404);
      return store.mutation('review:' + runId + ':' + dealId, input, () => {
        const current = review(run.projectId, alert.fingerprint); requireThat(input.version === current.version, 'STALE_REVIEW', `Review is now version ${current.version}; reload and reapply`, 409);
        requireThat(['open', 'confirmed', 'dismissed', 'resolved', 'deferred'].includes(input.status), 'REVIEW_STATUS', 'Select a supported review status');
        const value = { version: current.version + 1, status: input.status, actor: text(input.actor, 'actor'), note: text(input.note, 'manager note', 5000, input.status === 'open'), assignee: text(input.assignee ?? '', 'assignee', 160, true), dueAt: iso(input.dueAt, 'review dueAt', true), updatedAt: now(), sourceRunId: runId, dealId, fingerprint: alert.fingerprint };
        if (value.status === 'deferred') requireThat(value.dueAt, 'DEFER_UNTIL', 'A deferred review needs a due time');
        store.db.prepare('INSERT INTO reviews VALUES(?,?,?,?) ON CONFLICT(project_id,fingerprint) DO UPDATE SET version=excluded.version,value=excluded.value').run(run.projectId, alert.fingerprint, value.version, JSON.stringify(value));
        store.event(run.projectId, run.id, 'manager_review_saved', { ...value, previousVersion: current.version }); return { review: value };
      });
    },
    cohorts(runId, options = {}) { const { report } = runReport(runId), { offset, limit } = page(options); return { cohorts: report.cohorts.slice(offset, offset + limit), total: report.cohorts.length, offset, limit }; },
    compare(runId, baselineId) {
      const current = runReport(runId), baseline = runReport(baselineId); requireThat(current.run.projectId === baseline.run.projectId, 'COMPARE_PROJECT', 'Compare runs from the same project');
      const left = new Map(baseline.alerts.map(x => [x.dealId, x])), right = new Map(current.alerts.map(x => [x.dealId, x]));
      const a = new Map(readRecords(baseline.run.snapshotId).map(x => [x.id, digest(x)])), b = new Map(readRecords(current.run.snapshotId).map(x => [x.id, digest(x)]));
      const lc = new Map(baseline.report.cohorts.map(x => [x.cohort, x])), rc = new Map(current.report.cohorts.map(x => [x.cohort, x]));
      return { baseline: summary(baseline.run), current: summary(current.run), compatibility: { sameConfig: baseline.run.configSha256 === current.run.configSha256, sameScope: canonical(baseline.run.config.scope) === canonical(current.run.config.scope), sameAsOf: baseline.run.asOf === current.run.asOf }, summary: { baseline: baseline.run.summary, current: current.run.summary }, alerts: { new: [...right.keys()].filter(x => !left.has(x)), resolved: [...left.keys()].filter(x => !right.has(x)), persisting: [...right.keys()].filter(x => left.has(x)).map(dealId => ({ dealId, changed: left.get(dealId).fingerprint !== right.get(dealId).fingerprint })) }, cohorts: [...new Set([...lc.keys(), ...rc.keys()])].sort().map(key => ({ key, baseline: lc.get(key) ?? null, current: rc.get(key) ?? null })), records: { added: [...b.keys()].filter(x => !a.has(x)), absent: [...a.keys()].filter(x => !b.has(x)), changed: [...b.keys()].filter(x => a.has(x) && a.get(x) !== b.get(x)) }, interpretation: 'Alerts resolved means no longer emitted by this run, including changed caps or scope. Absent records are absent from the captured export. Cohort rates describe their actual retained members; these observations do not identify causes or individual performance.' };
    },
    exportProject(projectId, input) {
      return store.mutation('export:' + projectId, input, () => {
        const p = store.project(projectId, input.revision); if (input.runId) requireThat(store.get(input.runId, 'run').projectId === projectId, 'EXPORT_RUN', 'Select a run from this project');
        const objects = store.db.prepare("SELECT * FROM objects WHERE project_id=? AND kind NOT IN ('export','job')").all(projectId).map(x => ({ ...x, value: JSON.parse(x.value) }));
        const files = store.db.prepare("SELECT * FROM files WHERE project_id=? AND id NOT IN (SELECT json_extract(value,'$.fileId') FROM objects WHERE project_id=? AND kind='export')").all(projectId, projectId).map(x => { const file = store.readFile(x.id); return { id: x.id, name: x.name, sha256: x.sha256, bytes: x.size, createdAt: x.created_at, contentBase64: file.data.toString('base64') }; });
        const records = store.db.prepare('SELECT * FROM records WHERE snapshot_id IN (SELECT id FROM objects WHERE project_id=? AND kind=?)').all(projectId, 'snapshot');
        const reviews = store.db.prepare('SELECT * FROM reviews WHERE project_id=?').all(projectId), history = store.events(projectId, null, 1000000);
        const data = { schema: 'commons.hubspot.pipeline-project.v1', exportedAt: now(), selectedRunId: input.runId ?? null, project: p, objects, files, records, reviews, history, custody: 'Contains the selected project\'s original permitted CRM source, manager reviews and task/note receipts. Incomplete source-sync jobs are historical events only and are not resumed by restore.' };
        const bytes = gzipSync(jsonBytes({ ...data, contentSha256: digest(data) }));
        requireThat(bytes.length <= 128 * 1024 * 1024, 'EXPORT_CAPACITY', 'Project exceeds the 128 MiB portable export limit');
        const file = store.file(projectId, 'pipeline-project.json.gz', bytes), output = { id: id(), projectId, name: text(input.name, 'export name'), runId: input.runId ?? null, fileId: file.id, sha256: file.sha256, bytes: bytes.length, createdAt: now() }; store.put('export', output); store.bump(p, input.actor, 'project_exported', { exportId: output.id }); return { export: output };
      });
    },
    restoreProject(input) {
      let bytes = decode64(input.contentBase64, 128 * 1024 * 1024); if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes, { maxOutputLength: 512 * 1024 * 1024 });
      const imported = parse(bytes, 'portable project'), { contentSha256, ...data } = imported;
      requireThat(data.schema === 'commons.hubspot.pipeline-project.v1' && digest(data) === contentSha256 && Array.isArray(data.objects) && Array.isArray(data.files) && Array.isArray(data.records) && Array.isArray(data.reviews), 'RESTORE_SOURCE', 'Portable project identity or contents do not match');
      normalizeConfig(data.project.config); requireThat(data.records.length <= 1000000 && data.objects.length <= 100000 && data.files.length <= 100000, 'RESTORE_CAPACITY', 'Portable project exceeds workspace capacity');
      for (const file of data.files) { const content = decode64(file.contentBase64, 128 * 1024 * 1024); requireThat(content.length === file.bytes && sha(content) === file.sha256, 'RESTORE_SOURCE', 'An original file does not match its saved hash'); }
      return store.mutation('restore_project', input, () => {
        const projectId = id(), mapping = new Map(data.objects.map(x => [x.id, id()])); mapping.set(data.project.id, projectId); for (const file of data.files) mapping.set(file.id, id());
        const replace = value => Array.isArray(value) ? value.map(replace) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)])) : typeof value === 'string' && mapping.has(value) ? mapping.get(value) : value;
        const project = { ...data.project, id: projectId, name: text(input.name, 'restored project name'), revision: 1, restoredFrom: { projectId: data.project.id, contentSha256, exportedAt: data.exportedAt }, createdAt: now(), updatedAt: now() };
        const fileInsert = store.db.prepare('INSERT INTO files VALUES(?,?,?,?,?,?)');
        for (const file of data.files) { const content = Buffer.from(file.contentBase64, 'base64'); store.db.prepare('INSERT OR IGNORE INTO blobs VALUES(?,?)').run(file.sha256, content); fileInsert.run(mapping.get(file.id), projectId, file.name, file.sha256, file.bytes, file.createdAt); }
        for (const object of data.objects) {
          requireThat(['project', 'schema', 'snapshot', 'run', 'action'].includes(object.kind) && object.project_id === data.project.id, 'RESTORE_SOURCE', 'Portable object is outside the selected project');
          requireThat(object.value?.id === object.id && (object.kind === 'project' ? object.id === data.project.id : object.value.projectId === data.project.id), 'RESTORE_SOURCE', 'Portable object identity differs from its original project');
          if (object.kind === 'project') continue;
          const value = replace(object.value); value.id = mapping.get(object.id); value.projectId = projectId; value.originalId = object.id;
          if (object.kind === 'action' && (value.writeStartedAt || ['uncertain', 'executing'].includes(value.status)) && value.status !== 'completed') { value.status = 'uncertain'; value.reconciling = false; value.version++; value.error = { code: 'RESTORED_ATTEMPT', message: 'Reconcile the retained native attempt; restoration never resends it', at: now() }; }
          else if (object.kind === 'action' && !['completed', 'revoked'].includes(value.status)) { value.status = 'draft'; value.prepared = null; value.approval = null; value.version++; value.error = { code: 'RESTORED_PROPOSAL', message: 'Prepare this restored proposal against the current host before approval', at: now() }; }
          store.put(object.kind, value);
        }
        for (const row of data.records) { requireThat(mapping.has(row.snapshot_id) && digest(JSON.parse(row.value)) === row.sha256, 'RESTORE_SOURCE', 'Retained deal hash differs'); store.db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)').run(mapping.get(row.snapshot_id), row.deal_id, row.pipeline, row.owner, row.sha256, row.value); }
        for (const row of data.reviews) { const value = replace(JSON.parse(row.value)); store.db.prepare('INSERT INTO reviews VALUES(?,?,?,?)').run(projectId, row.fingerprint, row.version, JSON.stringify(value)); }
        project.schemaIds = replace(project.schemaIds); store.put('project', project);
        for (const event of data.history ?? []) store.event(projectId, mapping.get(event.objectId) ?? projectId, 'restored:' + event.kind, { original: event });
        store.event(projectId, projectId, 'project_restored', { actor: input.actor, sourceSha256: contentSha256 }); return { project };
      });
    },
    async close() { for (const { controller } of background.values()) controller.abort(new Error('Operator workspace stopping')); await Promise.allSettled([...background.values()].map(x => x.completion)); store.close(); }
  };
  installActions(workspace, options);
  return workspace;
}
