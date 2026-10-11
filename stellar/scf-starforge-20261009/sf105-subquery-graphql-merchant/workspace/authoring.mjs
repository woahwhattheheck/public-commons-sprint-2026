// MIT. Connected authoring over the original GraphQL compiler and SF30 transport.
import { randomUUID } from 'node:crypto';
import { open, readFile, lstat, link, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Kind, parse, parseType, parseValue, print, getNamedType, getNullableType,
  isObjectType, isCompositeType, isNonNullType, astFromValue } from 'graphql';
import { compileSchemaSource, inspectSchema, captureSchemaSource, validateApprovedQueries } from '../onboarding/schema.mjs';
import { compileSubQueryMerchant, bindSubQueryVariables, createSubQueryMerchantHandlers } from '../adapter.mjs';
import { digest, draftInput, inputDigest, plain, projectName } from './store.mjs';

const json = value => JSON.stringify(value, null, 2) + '\n';
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const PREVIEW = 'stellar-forge.graphql-workspace-preview.v1';
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
function object(text, label) {
  let value;
  try { value = JSON.parse(text); } catch { fail(label + ' must be a JSON object.'); }
  if (!plain(value)) fail(label + ' must be a JSON object.');
  return value;
}
function ident(value, label) {
  if (typeof value !== 'string' || !NAME.test(value) || ['__proto__', 'constructor', 'prototype'].includes(value))
    fail('Use a valid ' + label + '.');
  return value;
}
function shape(value, keys, label) {
  if (!plain(value) || Object.keys(value).some(key => !keys.includes(key))) fail('Invalid ' + label + '.');
}
function sources(input) {
  const draft = draftInput(input);
  return { draft, compiled: compileSchemaSource(draft.schemaText), queries: object(draft.queriesText, 'Approved queries') };
}
const defaultLiteral = field => {
  if (field.defaultValue === undefined) return null;
  const value = astFromValue(field.defaultValue, field.type);
  return value ? print(value) : null;
};
const buyerType = type => ({ Int: 'integer', Boolean: 'boolean', String: 'string', ID: 'string' })[String(getNullableType(type))] ?? null;

/** The actual source inventory, including nested fields and fixed input defaults. */
export function authoringCatalog(schemaText) {
  const compiled = compileSchemaSource(schemaText), inspection = inspectSchema(compiled);
  const describeArgument = arg => ({ name: arg.name, type: String(arg.type), description: arg.description ?? '',
    required: isNonNullType(arg.type) && arg.defaultValue === undefined,
    defaultLiteral: defaultLiteral(arg), buyerType: buyerType(arg.type) });
  const describeField = field => ({ name: field.name, type: String(field.type), namedType: getNamedType(field.type).name,
    composite: isCompositeType(getNamedType(field.type)), description: field.description ?? '',
    defaultLiteral: defaultLiteral(field),
    deprecated: field.deprecationReason ?? null, arguments: (field.args ?? []).map(describeArgument) });
  const types = Object.create(null);
  for (const type of Object.values(compiled.schema.getTypeMap()).filter(type => !type.name.startsWith('__'))) {
    types[type.name] = { name: type.name, kind: type.constructor.name, description: type.description ?? '',
      composite: isCompositeType(type),
      fields: typeof type.getFields === 'function' ? Object.values(type.getFields()).map(describeField) : [],
      values: typeof type.getValues === 'function' ? type.getValues().map(value => ({ name: value.name,
        description: value.description ?? '', deprecated: value.deprecationReason ?? null })) : [] };
  }
  return { sourceSha256: compiled.sourceSha256, schemaSha256: compiled.schemaSha256, inspection, types,
    roots: Object.values(compiled.schema.getQueryType().getFields()).map(field => ({ ...describeField(field),
      supported: isObjectType(getNullableType(field.type)) })) };
}

/** One deliberate schema request. Credential values remain in the original handler. */
export async function captureAuthoringSchema({ endpoint, allowLoopback = false, signal } = {}) {
  if (typeof allowLoopback !== 'boolean') fail('Choose whether this is a local development backend.');
  const captured = await captureSchemaSource(endpoint, { allowLoopback, env: process.env, signal });
  const schemaText = json(captured.snapshot);
  return { schemaText, catalog: authoringCatalog(schemaText), source: captured.snapshot.source,
    capturedAt: captured.snapshot.capturedAt };
}

