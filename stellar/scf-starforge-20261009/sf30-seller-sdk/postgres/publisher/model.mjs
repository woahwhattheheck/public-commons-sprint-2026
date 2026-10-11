// MIT. Durable extraction and review; publication delegates to original versions.
import { DatabaseSync } from 'node:sqlite';
import { mkdir, lstat, chmod, open, rename } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { openPostgresSourceFile, readPostgresSourceFile } from '../config.mjs';
import { PostgresResultError } from '../stream.mjs';
import { loadDatasetConfig } from '../../dataset-handler.mjs';
import { datasetControl } from '../../dataset-refresh/service.mjs';
import { openDatasetVersions } from '../../dataset-refresh/versions.mjs';
import { datasetBuyerEndpoint, readDatasetBuyerOffer, prepareDatasetBuyer } from '../../dataset-refresh/buyer-handoff.mjs';
import { capturePlan, inspectSource, csvLine, checkColumnTypes, encodeRow } from './plan.mjs';
import { absolute, privateDirectory, acquireWorkspace, bytes, digest, identity, readPrivate,
  readJson, hashPrivate, createFile, atomicJson, syncDirectory, fault, stamp } from './files.mjs';

const HASH = /^[a-f0-9]{64}$/;
const note = (value, name, maximum = 2000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum)
    throw fault('REVIEW_TEXT_REQUIRED', 'Enter ' + name + '.');
  return value.trim();
};
const safeError = issue => [issue?.code, issue?.message].find(value =>
  typeof value === 'string' && /^[A-Z0-9_]{1,80}$/.test(value)) ?? 'PUBLISHER_OPERATION_FAILED';
async function absent(path) { try { await lstat(path); return false; } catch (issue) { if (issue.code === 'ENOENT') return true; throw issue; } }
const unpack = row => row ? { ...row, data: JSON.parse(row.data) } : null;

