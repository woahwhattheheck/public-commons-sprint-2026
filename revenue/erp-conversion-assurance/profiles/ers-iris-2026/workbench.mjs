// MIT. Private filing custody composed with the original reconciliation service.
import { constants, createReadStream } from 'node:fs';
import { mkdir, lstat, open, readdir, link, rename, unlink, rm, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve, join, dirname, isAbsolute, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { acquireStateLease } from '../../../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';

const SHA = /^[a-f0-9]{64}$/, ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const JSON_LIMIT = 128 * 1024 * 1024, STATE_LIMIT = 4 * 1024 * 1024, MAP_LIMIT = 256 * 1024;
const here = dirname(fileURLToPath(import.meta.url));
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const now = () => new Date().toISOString();
const clone = value => structuredClone(value);
export class IrisWorkbenchError extends Error {
  constructor(code, message, status = 400, details) { super(message); this.name = 'IrisWorkbenchError'; this.code = code; this.status = status; this.details = details; }
}
const fail = (code, message, status, details) => { throw new IrisWorkbenchError(code, message, status, details); };
const id = value => { if (typeof value !== 'string' || !ID.test(value)) fail('IRIS_ID_INVALID', 'Use an ID beginning with a letter or digit, followed by letters, digits, dots, underscores or hyphens (96 characters maximum).'); return value; };
const hash = value => { if (typeof value !== 'string' || !SHA.test(value)) fail('IRIS_DIGEST_INVALID', 'Choose an existing retained artifact digest.'); return value; };
const page = (value, fallback, maximum) => { value ??= fallback; if (!Number.isSafeInteger(value) || value < 0 || value > maximum) fail('IRIS_PAGE_INVALID', 'Choose a supported page size and position.'); return value; };

async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const s = await lstat(path);
  if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o077) || (process.getuid && s.uid !== process.getuid()))
    fail('IRIS_PRIVATE_DIRECTORY', 'Use a private directory owned by this operating-system account.');
}
async function syncDirectory(path) { const f = await open(path, constants.O_RDONLY); try { await f.sync(); } finally { await f.close(); } }
async function atomic(path, bytes, createOnly = false) {
  const temporary = join(dirname(path), '.write-' + randomUUID()); let f;
  try {
    f = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await f.writeFile(bytes); await f.sync(); await f.close(); f = null;
    if (createOnly) await link(temporary, path); else await rename(temporary, path);
    await syncDirectory(dirname(path));
  } finally { if (f) await f.close(); await unlink(temporary).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}
async function regularBytes(path, maximum, privateOnly = false) {
  const f = await open(resolve(path), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await f.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(maximum) || before.size < 1n ||
        (privateOnly && (Number(before.mode) & 0o077))) fail('IRIS_FILE_INVALID', 'Choose a nonempty regular file within this operation’s saved size limit.');
    const bytes = await f.readFile(), after = await f.stat({ bigint: true });
    if (bytes.length > maximum || BigInt(bytes.length) !== before.size || before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs)
      fail('IRIS_INPUT_CHANGED', 'The original file changed while it was being retained. Select its completed export again.', 409);
    return bytes;
  } finally { await f.close(); }
}
function safeSchemaPath(path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\\') || path.split('/').some(p => !p || p === '.' || p === '..'))
    fail('IRIS_SCHEMA_PATH', 'A retained schema path must stay inside its original package.');
  return path;
}

/** Domain artifacts live beside, and bind to, one original comparison service.
 * Calls serialize through the original Linux flock implementation. Readers can
 * reopen immutable revisions while another host or CLI owns a mutation. */