/** Open the existing canonical query in the field editor without rewriting it. */
export function describeAuthoredOperation({ input, operation } = {}) {
  const { draft, queries } = sources(input), catalog = authoringCatalog(draft.schemaText);
  const selected = (queries.operations ?? []).find(item => item.name === operation);
  if (!selected) fail('Choose an existing operation.');
  let model = null, note = '';
  try {
    const document = parse(selected.query, { maxTokens: 4096 });
    if (document.definitions.length !== 1 || document.definitions[0].operation !== 'query') throw new Error('complex');
    const operationNode = document.definitions[0];
    if (operationNode.directives?.length || operationNode.selectionSet.selections.length !== 1) throw new Error('complex');
    const field = node => {
      if (node.kind !== Kind.FIELD || node.directives?.length) throw new Error('complex');
      return { field: node.name.value, alias: node.alias?.value ?? '',
        arguments: Object.fromEntries((node.arguments ?? []).map(arg => [arg.name.value, print(arg.value)])),
        selections: (node.selectionSet?.selections ?? []).map(field) };
    };
    const variables = Object.create(null);
    let samples = {};
    try { samples = object(draft.planText, 'Merchant plan').routes?.find(route => route.operation === selected.name)?.variables ?? {}; }
    catch { /* An unfinished merchant plan must not prevent query authoring. */ }
    for (const variable of operationNode.variableDefinitions ?? []) {
      if (variable.defaultValue) throw new Error('complex');
      const name = variable.variable.name.value;
      variables[name] = { graphqlType: print(variable.type), native: selected.variables?.[name] ?? {},
        ...(Object.hasOwn(samples, name) ? { sample: samples[name] } : {}) };
    }
    model = { name: selected.name, handler: selected.handler, admission: selected.admission,
      maxNodes: selected.maxNodes ?? 100, root: field(operationNode.selectionSet.selections[0]), variables };
  } catch {
    note = 'The field editor starts a new selection for this operation. Its existing raw query remains unchanged until you apply the selection; fragments and directives remain available in the original query editor.';
    model = { name: selected.name, handler: selected.handler, admission: selected.admission,
      maxNodes: selected.maxNodes ?? 100, root: { field: '', alias: '', arguments: {}, selections: [] }, variables: {} };
  }
  return { catalog, model, note, originalQuery: selected.query };
}