export async function openPostgresPublisher({ directory, create = false, sourceFile, targetDirectory,
  environment = process.env, seller = null, resource = null } = {}) {
  absolute(directory);
  if (create) {
    if (!await absent(directory)) throw fault('WORKSPACE_EXISTS', 'Use a new workspace or reopen this one without --create.');
    absolute(sourceFile, 'source file'); absolute(targetDirectory, 'target state directory');
    if (directory === targetDirectory) throw fault('SEPARATE_TARGET_REQUIRED');
  }
  await privateDirectory(directory, create);
  const release = await acquireWorkspace(directory);
  let db;
  try {
    const buyer = seller === null && resource === null ? null : datasetBuyerEndpoint(seller, resource);
    const database = join(directory, 'publisher.sqlite');
    if (!create) await readPrivate(join(directory, 'workspace.json'), 4096);
    if (!create && await absent(database)) throw fault('WORKSPACE_DATABASE_MISSING');
    if (!await absent(database)) {
      const stat = await lstat(database);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077) throw fault('PRIVATE_DATABASE_REQUIRED');
    }
    db = new DatabaseSync(database); await chmod(database, 0o600);
    db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS plans(id INTEGER PRIMARY KEY, created TEXT NOT NULL, folder TEXT NOT NULL UNIQUE, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, plan INTEGER NOT NULL REFERENCES plans(id), state TEXT NOT NULL,
        created TEXT NOT NULL, updated TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, run TEXT, created TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL);`);
    if (create) {
      await createFile(join(directory, 'workspace.json'), bytes({ schema: 'stellar-forge.postgres-publisher-workspace.v1',
        sourceFile, targetDirectory, createdAt: stamp() }));
      await privateDirectory(join(directory, 'plans'), true); await privateDirectory(join(directory, 'runs'), true);
      await syncDirectory(directory);
    }
    const settings = await readJson(join(directory, 'workspace.json'), 4096);
    if (settings.schema !== 'stellar-forge.postgres-publisher-workspace.v1' ||
        sourceFile && sourceFile !== settings.sourceFile || targetDirectory && targetDirectory !== settings.targetDirectory)
      throw fault('WORKSPACE_BINDING_CHANGED', 'Reopen with its original source and dataset target.');
    absolute(settings.sourceFile, 'source file'); absolute(settings.targetDirectory, 'target state directory');
    sourceFile = settings.sourceFile; targetDirectory = settings.targetDirectory;
    await privateDirectory(join(directory, 'plans')); await privateDirectory(join(directory, 'runs'));
    let active = null, closing = null, closed = false;
    const event = (kind, run, data = {}) => db.prepare('INSERT INTO events(run,created,kind,data) VALUES(?,?,?,?)')
      .run(run ?? null, stamp(), kind, JSON.stringify(data));
    function transaction(action) {
      db.exec('BEGIN IMMEDIATE');
      try { const value = action(); db.exec('COMMIT'); return value; }
      catch (issue) { db.exec('ROLLBACK'); throw issue; }
    }
    function plan(id) {
      if (!Number.isSafeInteger(id) || id < 1) throw fault('PLAN_NOT_FOUND', 'Choose a saved extraction plan.', 404);
      const row = unpack(db.prepare('SELECT * FROM plans WHERE id=?').get(id));
      if (!row) throw fault('PLAN_NOT_FOUND', 'Choose a saved extraction plan.', 404);
      return row;
    }
    function run(id) {
      if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw fault('RUN_NOT_FOUND', 'Choose a retained extraction.', 404);
      const row = unpack(db.prepare('SELECT * FROM runs WHERE id=?').get(id));
      if (!row) throw fault('RUN_NOT_FOUND', 'Choose a retained extraction.', 404);
      return row;
    }
    function change(id, state, patch, kind) {
      return transaction(() => {
        const current = run(id), data = { ...current.data, ...patch };
        db.prepare('UPDATE runs SET state=?,updated=?,data=? WHERE id=?').run(state, stamp(), JSON.stringify(data), id);
        event(kind, id, { state, ...patch }); return run(id);
      });
    }
    function available() {
      if (closed) throw fault('PUBLISHER_CLOSED');
      if (active) throw fault('PUBLISHER_BUSY', 'A workspace operation is still running.', 409);
    }
    function mutate(kind, id, action) {
      available();
      const operation = { kind, id, progress: {}, promise: null };
      active = operation;
      operation.promise = Promise.resolve().then(action).finally(() => {
        if (active === operation) active = null;
      });
      return operation.promise;
    }
    for (const row of db.prepare("SELECT id,state FROM runs WHERE state IN ('EXTRACTING','PUBLISHING')").all())
      change(row.id, row.state === 'EXTRACTING' ? 'INTERRUPTED' : 'PUBLICATION_UNKNOWN',
        { error: row.state === 'EXTRACTING' ? 'EXTRACTION_INTERRUPTED' : 'PUBLICATION_OUTCOME_NOT_RECORDED' }, 'PROCESS_RECOVERY');
    const source = () => inspectSource(sourceFile);
    async function savePlan(input) {
      return mutate('saving plan', null, async () => {
      const folder = randomUUID(), path = join(directory, 'plans', folder);
      await privateDirectory(path, true);
      const data = await capturePlan(sourceFile, path, input);
      await syncDirectory(path); await syncDirectory(join(directory, 'plans'));
      return transaction(() => {
        const result = db.prepare('INSERT INTO plans(created,folder,data) VALUES(?,?,?)').run(stamp(), folder, JSON.stringify(data));
        const id = Number(result.lastInsertRowid); event('PLAN_SAVED', null, { plan: id, digest: data.digest }); return plan(id);
      });
      });
    }
    async function target() {
      try {
        const result = await datasetControl(targetDirectory, 'schema');
        if (!HASH.test(result.versions?.current ?? '') || !Number.isSafeInteger(result.versions.revision)) throw fault('TARGET_RESPONSE_INVALID');
        return { connected: true, initializable: false, directory: targetDirectory, ...result };
      } catch (issue) {
        return { connected: false, initializable: await absent(targetDirectory), directory: targetDirectory, error: safeError(issue) };
      }
    }
    function status(options = {}) {
      const pages = {};
      const page = (name, table, order) => {
        const limit = options.limit ?? 25, offset = options[name + 'Offset'] ?? 0;
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0)
          throw fault('HISTORY_PAGE_INVALID', 'Use a page size from 1 to 100 and a non-negative offset.');
        const total = db.prepare('SELECT COUNT(*) AS total FROM ' + table).get().total;
        const rows = db.prepare('SELECT * FROM ' + table + ' ORDER BY ' + order + ' LIMIT ? OFFSET ?').all(limit, offset).map(unpack);
        pages[name] = { limit, offset, total, next: offset + rows.length < total ? offset + rows.length : null,
          previous: offset > 0 ? Math.max(0, offset - limit) : null };
        return rows;
      };
      return { schema: 'stellar-forge.postgres-publisher-status.v1', directory, sourceFile, targetDirectory, buyer,
        plans: page('plans', 'plans', 'id DESC'), runs: page('runs', 'runs', 'created DESC, id DESC'),
        active: active ? { kind: active.kind, id: active.id, progress: active.progress } : null,
        history: page('history', 'events', 'id DESC'), pages };
    }
    async function validatePlan(saved) {
      const base = join(directory, 'plans', saved.folder);
      const exact = await readJson(join(base, 'plan.json'));
      if (identity(exact) !== identity(saved.data) || digest(await readPrivate(join(base, 'source.json'))) !== saved.data.runtimeSourceHash ||
          digest(await readPrivate(join(base, 'original-source.json'))) !== saved.data.sourceHash ||
          saved.data.caHash && digest(await readPrivate(join(base, 'ca.pem'), 1048576)) !== saved.data.caHash)
        throw fault('RETAINED_PLAN_CHANGED', 'The retained extraction plan no longer matches its saved source.', 409);
      return base;
    }
    async function candidate(id) {
      const saved = run(id), p = plan(saved.plan), path = join(directory, 'runs', id);
      await validatePlan(p);
      const manifest = await readJson(join(path, 'candidate.json'));
      if (manifest.schema !== 'stellar-forge.postgres-dataset-candidate.v1' || manifest.run !== id || manifest.planDigest !== p.data.digest ||
          !manifest.extraction?.transaction?.readOnly || manifest.extraction.transaction.isolation !== 'REPEATABLE READ')
        throw fault('CANDIDATE_MANIFEST_INVALID');
      const { candidateDigest, ...body } = manifest;
      if (candidateDigest !== identity(body)) throw fault('CANDIDATE_MANIFEST_CHANGED');
      const csv = await hashPrivate(join(path, 'data.csv'), p.data.extraction.maxBytes);
      const configBytes = await readPrivate(join(path, 'dataset.json'), 65536);
      if (csv.hash !== manifest.csvHash || csv.bytes !== manifest.csvBytes || digest(configBytes) !== manifest.configHash)
        throw fault('CANDIDATE_FILES_CHANGED', 'The retained candidate files no longer match their extraction.', 409);
      const dataset = await loadDatasetConfig(join(path, 'dataset.json'));
      if (identity(dataset.describe()) !== identity(manifest.dataset) || dataset.describe().rowCount !== manifest.extraction.rowCount)
        throw fault('CANDIDATE_DATASET_CHANGED');
      return { manifest, dataset, configPath: join(path, 'dataset.json') };
    }
    function startExtraction(planId, { id = randomUUID() } = {}) {
      available();
      if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))
        throw fault('EXTRACTION_ID_INVALID');
      if (db.prepare('SELECT id FROM runs WHERE id=?').get(id))
        throw fault('EXTRACTION_ALREADY_EXISTS', 'Continue the original retained extraction with this ID.', 409);
      const p = plan(planId), controller = new AbortController();
      transaction(() => {
        const now = stamp(); db.prepare('INSERT INTO runs(id,plan,state,created,updated,data) VALUES(?,?,?,?,?,?)')
          .run(id, planId, 'EXTRACTING', now, now, JSON.stringify({ planDigest: p.data.digest, error: null }));
        event('EXTRACTION_STARTED', id, { plan: planId, sourceHash: p.data.sourceHash });
      });
      const operation = { kind: 'extraction', id, controller, progress: { rows: 0, bytes: 0 }, promise: null };
      active = operation;
      operation.promise = (async () => {
        let pg, file;
        const path = join(directory, 'runs', id);
        try {
          const sourceDirectory = await validatePlan(p);
          await privateDirectory(path, true);
          const opened = await openPostgresSourceFile(join(sourceDirectory, 'source.json'), { env: environment });
          pg = opened.source;
          checkColumnTypes(p.data.dataset.columns, pg.inspect().columnTypes[p.data.query]);
          file = await open(join(path, 'data.partial'), 'wx', 0o600);
          const hash = createHash('sha256'); let count = 0;
          async function write(text) {
            const data = Buffer.from(text); count += data.length;
            if (count > p.data.extraction.maxBytes) throw new PostgresResultError('DATASET_CSV_TOO_LARGE');
            await file.writeFile(data); hash.update(data);
          }
          await write(csvLine(Object.keys(p.data.dataset.columns)));
          const extraction = await pg.exportDataset(p.data.query, p.data.input, { ...p.data.extraction,
            signal: controller.signal,
            async onRow(row, types, progress) {
              checkColumnTypes(p.data.dataset.columns, types);
              await write(encodeRow(row, p.data.dataset));
              operation.progress = { rows: progress.rowCount, bytes: count };
            } });
          checkColumnTypes(p.data.dataset.columns, extraction.columnTypes);
          // exportDataset resolves only after the original transaction COMMIT.
          await pg.close(); pg = null;
          await file.sync(); await file.close(); file = null;
          await rename(join(path, 'data.partial'), join(path, 'data.csv'));
          const configBytes = bytes(p.data.dataset);
          await createFile(join(path, 'dataset.json'), configBytes);
          const dataset = await loadDatasetConfig(join(path, 'dataset.json'));
          const description = dataset.describe();
          if (description.rowCount !== extraction.rowCount) throw fault('DATASET_ROW_COUNT_CHANGED');
          const manifest = { schema: 'stellar-forge.postgres-dataset-candidate.v1', run: id,
            planDigest: p.data.digest, sourceHash: p.data.sourceHash, queryHash: p.data.queryHash,
            completedAt: stamp(), csvHash: hash.digest('hex'), csvBytes: count,
            configHash: digest(configBytes), dataset: description, extraction };
          manifest.candidateDigest = identity(manifest);
          await atomicJson(path, 'candidate.json', manifest); await syncDirectory(join(directory, 'runs'));
          return change(id, 'READY', { candidate: manifest, error: null }, 'EXTRACTION_COMPLETED');
        } catch (issue) {
          return change(id, controller.signal.aborted ? 'CANCELLED' : 'FAILED', { error: safeError(issue) }, 'EXTRACTION_STOPPED');
        } finally {
          try { await pg?.close(); } finally { await file?.close(); if (active === operation) active = null; }
        }
      })();
      operation.promise.catch(() => {});
      return { id, completion: operation.promise };
    }
    function cancel(id) {
      if (active?.kind !== 'extraction' || active.id !== id) throw fault('EXTRACTION_NOT_ACTIVE', 'This extraction has already stopped.', 409);
      active.controller.abort(); return { cancelling: id };
    }
    async function inspect(id, query) {
      const saved = run(id), result = { run: saved, plan: plan(saved.plan), preview: null };
      if (saved.data.candidate) {
        const current = await candidate(id);
        const response = current.dataset.handle({ query: new URLSearchParams(query ?? 'limit=' + Math.min(20, result.plan.data.dataset.maxLimit)) });
        if (response.status !== 200) throw fault(response.body.error, response.body.message, response.status);
        result.preview = response.body;
      }
      return result;
    }
    async function review(id, input) {
      return mutate('review', id, async () => {
      const current = await candidate(id), observed = await target();
      const reviewer = note(input.reviewer, 'the reviewer name', 128), text = note(input.note, 'the review note');
      let binding;
      if (input.initialize === true) {
        if (!observed.initializable) throw fault('TARGET_ALREADY_EXISTS', 'Review the running target before publishing.', 409);
        binding = { mode: 'initialize', directory: targetDirectory };
      } else {
        if (!observed.connected) throw fault('TARGET_NOT_RUNNING', 'Start the original versioned dataset seller, then review again.', 409);
        if (input.expectedSnapshot !== observed.versions.current || input.expectedRevision !== observed.versions.revision)
          throw fault('TARGET_REVIEW_CHANGED', 'Refresh the current version before recording this review.', 409);
        const contract = description => { const { snapshot, rowCount, ...value } = description; return identity(value); };
        if (contract(current.manifest.dataset) !== contract(observed.dataset))
          throw fault('DATASET_CONTRACT_CHANGED', 'The candidate changes the target query contract. Select its matching dataset plan or a new target.', 409);
        binding = { mode: 'refresh', directory: targetDirectory,
          expectedSnapshot: observed.versions.current, expectedRevision: observed.versions.revision };
      }
      const record = { id: randomUUID(), reviewer, note: text, recordedAt: stamp(),
        candidateDigest: current.manifest.candidateDigest, target: binding };
      return change(id, 'REVIEWED', { review: record, error: null }, 'CANDIDATE_REVIEWED');
      });
    }
    async function publish(id, reviewId) {
      return mutate('publication', id, async () => {
      const saved = run(id);
      if (!saved.data.review || saved.data.review.id !== reviewId || !['REVIEWED', 'PUBLICATION_UNKNOWN'].includes(saved.state))
        throw fault('CURRENT_REVIEW_REQUIRED', 'Review this exact candidate against the current target first.', 409);
      const current = await candidate(id);
      const latest = run(id), record = latest.data.review;
      if (!record || record.id !== reviewId || !['REVIEWED', 'PUBLICATION_UNKNOWN'].includes(latest.state))
        throw fault('CURRENT_REVIEW_REQUIRED', 'The publication review changed. Read the latest review before publishing.', 409);
      if (record.candidateDigest !== current.manifest.candidateDigest) throw fault('CANDIDATE_REVIEW_CHANGED');
      change(id, 'PUBLISHING', { error: null }, 'PUBLICATION_STARTED');
        let versions;
        try {
          let result;
          if (record.target.mode === 'initialize') {
            if (!await absent(targetDirectory)) throw fault('TARGET_ALREADY_EXISTS', 'Inspect the original target before initializing again.', 409);
            versions = await openDatasetVersions({ directory: targetDirectory, initialConfig: current.configPath });
            result = versions.status(); await versions.close(); versions = null;
          } else result = await datasetControl(targetDirectory, 'refresh', {
            configPath: current.configPath, expectedSnapshot: record.target.expectedSnapshot,
            expectedRevision: record.target.expectedRevision });
          if (result.current !== current.manifest.dataset.snapshot) throw fault('PUBLICATION_RESULT_CHANGED');
          return change(id, 'PUBLISHED', { publication: { recordedAt: stamp(), mode: record.target.mode,
            snapshot: result.current, revision: result.revision, result }, error: null }, 'PUBLICATION_COMPLETED');
        } catch (issue) {
          const rejected = issue.status === 409 || issue.status === 400 || issue.status === 422;
          return change(id, rejected ? 'READY' : 'PUBLICATION_UNKNOWN', { error: safeError(issue) },
            rejected ? 'PUBLICATION_REFUSED' : 'PUBLICATION_UNCERTAIN');
        } finally { await versions?.close(); }
      });
    }
    async function recover(id) {
      return mutate('recovery', id, async () => {
      const saved = run(id), current = await candidate(id);
      if (['INTERRUPTED', 'FAILED', 'CANCELLED'].includes(saved.state))
        return change(id, 'READY', { candidate: current.manifest, error: null }, 'COMPLETE_EXTRACTION_RECOVERED');
      let observed = await target(), versions;
      if (!observed.connected && saved.data.review?.target.mode === 'initialize') {
        try {
          versions = await openDatasetVersions({ directory: targetDirectory });
          observed = { connected: true, versions: versions.status() };
        } finally { await versions?.close(); }
      }
      if (observed.connected && observed.versions.current === current.manifest.dataset.snapshot &&
          observed.versions.versions.some(version => version.snapshot === current.manifest.dataset.snapshot && version.csvHash === current.manifest.csvHash))
        return change(id, 'PUBLISHED', { publication: { recordedAt: stamp(), mode: 'observed-active',
          snapshot: observed.versions.current, revision: observed.versions.revision }, error: null }, 'PUBLICATION_RECONCILED_ACTIVE');
      return { ...saved, observed, recovery: 'Review the displayed current target before another explicit publication. No data was changed.' };
      });
    }
    async function buyerOffer(id, query = '') {
      if (!buyer) throw fault('BUYER_SOURCE_REQUIRED', 'Start with --seller and --resource for the running original dataset seller.');
      if (typeof query !== 'string' || query.length > 8192) throw fault('BUYER_QUERY_INVALID');
      const current = await candidate(id), observed = await target();
      if (!observed.connected || !observed.resources?.some(item => item.resource === buyer.resource && item.snapshotSelection))
        throw fault('TARGET_BUYER_RESOURCE_MISMATCH', 'The target must advertise this exact snapshot-selectable resource.', 409);
      const selected = current.manifest.dataset.snapshot, parameters = new URLSearchParams(query);
      if (parameters.has('cursor') || parameters.has('snapshot')) throw fault('BUYER_FIRST_PAGE_REQUIRED');
      parameters.set('snapshot', selected);
      const preview = await datasetControl(targetDirectory, 'preview', { query: parameters.toString() });
      if (preview.dataset?.snapshot !== selected) throw fault('TARGET_SNAPSHOT_CHANGED');
      return readDatasetBuyerOffer({ ...buyer, snapshot: selected, query });
    }
    async function prepareBuyer(id, input) {
      return mutate('buyer handoff', id, async () => {
      const offer = await buyerOffer(id, input.query ?? '');
      const prepared = prepareDatasetBuyer(offer, input);
      const path = join(directory, 'runs', id, 'buyer-' + randomUUID() + '.json');
      await createFile(path, Buffer.from(prepared.configText)); await syncDirectory(join(directory, 'runs', id));
      event('BUYER_HANDOFF_PREPARED', id, { snapshot: prepared.snapshot, configSha256: prepared.configSha256,
        offerSha256: prepared.offerSha256, intentId: input.intentId, path });
      return { ...prepared, path };
      });
    }
    async function close() {
      if (closing) return closing;
      closed = true; active?.controller?.abort();
      closing = (async () => { try { await active?.promise; } finally { db.close(); await release(); } })();
      return closing;
    }
    return Object.freeze({ directory, settings, source, savePlan, plan, run, target, status, startExtraction,
      cancel, inspect, review, publish, recover, candidate, buyerOffer, prepareBuyer, close });
  } catch (issue) { db?.close(); await release(); throw issue; }
}