export async function openIrisWorkbench({ directory, service, python = 'python3', xsd, schemaRoot,
  maxArtifactBytes = 100 * 1024 * 1024, nativeTimeoutMs = 55000 } = {}) {
  if (typeof directory !== 'string' || !isAbsolute(directory)) fail('IRIS_DIRECTORY_REQUIRED', 'Provide the absolute private directory of the original reconciliation service.');
  for (const method of ['getBundle', 'getJob', 'getReviews', 'exportReplay'])
    if (typeof service?.[method] !== 'function') fail('IRIS_SERVICE_REQUIRED', 'Open the original retained reconciliation service first.');
  if (!Number.isSafeInteger(maxArtifactBytes) || maxArtifactBytes < 1 || maxArtifactBytes > 100 * 1024 * 1024 ||
      !Number.isSafeInteger(nativeTimeoutMs) || nativeTimeoutMs < 1000 || nativeTimeoutMs > 60000)
    fail('IRIS_LIMIT_INVALID', 'Use a positive artifact limit up to 100 MiB and a native deadline from 1 to 60 seconds.');
  const root = join(resolve(directory), 'iris');
  await privateDirectory(directory); await privateDirectory(root);
  for (const part of ['artifacts', 'filings', 'runtime']) await privateDirectory(join(root, part));
  const engineBytes = await regularBytes(join(here, 'iris.py'), 512 * 1024);
  const profileBytes = await regularBytes(join(here, 'profile.json'), MAP_LIMIT);
  const configuration = { schema: 'ers-iris.workbench.v1', serviceHmacKeySha256: service.configuration.hmacKeySha256,
    maxArtifactBytes, nativeTimeoutMs };
  const processes = new Set(), admitted = new Set(); let closed = false, closing;
  function track(operation) {
    if (closed) fail('IRIS_CLOSED', 'The filing workbench has closed.', 503);
    const pending = Promise.resolve().then(operation); admitted.add(pending);
    return pending.finally(() => admitted.delete(pending));
  }

  async function lease() {
    try { return await acquireStateLease(join(root, 'runtime')); }
    catch (error) {
      if (error.message === 'FLEET_STATE_ALREADY_OWNED') fail('IRIS_BUSY', 'Another operator is saving a filing. Refresh its retained revision before submitting again.', 409);
      if (error.message === 'FLEET_LINUX_FLOCK_REQUIRED') fail('IRIS_FLOCK_REQUIRED', 'The filing workbench requires Linux flock.');
      throw error;
    }
  }
  const initialization = await lease();
  try {
    const path = join(root, 'configuration.json');
    try {
      const existing = JSON.parse(await regularBytes(path, 4096, true));
      if (JSON.stringify(existing) !== JSON.stringify(configuration)) fail('IRIS_CONFIGURATION_CHANGED', 'Reopen this directory with its original service and saved filing limits.', 409);
    } catch (error) { if (error.code === 'ENOENT') await atomic(path, json(configuration), true); else throw error; }
  } finally { await initialization.close(); }

  async function artifact(bytes, kind) {
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > Math.max(maxArtifactBytes, JSON_LIMIT))
      fail('IRIS_ARTIFACT_LIMIT', 'The retained artifact exceeds the supported size limit.');
    const pin = { artifact: true, sha256: sha(bytes), bytes: bytes.length, kind }, path = join(root, 'artifacts', pin.sha256);
    try { await atomic(path, bytes, true); }
    catch (error) { if (error.code !== 'EEXIST') throw error; await readArtifact(pin); }
    return pin;
  }
  async function input(value, kind, maximum = maxArtifactBytes) {
    const bytes = typeof value === 'string' ? await regularBytes(value, maximum) : value?.bytes ?? value;
    if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > maximum) fail('IRIS_INPUT_REQUIRED', `Choose the complete ${kind} file within its supported size limit.`);
    return artifact(Buffer.from(bytes), kind);
  }
  async function readArtifact(pin) {
    if (!pin?.artifact || !Number.isSafeInteger(pin.bytes) || pin.bytes < 1 || pin.bytes > JSON_LIMIT)
      fail('IRIS_ARTIFACT_INVALID', 'The retained artifact descriptor is invalid.', 409);
    const bytes = await regularBytes(join(root, 'artifacts', hash(pin.sha256)), Math.max(maxArtifactBytes, JSON_LIMIT), true);
    if (sha(bytes) !== pin.sha256 || bytes.length !== pin.bytes) fail('IRIS_ARTIFACT_CHANGED', 'The retained artifact no longer matches its original digest.', 409);
    return bytes;
  }
  async function metadata(pin) {
    try { return JSON.parse(await readArtifact(pin)); }
    catch (error) { if (error instanceof SyntaxError) fail('IRIS_METADATA_INVALID', 'The retained operational metadata is not valid JSON.', 409); throw error; }
  }
  const engine = await artifact(engineBytes, 'domain-engine'), profile = await artifact(profileBytes, 'profile');

  async function loadFiling(filingId, snapshotSha256) {
    id(filingId);
    let head;
    if (snapshotSha256) {
      const bytes = await regularBytes(join(root, 'artifacts', hash(snapshotSha256)), STATE_LIMIT, true);
      if (sha(bytes) !== snapshotSha256) fail('IRIS_REVISION_CHANGED', 'The retained filing revision has changed.', 409);
      head = { sha256: snapshotSha256, bytes: bytes.length };
    } else {
      try { head = JSON.parse(await regularBytes(join(root, 'filings', filingId, 'head.json'), 4096, true)); }
      catch (error) { if (error.code === 'ENOENT') fail('IRIS_FILING_NOT_FOUND', 'The selected filing has not been retained.', 404); throw error; }
    }
    const state = await metadata({ artifact: true, kind: 'revision', ...head });
    if (state.schema !== 'ers-iris.filing.v1' || state.filingId !== filingId || !Number.isSafeInteger(state.revision) || state.revision < 1)
      fail('IRIS_STATE_INVALID', 'The retained filing revision is invalid.', 409);
    return { ...state, snapshotSha256: head.sha256 };
  }
  async function saveFiling(state, previous) {
    delete state.snapshotSha256;
    state.revision = (previous?.revision ?? 0) + 1;
    state.previousRevision = previous ? { artifact: true, kind: 'revision', sha256: previous.snapshotSha256,
      bytes: (await regularBytes(join(root, 'artifacts', previous.snapshotSha256), STATE_LIMIT, true)).length } : null;
    state.updatedAt = now();
    const bytes = json(state);
    if (bytes.length > STATE_LIMIT) fail('IRIS_HISTORY_LIMIT', 'This filing has reached its retained revision size limit. Export its history before beginning another filing.');
    const pin = await artifact(bytes, 'revision');
    await privateDirectory(join(root, 'filings', state.filingId));
    await atomic(join(root, 'filings', state.filingId, 'head.json'), json(pin));
    return { ...state, snapshotSha256: pin.sha256 };
  }
  async function mutate(filingId, expectedRevision, operation) {
    return track(async () => {
    const held = await lease();
    try {
      const previous = await loadFiling(filingId);
      if (!Number.isSafeInteger(expectedRevision) || previous.revision !== expectedRevision)
        fail('IRIS_REVISION_CONFLICT', 'The filing changed. Reopen its current revision and review the selected response before saving.', 409,
          { filingId, currentRevision: previous.revision, snapshotSha256: previous.snapshotSha256 });
      const next = clone(previous); await operation(next, previous); held.assertHeld();
      return await saveFiling(next, previous);
    } finally { await held.close(); }
    });
  }
  async function withTemporary(operation) {
    const temporary = await mkdtemp(join(root, 'runtime', 'operation-'));
    try { return await operation(temporary); } finally { await rm(temporary, { recursive: true, force: true }); }
  }
  async function materializeSchema(schema, temporary) {
    if (schema?.mode !== 'xsd') return [];
    const destination = join(temporary, 'schema'); await privateDirectory(destination);
    for (const file of schema.files) {
      const path = join(destination, safeSchemaPath(file.path)); await privateDirectory(dirname(path));
      await writeFile(path, await readArtifact(file.file), { flag: 'wx', mode: 0o600 });
    }
    return ['--xsd', join(destination, safeSchemaPath(schema.entry)), '--schema-root', destination];
  }
  async function captureSchema(validation) {
    if (validation.mode !== 'xsd') return { mode: 'xml-structure' };
    const base = await realpath(schemaRoot ?? dirname(xsd));
    const files = [];
    for (const pin of validation.files) {
      const relativePath = safeSchemaPath(pin.path), path = await realpath(join(base, relativePath));
      if (relative(base, path).split(/[\\/]/).includes('..')) fail('IRIS_SCHEMA_PATH', 'A schema import leaves the selected package.');
      const file = await input(path, 'xsd', 16 * 1024 * 1024);
      if (file.sha256 !== pin.sha256 || file.bytes !== pin.bytes) fail('IRIS_SCHEMA_CHANGED', 'The selected schema package changed during validation.', 409);
      files.push({ path: relativePath, file });
    }
    return { mode: 'xsd', entry: safeSchemaPath(validation.entry), files };
  }
  async function runNative(command, source, parameters = {}, { selectedSchema, configuredSchema = false, outputPath } = {}) {
    await readArtifact(source); await readArtifact(engine);
    return withTemporary(async temporary => {
      const args = [join(root, 'artifacts', engine.sha256), command, '--input', join(root, 'artifacts', source.sha256)];
      for (const [key, flag] of [['utid', '--utid'], ['receiptId', '--receipt-id'], ['httpStatus', '--http-status'], ['operation', '--operation']])
        if (parameters[key] !== undefined && parameters[key] !== null) args.push(flag, String(parameters[key]));
      if (parameters.mapping) { await readArtifact(parameters.mapping); args.push('--mapping', join(root, 'artifacts', parameters.mapping.sha256)); }
      const projectedPath = command === 'extract' ? outputPath ?? join(temporary, 'projection.csv') : null;
      if (projectedPath) args.push('--output', projectedPath);
      if (selectedSchema) args.push(...await materializeSchema(selectedSchema, temporary));
      else if (configuredSchema && xsd) args.push('--xsd', resolve(xsd), '--schema-root', resolve(schemaRoot ?? dirname(xsd)));
      const result = await new Promise((yes, no) => {
        const child = spawn(python, args, { stdio: ['ignore', 'pipe', 'ignore'] }); processes.add(child);
        const parts = []; let bytes = 0, failure;
        const timer = setTimeout(() => { failure = new IrisWorkbenchError('IRIS_NATIVE_TIMEOUT', 'The native filing operation exceeded its saved deadline.', 408); child.kill('SIGKILL'); }, nativeTimeoutMs);
        child.stdout.on('data', part => { bytes += part.length; if (bytes > JSON_LIMIT) { failure = new IrisWorkbenchError('IRIS_NATIVE_LIMIT', 'The native metadata exceeds the supported limit.'); child.kill('SIGKILL'); } else parts.push(part); });
        child.on('error', () => { failure = new IrisWorkbenchError('IRIS_PYTHON_REQUIRED', 'The selected Python runtime could not start.'); });
        child.on('close', code => {
          clearTimeout(timer); processes.delete(child);
          if (failure) return no(failure);
          let value; try { value = JSON.parse(Buffer.concat(parts)); } catch { return no(new IrisWorkbenchError('IRIS_NATIVE_RESPONSE', 'The native operation returned invalid operational metadata.', 500)); }
          if (value?.error) return no(new IrisWorkbenchError(value.error.code ?? 'IRIS_NATIVE_FAILED', value.error.message ?? 'The native operation could not complete.'));
          if (code !== 0 || value?.schema !== `ers-iris.${command === 'extract' ? 'projection' : command === 'transmission' ? 'transmission' : command === 'plan' ? 'decision' : command}.v1`)
            return no(new IrisWorkbenchError('IRIS_NATIVE_RESPONSE', 'The native operation did not return its expected result schema.', 500));
          yes(value);
        });
      });
      if (command !== 'plan' && (result.source?.sha256 !== source.sha256 || result.source?.bytes !== source.bytes))
        fail('IRIS_NATIVE_BINDING', 'The native result differs from its retained input.', 409);
      let schema = selectedSchema;
      if (configuredSchema) schema = await captureSchema(result.schemaValidation);
      const output = projectedPath ? await input(projectedPath, 'projection-csv', Math.max(maxArtifactBytes, service.configuration.maxInputBytes)) : null;
      if (output && (result.output?.sha256 !== output.sha256 || result.output?.bytes !== output.bytes || result.mapping?.sha256 !== parameters.mapping.sha256))
        fail('IRIS_PROJECTION_CHANGED', 'The projected CSV or mapping differs from the native result.', 409);
      const resultFile = await artifact(json(result), 'native-result');
      const operation = await artifact(json({ schema: 'ers-iris.native-operation.v1', command, engine, input: source,
        parameters, schemaPackage: schema ?? { mode: 'xml-structure' }, result: resultFile, output }), 'native-operation');
      return { result, resultFile, operation, output, schema };
    });
  }
  async function allFilings() {
    const names = (await readdir(join(root, 'filings'))).filter(name => ID.test(name)).sort(); const result = [];
    for (const name of names) { try { result.push(await loadFiling(name)); } catch (e) { if (e.code !== 'IRIS_FILING_NOT_FOUND') throw e; } }
    return result;
  }
  function summary(state) {
    return { filingId: state.filingId, familyId: state.familyId, revision: state.revision, snapshotSha256: state.snapshotSha256,
      createdAt: state.createdAt, updatedAt: state.updatedAt, manifest: state.manifest, recordCount: state.recordCount,
      submissionCount: state.submissionCount, schemaMode: state.schemaPackage.mode, receiptId: state.receiptId,
      currentResponseId: state.currentResponseId, status: state.responses.find(row => row.responseId === state.currentResponseId)?.status ?? 'Prepared',
      projectionCount: state.projections.length, comparisonCount: state.comparisons.length, parent: state.parent };
  }
  async function listFilings({ limit = 25, after = '', familyId } = {}) {
    limit = page(limit, 25, 100); if (!limit) fail('IRIS_PAGE_INVALID', 'Page size must be positive.');
    if (after) id(after); if (familyId) id(familyId);
    const rows = (await allFilings()).filter(row => (!familyId || row.familyId === familyId) && row.filingId > after);
    return { filings: rows.slice(0, limit).map(summary), nextCursor: rows.length > limit ? rows[limit - 1].filingId : null };
  }
  async function intake({ filingId, input: selectedInput, familyId, parent, preparedRecordMap, validation = 'configured' } = {}) {
    return track(async () => {
    id(filingId); if (!['configured', 'structure'].includes(validation)) fail('IRIS_VALIDATION_INVALID', 'Choose configured XSD validation or explicit XML structure inspection.');
    const held = await lease();
    try {
      try { await loadFiling(filingId); fail('IRIS_FILING_EXISTS', 'This filing ID already exists. Reopen its original XML or use a new filing ID.', 409); }
      catch (e) { if (e.code !== 'IRIS_FILING_NOT_FOUND') throw e; }
      const xml = await input(selectedInput, 'filing-xml'), parsed = await runNative('transmission', xml, {}, { configuredSchema: validation === 'configured' });
      const duplicate = (await allFilings()).find(row => row.manifest.utid === parsed.result.manifest.utid);
      if (duplicate) fail('IRIS_UTID_EXISTS', 'This UTID already belongs to a retained filing. Reopen it instead of creating another filing.', 409, { filingId: duplicate.filingId });
      let parentPin = null, provenance = null;
      if (parent) {
        const previous = await loadFiling(id(parent.filingId));
        const plan = previous.decisions.find(row => row.decisionId === parent.decisionId);
        if (!plan) fail('IRIS_PARENT_PLAN_REQUIRED', 'Choose a saved decision from the parent filing.');
        await readArtifact(plan.result);
        if (plan.failureId) {
          const failure = previous.failures.find(row => row.failureId === plan.failureId);
          if (!failure) fail('IRIS_FAILURE_NOT_FOUND', 'The parent decision’s native failure is unavailable.', 409);
          await readArtifact(failure.raw); await readArtifact(failure.result);
        }
        if (plan.evidenceId) {
          const evidence = previous.evidence.find(row => row.evidenceId === plan.evidenceId);
          if (!evidence) fail('IRIS_EVIDENCE_NOT_FOUND', 'The parent decision’s original-system evidence is unavailable.', 409);
          await readArtifact(evidence.raw);
        }
        const decisionInput = await metadata(plan.input), family = (await allFilings()).filter(row => row.familyId === previous.familyId);
        const pair = await currentPair(previous, !['resend', 'legacy-correction'].includes(decisionInput.action));
        const history = [];
        for (const row of family) if (row.filingId !== previous.filingId && row.currentResponseId) history.push(await currentPair(row));
        const preparedInput = await artifact(json({ ...decisionInput, ...pair, ack: pair.ack, history,
          preparedTransmission: parsed.result, ...(preparedRecordMap ? { preparedRecordMap } : {}) }), 'prepared-decision-input');
        const validated = await runNative('plan', preparedInput), decision = validated.result;
        if (decision.preparedValidation?.source?.sha256 !== xml.sha256 || decision.preparedValidation?.utid !== parsed.result.manifest.utid)
          fail('IRIS_PREPARED_VALIDATION_REQUIRED', 'The native domain must validate the complete prepared child transmission.', 409);
        const scope = await plannedScope(previous, decision, family);
        await requireAvailableScope(previous, decision, scope, family);
        provenance = await artifact(json(await childProvenance(parsed.result, decision, scope, preparedRecordMap)), 'record-provenance');
        parentPin = { filingId: previous.filingId, revision: previous.revision, snapshotSha256: previous.snapshotSha256,
          decisionId: plan.decisionId, decisionSha256: plan.result.sha256, input: preparedInput,
          validatedDecision: validated.resultFile, validationOperation: validated.operation,
          preparedValidation: decision.preparedValidation, ...(decision.filingDateTreatment ? { filingDateTreatment: decision.filingDateTreatment } : {}) };
        familyId = previous.familyId;
      } else if (familyId) familyId = (await loadFiling(id(familyId))).familyId;
      const stamp = now();
      held.assertHeld();
      return await saveFiling({ schema: 'ers-iris.filing.v1', filingId, familyId: familyId ?? filingId, parent: parentPin,
        createdAt: stamp, profile, domainEngine: engine, xml, transmission: parsed.resultFile, transmissionOperation: parsed.operation, provenance,
        schemaPackage: parsed.schema ?? { mode: 'xml-structure' }, manifest: parsed.result.manifest,
        recordCount: parsed.result.recordCount, submissionCount: parsed.result.submissions.length,
        receiptId: null, currentResponseId: null, projections: [], responses: [], failures: [], evidence: [], decisions: [], comparisons: [] }, null);
    } finally { await held.close(); }
    });
  }
  async function project({ filingId, expectedRevision, projectionId, mapping } = {}) {
    id(projectionId);
    return mutate(filingId, expectedRevision, async state => {
      if (state.projections.some(row => row.projectionId === projectionId)) fail('IRIS_PROJECTION_EXISTS', 'Use a new projection ID for an edited map.', 409);
      const map = await input(mapping, 'xml-map', MAP_LIMIT);
      const parsed = await runNative('extract', state.xml, { mapping: map }, { selectedSchema: state.schemaPackage });
      state.projections.push({ projectionId, createdAt: now(), mapping: map, output: parsed.output, result: parsed.resultFile,
        operation: parsed.operation, columns: parsed.result.columns, recordCount: parsed.result.recordCount });
    });
  }
  async function importResponse({ filingId, expectedRevision, input: response, select = false } = {}) {
    if (typeof select !== 'boolean') fail('IRIS_SELECTION_INVALID', 'Choose whether to select this response as the current observation.');
    return mutate(filingId, expectedRevision, async state => {
      const raw = await input(response, 'irs-response');
      const parsed = await runNative('ack', raw, { utid: state.manifest.utid, receiptId: state.receiptId });
      const previous = state.responses.find(row => row.raw.sha256 === raw.sha256);
      if (previous) { if (select) state.currentResponseId = previous.responseId; return; }
      const responseId = randomUUID();
      state.responses.push({ responseId, createdAt: now(), raw, result: parsed.resultFile, operation: parsed.operation,
        kind: parsed.result.kind, status: parsed.result.status, receiptId: parsed.result.receiptId, submissionCount: parsed.result.submissions.length });
      if (parsed.result.receiptId) state.receiptId = parsed.result.receiptId;
      if (select) state.currentResponseId = responseId;
    });
  }
  async function selectResponse({ filingId, expectedRevision, responseId } = {}) {
    return mutate(filingId, expectedRevision, async state => {
      const selected = state.responses.find(row => row.responseId === responseId);
      if (!selected) fail('IRIS_RESPONSE_NOT_FOUND', 'Choose a retained response.');
      await readArtifact(selected.raw); await readArtifact(selected.result); state.currentResponseId = responseId;
    });
  }
  async function importFailure({ filingId, expectedRevision, input: response, httpStatus, operation = 'intake' } = {}) {
    if (!Number.isInteger(httpStatus) || !['intake', 'acknowledgment'].includes(operation)) fail('IRIS_FAILURE_CAPTURE', 'Provide the actual HTTP status and native operation.');
    return mutate(filingId, expectedRevision, async state => {
      const raw = await input(response, 'native-failure', 8 * 1024 * 1024);
      const parsed = await runNative('failure', raw, { utid: state.manifest.utid, httpStatus, operation });
      if (state.failures.some(row => row.raw.sha256 === raw.sha256 && row.httpStatus === httpStatus && row.operationName === operation))
        fail('IRIS_FAILURE_EXISTS', 'This captured failure is already retained.', 409);
      state.failures.push({ failureId: randomUUID(), createdAt: now(), raw, result: parsed.resultFile, operation: parsed.operation,
        httpStatus, operationName: operation, classification: parsed.result.classification, lookupRequired: parsed.result.lookupRequired });
    });
  }
  async function retainEvidence({ filingId, expectedRevision, input: selected, evidenceId } = {}) {
    id(evidenceId);
    return mutate(filingId, expectedRevision, async state => {
      if (state.evidence.some(row => row.evidenceId === evidenceId)) fail('IRIS_EVIDENCE_EXISTS', 'Use a new ID for another original-system evidence file.', 409);
      state.evidence.push({ evidenceId, createdAt: now(), raw: await input(selected, 'legacy-evidence') });
    });
  }
  async function currentPair(state, required = true) {
    await readArtifact(state.xml);
    const transmission = await metadata(state.transmission), selected = state.responses.find(row => row.responseId === state.currentResponseId);
    if (!selected) { if (required) fail('IRIS_CURRENT_RESPONSE_REQUIRED', 'Select a retained IRS response for this filing.'); return { transmission }; }
    await readArtifact(selected.raw);
    return { transmission, ack: await metadata(selected.result) };
  }
  async function plannedScope(current, decision, family) {
    const provenance = new Map(), sources = new Map();
    const origin = async (state, submissionId, recordId) => {
      if (!provenance.has(state.filingId)) {
        const rows = state.provenance ? await metadata(state.provenance) : [];
        provenance.set(state.filingId, new Map(rows.map(row => [JSON.stringify([row.submissionId, row.recordId]), row])));
      }
      const selected = provenance.get(state.filingId).get(JSON.stringify([submissionId, recordId]));
      if (state.provenance && !selected) fail('IRIS_PROVENANCE_INVALID', 'The retained child lineage omits a selected native record.', 409);
      return selected ? { originFilingId: selected.originFilingId, originSubmissionId: selected.originSubmissionId,
        originRecordId: selected.originRecordId } : { originFilingId: state.filingId, originSubmissionId: submissionId, originRecordId: recordId };
    };
    const sourceByReceipt = receipt => {
      const found = family.filter(row => row.receiptId === receipt);
      if (found.length !== 1) fail('IRIS_SOURCE_LINEAGE_REQUIRED', 'Retain the unique source filing and its receipt before preparing this successor.', 409);
      return found[0];
    };
    if (decision.submissions) for (const group of decision.submissions) {
      let source = current, sid = group.submissionId;
      const reference = group.originalUniqueSubmissionId || group.submissionId;
      if (decision.action === 'replace' && decision.transmissionType === 'R') {
        if (decision.originalReceiptId) source = sourceByReceipt(decision.originalReceiptId);
        else if (group.originalUniqueSubmissionId) {
          const parts = group.originalUniqueSubmissionId.split('|'); source = sourceByReceipt(parts[0]); sid = parts[1];
        }
      }
      for (const row of group.records) sources.set(JSON.stringify([reference, row.recordId]), {
        ...(await origin(source, sid, row.recordId)), sourceFilingId: source.filingId, sourceSubmissionId: sid, sourceRecordId: row.recordId,
      });
    }
    else if (decision.records) for (const row of decision.records) {
      let source = current, sid = row.submissionId, rid = row.recordId;
      if (row.UniqueRecordId) {
        const parts = row.UniqueRecordId.split('|'); source = sourceByReceipt(parts[0]); sid = parts[1]; rid = parts[2];
      }
      sources.set(row.UniqueRecordId ?? JSON.stringify([sid, rid]), { ...(await origin(source, sid, rid)),
        sourceFilingId: source.filingId, sourceSubmissionId: sid, sourceRecordId: rid });
    }
    return sources;
  }
  function scopeKey(row) { return JSON.stringify([row.originFilingId, row.originSubmissionId, row.originRecordId]); }
  async function activeRecordScope(state) {
    if (!state.currentResponseId || !['O', 'R'].includes(state.manifest.type)) return new Set();
    const { transmission, ack } = await currentPair(state);
    if (['Rejected', 'Not Found'].includes(ack.status)) return new Set();
    const origins = state.provenance ? new Map((await metadata(state.provenance)).map(row => [JSON.stringify([row.submissionId, row.recordId]), row])) : new Map();
    const active = new Set(['Accepted', 'Accepted with Errors', 'Received', 'Processing']), keys = new Set();
    for (const group of transmission.submissions) {
      const response = ack.submissions.find(row => row.submissionId === group.submissionId);
      if (response?.status === 'Rejected') continue;
      for (const record of group.records) {
        const detail = response?.records.find(row => row.recordId === record.recordId);
        const status = detail?.status ?? response?.status ?? ack.status;
        const origin = origins.get(JSON.stringify([group.submissionId, record.recordId]));
        if (state.provenance && !origin) fail('IRIS_PROVENANCE_INVALID', 'The retained child lineage omits a native record.', 409);
        if (active.has(status)) keys.add(scopeKey(origin ?? { originFilingId: state.filingId,
          originSubmissionId: group.submissionId, originRecordId: record.recordId }));
      }
    }
    return keys;
  }
  async function requireAvailableScope(current, decision, scope, family) {
    if (!['O', 'R'].includes(decision.transmissionType) || !['replace', 'refile-original', 'resend'].includes(decision.action)) return;
    const selected = new Set([...scope.values()].map(scopeKey));
    for (const row of family) {
      const active = await activeRecordScope(row);
      if ([...active].some(key => selected.has(key))) fail('IRIS_SUCCESSOR_ALREADY_ACTIVE',
        'A retained successor already has an accepted or in-flight IRS observation for this exact source scope. Open that filing and follow its current native result.', 409,
        { filingId: row.filingId, currentResponseId: row.currentResponseId, revision: row.revision });
    }
  }
  async function childProvenance(transmission, decision, scope, preparedRecordMap = []) {
    const rename = new Map(preparedRecordMap.map(row => [JSON.stringify([row.submissionId, row.recordId]), JSON.stringify([row.sourceSubmission, row.sourceRecordId])]));
    const rows = [];
    for (const group of transmission.submissions) for (const record of group.records) {
      const key = decision.submissions ? rename.get(JSON.stringify([group.submissionId, record.recordId])) ??
        JSON.stringify([group.originalUniqueSubmissionId || group.submissionId, record.recordId]) :
        record.previousUniqueRecordId ?? JSON.stringify([group.submissionId, record.recordId]);
      const source = scope.get(key);
      if (!source) fail('IRIS_PROVENANCE_REQUIRED', 'The prepared native record needs its verified source-scope lineage.', 409);
      rows.push({ ...source, submissionId: group.submissionId, recordId: record.recordId });
    }
    return rows;
  }
  async function rebuildLineage({ filingId, expectedRevision } = {}) {
    return mutate(filingId, expectedRevision, async state => {
      if (!state.parent?.input || !state.parent.validationOperation) fail('IRIS_PARENT_VALIDATION_REQUIRED', 'This filing needs its original retained prepared-child validation to rebuild record lineage.');
      await readArtifact(state.xml); await readArtifact(state.parent.validatedDecision);
      const request = await metadata(state.parent.input), transmission = await metadata(state.transmission);
      if (request.preparedTransmission?.source?.sha256 !== state.xml.sha256 || transmission.source?.sha256 !== state.xml.sha256)
        fail('IRIS_PARENT_INPUT_CONFLICT', 'The saved native validation must identify this exact original XML.', 409);
      const validated = await runNative('plan', state.parent.input);
      if (validated.result.preparedValidation?.source?.sha256 !== state.xml.sha256)
        fail('IRIS_PREPARED_VALIDATION_REQUIRED', 'The native domain must validate the retained child before rebuilding its lineage.', 409);
      const parent = await loadFiling(state.parent.filingId), family = (await allFilings()).filter(row => row.familyId === state.familyId);
      const scope = await plannedScope(parent, validated.result, family);
      const rows = await childProvenance(transmission, validated.result, scope, request.preparedRecordMap);
      const key = value => JSON.stringify(value.map(row => [row.submissionId, row.recordId, row.originFilingId,
        row.originSubmissionId, row.originRecordId, row.sourceFilingId, row.sourceSubmissionId, row.sourceRecordId]).sort());
      if (state.provenance && key(await metadata(state.provenance)) === key(rows)) fail('IRIS_LINEAGE_CURRENT', 'The retained record lineage already matches its original native validation.', 409);
      const provenance = await artifact(json(rows), 'record-provenance');
      (state.lineageRebuilds ??= []).push({ createdAt: now(), previousProvenance: state.provenance, provenance,
        validation: validated.resultFile, validationOperation: validated.operation });
      state.provenance = provenance;
    });
  }
  async function plan({ filingId, expectedRevision, action, selection, submissionIds, reason, failureId, evidenceId } = {}) {
    if (!['recover-receipt', 'resend', 'replace', 'refile-original', 'correct', 'wrong-form', 'legacy-correction'].includes(action)) fail('IRIS_ACTION_INVALID', 'Choose a supported filing operation.');
    return mutate(filingId, expectedRevision, async (state, previous) => {
      const pair = await currentPair(state, !['recover-receipt', 'resend', 'legacy-correction'].includes(action));
      const history = [], historyRefs = [];
      for (const row of await allFilings()) if (row.familyId === state.familyId && row.filingId !== state.filingId && row.currentResponseId) {
        history.push(await currentPair(row)); historyRefs.push({ filingId: row.filingId, revision: row.revision,
          snapshotSha256: row.snapshotSha256, responseId: row.currentResponseId });
      }
      const request = { action, ...pair, history, ...(selection === undefined ? {} : { selection }),
        ...(submissionIds === undefined ? {} : { submissionIds }), ...(reason ? { reason } : {}) };
      if (failureId) {
        const selected = state.failures.find(row => row.failureId === failureId);
        if (!selected) fail('IRIS_FAILURE_NOT_FOUND', 'Choose a retained native failure.');
        await readArtifact(selected.raw); request.failure = await metadata(selected.result);
      }
      if (evidenceId) {
        const selected = state.evidence.find(row => row.evidenceId === evidenceId);
        if (!selected) fail('IRIS_EVIDENCE_NOT_FOUND', 'Choose retained original-system evidence.');
        await readArtifact(selected.raw); request.legacyEvidenceSha256 = selected.raw.sha256;
      }
      const requestFile = await artifact(json(request), 'decision-input');
      const parsed = await runNative('plan', requestFile);
      const family = (await allFilings()).filter(row => row.familyId === state.familyId);
      await requireAvailableScope(state, parsed.result, await plannedScope(state, parsed.result, family), family);
      state.decisions.push({ decisionId: randomUUID(), createdAt: now(), action, revision: previous.revision,
        snapshotSha256: previous.snapshotSha256, responseId: state.currentResponseId, history: historyRefs,
        ...(failureId ? { failureId } : {}), ...(evidenceId ? { evidenceId } : {}),
        input: requestFile, result: parsed.resultFile, operation: parsed.operation, transmissionType: parsed.result.transmissionType,
        requirements: parsed.result.requirements, ...(parsed.result.filingDateTreatment ? { filingDateTreatment: parsed.result.filingDateTreatment } : {}), recordCount: parsed.result.records?.length ?? null,
        submissionCount: parsed.result.submissions?.length ?? null });
    });
  }
  async function binding(value) {
    if (!value || typeof value !== 'object') fail('IRIS_PROJECTION_REQUIRED', 'Select the retained filing projection for this comparison.');
    const state = await loadFiling(id(value.filingId), value.snapshotSha256);
    const projection = state.projections.find(row => row.projectionId === value.projectionId);
    if (!projection) fail('IRIS_PROJECTION_NOT_FOUND', 'The selected filing revision does not contain this projection.');
    await readArtifact(state.xml); await readArtifact(projection.mapping); await readArtifact(projection.output);
    const result = { schema: 'ers-iris.comparison-binding.v1', filingId: state.filingId, familyId: state.familyId,
      revision: state.revision, snapshotSha256: state.snapshotSha256, utid: state.manifest.utid,
      projectionId: projection.projectionId, xmlSha256: state.xml.sha256,
      mappingSha256: projection.mapping.sha256, targetSha256: projection.output.sha256, profileSha256: state.profile.sha256 };
    for (const key of ['targetSha256', 'xmlSha256', 'mappingSha256']) if (value[key] && value[key] !== result[key])
      fail('IRIS_BINDING_CHANGED', 'The selected projection identity changed. Reopen the original filing revision.', 409);
    return result;
  }
  async function linkComparison({ filingId, expectedRevision, projectionId, jobId, reportSha256 } = {}) {
    id(jobId); hash(reportSha256);
    return mutate(filingId, expectedRevision, async state => {
      const projection = state.projections.find(row => row.projectionId === projectionId);
      if (!projection) fail('IRIS_PROJECTION_NOT_FOUND', 'Choose a retained projection.');
      await readArtifact(projection.output);
      const job = await service.getJob(jobId), retained = await service.getBundle(job.bundleId);
      if (job.state !== 'COMPLETED' || job.result?.report?.sha256 !== reportSha256)
        fail('IRIS_REPORT_CONFLICT', 'Select the exact completed original comparison report.', 409);
      const selected = retained.spec.workspace?.iris;
      if (!selected || selected.filingId !== filingId || selected.projectionId !== projectionId ||
          selected.targetSha256 !== projection.output.sha256 || retained.bundle.target.sha256 !== projection.output.sha256 ||
          job.result.target.sha256 !== projection.output.sha256)
        fail('IRIS_COMPARISON_TARGET_CONFLICT', 'The original comparison must use this filing’s exact projected target CSV and saved IRIS binding.', 409);
      await binding(selected);
      if (state.comparisons.some(row => row.jobId === jobId)) fail('IRIS_COMPARISON_EXISTS', 'This original run is already linked to the filing.', 409);
      state.comparisons.push({ jobId, bundleId: job.bundleId, projectionId, reportSha256, status: job.result.status,
        sourceSha256: retained.bundle.source.sha256, targetSha256: retained.bundle.target.sha256,
        specSha256: retained.bundle.spec.sha256, engineSha256: retained.bundle.engine.sha256, linkedAt: now() });
    });
  }
  async function getFiling(filingId) {
    const state = await loadFiling(filingId);
    const comparisons = [];
    for (const reference of state.comparisons) {
      const job = await service.getJob(reference.jobId);
      if (job.bundleId !== reference.bundleId || job.result?.report?.sha256 !== reference.reportSha256)
        fail('IRIS_REPORT_CONFLICT', 'A linked original comparison changed identity.', 409);
      comparisons.push({ ...reference, job, reviews: await service.getReviews(reference.jobId) });
    }
    const activeScopeConflicts = []; let lineageIssue = null;
    try {
      const active = await activeRecordScope(state);
      if (active.size) for (const other of await allFilings()) if (other.familyId === state.familyId && other.filingId !== filingId) {
        const sharedRecords = [...await activeRecordScope(other)].filter(key => active.has(key)).length;
        if (sharedRecords) activeScopeConflicts.push({ filingId: other.filingId, revision: other.revision,
          status: summary(other).status, currentResponseId: other.currentResponseId, sharedRecords });
      }
    } catch (error) {
      if (error.code !== 'IRIS_PROVENANCE_INVALID') throw error;
      lineageIssue = { error: error.code, message: error.message };
    }
    return { ...state, summary: summary(state), comparisons, activeScopeConflicts, ...(lineageIssue ? { lineageIssue } : {}) };
  }
  async function transmissionPage(filingId, { submissionId = '', offset = 0, limit = 50 } = {}) {
    offset = page(offset, 0, Number.MAX_SAFE_INTEGER); limit = page(limit, 50, 200);
    if (!limit) fail('IRIS_PAGE_INVALID', 'Page size must be positive.');
    const state = await loadFiling(filingId), transmission = await metadata(state.transmission);
    const rows = submissionId ? (transmission.submissions.find(row => row.submissionId === submissionId)?.records ?? null)
      : transmission.submissions.map(({ records, ...row }) => row);
    if (!rows) fail('IRIS_SUBMISSION_NOT_FOUND', 'Choose a retained submission ID.');
    return { filingId, revision: state.revision, submissionId, total: rows.length, offset,
      nextOffset: offset + limit < rows.length ? offset + limit : null, rows: rows.slice(offset, offset + limit) };
  }
  async function responsePage(filingId, responseId, { offset = 0, limit = 50, submissionId = '' } = {}) {
    const state = await loadFiling(filingId), selected = state.responses.find(row => row.responseId === responseId);
    if (!selected) fail('IRIS_RESPONSE_NOT_FOUND', 'Choose a retained response.');
    offset = page(offset, 0, Number.MAX_SAFE_INTEGER); limit = page(limit, 50, 200);
    const result = await metadata(selected.result), rows = submissionId
      ? result.submissions.find(row => row.submissionId === submissionId)?.records : result.submissions;
    if (!rows || !limit) fail('IRIS_PAGE_INVALID', 'Choose a returned submission and positive page size.');
    return { filingId, responseId, kind: result.kind, utid: result.utid, receiptId: result.receiptId, status: result.status,
      errors: result.errors.slice(0, 200), errorCount: result.errors.length, offset, total: rows.length,
      nextOffset: offset + limit < rows.length ? offset + limit : null,
      rows: rows.slice(offset, offset + limit).map(row => ({ ...row, ...(row.records ? { records: row.records.slice(0, 200), recordCount: row.records.length } : {}),
        errors: row.errors.slice(0, 200), errorCount: row.errors.length })) };
  }
  async function decisionView(filingId, decisionId) {
    const state = await loadFiling(filingId), selected = state.decisions.find(row => row.decisionId === decisionId);
    if (!selected) fail('IRIS_DECISION_NOT_FOUND', 'Choose a retained decision.');
    const result = await metadata(selected.result);
    return { ...result, records: result.records?.slice(0, 100), recordCount: result.records?.length,
      submissions: result.submissions?.slice(0, 100).map(({ records, ...row }) => ({ ...row, records: records?.slice(0, 100), recordCount: records?.length })),
      submissionCount: result.submissions?.length, resultSha256: selected.result.sha256 };
  }
  async function download(filingId, kind, selector) {
    const state = await loadFiling(filingId); let pin, filename, type;
    if (kind === 'xml') { pin = state.xml; filename = `${filingId}.xml`; type = 'application/xml'; }
    if (kind === 'projection' || kind === 'mapping') {
      const row = state.projections.find(value => value.projectionId === selector);
      pin = kind === 'projection' ? row?.output : row?.mapping;
      filename = `${filingId}-${id(selector)}.${kind === 'projection' ? 'csv' : 'json'}`;
      type = kind === 'projection' ? 'text/csv; charset=utf-8' : 'application/json';
    }
    if (kind === 'response') { pin = state.responses.find(row => row.responseId === selector)?.raw; filename = `${filingId}-response.xml`; type = 'application/xml'; }
    if (kind === 'decision') { pin = state.decisions.find(row => row.decisionId === selector)?.result; filename = `${filingId}-decision.json`; type = 'application/json'; }
    if (!pin) fail('IRIS_DOWNLOAD_NOT_FOUND', 'Choose an existing original or projected filing artifact.', 404);
    return { bytes: await readArtifact(pin), filename, type, sha256: pin.sha256 };
  }
  async function exportRetainedHandoff({ filingId, destination } = {}) {
    const selected = await loadFiling(filingId), members = (await allFilings()).filter(row => row.familyId === selected.familyId);
    if (typeof destination !== 'string' || !isAbsolute(destination)) fail('IRIS_EXPORT_DIRECTORY', 'Use an absolute create-only private handoff directory.');
    await mkdir(destination, { mode: 0o700 }); await privateDirectory(destination);
    const artifacts = new Map(), revisions = new Map(), jobs = new Map();
    const collect = value => {
      if (!value || typeof value !== 'object') return;
      if (value.artifact === true) { hash(value.sha256); artifacts.set(value.sha256, value); }
      for (const child of Object.values(value)) if (child && typeof child === 'object') collect(child);
    };
    for (const current of members) {
      let state = current;
      while (state) {
        if (revisions.has(state.snapshotSha256)) break;
        collect(state); revisions.set(state.snapshotSha256, state);
        for (const comparison of state.comparisons) jobs.set(comparison.jobId, comparison);
        state = state.previousRevision ? await loadFiling(state.filingId, state.previousRevision.sha256) : null;
      }
    }
    for (const [digest, state] of revisions) {
      const bytes = await regularBytes(join(root, 'artifacts', digest), STATE_LIMIT, true);
      if (sha(bytes) !== digest) fail('IRIS_REVISION_CHANGED', 'A retained revision changed during handoff.', 409);
      artifacts.set(digest, { artifact: true, sha256: digest, bytes: bytes.length, kind: 'revision' });
    }
    await privateDirectory(join(destination, 'artifacts'));
    const operations = new Map(), pending = [...artifacts.values()], copied = new Set();
    for (let index = 0; index < pending.length; index++) {
      const pin = pending[index]; if (copied.has(pin.sha256)) continue;
      const bytes = await readArtifact(pin); copied.add(pin.sha256);
      await atomic(join(destination, 'artifacts', pin.sha256), bytes, true);
      if (pin.kind === 'native-operation') {
        const operation = JSON.parse(bytes); operations.set(pin.sha256, operation);
        const old = new Set(artifacts.keys()); collect(operation);
        for (const [key, added] of artifacts) if (!old.has(key)) pending.push(added);
      }
    }
    const comparisons = [];
    if (jobs.size) await privateDirectory(join(destination, 'comparisons'));
    for (const reference of jobs.values()) {
      const job = await service.getJob(reference.jobId);
      if (job.bundleId !== reference.bundleId || job.result?.report?.sha256 !== reference.reportSha256)
        fail('IRIS_REPORT_CONFLICT', 'A linked report changed during handoff.', 409);
      const result = await service.exportReplay({ jobId: reference.jobId, destination: join(destination, 'comparisons', reference.jobId) });
      const { directory: ignored, ...receipt } = result;
      comparisons.push({ ...receipt, path: `comparisons/${reference.jobId}` });
    }
    const manifest = { schema: 'ers-iris.handoff.v1', exportedAt: now(), familyId: selected.familyId, filingId,
      filings: members.map(row => ({ filingId: row.filingId, revision: row.revision, snapshotSha256: row.snapshotSha256 })),
      artifacts: [...artifacts.values()], operations: [...operations.keys()], comparisons };
    const manifestBytes = json(manifest); await atomic(join(destination, 'handoff.json'), manifestBytes, true);
    await atomic(join(destination, 'replay-domain.mjs'), await regularBytes(join(here, 'replay.mjs'), 128 * 1024), true);
    await atomic(join(destination, 'README.md'), Buffer.from('# Retained IRIS filing handoff\n\nRun `node replay-domain.mjs` to verify every retained domain artifact and replay the original pinned native operations with Python 3. Supply `--python /path/to/python3` when needed. XSD operations use lxml and the retained schema files.\n\nEach `comparisons/<jobId>/` directory is the original reconciliation service export. Run `node replay.mjs` in that directory to reproduce its exact report. The exported original report and reviewer history remain together.\n\n`handoff.json` pins filing heads, native operation metadata, XML maps/projections, response artifacts and original comparison exports. Revision chains remain under their content hashes in `artifacts/`.\n'), true);
    return { schema: 'ers-iris.handoff-export.v1', directory: destination, filingId, familyId: selected.familyId,
      manifest: { sha256: sha(manifestBytes), bytes: manifestBytes.length }, filingCount: members.length,
      revisionCount: revisions.size, artifactCount: artifacts.size, nativeOperationCount: operations.size, comparisonCount: comparisons.length };
  }
  const exportHandoff = options => track(() => exportRetainedHandoff(options));
  async function createHandoff(filingId) {
    return track(async () => {
    const temporary = await mkdtemp(join(root, 'runtime', 'handoff-'));
    try {
      const exported = await exportRetainedHandoff({ filingId, destination: join(temporary, 'filing') });
      const path = join(temporary, 'handoff.tar.gz');
      await new Promise((yes, no) => {
        const child = spawn('tar', ['-czf', path, '-C', temporary, 'filing'], { stdio: ['ignore', 'ignore', 'ignore'] });
        const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
        child.on('error', () => { clearTimeout(timer); no(new IrisWorkbenchError('IRIS_TAR_REQUIRED', 'Private browser handoff requires tar.')); });
        child.on('close', code => { clearTimeout(timer); code === 0 ? yes() : no(new IrisWorkbenchError('IRIS_EXPORT_FAILED', 'The private handoff archive could not be completed.', 500)); });
      });
      return { filename: `${id(filingId)}-iris-handoff.tar.gz`, exported, bytes: (await lstat(path)).size,
        stream: () => createReadStream(path), close: () => rm(temporary, { recursive: true, force: true }) };
    } catch (error) { await rm(temporary, { recursive: true, force: true }); throw error; }
    });
  }
  return Object.freeze({ configuration: clone(configuration), schemaConfigured: Boolean(xsd), listFilings, intake, project,
    importResponse, selectResponse, importFailure, retainEvidence, plan, binding, linkComparison, rebuildLineage, getFiling,
    transmissionPage, responsePage, decisionView, download, exportHandoff, createHandoff,
    close: () => closing ??= (async () => { closed = true; await Promise.allSettled([...admitted]); })() });
}