/** Build syntax only; the existing full schema/native validator owns semantics. */
export function compileAuthoredOperation({ input, operation, model } = {}) {
  const { draft, compiled, queries } = sources(input);
  shape(model, ['name', 'handler', 'admission', 'maxNodes', 'root', 'variables'], 'operation editor');
  const name = ident(model.name, 'operation name'), handler = ident(model.handler, 'handler name'),
    admission = ident(model.admission, 'admission name');
  const index = (queries.operations ?? []).findIndex(item => item.name === operation);
  if (index < 0) fail('Choose the original operation to update.');
  for (const other of queries.operations.filter((_, i) => i !== index))
    if ([other.name, other.handler, other.admission].some(value => [name, handler, admission].includes(value)))
      fail('Operation and handler names must stay unique across this project.');
  let count = 0;
  const field = (value, parent, depth = 0) => {
    shape(value, ['field', 'alias', 'arguments', 'selections'], 'field selection');
    if (++count > 128 || depth > 16) fail('Choose at most 128 fields within 16 selection levels.');
    const fieldName = ident(value.field, 'source field name');
    if (['__schema', '__type'].includes(fieldName)) fail('Choose data fields for a merchant operation.');
    const definition = parent?.getFields?.()[fieldName] ??
      (fieldName === '__typename' && isCompositeType(parent) ? { type: compiled.schema.getType('String'), args: [] } : null);
    if (!definition) fail('The source schema has no field ' + (parent?.name ?? '') + '.' + fieldName + '.');
    const args = value.arguments ?? {}, selections = value.selections ?? [];
    if (!plain(args) || !Array.isArray(selections)) fail('Choose valid field arguments and selections.');
    const arguments_ = Object.entries(args).map(([argName, literal]) => {
      if (!(definition.args ?? []).some(arg => arg.name === argName)) fail('Unknown argument ' + fieldName + '.' + argName + '.');
      if (typeof literal !== 'string' || literal.length > 4096) fail('An argument must contain a GraphQL literal or declared $variable.');
      let parsed;
      try { parsed = parseValue(literal, { maxTokens: 1024 }); }
      catch { fail('Invalid GraphQL value for ' + fieldName + '.' + argName + '.'); }
      return { kind: Kind.ARGUMENT, name: { kind: Kind.NAME, value: argName }, value: parsed };
    });
    return { kind: Kind.FIELD, name: { kind: Kind.NAME, value: fieldName },
      ...(value.alias ? { alias: { kind: Kind.NAME, value: ident(value.alias, 'result alias') } } : {}), arguments: arguments_,
      ...(selections.length ? { selectionSet: { kind: Kind.SELECTION_SET,
        selections: selections.map(child => field(child, getNamedType(definition.type), depth + 1)) } } : {}) };
  };
  const root = field(model.root, compiled.schema.getQueryType());
  const nativeVariables = Object.create(null), samples = Object.create(null), definitions = [];
  if (!plain(model.variables) || Object.keys(model.variables).length > 16) fail('Use at most 16 bounded buyer variables.');
  for (const [variableName, value] of Object.entries(model.variables)) {
    ident(variableName, 'variable name'); shape(value, ['graphqlType', 'native', 'sample'], 'variable editor');
    if (typeof value.graphqlType !== 'string' || !/^(Int|String|ID|Boolean)!?$/.test(value.graphqlType))
      fail('Buyer variables use Int, String, ID or Boolean. Keep other input structure as fixed literals.');
    if (!plain(value.native)) fail('Supply the original native variable bounds.');
    nativeVariables[variableName] = value.native;
    if (Object.hasOwn(value, 'sample')) samples[variableName] = value.sample;
    definitions.push({ kind: Kind.VARIABLE_DEFINITION, variable: { kind: Kind.VARIABLE,
      name: { kind: Kind.NAME, value: variableName } }, type: parseType(value.graphqlType) });
  }
  const query = print({ kind: Kind.DOCUMENT, definitions: [{ kind: Kind.OPERATION_DEFINITION, operation: 'query',
    name: { kind: Kind.NAME, value: name }, variableDefinitions: definitions,
    selectionSet: { kind: Kind.SELECTION_SET, selections: [root] } }] });
  const candidate = { name, handler, admission, root: root.alias?.value ?? root.name.value,
    query, maxNodes: model.maxNodes, variables: nativeVariables };
  const validated = validateApprovedQueries(compiled, { ...queries, operations: [candidate] }, { examples: { [name]: samples } });
  const next = structuredClone(queries); next.operations[index] = validated.queries.operations[0];
  return { operation: next.operations[index], queriesText: json(next), samples,
    sourceSha256: compiled.sourceSha256, review: validated.operations[0], inputDigest: inputDigest(draft) };
}

