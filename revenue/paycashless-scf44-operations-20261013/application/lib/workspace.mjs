// MIT. Exact provider custody and immutable payment evidence in the original Node SQLite store.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import {
  PaycashlessError, need, now, hash, canonical, jsonBytes, clone, directory, confined,
  writeExact, fileDescriptor, verifyFile, readJSON, lease, publicError, redact, parseLedgerCSV,
} from './files.mjs';
import {
  NATIVE_ACTIONS, describeConnection, buildRequest, executeProvider, projectResource,
  reconcileVersions, verifyWebhook, nextPageRequest, validateOperation,
} from './native.mjs';
import { parseSourceJSON } from './source-json.mjs';
import { exactInput } from './provider-auth.mjs';
import { parseSSEFrame } from './settlement-sse.mjs';
import { normalizeBook, normalizeLinkDecision, reconcilePayments } from './paycashless.mjs';
import { paycashlessReport } from './reports.mjs';

export const WORKSPACE_SCHEMA = 'paycashless.operations-workspace.v1';
export const TABLES = [
  'books', 'links', 'operations', 'attempts', 'captures', 'sources', 'resources',
  'resourceVersions', 'webhooks', 'reconciliations', 'reports', 'exports', 'streams',
];

const definition = (name, required, properties = {}) => ({
  name, mutates: true,
  inputSchema: { type: 'object', required, properties, additionalProperties: true },
});
const textField = {type:'string'}, idsField={type:'array',items:textField};
export const PAYCASHLESS_METHODS = [
  definition('profile.update',['name'],{name:textField}),
  definition('file.retain',['fileId'],{fileId:textField}),
  definition('book.save',['definition'],{definition:{type:'object'},bookId:textField,sourceIds:idsField}),
  definition('link.save',['bookVersionId','decision'],{bookVersionId:textField,decision:{type:'object'}}),
  definition('operation.prepare',['connectionAlias','action'],{
    connectionAlias:textField,action:textField,input:{type:'object'},inputJSON:textField,fileId:textField,
    evidence:{type:'object',properties:{bookVersionId:textField,
      versionIds:{type:'object',additionalProperties:textField},
      sourceIds:{type:'object',additionalProperties:textField}}},
  }),
  definition('operation.dispatch',['operationId'],{operationId:textField}),
  definition('operation.reconcile',['operationId'],{operationId:textField}),
  definition('operation.retry-original',['operationId'],{operationId:textField}),
  definition('operation.cancel',['operationId','reason']),
  definition('capture.start',['connectionAlias','action'],{connectionAlias:textField,action:textField,input:{type:'object'},inputJSON:textField}),
  definition('capture.run',['captureId'],{captureId:textField,maxPages:{type:'integer',minimum:1,maximum:10000}}),
  definition('capture.pause',['captureId']),
  definition('stream.configure',['connectionAlias','accountId','cursor']),
  definition('stream.pause',['streamId','paused']),
  definition('stream.status',['streamId','state','message']),
  definition('stream.commit',['streamId','expectedCursor','requestCursor','eventId','dataJSON','rawBase64','requestURL','responseHeaders','observedAt']),
  definition('source.import',['fileId','connectionAlias','action']),
  definition('source.project',['sourceId']),
  definition('reconciliation.create',['bookVersionId'],{bookVersionId:textField,versionIds:idsField,sourceIds:idsField,captureIds:idsField,name:textField}),
  definition('report.create',['reconciliationId'],{reconciliationId:textField,name:textField}),
  definition('webhook.reconcile',['webhookId']),
  definition('delivery.configure',['enabled']),
  definition('workspace.export',['destination']),
  definition('report.export',['reportId','destination']),
  definition('package.inspect',['sourceDirectory']),
  definition('package.receive',['sourceDirectory','destination']),
];
function json(value) { return value == null ? null : JSON.parse(value); }
function rowValue(row) { return row ? JSON.parse(row.document) : null; }
function requestIdentity(method, args) { return hash(Buffer.from(canonical({ method, args }))); }
function normalizedNativeId(id) {
  return String(id); // Provider identifiers are case-sensitive original strings.
}
function localResourceId(scope, environment, kind, id) {
  return hash(Buffer.from(canonical([scope, environment, kind, normalizedNativeId(id)])));
}

