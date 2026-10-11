// MIT. Schema evolution for original SF105 products and native prepared packages.
import { lstat, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { findBreakingChanges, findDangerousChanges, getNamedType,
  isAbstractType, isEnumType, isInputObjectType, Kind, parse, TypeInfo, visit, visitWithTypeInfo } from 'graphql';
import { compileSchemaSource, readSchemaSource, validateApprovedQueries } from './schema.mjs';
import { compileSubQueryMerchantPlan, prepareSubQuerySeller } from './prepare.mjs';
import { decode, digest, fail, fields, jsonBytes, own, parseJson, readBytes, record, writeBundle } from './files.mjs';

const HASH = /^[a-f0-9]{64}$/;
const MAX_FILE = 8 * 1024 * 1024;
const MAX_BUNDLE = 32 * 1024 * 1024;
const canonical = value => Array.isArray(value) ? value.map(canonical) : record(value) ?
  Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const problem = error => ({ code: String(error.code ?? 'SUBQUERY_CONFIGURATION_INVALID'), message: String(error.message).slice(0, 4096) });
const sourceIdentity = frame => ({ sourceSha256: frame.schemaSource.sourceSha256,
  schemaSha256: frame.schemaSource.schemaSha256, provenance: frame.schemaSource.provenance,
  queriesValueSha256: digest(jsonBytes(canonical(frame.queries))), planValueSha256: digest(jsonBytes(canonical(frame.plan))) });
const operationView = operation => Object.fromEntries(['name', 'handler', 'admission', 'root', 'maxNodes', 'variables', 'query']
  .filter(key => own(operation, key)).map(key => [key, operation[key]]));

function referencedInputTypes(type) {
  const seen = new Map();
  const collect = current => {
    const named = getNamedType(current);
    if (seen.has(named.name)) return;
    if (isEnumType(named)) {
      seen.set(named.name, { name: named.name, kind: 'ENUM', values: named.getValues().map(value => value.name).sort() });
    } else if (isInputObjectType(named)) {
      const entry = { name: named.name, kind: 'INPUT_OBJECT', fields: [] };
      seen.set(named.name, entry); // Recursive input objects are legal.
      for (const field of Object.values(named.getFields()).sort((a, b) => a.name.localeCompare(b.name))) {
        entry.fields.push({ name: field.name, type: String(field.type),
          ...(field.defaultValue !== undefined ? { defaultValue: canonical(field.defaultValue) } : {}) });
        collect(field.type);
      }
    }
  };
  collect(type);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function selectedContract(schema, operation) {
  const types = new TypeInfo(schema), selected = new Map();
  visit(parse(operation.query, { maxTokens: 4096 }), visitWithTypeInfo(types, { Field(node) {
    const parent = types.getParentType(), field = types.getFieldDef();
    if (!parent || !field) return;
    const coordinate = parent.name + '.' + node.name.value, named = getNamedType(field.type);
    const args = [];
    for (const arg of field.args) {
      const supplied = node.arguments?.find(value => value.name.value === arg.name);
      const variable = supplied?.value.kind === Kind.VARIABLE ? operation.variables?.[supplied.value.name.value] : null;
      const defaultUsed = !supplied || variable && !variable.required && !own(variable, 'default');
      if (!supplied && arg.defaultValue === undefined) continue;
      const value = { name: arg.name, type: String(arg.type) };
      if (defaultUsed && arg.defaultValue !== undefined) value.defaultValue = canonical(arg.defaultValue);
      // Include referenced nested input defaults and enum/type contracts.
      // This is deliberately conservative for fixed object literals: callers
      // can inspect the exact changed field even when that literal overrides it.
      const inputTypes = referencedInputTypes(arg.type);
      if (inputTypes.length) value.inputTypes = inputTypes;
      args.push(value);
    }
    const contract = { coordinate, type: String(field.type), arguments: args.sort((a, b) => a.name.localeCompare(b.name)),
      ...(isEnumType(named) ? { enumValues: named.getValues().map(value => value.name).sort() } : {}),
      ...(isAbstractType(named) ? { possibleTypes: schema.getPossibleTypes(named).map(type => type.name).sort() } : {}),
      ...(field.deprecationReason ? { deprecated: field.deprecationReason } : {}) };
    // The same coordinate can be selected repeatedly with different arguments.
    // Retain each actual selection contract rather than overwrite an alias.
    selected.set(coordinate + ':' + JSON.stringify(canonical(contract)), contract);
  } }));
  return [...selected.values()].sort((a, b) => JSON.stringify(canonical(a)).localeCompare(JSON.stringify(canonical(b))));
}

function validateOne(schemaSource, configuration, operation) {
  try {
    const result = validateApprovedQueries(schemaSource, { ...configuration, operations: [operation] });
    return { valid: true, querySha256: result.operations[0].querySha256 };
  } catch (error) { return { valid: false, error: problem(error) }; }
}

function routeView(plan, route) {
  const choice = plan.routes.find(value => value.id === route.id);
  return { id: route.id, url: route.offer.resource.url, operation: choice.operation,
    method: route.offer.extensions.bazaar.info.input.method, handler: route.handler, admission: route.admit,
    serviceName: route.offer.resource.serviceName ?? null, tags: route.offer.resource.tags ?? null,
    description: route.offer.resource.description, accepts: route.offer.accepts,
    input: route.offer.extensions.bazaar.schema.properties.input,
    example: route.offer.extensions.bazaar.info.input.body };
}
function routeChanges(previous, next, previousPlan, nextPlan) {
  const before = new Map(previous.service.routes.map(route => [route.id, routeView(previousPlan, route)]));
  const after = new Map(next.service.routes.map(route => [route.id, routeView(nextPlan, route)]));
  return [...new Set([...before.keys(), ...after.keys()])].map(id => {
    const a = before.get(id), b = after.get(id);
    const changed = a && b ? Object.keys(a).filter(key => !same(a[key], b[key])) : [];
    return { id, status: !a ? 'ADDED' : !b ? 'REMOVED' : changed.length ? 'CHANGED' : 'UNCHANGED',
      changed, previous: a ?? null, candidate: b ?? null };
  });
}

/** Pure review of explicit old/new served schemas and immutable query products.
 * `prepared` is the original compiler result when the entire candidate is valid.
 * Global changes outside selected products are reported without a blanket gate. */
export function compareSubQueryMerchantSchemas({ previous, candidate }) {
  if (!record(previous) || !record(candidate) || !previous.schemaSource?.schema || !candidate.schemaSource?.schema)
    fail('REVISION_SOURCE', 'Supply compiled previous and candidate served schemas');
  const old = { schemaSource: previous.schemaSource, queries: structuredClone(previous.queries), plan: structuredClone(previous.plan) };
  const next = { schemaSource: candidate.schemaSource,
    queries: structuredClone(own(candidate, 'queries') ? candidate.queries : previous.queries),
    plan: structuredClone(own(candidate, 'plan') ? candidate.plan : previous.plan) };
  const baseline = compileSubQueryMerchantPlan(old);
  let prepared = null, candidateValidation = { valid: true };
  try { prepared = compileSubQueryMerchantPlan(next); }
  catch (error) { candidateValidation = { valid: false, error: problem(error) }; }
  const nextOperations = Array.isArray(next.queries?.operations) ? next.queries.operations : [];
  const oldOperations = new Map(baseline.queries.operations.map(operation => [operation.name, operation]));
  const operations = [];
  for (const original of baseline.queries.operations) {
    const proposed = nextOperations.find(operation => operation?.name === original.name);
    const validation = validateOne(next.schemaSource, { ...old.queries,
      origin: next.queries?.origin, path: next.queries?.path }, original);
    const before = selectedContract(old.schemaSource.schema, original);
    const after = selectedContract(next.schemaSource.schema, original);
    const contractChanged = !same(before, after);
    const normalized = proposed ? (() => {
      try { return validateApprovedQueries(next.schemaSource, { ...next.queries, operations: [proposed] }).queries.operations[0]; }
      catch { return proposed; }
    })() : null;
    const changes = normalized ? [...new Set([...Object.keys(original), ...Object.keys(normalized)])]
      .filter(key => !same(original[key], normalized[key])) : [];
    operations.push({ name: original.name, previousQuerySha256: digest(Buffer.from(original.query)),
      previousOperation: operationView(original),
      originalAgainstCandidate: { ...validation, contractChanged,
        status: !validation.valid ? 'QUERY_INVALID' : contractChanged ? 'CONTRACT_CHANGED' : 'COMPATIBLE',
        previousContract: before, candidateContract: after },
      candidate: proposed ? { status: changes.length ? 'CHANGED' : 'UNCHANGED', changed: changes,
        operation: operationView(normalized), ...validateOne(next.schemaSource, next.queries, proposed) } : { status: 'REMOVED' } });
  }
  for (const proposed of nextOperations.filter(operation => record(operation) && !oldOperations.has(operation.name)))
    operations.push({ name: proposed.name, previousQuerySha256: null, originalAgainstCandidate: null,
      candidate: { status: 'ADDED', operation: operationView(proposed), ...validateOne(next.schemaSource, next.queries, proposed) } });
  const routes = prepared ? routeChanges(baseline, prepared, old.plan, next.plan) : null;
  const report = { schema: 'stellar-forge.subquery-schema-change-review.v1',
    previous: sourceIdentity(old), candidate: sourceIdentity(next), ready: Boolean(prepared), candidateValidation,
    schemaChanges: { breaking: findBreakingChanges(old.schemaSource.schema, next.schemaSource.schema),
      dangerous: findDangerousChanges(old.schemaSource.schema, next.schemaSource.schema) },
    endpoint: { changed: old.queries.origin !== next.queries?.origin || old.queries.path !== next.queries?.path,
      previous: { origin: old.queries.origin, path: old.queries.path },
      candidate: { origin: next.queries?.origin ?? null, path: next.queries?.path ?? null } },
    operations, routes,
    summary: { originalOperations: oldOperations.size,
      affectedOperations: operations.filter(value => value.originalAgainstCandidate && value.originalAgainstCandidate.status !== 'COMPATIBLE').length,
      changedOperations: operations.filter(value => value.candidate.status !== 'UNCHANGED').length,
      changedRoutes: routes ? routes.filter(value => value.status !== 'UNCHANGED').length : null } };
  return { review: report, prepared };
}

/** Reopen the original exporter package and verify the exact retained bytes.
 * Snapshot bytes are returned for a self-contained previous-version copy. */
export async function readSubQueryMerchantBundle(directory) {
  const root = await realpath(resolve(directory));
  if (!(await lstat(root)).isDirectory()) fail('BUNDLE_DIRECTORY', 'Choose an original prepared merchant directory');
  if (!(await lstat(join(root, 'manifest.json'))).isFile()) fail('BUNDLE_MANIFEST', 'Original bundle manifest must be a regular file');
  const manifestBytes = await readBytes(join(root, 'manifest.json'), 65536), manifest = parseJson(manifestBytes);
  fields(manifest, ['schema', 'createdAt', 'sourceSha256', 'originalQueriesSha256', 'planSha256', 'files'], 'Original bundle manifest');
  if (manifest.schema !== 'stellar-forge.subquery-merchant-bundle.v1' || !Array.isArray(manifest.files) ||
      manifest.files.length < 15 || manifest.files.length > 64 ||
      ![manifest.sourceSha256, manifest.originalQueriesSha256, manifest.planSha256].every(value => HASH.test(value)))
    fail('BUNDLE_MANIFEST', 'Choose a complete original prepared merchant package');
  const bytes = new Map(); let total = 0;
  for (const entry of manifest.files) {
    fields(entry, ['name', 'bytes', 'sha256'], 'Original bundle file');
    if (typeof entry.name !== 'string' || !/^[A-Za-z0-9_-][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)?$/.test(entry.name) ||
        entry.name === 'manifest.json' || bytes.has(entry.name) || !Number.isSafeInteger(entry.bytes) ||
        entry.bytes < 1 || entry.bytes > MAX_FILE || !HASH.test(entry.sha256))
      fail('BUNDLE_FILE', 'Original bundle manifest contains an invalid file entry');
    const path = join(root, entry.name);
    if (!(await lstat(dirname(path))).isDirectory() || !(await lstat(path)).isFile())
      fail('BUNDLE_FILE', 'Original bundle entries must be regular files in regular directories');
    const data = await readBytes(path, MAX_FILE); total += data.length;
    if (total > MAX_BUNDLE || data.length !== entry.bytes || digest(data) !== entry.sha256)
      fail('BUNDLE_CHANGED', 'An original package file changed or the package exceeds 32 MiB');
    bytes.set(entry.name, data);
  }
  const schemaNames = ['schema-source.json', 'schema-source.graphql'].filter(name => bytes.has(name));
  if (schemaNames.length !== 1 || ['approved-queries.original.json', 'merchant-plan.json', 'queries.json', 'service.json',
    'schema-review.json', 'review.json', 'review.html', 'RUN.md', 'buyer/seller-openapi.json',
    'buyer/seller-client.mjs', 'buyer/seller-client.d.mts', 'buyer/package.json', 'buyer/README.md', 'buyer/requests.json']
    .some(name => !bytes.has(name))) fail('BUNDLE_INCOMPLETE', 'The original merchant package is incomplete');
  const schemaBytes = bytes.get(schemaNames[0]), queriesBytes = bytes.get('approved-queries.original.json'), planBytes = bytes.get('merchant-plan.json');
  if (digest(schemaBytes) !== manifest.sourceSha256 || digest(queriesBytes) !== manifest.originalQueriesSha256 || digest(planBytes) !== manifest.planSha256)
    fail('BUNDLE_SOURCE', 'Original source files do not match the prepared manifest');
  const schemaSource = { ...compileSchemaSource(decode(schemaBytes)), sourceBytes: schemaBytes, sourceSha256: digest(schemaBytes) };
  const queries = parseJson(queriesBytes), plan = parseJson(planBytes), compiled = compileSubQueryMerchantPlan({ schemaSource, queries, plan });
  const service = parseJson(bytes.get('service.json'));
  if (!same(service, compiled.service) || !same(parseJson(bytes.get('queries.json')), compiled.queries))
    fail('BUNDLE_BINDING', 'Prepared runtime files do not match their original schema, queries and terms');
  bytes.set('manifest.json', manifestBytes);
  return { directory: root, schemaSource, queries, plan, service, manifest,
    identity: { manifestSha256: digest(manifestBytes), sourceSha256: manifest.sourceSha256,
      originalQueriesSha256: manifest.originalQueriesSha256, planSha256: manifest.planSha256 }, files: bytes };
}

async function loadRevision({ previousDirectory, schemaFile, queriesFile, planFile }) {
  const previous = await readSubQueryMerchantBundle(previousDirectory), schemaSource = await readSchemaSource(schemaFile);
  const queriesBytes = queriesFile ? await readBytes(queriesFile) : previous.files.get('approved-queries.original.json');
  const planBytes = planFile ? await readBytes(planFile, 262144) : previous.files.get('merchant-plan.json');
  const candidate = { schemaSource, queries: parseJson(queriesBytes), plan: parseJson(planBytes) };
  const result = compareSubQueryMerchantSchemas({ previous, candidate });
  return { previous, candidate, queriesBytes, planBytes, ...result };
}
export async function reviewSubQueryRevision(options) { return (await loadRevision(options)).review; }

const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
function reviewHtml(review) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>GraphQL merchant revision</title><style>body{font:15px/1.5 system-ui,sans-serif;color:#222;background:#f4f4f4;margin:0}main{max-width:1120px;margin:auto;padding:28px}section{background:#fff;border:1px solid #aaa;padding:20px;margin:18px 0}h1{font-size:28px}h2{font-size:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #bbb;padding:9px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eee}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 ui-monospace,monospace}a{color:inherit}</style>
<main><h1>GraphQL merchant revision</h1><p>Review the existing query products, provider schema changes and exact revised native route terms. The merchant folder is prepared by the original SF105 exporter. The previous folder retains the complete original package.</p>
<section><h2>Selected products</h2><table><thead><tr><th>Operation</th><th>Original query under new schema</th><th>Revised operation</th></tr></thead><tbody>${review.operations.map(item => `<tr><td>${escape(item.name)}</td><td>${escape(item.originalAgainstCandidate?.status ?? 'NEW')}${item.originalAgainstCandidate?.error ? '<pre>' + escape(item.originalAgainstCandidate.error.message) + '</pre>' : ''}</td><td>${escape(item.candidate.status)}</td></tr>`).join('')}</tbody></table></section>
<section><h2>Provider schema changes</h2><pre>${escape(JSON.stringify(review.schemaChanges, null, 2))}</pre></section>
${(review.routes ?? []).filter(route => route.status !== 'UNCHANGED').map(route => `<section><h2>${escape(route.id)} — ${escape(route.status)}</h2><p>Changed: ${escape(route.changed.join(', ') || route.status)}</p><h3>Previous</h3><pre>${escape(JSON.stringify(route.previous, null, 2))}</pre><h3>Candidate</h3><pre>${escape(JSON.stringify(route.candidate, null, 2))}</pre></section>`).join('')}
<section><h2>Prepared application</h2><p><a href="../merchant/review.html">Open the original merchant review</a>. Use <a href="RUN.md">RUN.md</a> to launch the original seller or access the generated buyer clients.</p><pre>${escape(JSON.stringify({ previous: review.previous, candidate: review.candidate, endpoint: review.endpoint }, null, 2))}</pre></section></main></html>\n`;
}

/** Create one self-contained revision wrapper using the ORIGINAL exporter.
 * Comparison inputs are frozen before preparation; the prior package is copied
 * byte-for-byte and its existing directory is never edited. */
export async function prepareSubQueryRevision(options) {
  const loaded = await loadRevision(options), { previous, candidate, queriesBytes, planBytes, review } = loaded;
  if (!loaded.prepared) fail('REVISION_INVALID', review.candidateValidation.error.message);
  const reviewBytes = jsonBytes(review);
  if (reviewBytes.length > MAX_FILE) fail('REVISION_SIZE', 'Revision review exceeds 8 MiB');
  const requested = resolve(options.directory), parent = await realpath(dirname(requested));
  const destination = join(parent, basename(requested)), inside = relative(previous.directory, destination);
  if (!isAbsolute(inside) && inside !== '..' && !inside.startsWith('..' + sep))
    fail('REVISION_DIRECTORY', 'Choose a new revision directory outside the previous merchant package');
  const schemaName = candidate.schemaSource.format === 'sdl' ? 'schema-source.graphql' : 'schema-source.json';
  const root = await writeBundle(destination, [['candidate/' + schemaName, candidate.schemaSource.sourceBytes],
    ['candidate/approved-queries.json', queriesBytes], ['candidate/merchant-plan.json', planBytes]]);
  const previousDirectory = await writeBundle(join(root, 'previous'), [...previous.files]);
  const prepared = await prepareSubQuerySeller({ schemaFile: join(root, 'candidate', schemaName),
    queriesFile: join(root, 'candidate/approved-queries.json'), planFile: join(root, 'candidate/merchant-plan.json'),
    directory: join(root, 'merchant') });
  const currentManifestBytes = await readBytes(prepared.manifest, 65536), currentManifest = parseJson(currentManifestBytes);
  if (currentManifest.sourceSha256 !== candidate.schemaSource.sourceSha256 || currentManifest.originalQueriesSha256 !== digest(queriesBytes) ||
      currentManifest.planSha256 !== digest(planBytes)) fail('REVISION_INPUT_CHANGED', 'Revision inputs changed during native preparation');
  const run = `# GraphQL merchant revision\n\nOpen revision/review.html, then merchant/review.html. The merchant directory contains the complete original seller service, approved queries and generated buyer client.\n\nRun from the wrapper directory containing merchant/, previous/ and revision/:\n\n\`\`\`sh\nnode /PATH/TO/sf105-subquery-graphql-merchant/launch.mjs --seller merchant/service.json --queries merchant/queries.json --check\nnode /PATH/TO/sf105-subquery-graphql-merchant/launch.mjs --seller merchant/service.json --queries merchant/queries.json --port 8423\n\`\`\`\n\nUse the original --facilitator option and existing merchant runtime settings for native operation. Credentials remain named environment inputs. The prior package is retained exactly in previous/; select it through the same original launcher when its provider endpoint still serves that schema. This package does not change a provider database or an already running merchant. For another revision, pass merchant/ as --previous to the existing onboarding compare/revise commands.\n`;
  const files = [['review.json', reviewBytes], ['review.html', reviewHtml(review)], ['RUN.md', run]];
  const manifest = { schema: 'stellar-forge.subquery-merchant-revision.v1', createdAt: new Date().toISOString(),
    packagePathsRelativeTo: '..',
    previous: { directory: 'previous', ...previous.identity },
    candidate: { directory: 'merchant', manifestSha256: digest(currentManifestBytes), sourceSha256: currentManifest.sourceSha256,
      originalQueriesSha256: currentManifest.originalQueriesSha256, planSha256: currentManifest.planSha256 },
    files: files.map(([name, bytes]) => ({ name, bytes: Buffer.byteLength(bytes), sha256: digest(bytes) })) };
  // Publish revision metadata only after both complete native packages exist.
  // writeBundle reserves a fresh metadata directory; its files then remain fixed.
  const metadata = await writeBundle(join(root, 'revision'), [...files, ['manifest.json', jsonBytes(manifest)]]);
  return { directory: root, prepared, previousDirectory, review: join(metadata, 'review.html'),
    report: join(metadata, 'review.json'), manifest: join(metadata, 'manifest.json'), summary: review.summary };
}