async function privateJson(file) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.size > 3 * 1024 * 1024 || (stat.mode & 0o077)) fail('Retained preview is not a private regular file.');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readFile(file)));
}
async function createJson(folder, filename, value) {
  const text = json(value), temporary = join(folder, '.' + randomUUID() + '.tmp'), target = join(folder, filename);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(text); await handle.sync(); await handle.close();
    await link(temporary, target);
    const directory = await open(folder, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await handle.close().catch(() => {}); await rm(temporary, { force: true }); }
  return digest(text);
}
const previewFile = (store, id, suffix = '.json') => {
  if (!ID.test(id)) fail('Choose a valid preview operation ID.');
  return join(store.previews, id + suffix);
};
export function previewView(record) {
  return { id: record.id, project: record.project, draftRevision: record.draftRevision, inputDigest: record.inputDigest,
    operation: record.operation, createdAt: record.createdAt, completedAt: record.completedAt,
    source: record.source, requestSha256: record.requestSha256, responseSha256: record.responseSha256,
    responseBytes: record.responseBytes, status: record.status, state: record.state };
}
function verifyPreview(record, id) {
  if (!plain(record) || record.schema !== PREVIEW || record.id !== id || record.state !== 'COMPLETED' ||
      !plain(record.request) || typeof record.responseBase64 !== 'string') fail('Retained preview record is inconsistent.');
  const bytes = Buffer.from(record.responseBase64, 'base64');
  if (bytes.length !== record.responseBytes || digest(bytes) !== record.responseSha256 ||
      digest(Buffer.from(JSON.stringify(record.request))) !== record.requestSha256) fail('Retained preview bytes changed.');
  return record;
}
export async function readPreview(store, reference) {
  const path = previewFile(store, reference.id), record = verifyPreview(await privateJson(path), reference.id);
  if (reference.recordSha256 && digest(await readFile(path)) !== reference.recordSha256 ||
      reference.project && reference.project !== record.project || reference.inputDigest && reference.inputDigest !== record.inputDigest)
    fail('The preview does not match this retained project.');
  return record;
}
export async function listPreviewOperations(store, saved) {
  const operations = [];
  for (const name of await readdir(store.previews)) {
    if (!/^[a-f0-9-]+\.(?:pending\.)?json$/.test(name)) continue;
    try {
      const record = await privateJson(join(store.previews, name));
      if (record.project !== saved.id) continue;
      if (record.state === 'COMPLETED') verifyPreview(record, record.id);
      if (record.schema !== PREVIEW || !ID.test(record.id)) continue;
      const prior = operations.findIndex(item => item.id === record.id);
      if (prior >= 0 && operations[prior].state === 'COMPLETED') continue;
      const item = { ...previewView(record), retained: (saved.previews ?? []).some(item => item.id === record.id),
        current: record.inputDigest === saved.inputDigest };
      if (prior >= 0) operations[prior] = item; else operations.push(item);
    } catch (error) { if (error.code !== 'ENOENT') operations.push({ id: name, state: 'UNAVAILABLE', error: error.message }); }
  }
  return operations.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

/** Retain before/after source context; an interrupted request is never replayed automatically. */
export async function previewAuthoredOperation(store, saved, { id, operation, variables, allowLoopback = false, signal } = {}) {
  previewFile(store, id); projectName(saved.id);
  if (typeof allowLoopback !== 'boolean' || !plain(variables)) fail('Choose preview variables and the local development option.');
  const { compiled, queries } = sources(saved.input);
  const raw = queries.operations?.find(item => item.name === operation);
  if (!raw) fail('Choose a saved operation.');
  const checked = validateApprovedQueries(compiled, { ...queries, operations: [raw] }, { examples: { [operation]: variables } });
  const native = compileSubQueryMerchant(checked.queries).operations[0];
  const bound = bindSubQueryVariables({ variables }, native), request = { query: native.query, variables: bound };
  const requestSha256 = digest(Buffer.from(JSON.stringify(request)));
  const intent = { schema: PREVIEW, id, project: saved.id, draftRevision: saved.revision, inputDigest: saved.inputDigest,
    operation, createdAt: new Date().toISOString(), state: 'STARTED', requestSha256,
    source: { origin: queries.origin, path: queries.path, schemaSha256: compiled.schemaSha256,
      sourceSha256: compiled.sourceSha256, provenance: compiled.provenance }, request };
  try {
    const existing = await readPreview(store, { id });
    if (existing.project !== saved.id || existing.inputDigest !== saved.inputDigest || existing.operation !== operation ||
        existing.requestSha256 !== requestSha256)
      fail('This preview ID already belongs to different saved inputs.', 409);
    return { record: existing, reference: { ...previewView(existing), recordSha256: digest(await readFile(previewFile(store, id))) } };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const handlers = createSubQueryMerchantHandlers(checked.queries, { allowLoopback, env: process.env });
  try { await createJson(store.previews, id + '.pending.json', intent); }
  catch (error) {
    if (error.code === 'EEXIST') fail('This preview was already started. Recover its saved result or explicitly start a new preview.', 409);
    throw error;
  }
  let result;
  try { result = await handlers[native.handler]({ method: 'POST', url: new URL(queries.origin + queries.path),
    pathParams: {}, headers: {}, body: { variables }, ...(signal ? { signal } : {}) }); }
  catch (error) { result = { status: signal?.aborted ? 499 : 502, body: { error: signal?.aborted ? 'PREVIEW_CANCELLED' : 'PREVIEW_SOURCE_REQUEST_FAILED' } }; }
  const bytes = Buffer.isBuffer(result.body) ? result.body : Buffer.from(JSON.stringify(result.body ?? null));
  if (bytes.length > 2 * 1024 * 1024) fail('The original handler response exceeds the retained preview limit.');
  const record = { ...intent, state: 'COMPLETED', completedAt: new Date().toISOString(), status: result.status,
    responseSha256: digest(bytes), responseBytes: bytes.length, responseBase64: bytes.toString('base64'),
    responseType: result.headers?.['content-type'] ?? 'application/json; charset=utf-8' };
  const recordSha256 = await createJson(store.previews, id + '.json', record);
  return { record, reference: { ...previewView(record), recordSha256 } };
}

export async function recoverPreview(store, saved, id) {
  const record = await readPreview(store, { id, project: saved.id });
  // Historical completed previews remain useful after later draft edits. Their
  // original input digest and revision are retained, never reassigned to now.
  return { record, reference: { ...previewView(record), recordSha256: digest(await readFile(previewFile(store, id))) } };
}