export async function openPaycashlessWorkspace({
  directory: workspaceDirectory,
  connections = {},
  name = 'Paycashless payment and settlement',
  sourceDirectory,
  runtimeDirectory,
  expectedManifestSha256,
  adapters = {},
} = {}) {
  need(Number(process.versions.node.split('.')[0]) === 24, 'NODE_24_REQUIRED');
  need(path.isAbsolute(workspaceDirectory), 'ABSOLUTE_DIRECTORY_REQUIRED');
  await directory(workspaceDirectory);
  await directory(path.join(workspaceDirectory, 'objects'));
  const dbPath = path.join(workspaceDirectory, 'workspace.sqlite');
  const db = new DatabaseSync(dbPath, { timeout: 10000 });
  try {
  await fs.chmod(dbPath, 0o600);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
  db.exec([
    'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;',
    'CREATE TABLE IF NOT EXISTS records (',
    ' table_name TEXT NOT NULL, id TEXT NOT NULL, sequence INTEGER NOT NULL,',
    ' document TEXT NOT NULL, PRIMARY KEY(table_name,id)) STRICT;',
    'CREATE INDEX IF NOT EXISTS records_page ON records(table_name,sequence,id);',
    "CREATE INDEX IF NOT EXISTS records_run_scope ON records(table_name,",
    " json_extract(document,'$.bookVersionId'),json_extract(document,'$.status'),sequence,id);",
    'CREATE TABLE IF NOT EXISTS journal (revision INTEGER PRIMARY KEY,',
    ' previous_sha256 TEXT, sha256 TEXT NOT NULL, document TEXT NOT NULL) STRICT;',
    'CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, intent_sha256 TEXT NOT NULL,',
    ' method TEXT NOT NULL, args TEXT NOT NULL, expected_revision INTEGER,',
    ' status TEXT NOT NULL, result TEXT, error TEXT, created_at TEXT NOT NULL,',
    ' updated_at TEXT NOT NULL) STRICT;',
    'CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, document TEXT NOT NULL) STRICT;',
  ].join('\n'));

  const native = {
    buildRequest, executeProvider, projectResource, reconcileVersions,
    verifyWebhook, nextPageRequest, validateOperation, ...adapters,
  };
  const getMeta = key => json(db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value);
  const setMeta = (key, value) => db.prepare(
    'INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
  ).run(key, JSON.stringify(value));
  if (!getMeta('identity')) {
    db.exec('BEGIN IMMEDIATE');
    try {
      if (!getMeta('identity')) {
        setMeta('identity', { schema: WORKSPACE_SCHEMA, id: randomUUID(), createdAt: now() });
        setMeta('profile', { name });
        setMeta('revision', 0);
        setMeta('head', null);
        setMeta('dispatchEnabled', false);
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  need(getMeta('identity').schema === WORKSPACE_SCHEMA, 'WORKSPACE_SCHEMA_MISMATCH');

  const selectedConnections = clone(connections);
  const secrets = () => Object.values(selectedConnections).flatMap(connection =>
    [connection.apiKey, connection.apiSecret, connection.token, connection.bearerToken, connection.webhookSecret,
      ...Object.values(connection.webhookSecrets ?? {}), ...Object.values(connection.secrets ?? {}),
      ...Object.values(connection.webhookEndpoints ?? {}).flatMap(endpoint=>[endpoint.secretKey,endpoint.apiSecret])]).filter(Boolean);

  function connection(alias, expected) {
    const selected = selectedConnections[alias];
    need(selected, 'CONNECTION_NOT_CONFIGURED', { alias });
    const descriptor = publicConnection(alias, selected);
    if (expected) need(canonical(descriptor) === canonical(expected),
      'CONNECTION_SCOPE_CHANGED', { alias });
    return selected;
  }

  function publicConnection(alias, selected) {
    const descriptor = describeConnection(selected);
    need(descriptor && typeof descriptor === 'object', 'INVALID_CONNECTION_DESCRIPTOR');
    return { ...clone(descriptor), alias };
  }

  function sourceScope(selected) {
    const descriptor = describeConnection(selected);
    return descriptor.sourceScope ?? descriptor.id ?? hash(Buffer.from(canonical({
      provider: descriptor.provider, environment: descriptor.environment,
      organizationId: descriptor.organizationId ?? null, tenant: descriptor.tenant ?? null,
      identityId: descriptor.identityId ?? null, accountNumber: descriptor.accountNumber ?? null, network: descriptor.network ?? null,
      baseUrl: descriptor.baseUrl ?? null,
    })));
  }

  function current(table, id) {
    need(TABLES.includes(table), 'UNKNOWN_TABLE');
    return rowValue(db.prepare(
      'SELECT document FROM records WHERE table_name=? AND id=?').get(table, String(id)));
  }

  function requireRow(table, id) {
    const row = current(table, id);
    need(row, 'RECORD_NOT_FOUND', { table, id });
    return row;
  }

  function put(table, value) {
    need(TABLES.includes(table) && typeof value.id === 'string', 'INVALID_RECORD');
    const previous = db.prepare(
      'SELECT sequence FROM records WHERE table_name=? AND id=?').get(table, value.id);
    const sequence = previous?.sequence ?? db.prepare(
      'SELECT COALESCE(MAX(sequence),0)+1 AS n FROM records').get().n;
    db.prepare([
      'INSERT INTO records(table_name,id,sequence,document) VALUES(?,?,?,?)',
      'ON CONFLICT(table_name,id) DO UPDATE SET document=excluded.document',
    ].join(' ')).run(table, value.id, sequence, JSON.stringify(value));
    return value;
  }

  function transition(kind, detail, work) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      const revision = getMeta('revision') + 1;
      const entry = {
        revision, previous: getMeta('head'), kind, detail,
        createdAt: now(), result: result ?? null,
      };
      const digest = hash(Buffer.from(canonical(entry)));
      db.prepare('INSERT INTO journal VALUES(?,?,?,?)').run(
        revision, entry.previous, digest, JSON.stringify(entry));
      setMeta('revision', revision);
      setMeta('head', digest);
      db.exec('COMMIT');
      return result;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  function listAll(table) {
    need(TABLES.includes(table), 'UNKNOWN_TABLE');
    return db.prepare('SELECT document FROM records WHERE table_name=? ORDER BY sequence,id')
      .all(table).map(rowValue);
  }

  async function retainFile(body, {
    filename = 'source.bin', contentType = 'application/octet-stream', private: isPrivate = false,
  } = {}) {
    body = Buffer.from(body);
    const sha256 = hash(body);
    const id = (isPrivate ? 'private-' : 'public-') + sha256;
    const relative = 'objects/' + id.slice(0, 12) + '/' + id;
    const destination = await confined(workspaceDirectory, relative, true);
    await writeExact(destination, body);
    const descriptor = {
      id, path: relative, filename: path.basename(filename), contentType,
      bytes: body.length, sha256, mode: 0o600, private: isPrivate,
    };
    db.prepare('INSERT INTO files(id,document) VALUES(?,?) ON CONFLICT(id) DO NOTHING')
      .run(id, JSON.stringify(descriptor));
    return descriptor;
  }

  function file(id, { private: allowPrivate = false } = {}) {
    const descriptor = rowValue(db.prepare('SELECT document FROM files WHERE id=?').get(id));
    need(descriptor && (allowPrivate || !descriptor.private), 'FILE_NOT_AVAILABLE');
    return descriptor;
  }

  async function fileBytes(id, options) {
    const descriptor = file(id, options);
    await verifyFile(workspaceDirectory, descriptor);
    return fs.readFile(await confined(workspaceDirectory, descriptor.path));
  }

  function publicValue(value) { return redact(value, secrets()); }

  function describe() {
    const identity = getMeta('identity');
    return {
      workspace: {
        id: identity.id, revision: getMeta('revision'), head: getMeta('head'),
        name: getMeta('profile').name, createdAt: identity.createdAt,
        dispatchEnabled: getMeta('dispatchEnabled'),
        receivedFrom: getMeta('receivedFrom'),
      },
      connections: Object.entries(selectedConnections)
        .map(([alias, value]) => publicConnection(alias, value)),
      catalogue: NATIVE_ACTIONS,
      methods: PAYCASHLESS_METHODS,
      summary: Object.fromEntries(TABLES.map(table => [
        table, db.prepare('SELECT count(*) AS n FROM records WHERE table_name=?').get(table).n,
      ])),
    };
  }

  function list({ table, limit = 100, cursor = null, ...filters }) {
    need(TABLES.includes(table) || table === 'requests', 'UNKNOWN_TABLE');
    need(Number.isSafeInteger(Number(limit)) && Number(limit) >= 1 && Number(limit) <= 500,
      'INVALID_PAGE_SIZE');
    const start = cursor ? JSON.parse(Buffer.from(cursor, 'base64url').toString()) : { sequence: 0, id: '' };
    if (table === 'requests') {
      const rows = db.prepare(
        'SELECT * FROM requests WHERE (created_at,id) > (?,?) ORDER BY created_at,id LIMIT ?'
      ).all(start.createdAt ?? '', start.id, Number(limit) + 1);
      const selected = rows.slice(0, Number(limit));
      const last = selected.at(-1);
      return {
        rows: selected.map(requestRow),
        nextCursor: rows.length > Number(limit) ? Buffer.from(JSON.stringify({
          createdAt: last.created_at, id: last.id,
        })).toString('base64url') : null,
      };
    }
    const allowed = ['state', 'status', 'connectionAlias', 'environment', 'resourceKind',
      'resourceId', 'operationId', 'captureId', 'kind', 'bookId', 'bookVersionId', 'reconciliationId'];
    const clauses = ['table_name=?', '(sequence,id) > (?,?)'];
    const values = [table, start.sequence, start.id];
    for (const [key, value] of Object.entries(filters)) {
      need(allowed.includes(key), 'UNSUPPORTED_FILTER', { key });
      clauses.push("json_extract(document,'$." + key + "')=?");
      values.push(String(value));
    }
    const rows = db.prepare('SELECT sequence,id,document FROM records WHERE ' +
      clauses.join(' AND ') + ' ORDER BY sequence,id LIMIT ?')
      .all(...values, Number(limit) + 1);
    const selected = rows.slice(0, Number(limit));
    const last = selected.at(-1);
    return {
      rows: selected.map(row => publicValue(rowValue(row))),
      nextCursor: rows.length > Number(limit) ? Buffer.from(JSON.stringify({
        sequence: last.sequence, id: last.id,
      })).toString('base64url') : null,
    };
  }

  function localResult(value) {
    if(!value)return value;
    const local=getMeta('identity').id;
    if(value.workspaceId===local)return value;
    return {...value,workspaceId:local,
      originalWorkspaceId:value.originalWorkspaceId??value.workspaceId};
  }

  function requestRow(row) {
    return publicValue({
      id: row.id, method: row.method, args: json(row.args), status: row.status,
      result: localResult(json(row.result)), error: json(row.error), createdAt: row.created_at,
      updatedAt: row.updated_at, expectedRevision: row.expected_revision,
    });
  }

  function item(table, id) {
    if (table === 'requests') {
      const row = db.prepare('SELECT * FROM requests WHERE id=?').get(id);
      need(row, 'RECORD_NOT_FOUND');
      return requestRow(row);
    }
    return publicValue(requireRow(table, id));
  }

  function applyProjection(source, rows) {
    const versionIds = [];
    for (const incoming of rows) {
      need(incoming.kind && incoming.id != null, 'INVALID_PROVIDER_PROJECTION');
      const contentSha256=incoming.contentSha256 ?? incoming.versionSha256;
      need(typeof contentSha256==='string' && /^[a-f0-9]{64}$/.test(contentSha256),
        'PROVIDER_PROJECTION_HASH_REQUIRED');
      const resourceId = localResourceId(source.sourceScope ?? source.connectionAlias, incoming.environment,
        incoming.kind, String(incoming.id));
      const versionId = hash(Buffer.from(canonical([
        source.id, incoming.kind, String(incoming.id), incoming.pointer ?? '',
        contentSha256,
      ])));
      if (current('resourceVersions', versionId)) {
        versionIds.push(versionId);
        continue;
      }
      const version = {
        ...incoming,contentSha256,provider:incoming.provider??source.provider,
        id: versionId, resourceId: String(incoming.id),
        localResourceId: resourceId, sourceId: source.id,
        connectionAlias: source.connectionAlias, sourceScope: source.sourceScope, createdAt: source.createdAt,
      };
      const resource = current('resources', resourceId);
      const existing = resource ? requireRow('resourceVersions', resource.currentVersionId) : null;
      const decision = existing ? native.reconcileVersions(
        { ...existing, id: normalizedNativeId(existing.resourceId) },
        { ...incoming, id: normalizedNativeId(incoming.id) }) :
        { decision: 'replace', reason: 'First original observation.' };
      put('resourceVersions', { ...version, reconciliation: decision });
      if (!resource || decision.decision === 'replace') {
        put('resources', {
          id: resourceId, kind: incoming.kind, resourceId: String(incoming.id),
          environment: incoming.environment, connectionAlias: source.connectionAlias,
          sourceScope: source.sourceScope,
          connectionAliases: [...new Set([...(resource?.connectionAliases ?? []), source.connectionAlias])],
          currentVersionId: versionId, conflict: false,
          projection: incoming.value, projectionNumberTokens:incoming.numberTokens??{}, createdAt: resource?.createdAt ?? source.createdAt,
          updatedAt: source.createdAt, sourceUpdatedAt: incoming.sourceUpdatedAt,
        });
      } else if (decision.decision === 'conflict') {
        put('resources', { ...resource, conflict: true, updatedAt: source.createdAt });
      }
      versionIds.push(versionId);
    }
    return versionIds;
  }

  async function retainExchange(exchange, context) {
    const id = context.sourceId ?? randomUUID();
    const existing = current('sources', id);
    if (existing) return existing;
    need(canonical(exchange.request.context) === canonical(describeConnection(connection(context.connectionAlias))),
      'ORIGINAL_EXCHANGE_CONNECTION_CHANGED');
    need(exchange.request.context.environment === context.environment, 'ORIGINAL_EXCHANGE_ENVIRONMENT_CHANGED');
    const requestBody = jsonBytes(exchange.request);
    const requestFile = await retainFile(requestBody, {
      filename: 'provider-request.json', contentType: 'application/json', private: true,
    });
    let responseFile = null;
    let downloadFile = null;
    if (exchange.response?.bodyBase64 !== undefined) {
      const raw = Buffer.from(exchange.response.bodyBase64, 'base64');
      need(raw.length === exchange.response.bytes && hash(raw) === exchange.response.sha256,
        'PROVIDER_BODY_IDENTITY_MISMATCH');
      responseFile = await retainFile(raw, {
        filename: context.filename ?? 'provider-response.bin',
        contentType: exchange.response.headers?.['content-type'] ?? 'application/octet-stream',
        private: true,
      });
      const containsSecret = secrets().some(secret => raw.includes(Buffer.from(secret)) ||
        raw.includes(Buffer.from(encodeURIComponent(secret))) ||
        raw.includes(Buffer.from(JSON.stringify(secret).slice(1, -1))));
      const safeValue = !exchange.parsed ||
        canonical(publicValue(exchange.parsed.value)) === canonical(exchange.parsed.value);
      const statement = exchange.request.downloadable === true &&
        ['csv', 'pdf', 'binary'].includes(exchange.request.responseFormat) && exchange.response.complete &&
        exchange.classification?.outcome === 'accepted';
      if (!containsSecret && safeValue && (statement || exchange.parsed)) {
        downloadFile = await retainFile(raw, {
          filename: statement ? 'original-statement.' + exchange.request.responseFormat : 'original-response.json',
          contentType: exchange.response.headers?.['content-type'] ?? 'application/octet-stream',
        });
      }
    }
    const receiptFile = await retainFile(jsonBytes(exchange), {
      filename: 'original-exchange.json', contentType: 'application/json', private: true,
    });
    const publicBody = {
      request: publicValue(exchange.request),
      startedAt: exchange.startedAt, finishedAt: exchange.finishedAt,
      transport: publicValue(exchange.transport),
      response: exchange.response ? {
        status: exchange.response.status, statusText: exchange.response.statusText,
        headers: publicValue(exchange.response.headers),
        bytes: exchange.response.bytes, sha256: exchange.response.sha256,
        complete: exchange.response.complete,
      } : null,
      parsed: publicValue(exchange.parsed), parseError: exchange.parseError,
      classification:exchange.classification,retry:exchange.retry??null,
      retryAfter:exchange.retryAfter??exchange.response?.headers?.['retry-after']??null,
    };
    const publicFile = await retainFile(jsonBytes(publicBody), {
      filename: 'provider-observation.json', contentType: 'application/json',
    });
    let rows = [];
    let projectionError = null;
    try {
      rows = exchange.classification?.outcome === 'accepted' && exchange.response?.complete
        ? native.projectResource({
        exchange, environment: context.environment,
        sourceReference: {
          sourceId:id,connectionAlias:context.connectionAlias,
          sourceScope:sourceScope(connection(context.connectionAlias)),
          provider:exchange.request.provider ?? connection(context.connectionAlias).provider,
          network:publicConnection(context.connectionAlias,connection(context.connectionAlias)).network ?? null,
          networkPassphrase:publicConnection(context.connectionAlias,connection(context.connectionAlias)).networkPassphrase ?? null,
          observedAt:exchange.finishedAt ?? now(),requestAction: exchange.request.action, input: exchange.request.input,
        },
      }) : [];
    } catch (error) { projectionError = publicError(error); }
    const source = {
      id, kind: context.kind ?? exchange.request.action, action:exchange.request.action, requestInput:clone(exchange.request.input),
      requestSha256:hash(Buffer.from(canonical(exchange.request))),connection:clone(exchange.request.context),
      createdAt: exchange.finishedAt ?? now(), ...context,
      provider: exchange.request.provider ?? connection(context.connectionAlias).provider,
      sourceScope:sourceScope(connection(context.connectionAlias)),
      network:publicConnection(context.connectionAlias,connection(context.connectionAlias)).network ?? null,
      networkPassphrase:publicConnection(context.connectionAlias,connection(context.connectionAlias)).networkPassphrase ?? null,
      requestFileId: requestFile.id, responseFileId: responseFile?.id ?? null,
      receiptFileId: receiptFile.id, publicFileId: publicFile.id,
      downloadableFileId: downloadFile?.id ?? null,
      downloadFileName: downloadFile?.filename ?? null,
      downloadContentType: downloadFile?.contentType ?? null,
      privateBody: true, bodySha256: responseFile?.sha256 ?? null,
      bytes: responseFile?.bytes ?? 0, status: exchange.response?.status ?? null,
      bodyComplete: exchange.response?.complete ?? false,
      classification:exchange.classification,retry:exchange.retry??null,
      retryAfter:exchange.retryAfter??exchange.response?.headers?.['retry-after']??null,projectionError,
      error: exchange.transport.error ?? exchange.parseError ?? null,
    };
    transition('source.retained', { sourceId: id }, () => {
      source.versionIds = applyProjection(source, rows);
      return put('sources', source);
    });
    return source;
  }

  async function prepareOperation(args, requestId) {
    const previous = current('operations', requestId);
    if (previous) return previous;
    const selected = connection(args.connectionAlias);
    const input = exactInput(args);
    if (args.fileId) {
      const descriptor = file(args.fileId, { private: true });
      const body = await fileBytes(descriptor.id, { private: true });
      need(input.file === undefined, 'DUPLICATE_ORIGINAL_FILE_SELECTION');
      input.file = { filename: descriptor.filename, contentType: descriptor.contentType,
        bodyBase64: body.toString('base64'), bytes: descriptor.bytes, sha256: descriptor.sha256 };
    }
    const request = await native.buildRequest(selected, args.action, input);
    need(request.action === args.action && !request.headers?.Authorization &&
      !request.headers?.authorization, 'INVALID_NATIVE_PREPARATION');
    const operation = {
      id: requestId, action: args.action, input: clone(input), inputJSON:args.inputJSON??null, fileId: args.fileId ?? null,
      connectionAlias: args.connectionAlias,
      connection: publicConnection(args.connectionAlias, selected),
      request, requestSha256: hash(Buffer.from(canonical(request))),
      evidence: clone(args.evidence ?? {}), state: 'PREPARED',
      readback: request.readback, resourceKind: request.resourceKind,
      resourceId: request.resourceId, environment: request.environment,
      attemptIds: [], sourceIds: [], createdAt: now(), updatedAt: now(),
    };
    const prepared = await retainFile(jsonBytes(operation), {
      filename: 'prepared-operation.json', contentType: 'application/json', private: true,
    });
    operation.preparedFileId = prepared.id;
    return transition('operation.prepared', { operationId: operation.id },
      () => put('operations', operation));
  }

  async function economicEvidence(operation) {
    if (!operation.request.mutation) return;
    const selection = operation.evidence ?? {};
    const evidence = {versions:{},sources:{},book:null};
    for (const [name,id] of Object.entries(selection.versionIds ?? {})) {
      const value = requireRow('resourceVersions',id);
      need(value.environment === operation.environment,'EVIDENCE_ENVIRONMENT_MISMATCH');
      evidence.versions[name] = value;
      need(!Object.hasOwn(evidence,name),'RESERVED_EVIDENCE_NAME');
      evidence[name] = value;
    }
    for (const [name,id] of Object.entries(selection.sourceIds ?? {})) {
      const value = requireRow('sources',id);
      need(value.environment === operation.environment,'EVIDENCE_ENVIRONMENT_MISMATCH');
      const original = {...value,exchange:value.receiptFileId ?
        JSON.parse((await fileBytes(value.receiptFileId,{private:true})).toString()) : null};
      evidence.sources[name] = original;
      need(!Object.hasOwn(evidence,name),'DUPLICATE_EVIDENCE_NAME');
      evidence[name] = original;
    }
    if (selection.bookVersionId) {
      const book=requireRow('books',selection.bookVersionId);
      need(book.definition.environment===operation.environment,'BOOK_ENVIRONMENT_MISMATCH');
      need(Object.values(book.definition.connectionAliases).flat().includes(operation.connectionAlias),
        'OPERATION_OUTSIDE_BOOK_CONNECTIONS');
      evidence.book=book.definition;
    }
    await native.validateOperation({request:operation.request,evidence,now:now()});
  }

  async function retryAuthorization() {
    need(false,'ORIGINAL_RETRY_UNSUPPORTED',{reason:'The issued Paycashless contract does not declare idempotent financial retries. Retain the original attempt and use its exact native readback.'});
  }

  async function dispatchOperation(operationId, commandId, signal, {retryOriginal=false} = {}) {
    const guard = await lease(workspaceDirectory, 'operation-' + hash(operationId));
    try {
      let operation = requireRow('operations', operationId);
      const attemptId = operation.state === 'DISPATCHING'
        ? operation.attemptIds.at(-1) : commandId + ':dispatch';
      need(attemptId, 'ORIGINAL_ATTEMPT_REQUIRED');
      const prior = current('attempts', attemptId);
      if (prior?.sourceId) return operation;
      if(retryOriginal)need(operation.state!=='PREPARED','LATEST_ORIGINAL_RETRY_RESPONSE_REQUIRED');
      if(retryOriginal && ['REJECTED','UNCERTAIN'].includes(operation.state)) {
        const authorization=await retryAuthorization(operation,commandId);
        operation=transition('operation.original-retry-selected',{operationId,commandId},() =>
          put('operations',{...operation,state:'RETRY_READY',retryAuthorization:authorization,updatedAt:now()}));
      }
      if(operation.state==='RETRY_READY') {
        need(retryOriginal,'ORIGINAL_RETRY_REQUEST_REQUIRED');
        if(operation.retryAuthorization?.commandId!==commandId) {
          const priorCommand=db.prepare('SELECT status FROM requests WHERE id=?')
            .get(operation.retryAuthorization?.commandId);
          const priorAttempt=current('attempts',operation.retryAuthorization?.commandId+':dispatch');
          need(priorCommand?.status==='FAILED' && !priorAttempt,'ORIGINAL_RETRY_REQUEST_REQUIRED');
          const authorization=await retryAuthorization(operation,commandId);
          operation=transition('operation.original-retry-reselected',{operationId,commandId},() =>
            put('operations',{...operation,
              retrySelectionHistory:[...(operation.retrySelectionHistory??[]),operation.retryAuthorization],
              retryAuthorization:authorization,updatedAt:now()}));
        }
      } else if(['ACCEPTED','REJECTED','UNCERTAIN','CANCELED'].includes(operation.state))return operation;
      connection(operation.connectionAlias, operation.connection);
      const attemptDirectory = path.join(workspaceDirectory, 'attempts', hash(attemptId));
      await directory(attemptDirectory);
      const responsePath = path.join(attemptDirectory, 'exchange.private.json');
      let exchange = await readJSON(responsePath, true);
      if (operation.state === 'DISPATCHING' && !exchange) {
        return transition('operation.uncertain', { operationId, attemptId }, () => {
          const original = operation.attemptIds.at(-1);
          if (original) {
            const row = requireRow('attempts', original);
            put('attempts', { ...row, status: 'UNCERTAIN', finishedAt: now() });
          }
          operation = { ...operation, state: 'UNCERTAIN', updatedAt: now() };
          return put('operations', operation);
        });
      }
      if (!exchange) {
        need(['PREPARED','RETRY_READY'].includes(operation.state),'OPERATION_NOT_PREPARED');
        if(operation.state==='RETRY_READY')await retryAuthorization(operation,commandId);
        if (operation.request.mutation) need(getMeta('dispatchEnabled') === true,
          'PROVIDER_DISPATCH_DISABLED');
        await economicEvidence(operation);
        transition('operation.dispatching', { operationId, attemptId }, () => {
          put('attempts', {
            id: attemptId, operationId, requestSha256: operation.requestSha256,
            originalRetry:operation.state==='RETRY_READY' ? operation.retryAuthorization : null,
            status: 'DISPATCHING', startedAt: now(),
          });
          operation = {
            ...operation, state: 'DISPATCHING', updatedAt: now(),
            attemptIds: [...operation.attemptIds, attemptId],
          };
          put('operations', operation);
        });
        const selected = connection(operation.connectionAlias, operation.connection);
        try {
          exchange = await native.executeProvider(operation.request,
            { connection: selected, signal });
        } catch (error) {
          exchange = {
            schema: 'paycashless.original-provider-exchange.v1', request: operation.request,
            startedAt: requireRow('attempts', attemptId).startedAt, finishedAt: now(),
            transport: { status: 'uncertain', error: publicError(error) },
            response: null, parsed: null, parseError: null,
            classification: { outcome: 'uncertain', reason: 'Original dispatch has no complete response.' },
          };
        }
        await writeExact(responsePath, jsonBytes(exchange));
      }
      const source = await retainExchange(exchange, {
        sourceId: hash('attempt-source:' + attemptId),
        connectionAlias: operation.connectionAlias, operationId, attemptId,
        environment: operation.environment,
      });
      return transition('operation.observed', { operationId, attemptId, sourceId: source.id }, () => {
        const status = exchange.classification.outcome.toUpperCase();
        need(['ACCEPTED', 'REJECTED', 'UNCERTAIN'].includes(status), 'INVALID_PROVIDER_OUTCOME');
        put('attempts', {
          ...requireRow('attempts', attemptId), status,
          finishedAt: exchange.finishedAt, sourceId: source.id,
        });
        return put('operations', {
          ...operation, state: status, updatedAt: now(),
          sourceIds: [...new Set([...operation.sourceIds, source.id])],
          outcome:exchange.classification,retry:exchange.retry??null,
          retryAfter:exchange.retryAfter??exchange.response?.headers?.['retry-after']??null,
          firstAttemptAt:requireRow('attempts',operation.attemptIds[0]).startedAt,
        });
      });
    } finally { await guard.release(); }
  }

  async function reconcileOperation(args, requestId, signal) {
    const retained=getMeta('local-command-result:'+requestId);if(retained)return retained.value;
    const original = requireRow('operations', args.operationId);
    need(original.readback, 'NATIVE_READBACK_UNAVAILABLE');
    connection(original.connectionAlias,original.connection);
    let observed,sources,capture=null,completePopulation=false;
    const paginated=NATIVE_ACTIONS.find(entry=>entry.id===original.readback.action)?.pagination;
    if(paginated){
      const earlier=original.reconciliation;
      const candidate=earlier?.completePopulation!==true&&earlier?.captureId&&
        canonical(earlier.selectedOriginal)===canonical(original.readback)?current('captures',earlier.captureId):null;
      const captureId=candidate?.id??requestId+':readback-capture';
      if(candidate)need(candidate.action===original.readback.action&&candidate.connectionAlias===original.connectionAlias&&
        canonical(candidate.connection)===canonical(original.connection),'ORIGINAL_READBACK_CAPTURE_CHANGED');
      await startCapture({connectionAlias:original.connectionAlias,connection:original.connection,
        action:original.readback.action,input:original.readback.input},captureId);
      capture=await runCapture({captureId,maxPages:args.maxPages??100},requestId,signal);
      const last=capture.pageAttempts?.at(-1)?.operationId;
      observed=last?requireRow('operations',last):{id:null,state:'UNCERTAIN',sourceIds:[]};
      const ids=[...new Set([...capture.pages.map(page=>page.sourceId),...(capture.rejectedSourceIds??[]),...(observed.sourceIds??[])])];
      sources=ids.map(id=>requireRow('sources',id));
      completePopulation=capture.status==='COMPLETE'&&capture.next===null&&capture.pages.length>0&&
        !(capture.rejectedSourceIds??[]).length;
    }else{
      const read = await prepareOperation({
        connectionAlias: original.connectionAlias,
        action: original.readback.action, input: original.readback.input,
      }, requestId + ':readback');
      need(read.request.mutation === false, 'RECONCILIATION_MUST_BE_READ_ONLY');
      observed = await dispatchOperation(read.id, requestId, signal);
      sources = observed.sourceIds.map(id => requireRow('sources', id));
      completePopulation=observed.state==='ACCEPTED'&&sources.length>0;
    }
    completePopulation=completePopulation&&sources.every(source=>source.bodyComplete===true&&
      source.classification?.outcome==='accepted'&&!source.projectionError&&!source.error);
    const versions = sources.flatMap(source => source.versionIds)
      .map(id => requireRow('resourceVersions', id));
    const readbackResourceId = original.readback.resourceId ?? original.resourceId;
    const readbackResourceKind = original.readback.resourceKind ?? original.resourceKind;
    const matching = versions.filter(version =>
      (original.readback.match ? (()=>{
        let value=version.value;
        for(const key of original.readback.match.pointer.slice(1).split('/').map(x=>x.replaceAll('~1','/').replaceAll('~0','~'))){
          if(value===null||typeof value!=='object'||!Object.hasOwn(value,key))return false;value=value[key];
        }
        return canonical(value)===canonical(original.readback.match.value);
      })() : readbackResourceId!==null&&normalizedNativeId(version.resourceId)===normalizedNativeId(readbackResourceId)) &&
      version.kind === readbackResourceKind &&
      version.environment === original.environment &&
      version.connectionAlias === original.connectionAlias && version.sourceScope===original.connection.sourceScope);
    return localCommandTransition(requestId,'operation.reconciled', { operationId: original.id }, () => {
      const latest = requireRow('operations', original.id);
      return put('operations', {
        ...latest, updatedAt: now(),
        reconciliation: {
          operationId: observed.id, observedState: observed.state,
          sourceIds:sources.map(source=>source.id),versionIds:matching.map(row=>row.id),
          matched:completePopulation&&matching.length===1,ambiguous:matching.length>1,
          completePopulation,captureId:capture?.id??null,captureStatus:capture?.status??null,
          next:capture?.next??null,selectedOriginal:clone(original.readback),observedAt:now(),
        },
      });
    });
  }

  async function runCapture(args, commandId, signal) {
    const guard = await lease(workspaceDirectory, 'capture-' + hash(args.captureId));
    try {
      let capture = requireRow('captures', args.captureId);
      if (capture.status === 'COMPLETE') return capture;
      connection(capture.connectionAlias, capture.connection);
      if (['PAUSED', 'PARTIAL'].includes(capture.status)) {
        capture = transition('capture.resumed', { captureId: capture.id }, () =>
          put('captures', {
            ...capture, status: 'RUNNING', pendingOperationId: null,
            error: null, updatedAt: now(),
          }));
      }
      const maxPages = Number(args.maxPages ?? 100);
      need(Number.isSafeInteger(maxPages) && maxPages > 0 && maxPages <= 10000,
        'INVALID_PAGE_LIMIT');
      for (let index = 0; index < maxPages; index++) {
        signal?.throwIfAborted();
        capture = requireRow('captures', args.captureId);
        if (capture.status === 'PAUSED') return capture;
        const pageIndex = capture.pages.length;
        let pageId = capture.pendingOperationId;
        if (!pageId) {
          const attempt = (capture.pageAttempts ?? []).filter(row => row.index === pageIndex).length;
          pageId = capture.id + ':page:' + pageIndex + ':attempt:' + attempt;
          capture = transition('capture.page-selected', { captureId: capture.id, pageId }, () =>
            put('captures', {
              ...capture, pendingOperationId: pageId, status: 'RUNNING',
              pageAttempts: [...(capture.pageAttempts ?? []), {
                index: pageIndex, operationId: pageId, selectedAt: now(),
              }],
            }));
        }
        let operation = await prepareOperation({
          connectionAlias: capture.connectionAlias,
          action: capture.next.action, input: capture.next.input,
        }, pageId);
        need(!operation.request.mutation, 'CAPTURE_MUST_BE_READ_ONLY');
        operation = await dispatchOperation(pageId, pageId, signal);
        const source = operation.sourceIds.length ?
          requireRow('sources', operation.sourceIds.at(-1)) : null;
        if (operation.state !== 'ACCEPTED' || !source?.bodyComplete) {
          return transition('capture.interrupted', { captureId: capture.id }, () =>
            put('captures', {
              ...capture, status: 'PARTIAL', updatedAt: now(),
              pendingOperationId: operation.id,
              error: { code: 'ORIGINAL_PAGE_INCOMPLETE', state: operation.state },
            }));
        }
        const exchange = JSON.parse((await fileBytes(source.receiptFileId, { private: true })).toString());
        if (capture.pages.some(page => page.bodySha256 === source.bodySha256)) {
          return transition('capture.repeated-page', { captureId: capture.id }, () =>
            put('captures', {
              ...capture, status: 'PARTIAL', updatedAt: now(),
              rejectedSourceIds: [...(capture.rejectedSourceIds ?? []), source.id],
              error: { code: 'REPEATED_NATIVE_PAGE' },
            }));
        }
        const continuation = native.nextPageRequest({ request: operation.request, exchange });
        need(continuation && typeof continuation.done === 'boolean', 'INVALID_NATIVE_CONTINUATION');
        const next = continuation.done ? null : {
          action: continuation.action, input: continuation.input,
        };
        if (next) need(canonical(next) !== canonical(capture.next), 'UNCHANGED_NATIVE_CURSOR');
        capture = transition('capture.page', { captureId: capture.id, sourceId: source.id }, () =>
          put('captures', {
            ...capture, status: continuation.done ? 'COMPLETE' : 'RUNNING',
            pages: [...capture.pages, {
              index: pageIndex, sourceId: source.id,
              requestSha256: operation.requestSha256, bodySha256: source.bodySha256,
              requestInput:clone(operation.request.input),next:clone(next),
            }],
            next, pendingOperationId: null, error: null, updatedAt: now(),
          }));
        if (capture.status === 'COMPLETE') return capture;
      }
      return capture;
    } finally { await guard.release(); }
  }

  async function importSource(args, requestId) {
    const previous = current('sources', requestId);
    if (previous) return previous;
    const descriptor = file(args.fileId, { private: true });
    const body = await fileBytes(descriptor.id, { private: true });
    const selected = connection(args.connectionAlias);
    const prepared = await native.buildRequest(selected, args.action, exactInput(args));
    let parsed = null;
    let parseError = null;
    if (prepared.responseFormat === 'json') {
      try { parsed = parseSourceJSON(body); }
      catch (error) { parseError = publicError(error); }
    }
    const status = args.status ?? 200;
    need(Number.isInteger(status) && status >= 100 && status <= 599, 'INVALID_ORIGINAL_HTTP_STATUS');
    const complete = args.bodyComplete !== false;
    const outcome = !complete || parseError || status === 409 || status >= 500 ? 'uncertain' :
      status >= 200 && status < 300 ? 'accepted' : 'rejected';
    const exchange = {
      schema: 'paycashless.imported-provider-exchange.v1', request: prepared,
      startedAt: args.observedAt ?? now(), finishedAt: args.observedAt ?? now(),
      transport: { status: 'received', imported: true },
      response: {
        status, statusText: '', headers: clone(args.headers??{ 'content-type': descriptor.contentType }),
        bodyBase64: body.toString('base64'), bytes: body.length, sha256: hash(body),
        complete,
      },
      parsed, parseError,
      classification: { outcome, reason: 'Original imported HTTP status and body completeness; no provider dispatch.' },
    };
    return retainExchange(exchange, {
      sourceId: requestId, connectionAlias: args.connectionAlias,
      environment: prepared.environment, imported: true,
      originalFileId: descriptor.id,
    });
  }

  async function webhook({ connectionAlias, subscriptionId, body, headers = {} }) {
    const selected = connection(connectionAlias);
    const boundConnection=publicConnection(connectionAlias,selected);
    const boundScope=sourceScope(selected);
    const endpoint = selected.webhookEndpoints?.[subscriptionId];
    need(endpoint,'WEBHOOK_ENDPOINT_NOT_CONFIGURED');
    const endpointConfiguration={...endpoint,apiSecret:endpoint.apiSecret??selected.apiSecret};
    const endpointBinding={callbackUrl:endpoint.callbackUrl??null,urlConvention:endpoint.urlConvention??null,
      timestampUnit:endpoint.timestampUnit??null,maxAgeMs:endpoint.maxAgeMs??null,futureToleranceMs:endpoint.futureToleranceMs??null,
      secretBinding:hash(Buffer.from('paycashless-callback-secret\0'+String(endpointConfiguration.apiSecret??'')))};
    const raw = Buffer.from(body);
    const receivedAt = now();
    const bodyFile = await retainFile(raw, {
      filename: 'webhook-original.json', contentType: 'application/json', private: true,
    });
    let event = null;
    let error = null;
    try { event = await native.verifyWebhook({
      provider:selected.provider,rawBody:raw,headers,receivedAt,
      configuration:endpointConfiguration,
    }); }
    catch (problem) { error = publicError(problem); }
    const signatureFile = await retainFile(jsonBytes({ headers, receivedAt }), {
      filename: 'webhook-headers.json', contentType: 'application/json', private: true,
    });
    const verified = event?.verified === true;
    const receiptId = hash(Buffer.from(canonical([
      connectionAlias,subscriptionId,boundScope,boundConnection.environment,boundConnection,endpointBinding,
      verified ? 'verified' : 'rejected',
      bodyFile.sha256, verified ? (event.canonicalSha256 ?? event.rawSha256 ?? bodyFile.sha256) : signatureFile.sha256,
    ])));
    const previous = current('webhooks', receiptId);
    if (previous) {
      transition('webhook.redelivered', { webhookId: receiptId, verified }, () =>
        put('webhooks', {
          ...previous,
          receptions: [...(previous.receptions ?? []), {
            receivedAt: now(), signatureFileId: signatureFile.id,
          }],
        }));
      return { accepted: verified, id: receiptId, replayed: true };
    }
    const record = {
      id: receiptId, connectionAlias, provider:selected.provider, subscriptionId, bodyFileId: bodyFile.id,
      sourceScope:boundScope,environment:boundConnection.environment,connection:boundConnection,endpointBinding,
      signatureFileId: signatureFile.id, rawSha256: bodyFile.sha256,
      bytes: bodyFile.bytes, verified: event?.verified === true,
      eventType: event?.eventType ?? null, eventTypeAuthenticated:false,verifiedData:event?.verifiedData===true,
      authenticatedFields:event?.authenticatedFields??[],eventId:event?.eventId??null,
      transactionId:event?.transactionId??null, projectable:event?.projectable!==false,
      createdAt: now(), status: event?.verified ? 'RETAINED' : 'REJECTED', error,
      receptions: [{ receivedAt: now(), signatureFileId: signatureFile.id }],
    };
    if (event?.canonicalBase64) {
      const canonicalBody = Buffer.from(event.canonicalBase64, 'base64');
      need(hash(canonicalBody) === event.canonicalSha256, 'CANONICAL_WEBHOOK_HASH_MISMATCH');
      const canonicalFile = await retainFile(canonicalBody, {
        filename: 'webhook-canonical.json', contentType: 'application/json', private: true,
      });
      record.canonicalFileId = canonicalFile.id;
      record.canonicalSha256 = canonicalFile.sha256;
    }
    const verifiedEvent = event ? await retainFile(jsonBytes(event), {
      filename: 'verified-webhook.json', contentType: 'application/json', private: true,
    }) : null;
    record.eventFileId = verifiedEvent?.id ?? null;
    transition('webhook.retained', { webhookId: receiptId }, () => put('webhooks', record));
    return { accepted: record.verified, id: receiptId, replayed: false };
  }

  async function projectWebhook(args) {
    const row = requireRow('webhooks', args.webhookId);
    need(row.verified, 'WEBHOOK_NOT_VERIFIED');
    if (row.status === 'PROJECTED') return row;
    const event = JSON.parse((await fileBytes(row.eventFileId, { private: true })).toString());
    need(row.connection&&row.sourceScope&&row.environment,'ORIGINAL_WEBHOOK_BINDING_REQUIRED');
    const descriptor=clone(row.connection);
    need(descriptor.alias===row.connectionAlias&&descriptor.provider===row.provider&&
      descriptor.environment===row.environment&&descriptor.sourceScope===row.sourceScope,
      'ORIGINAL_WEBHOOK_BINDING_CHANGED');
    const publicFile = await retainFile(jsonBytes(publicValue(event)), {
      filename: 'verified-webhook-public.json', contentType: 'application/json',
    });
    const source = {
      id: 'webhook-' + row.id, kind: row.eventType, connectionAlias: row.connectionAlias,
      environment:descriptor.environment,createdAt:row.createdAt,
      sourceScope:row.sourceScope,provider:descriptor.provider,
      network:descriptor.network??null,networkPassphrase:descriptor.networkPassphrase??null,
      responseFileId: row.bodyFileId, publicFileId: publicFile.id,
      privateBody: true, bodySha256: row.rawSha256, bytes: row.bytes,
      status: null, bodyComplete: true, webhookId: row.id,
    };
    const rows = native.projectResource({
      event, provider:descriptor.provider, eventType: row.eventType, environment: source.environment,
      sourceReference:{sourceId:source.id,connectionAlias:row.connectionAlias,
        sourceScope:source.sourceScope,provider:descriptor.provider,
        organizationId:descriptor.organizationId??null,network:descriptor.network??null,
        networkPassphrase:descriptor.networkPassphrase??null,observedAt:row.createdAt},
    });
    return transition('webhook.projected', { webhookId: row.id }, () => {
      source.versionIds = applyProjection(source, rows);
      put('sources', source);
      return put('webhooks', { ...row, status: 'PROJECTED', sourceId: source.id });
    });
  }


  async function saveBook(args, requestId) {
    const previous=current('books',requestId);
    if(previous)return previous;
    const input=clone(args.definition);
    if(args.bookId){need(!input.id||input.id===args.bookId,'BOOK_ID_MISMATCH');input.id=args.bookId;}
    input.id??=requestId;
    const definition=normalizeBook(input);
    need(definition && typeof definition==='object' && typeof definition.then!=='function',
      'SYNCHRONOUS_BOOK_NORMALIZATION_REQUIRED');
    const sourceIds=[...new Set(args.sourceIds??[])];
    for(const id of sourceIds)requireRow('sources',id);
    for(const [provider,aliases] of Object.entries(definition.connectionAliases))
      for(const alias of aliases){
        const selected=connection(alias);
        need(selected.provider===provider && selected.environment===definition.environment,
          'BOOK_CONNECTION_BINDING_MISMATCH',{alias,provider});
      }
    return transition('book.saved',{bookId:definition.id},()=>{
      const versions=listAll('books').filter(row=>row.bookId===definition.id);
      return put('books',{id:requestId,bookId:definition.id,environment:definition.environment,version:versions.length+1,
        sha256:hash(jsonBytes(definition)),definition,sourceIds,createdAt:now()});
    });
  }

  function saveLink(args,requestId){
    const prior=current('links',requestId);
    if(prior)return prior;
    // Normalize against the actual current decision tips under the same SQLite
    // write transaction that records the successor; no asynchronous gap.
    return transition('link.saved',{linkId:requestId,bookVersionId:args.bookVersionId},()=>{
      const book=requireRow('books',args.bookVersionId);
      const versions=listAll('resourceVersions'),sources=listAll('sources');
      const decisions=listAll('links').filter(row=>row.bookVersionId===book.id);
      const decision=normalizeLinkDecision(clone(args.decision),{
        book:book.definition,versions,sources,decisions,
      });
      need(decision && typeof decision==='object' && typeof decision.then!=='function',
        'SYNCHRONOUS_LINK_NORMALIZATION_REQUIRED');
      if(decision.supersedesId){
        const previous=requireRow('links',decision.supersedesId);
        need(previous.bookVersionId===book.id,'LINK_BOOK_VERSION_MISMATCH');
        need(!decisions.some(row=>row.supersedesId===previous.id),'LINK_ALREADY_SUPERSEDED');
      }
      return put('links',{...decision,id:requestId,bookId:book.bookId,bookVersionId:book.id,
        environment:book.definition.environment,createdAt:now()});
    });
  }

  async function startCapture(args, requestId) {
    const previous = current('captures',requestId);
    if (previous) return previous;
    const selected = connection(args.connectionAlias,args.connection);
    const input=exactInput(args);
    const request = await native.buildRequest(selected,args.action,input);
    need(!request.mutation,'CAPTURE_MUST_BE_READ_ONLY');
    return transition('capture.started',{captureId:requestId},() => put('captures',{
      id:requestId,connectionAlias:args.connectionAlias,action:args.action,
      input:clone(request.input),inputJSON:args.inputJSON??null,connection:publicConnection(args.connectionAlias,selected),
      bookId:args.bookId ?? null,
      status:'READY',pages:[],next:{action:args.action,input:clone(request.input)},
      createdAt:now(),updatedAt:now(),
    }));
  }


  function configureStream(args,requestId){
    const old=current('streams',requestId);if(old)return old;
    need(typeof args.accountId==='string'&&/^(?:G[A-Z2-7]{55}|M[A-Z2-7]{68})$/.test(args.accountId),'HORIZON_ACCOUNT_REQUIRED');
    need(typeof args.cursor==='string'&&/^(?:0|[1-9][0-9]*)$/.test(args.cursor),'EXPLICIT_STREAM_CURSOR_REQUIRED');
    const selected=connection(args.connectionAlias),descriptor=publicConnection(args.connectionAlias,selected);
    need(descriptor.provider==='horizon','STREAM_HORIZON_CONNECTION_REQUIRED');
    return transition('stream.configured',{streamId:requestId},()=>{
      if(args.bookVersionId){
        const book=requireRow('books',args.bookVersionId);
        need(book.definition.environment===descriptor.environment&&book.definition.connectionAliases.horizon.includes(args.connectionAlias),'STREAM_BOOK_CONNECTION_MISMATCH');
      }
      return put('streams',{id:requestId,name:args.name??'Horizon settlement events',
        connectionAlias:args.connectionAlias,connection:descriptor,environment:descriptor.environment,
        accountId:args.accountId,bookVersionId:args.bookVersionId??null,startCursor:args.cursor,cursor:args.cursor,lastEventId:null,
        status:'ACTIVE',runtimeState:'STOPPED',eventCount:0,sourceIds:[],createdAt:now(),updatedAt:now()});
    });
  }
  function pauseStream(args,requestId){
    need(typeof args.paused==='boolean','STREAM_PAUSED_BOOLEAN_REQUIRED');
    return localCommandTransition(requestId,'stream.pause-selected',{streamId:args.streamId,paused:args.paused},()=>{
      const row=requireRow('streams',args.streamId);connection(row.connectionAlias,row.connection);
      return put('streams',{...row,status:args.paused?'PAUSED':'ACTIVE',updatedAt:now()});
    });
  }
  function statusStream(args,requestId){
    need(['CONNECTING','CONNECTED','RETRYING','STOPPED','ERROR'].includes(args.state),'STREAM_RUNTIME_STATE_INVALID');
    need(typeof args.message==='string'&&args.message.length<=4000,'STREAM_STATUS_MESSAGE_REQUIRED');
    need(args.httpStatus===undefined||Number.isInteger(args.httpStatus)&&args.httpStatus>=100&&args.httpStatus<=599,'STREAM_HTTP_STATUS_INVALID');
    need(args.retryAt===undefined||args.retryAt===null||typeof args.retryAt==='string'&&Number.isFinite(Date.parse(args.retryAt)),'STREAM_RETRY_TIME_INVALID');
    return localCommandTransition(requestId,'stream.observed',{streamId:args.streamId,state:args.state},()=>{
      const row=requireRow('streams',args.streamId);connection(row.connectionAlias,row.connection);
      return put('streams',{...row,runtimeState:args.state,retryAt:args.state==='CONNECTED'?null:args.retryAt??null,lastObservation:{...clone(args),observedAt:now()},updatedAt:now()});
    });
  }
  async function commitStream(args,requestId){
    const accepted=getMeta('local-command-result:'+requestId);if(accepted)return accepted.value;
    const original=requireRow('streams',args.streamId),selected=connection(original.connectionAlias,original.connection);
    need(typeof args.expectedCursor==='string'&&/^(?:0|[1-9][0-9]*)$/.test(args.expectedCursor),'EXPLICIT_STREAM_CURSOR_REQUIRED');
    need(typeof args.requestCursor==='string'&&/^(?:0|[1-9][0-9]*)$/.test(args.requestCursor)&&BigInt(args.requestCursor)<=BigInt(args.expectedCursor),'STREAM_CONNECTION_CURSOR_INVALID');
    need(typeof args.dataJSON==='string'&&typeof args.rawBase64==='string','COMPLETE_STREAM_EVENT_REQUIRED');
    const raw=Buffer.from(args.rawBase64,'base64');
    need(raw.toString('base64')===args.rawBase64&&raw.length<=16*1024*1024,'STREAM_RAW_FRAME_INVALID');
    const decoded=parseSSEFrame(raw);
    need(decoded.data===args.dataJSON&&decoded.id===args.eventId,'STREAM_FRAME_DATA_ID_MISMATCH');
    need(decoded.event===null||decoded.event===''||decoded.event==='message','HORIZON_PAYMENT_EVENT_REQUIRED');
    const data=Buffer.from(args.dataJSON),parsed=parseSourceJSON(data,{maxBytes:16*1024*1024}),value=parsed.value;
    need(value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.paging_token==='string'&&
      /^(?:0|[1-9][0-9]*)$/.test(value.paging_token),'STREAM_PAGING_TOKEN_REQUIRED');
    const cursor=value.paging_token;
    need(args.eventId===null||args.eventId===''||args.eventId===cursor,'STREAM_EVENT_CURSOR_MISMATCH');
    need(BigInt(cursor)>BigInt(args.expectedCursor),'STREAM_CURSOR_MUST_ADVANCE');
    need(requestId==='stream-event:'+hash(Buffer.from(canonical([args.streamId,cursor,args.dataJSON]))),'STREAM_STABLE_REQUEST_ID_REQUIRED');
    need(typeof args.observedAt==='string'&&Number.isFinite(Date.parse(args.observedAt)),'STREAM_OBSERVATION_TIME_REQUIRED');
    need(args.responseHeaders&&typeof args.responseHeaders==='object'&&!Array.isArray(args.responseHeaders)&&
      Object.values(args.responseHeaders).every(v=>typeof v==='string'),'STREAM_HEADERS_REQUIRED');
    const header=Object.entries(args.responseHeaders).filter(([k])=>k.toLowerCase()==='content-type');
    need(header.length===1&&/^text\/event-stream(?:;|$)/i.test(header[0][1]),'STREAM_RESPONSE_TYPE_REQUIRED');
    const request=await native.buildRequest(selected,'horizon.payments.account',{params:{accountId:original.accountId},
      query:{cursor:args.requestCursor,order:'asc',join:'transactions',include_failed:true,limit:100}});
    const expectedURL=new URL(request.url),observedURL=new URL(args.requestURL);
    need(observedURL.origin===expectedURL.origin&&observedURL.pathname===expectedURL.pathname&&
      !observedURL.username&&!observedURL.password&&!observedURL.hash&&
      canonical([...observedURL.searchParams].sort())===canonical([...expectedURL.searchParams].sort()),'STREAM_REQUEST_SCOPE_CHANGED');
    const sourceId='stream-source:'+hash(Buffer.from(canonical([args.streamId,cursor]))),previous=current('sources',sourceId);
    if(previous){
      need(previous.bodySha256===hash(data)&&previous.streamFrameSha256===hash(raw)&&
        canonical(previous.streamCommit)===canonical(args),'STREAM_EVENT_ORIGINAL_CHANGED');
      return {stream:requireRow('streams',args.streamId),cursor:requireRow('streams',args.streamId).cursor,
        sourceId,versionIds:previous.versionIds,replayed:true};
    }
    const exchange={schema:'paycashless.original-provider-exchange.v1',request,startedAt:args.observedAt,finishedAt:args.observedAt,
      transport:{status:'received',dispatched:true,eventStream:true,streamId:args.streamId,frameSha256:hash(raw)},
      response:{status:200,statusText:'OK',headers:clone(args.responseHeaders),bodyBase64:data.toString('base64'),bytes:data.length,sha256:hash(data),complete:true},
      parsed,parseError:null,classification:{outcome:'accepted',reason:'One complete original SSE event; this is not terminal page coverage.'}};
    const context={sourceId,connectionAlias:original.connectionAlias,sourceScope:original.connection.sourceScope,
      network:original.connection.network,networkPassphrase:original.connection.networkPassphrase,observedAt:args.observedAt};
    const rows=native.projectResource({exchange,environment:original.environment,sourceReference:context});
    need(rows.some(row=>row.kind==='horizon-operation'),'STREAM_OPERATION_PROJECTION_REQUIRED');
    const frameFile=await retainFile(raw,{filename:'original-settlement-frame.sse',contentType:'text/event-stream',private:true});
    const responseFile=await retainFile(data,{filename:'original-settlement-event.json',contentType:'application/json',private:true});
    const requestFile=await retainFile(jsonBytes(request),{filename:'settlement-stream-request.json',contentType:'application/json',private:true});
    const receiptFile=await retainFile(jsonBytes(exchange),{filename:'settlement-stream-exchange.json',contentType:'application/json',private:true});
    const publicFile=await retainFile(jsonBytes(publicValue(exchange)),{filename:'settlement-stream-observation.json',contentType:'application/json'});
    return localCommandTransition(requestId,'stream.event-retained',{streamId:args.streamId,sourceId,cursor},()=>{
      const row=requireRow('streams',args.streamId);
      need(row.status==='ACTIVE','STREAM_PAUSED');
      need(row.cursor===args.expectedCursor&&canonical(row.connection)===canonical(original.connection),'STREAM_CHECKPOINT_CHANGED');
      const source={id:sourceId,kind:'horizon.payments.account',action:'horizon.payments.account',requestInput:request.input,
        createdAt:args.observedAt,connectionAlias:row.connectionAlias,environment:row.environment,provider:'horizon',
        sourceScope:row.connection.sourceScope,network:row.connection.network,networkPassphrase:row.connection.networkPassphrase,
        requestFileId:requestFile.id,responseFileId:responseFile.id,receiptFileId:receiptFile.id,publicFileId:publicFile.id,
        streamFrameFileId:frameFile.id,streamFrameSha256:frameFile.sha256,streamId:row.id,streamCommit:clone(args),pagingToken:cursor,
        privateBody:true,bodySha256:responseFile.sha256,bytes:responseFile.bytes,status:200,bodyComplete:true,classification:exchange.classification,
        versionIds:[]};
      source.versionIds=applyProjection(source,rows);put('sources',source);
      const stream=put('streams',{...row,cursor,lastEventId:args.eventId,eventCount:row.eventCount+1,
        sourceIds:[...row.sourceIds,sourceId],runtimeState:'CONNECTED',updatedAt:args.observedAt});
      return {stream,cursor,sourceId,versionIds:source.versionIds,replayed:false};
    });
  }

  async function createReconciliation(args, requestId) {
    const previous=current('reconciliations',requestId);
    if(previous)return previous;
    // Selection and projection are synchronous inside one original database
    // transaction, so coverage and accepted link tips describe one real head.
    return transition('reconciliation.created',{reconciliationId:requestId},()=>{
      const book=requireRow('books',args.bookVersionId),definition=book.definition;
      const aliases=new Set(Object.values(definition.connectionAliases).flat());
      const selectedSourceIds=args.sourceIds?new Set(args.sourceIds):null;
      if(selectedSourceIds)for(const id of selectedSourceIds)requireRow('sources',id);
      const inScope=row=>row.environment===definition.environment&&aliases.has(row.connectionAlias);
      let history=listAll('resourceVersions').filter(row=>inScope(row)&&
        (!selectedSourceIds||selectedSourceIds.has(row.sourceId)));
      let versions,selectionConflicts=[];
      if(args.versionIds){
        need(new Set(args.versionIds).size===args.versionIds.length,'DUPLICATE_SELECTED_VERSION');
        versions=args.versionIds.map(id=>requireRow('resourceVersions',id));
        need(versions.every(inScope),'VERSION_OUTSIDE_BOOK');
        if(selectedSourceIds)need(versions.every(row=>selectedSourceIds.has(row.sourceId)),
          'VERSION_OUTSIDE_SOURCE_SELECTION');
      }else if(selectedSourceIds){
        const selected=new Map();
        for(const row of history){
          const key=row.localResourceId,previous=selected.get(key);
          if(!previous){selected.set(key,row);continue;}
          const decision=native.reconcileVersions(
            {...previous,id:normalizedNativeId(previous.resourceId)},
            {...row,id:normalizedNativeId(row.resourceId)});
          if(decision.decision==='replace'){
            selected.set(key,row);
            selectionConflicts=selectionConflicts.filter(conflict=>conflict.resourceId!==key);
          }else if(decision.decision==='conflict')selectionConflicts.push({
            resourceId:key,versionIds:[previous.id,row.id],reason:decision.reason});
        }
        versions=[...selected.values()];
      }else{
        const resources=listAll('resources').filter(inScope);
        versions=resources.map(row=>requireRow('resourceVersions',row.currentVersionId));
        selectionConflicts=resources.filter(row=>row.conflict).map(row=>({
          resourceId:row.id,versionIds:history.filter(v=>v.localResourceId===row.id).map(v=>v.id),
          reason:'Unresolved original provider observations.',
        }));
      }
      const decisions=listAll('links').filter(row=>row.bookVersionId===book.id);
      const evidenceVersions=[...new Set(decisions.flatMap(d=>[d.subjectVersionId,d.settlementVersionId,
        ...(d.corroborationVersionIds??[])]).filter(Boolean))].map(id=>requireRow('resourceVersions',id));
      history=[...new Map([...history,...evidenceVersions].map(row=>[row.id,row])).values()];
      const sourceIds=[...new Set([...book.sourceIds,...(selectedSourceIds??[]),
        ...versions.map(v=>v.sourceId),...history.map(v=>v.sourceId),...evidenceVersions.map(v=>v.sourceId),
        ...decisions.flatMap(d=>[...(d.sourceIds??[]),...(d.conversion?.sourceIds??[])])])];
      const sources=sourceIds.map(id=>requireRow('sources',id));
      for(const source of sources)if(source.connectionAlias)
        need(aliases.has(source.connectionAlias)&&source.environment===definition.environment,
          'SOURCE_OUTSIDE_BOOK');
      const captures=args.captureIds?args.captureIds.map(id=>requireRow('captures',id)):
        listAll('captures').filter(row=>row.pages.some(page=>sourceIds.includes(page.sourceId)));
      for(const capture of captures)need(aliases.has(capture.connectionAlias)&&
        capture.connection.environment===definition.environment,'CAPTURE_OUTSIDE_BOOK');
      const coverage={period:definition.period,bookVersionId:book.id,sourceIds,
        versionIds:versions.map(v=>v.id),currentVersionIds:versions.map(v=>v.id),
        selectionConflicts,historyVersionIds:history.map(v=>v.id),
        captures:captures.map(row=>({id:row.id,status:row.status,connectionAlias:row.connectionAlias,
          action:row.action,input:row.input,connection:row.connection,createdAt:row.createdAt,updatedAt:row.updatedAt,
          pages:row.pages.length,pageReceipts:row.pages,sourceIds:row.pages.map(page=>page.sourceId),
          next:row.next,rejectedSourceIds:row.rejectedSourceIds??[],error:row.error??null})),
        streams:listAll('streams').filter(row=>aliases.has(row.connectionAlias)&&row.environment===definition.environment).map(row=>({
          id:row.id,connectionAlias:row.connectionAlias,connection:row.connection,accountId:row.accountId,startCursor:row.startCursor,
          cursor:row.cursor,status:row.status,runtimeState:row.runtimeState,eventCount:row.eventCount,sourceIds:row.sourceIds,
          complete:false,reason:'An open-ended SSE checkpoint is not complete period coverage.'})),
        linkIds:decisions.map(row=>row.id)};
      const data=reconcilePayments({book:definition,versions,history,sources,decisions,coverage});
      need(data && typeof data==='object' && typeof data.then!=='function',
        'SYNCHRONOUS_RECONCILIATION_REQUIRED');
      return put('reconciliations',{id:requestId,name:args.name??'Payment reconciliation',createdAt:now(),
        bookId:book.bookId,bookVersionId:book.id,environment:definition.environment,
        sourceIds,versionIds:versions.map(v=>v.id),
        linkIds:decisions.map(row=>row.id),data});
    });
  }

  async function createReport(args, requestId) {
    const previous=current('reports',requestId);
    if(previous)return previous;
    const edition=requireRow('reconciliations',args.reconciliationId);
    const generated=await paycashlessReport(publicValue(edition.data)),files=[];
    for(const [extension,contentType]of [['json','application/json'],['csv','text/csv; charset=utf-8'],
      ['html','text/html; charset=utf-8']]){
      need(typeof generated[extension]==='string','INVALID_PAYCASHLESS_REPORT');
      const descriptor=await retainFile(Buffer.from(generated[extension],'utf8'),{
        filename:'payment-report.'+extension,contentType});
      files.push({...descriptor,url:'/api/file/'+descriptor.id});
    }
    const report={id:requestId,reconciliationId:edition.id,name:args.name??edition.name,createdAt:now(),
      bookId:edition.bookId,bookVersionId:edition.bookVersionId,environment:edition.environment,files,
      scope:{sourceIds:edition.sourceIds,versionIds:edition.versionIds,linkIds:edition.linkIds,
        bookVersionId:edition.bookVersionId,period:edition.data.coverage?.period??edition.data.period??null}};
    return transition('report.created',{reportId:requestId},()=>put('reports',report));
  }

  function localCommandTransition(requestId, kind, detail, work) {
    const key = 'local-command-result:' + requestId;
    const retained = getMeta(key);
    if (retained) return retained.value;
    return transition(kind, { ...detail, requestId }, () => {
      const value = work();
      setMeta(key, { value, completedAt: now() });
      return value;
    });
  }

  async function executeCommand(method, args, requestId, signal) {
    switch (method) {
      case 'file.retain': return {file:file(args.fileId,{private:true})};
      case 'profile.update':
        return localCommandTransition(requestId, method, {}, () => {
          need(typeof args.name === 'string' && args.name.trim(), 'NAME_REQUIRED');
          setMeta('profile', { ...getMeta('profile'), name: args.name.trim() });
          return describe().workspace;
        });
      case 'delivery.configure':
        return localCommandTransition(requestId, method, {}, () => {
          need(typeof args.enabled === 'boolean', 'EXPLICIT_DISPATCH_SELECTION_REQUIRED');
          setMeta('dispatchEnabled', args.enabled);
          return { enabled: args.enabled };
        });
      case 'book.save': return saveBook(args,requestId);
      case 'link.save': return saveLink(args,requestId);
      case 'operation.prepare': return prepareOperation(args, requestId);
      case 'operation.dispatch': return dispatchOperation(args.operationId, requestId, signal);
      case 'operation.reconcile': return reconcileOperation(args, requestId, signal);
      case 'operation.retry-original': return dispatchOperation(args.operationId,requestId,signal,{retryOriginal:true});
      case 'operation.cancel':
        return localCommandTransition(requestId, method, { operationId: args.operationId }, () => {
          const row = requireRow('operations', args.operationId);
          need(row.state === 'PREPARED', 'DISPATCHED_OPERATION_CANNOT_BE_CANCELED_LOCALLY');
          need(args.reason?.trim(), 'REASON_REQUIRED');
          return put('operations', { ...row, state: 'CANCELED', reason: args.reason, updatedAt: now() });
        });
      case 'capture.start': return startCapture(args,requestId);
      case 'capture.run': return runCapture(args, requestId, signal);
      case 'capture.pause':
        return localCommandTransition(requestId, method, { captureId: args.captureId }, () => {
          const row = requireRow('captures', args.captureId);
          return put('captures', {
            ...row, status: row.status === 'COMPLETE' ? 'COMPLETE' : 'PAUSED', updatedAt: now(),
          });
        });
      case 'source.import': return importSource(args, requestId);
      case 'source.project': {
        const row = requireRow('sources', args.sourceId);
        need(row.receiptFileId, 'ORIGINAL_EXCHANGE_REQUIRED');
        const exchange = JSON.parse((await fileBytes(row.receiptFileId, { private: true })).toString());
        return retainExchange(exchange, {
          sourceId: requestId, connectionAlias: row.connectionAlias,
          environment: row.environment, reprojectedSourceId: row.id,
        });
      }
      case 'stream.configure': return configureStream(args,requestId);
      case 'stream.pause': return pauseStream(args,requestId);
      case 'stream.status': return statusStream(args,requestId);
      case 'stream.commit': return commitStream(args,requestId);
      case 'webhook.reconcile': return projectWebhook(args);
      case 'reconciliation.create': return createReconciliation(args, requestId);
      case 'report.create': return createReport(args, requestId);
      default: {
        const receiving = await import('./receiving.mjs');
        if (method === 'workspace.export') return receiving.exportPaycashlessWorkspace({
          workspace: api, ...args, requestId, sourceDirectory, runtimeDirectory, expectedManifestSha256,
        });
        if (method === 'report.export') return receiving.exportPaycashlessReport({
          workspace: api, ...args, requestId,
        });
        if (method === 'package.inspect') return receiving.inspectPaycashlessDelivery(args);
        if (method === 'package.receive') return receiving.receivePaycashlessDelivery({
          ...args, requestId, signal,
        });
        throw new PaycashlessError('UNKNOWN_METHOD');
      }
    }
  }

  async function command({ requestId, expectedRevision, method, args = {}, signal }) {
    need(typeof requestId === 'string' && requestId.length > 0 && requestId.length < 200,
      'REQUEST_ID_REQUIRED');
    need(PAYCASHLESS_METHODS.some(entry => entry.name === method), 'UNKNOWN_METHOD');
    const identity = requestIdentity(method, args);
    const guard = await lease(workspaceDirectory, 'request-' + hash(requestId));
    try {
      let row = db.prepare('SELECT * FROM requests WHERE id=?').get(requestId);
      if (row) {
        need(row.intent_sha256 === identity, 'REQUEST_ID_CONFLICT');
        if (row.status === 'COMPLETE') return localResult(json(row.result));
        if (row.status === 'FAILED') {
          const previous = json(row.error);
          throw new PaycashlessError(previous.code, previous.message, previous.details);
        }
      } else {
        db.exec('BEGIN IMMEDIATE');
        try {
          if (expectedRevision !== undefined) need(expectedRevision === getMeta('revision'),
            'REVISION_CONFLICT', { actualRevision: getMeta('revision') });
          db.prepare('INSERT INTO requests VALUES(?,?,?,?,?,?,?,?,?,?)').run(
            requestId, identity, method, JSON.stringify(args), expectedRevision ?? null,
            'RUNNING', null, null, now(), now());
          const revision = getMeta('revision') + 1;
          const accepted = {
            revision, previous: getMeta('head'), kind: 'request.accepted',
            detail: { requestId, method, intentSha256: identity },
            createdAt: now(), result: null,
          };
          const acceptedHash = hash(Buffer.from(canonical(accepted)));
          db.prepare('INSERT INTO journal VALUES(?,?,?,?)').run(
            revision, accepted.previous, acceptedHash, JSON.stringify(accepted));
          setMeta('revision', revision);
          setMeta('head', acceptedHash);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      }
      try {
        const value = await executeCommand(method, args, requestId, signal);
        const result = {
          requestId, workspaceId: getMeta('identity').id,
          revision: getMeta('revision'), result: publicValue(value),
        };
        db.prepare('UPDATE requests SET status=?,result=?,updated_at=? WHERE id=?')
          .run('COMPLETE', JSON.stringify(result), now(), requestId);
        return result;
      } catch (error) {
        const failure = publicError(error);
        // Explicit preconditions remain the original failed request; no provider resend.
        db.prepare('UPDATE requests SET status=?,error=?,updated_at=? WHERE id=?')
          .run('FAILED', JSON.stringify(failure), now(), requestId);
        throw error;
      }
    } finally { await guard.release(); }
  }

  async function snapshot(destination) {
    need(path.isAbsolute(destination), 'ABSOLUTE_FILE_REQUIRED');
    need(!await fs.lstat(destination).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    }), 'SNAPSHOT_DESTINATION_EXISTS');
    await directory(path.dirname(destination));
    // SQLite performs a consistent committed snapshot, including WAL contents.
    // Referenced objects are immutable, so later workspace writes cannot change this selection.
    db.prepare('VACUUM INTO ?').run(destination);
    await fs.chmod(destination, 0o600);
    const handle = await fs.open(destination, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
    const copy = new DatabaseSync(destination, { readOnly: true });
    try {
      need(copy.prepare('PRAGMA integrity_check').get().integrity_check === 'ok',
        'SNAPSHOT_INTEGRITY_FAILED');
      const meta = key => json(copy.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value);
      return {
        workspaceId: meta('identity').id, revision: meta('revision'), head: meta('head'),
        files: copy.prepare('SELECT document FROM files ORDER BY id').all().map(rowValue),
        descriptor: await fileDescriptor(destination, 'workspace/workspace.sqlite'),
      };
    } finally { copy.close(); }
  }

  function registerExport(value) {
    const previous = current('exports', value.id);
    if (previous) {
      need(canonical(previous) === canonical(value), 'EXPORT_ID_CONFLICT');
      return previous;
    }
    return transition('export.completed', { exportId: value.id }, () => put('exports', value));
  }

  function prepareReceived(origin) {
    if (getMeta('receivedFrom')?.manifestSha256 === origin.manifestSha256)
      return describe().workspace;
    return transition('workspace.received', origin, () => {
      setMeta('dispatchEnabled', false);
      setMeta('receivedFrom', { ...origin, workspaceId: getMeta('identity').id });
      setMeta('identity', { schema: WORKSPACE_SCHEMA, id: randomUUID(), createdAt: now() });
      for (const row of listAll('operations')) {
        if (row.state === 'DISPATCHING')
          put('operations', { ...row, state: 'UNCERTAIN', receivedWhileDispatching: true });
      }
      for (const row of listAll('attempts')) {
        if (row.status === 'DISPATCHING')
          put('attempts', { ...row, status: 'UNCERTAIN', receivedWhileDispatching: true });
      }
      for (const row of listAll('streams')) put('streams',{...row,status:'PAUSED',runtimeState:'STOPPED',receivedFromStatus:row.status});
      for (const row of listAll('captures')) {
        if (!['COMPLETE', 'CANCELED'].includes(row.status))
          put('captures', { ...row, status: 'PAUSED', receivedFromStatus: row.status });
      }
      return describe().workspace;
    });
  }

  const api = {
    directory: workspaceDirectory, describe, list, item, command,
    retainFile, file, fileBytes, webhook, snapshot, registerExport,
    privateItem: requireRow, privateList: listAll, prepareReceived,
    sourceDirectory, runtimeDirectory, expectedManifestSha256,
    async close() { db.close(); },
  };
  return api;
  } catch(error) {
    try { db.close(); } catch(closeError) {
      throw new AggregateError([error,closeError], 'Workspace construction and database close failed.');
    }
    throw error;
  }
}
