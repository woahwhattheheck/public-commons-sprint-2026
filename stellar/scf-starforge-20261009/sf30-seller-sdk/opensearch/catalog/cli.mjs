#!/usr/bin/env node
// MIT. Installed catalog commands over the original OpenSearch workspace and request journal.
import { constants } from 'node:fs';
import { open, mkdir, link, unlink, realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const CATALOG_HELP = `Starforge material catalog

  starforge opensearch-catalog COMMAND --source SOURCE.json --workspace PRIVATE_DIR
    [--plan PLAN.json] [COMMAND_OPTIONS]

Read the original retained workspace:
  catalog-state
  catalog-show       --catalog ID [--revision N]
  catalog-history    --catalog ID
  catalog-source     --source-id ID
  catalog-edition    --edition ID
  catalog-material   --edition ID --material-key KEY
  catalog-materials  --edition ID [--offset N] [--limit N] [--search TEXT]
  catalog-changes    --edition ID [--offset N] [--limit N]
  catalog-facets     --catalog ID [--edition ID]
  catalog-suggest    --catalog ID [--text TEXT | --text-file UTF8_FILE]
                     [--customer ID] [--category VALUE] [--manufacturer VALUE]
                     [--unit VALUE] [--offset N] [--limit N]
  catalog-quantity   --catalog ID --material-key KEY --material-sha256 SHA256
                     --quantity DECIMAL_TEXT --unit ORIGINAL_UNIT
  catalog-decisions  --catalog ID [--offset N] [--limit N]
  catalog-operation  --request-id ORIGINAL_ID
  catalog-import-storage [--import-request-id ORIGINAL_ID] [--offset N] [--limit N]
  catalog-retire-import-stage --request RETIREMENT.json

Supplier delivery:
  catalog-supplier-profile [--target xchange-2.0|2ba-xchange-2.0]
  catalog-supplier-state   --catalog ID
  catalog-supplier-plan    --submission ID
  catalog-supplier-history --submission ID
  catalog-supplier-product --submission ID --material-key KEY
  catalog-supplier-rows    --review ID [--status all|errors|warnings|ready]
                          [--search IDENTIFIER] [--offset N] [--limit N]
  catalog-supplier-recipient-rows --review ID [--kind all|product|tradeItem]
                          [--change all|added|changed|unchanged|expired|deleted|skipped]
                          [--search IDENTIFIER] [--offset N] [--limit N]
  catalog-supplier-row     --review ID --material-key KEY
  catalog-supplier-save       --request REQUEST.json
  catalog-supplier-correction --request REQUEST.json
  catalog-supplier-review     --request REQUEST.json
  catalog-supplier-export --review ID --review-sha256 SHA256
                          --format FORMAT --output FILE_OR_-

Supplier formats: review.json, issues.csv, products.jsonl, bmecat.xml,
                  xchange.json, recipient.jsonl, impact.csv, parameters.xml, 2ba.zip.
                  2ba.zip pairs the reviewed native JSON with parameters.xml.
Use format.kind=xchange-json for an original ETIM xChange document.
A complete catalog bundle also carries supplier plan/correction histories
and every immutable supplier review; original v1 bundles remain readable.

Retain and review original work:
  catalog-upload       --file ORIGINAL_FILE --request REQUEST.json
  catalog-save         --request REQUEST.json
  catalog-preview      --request REQUEST.json
  catalog-select       --request REQUEST.json
  catalog-decision     --request REQUEST.json
  catalog-create-draft --request REQUEST.json
  catalog-import       --file ORIGINAL_BUNDLE.jsonl --request REQUEST.json

Export complete retained work:
  catalog-export --catalog ID --format FORMAT --output FILE_OR_-
                 [--edition ID] [--index ORIGINAL_INDEX]

Formats: catalog.csv, catalog.jsonl, approved-matches.csv, facets.json, index.json,
bulk.ndjson, delta.ndjson, source.json, search-client.ts, catalog-bundle.jsonl.

Stage retirement uses {importRequestId, expectedRequestSha256} from catalog-import-storage.
It retires only the closed temporary stage of that COMPLETE import. Original
bundles, canonical source files and completed operation results stay retained.
The same retirement selection resumes after interruption; it creates no new
catalog or import. Storage reports distinguish estimated staged allocation,
verified removals and files already absent before a durable removal receipt.

Every business mutation supplies its original requestId. Save, preview and select
retain expectedRevision; decisions retain expectedCatalogRevision, material hash,
and an existing decisionId/expectedRevision when revising a saved customer match.
The JSON fields are the same fields used by the browser and workspace methods.
Use --request - to read one JSON object from stdin (up to 1 MiB).
Upload requests include format (for example {"kind":"tsv"}) and source provenance.
Upload/import name, bytes and sha256 may be supplied; omitted manifest fields are
filled from the selected regular file. Supplied length/hash must match its bytes.
Hashing and transfer share one open file descriptor; large bodies stay streamed.

A repeated command reopens the exact saved operation for that requestId. Changed
input requires a different explicit request; failed/interrupted operations remain
inspectable with catalog-operation. A pending or failed mutation exits nonzero.
Exports are streamed to a private temporary file and published after completion.
An existing output is accepted only when its exact bytes and SHA-256 agree.
--output - streams only the export body to stdout and its receipt to stderr.
Other commands write JSON to stdout. Quantities remain original decimal text and
the conversion result retains an exact numerator/denominator.
`;

const COMMON = ['--source', '--workspace', '--plan'];
const PAGING = ['--offset', '--limit'];
const OPTIONS = {
  'catalog-state': [],
  'catalog-show': ['--catalog', '--revision'],
  'catalog-history': ['--catalog'],
  'catalog-source': ['--source-id'],
  'catalog-edition': ['--edition'],
  'catalog-material': ['--edition', '--material-key'],
  'catalog-materials': ['--edition', '--search', ...PAGING],
  'catalog-changes': ['--edition', ...PAGING],
  'catalog-facets': ['--catalog', '--edition'],
  'catalog-suggest': ['--catalog', '--text', '--text-file', '--customer', '--category', '--manufacturer', '--unit', ...PAGING],
  'catalog-quantity': ['--catalog', '--material-key', '--material-sha256', '--quantity', '--unit'],
  'catalog-decisions': ['--catalog', ...PAGING],
  'catalog-operation': ['--request-id'],
  'catalog-import-storage': ['--import-request-id', ...PAGING],
  'catalog-retire-import-stage': ['--request'],
  'catalog-supplier-profile': ['--target'],
  'catalog-supplier-state': ['--catalog'],
  'catalog-supplier-plan': ['--submission'],
  'catalog-supplier-history': ['--submission'],
  'catalog-supplier-product': ['--submission','--material-key'],
  'catalog-supplier-rows': ['--review','--status','--search',...PAGING],
  'catalog-supplier-row': ['--review','--material-key'],
  'catalog-supplier-recipient-rows': ['--review','--kind','--change','--search',...PAGING],
  'catalog-supplier-save': ['--request'],
  'catalog-supplier-correction': ['--request'],
  'catalog-supplier-review': ['--request'],
  'catalog-supplier-export': ['--review','--review-sha256','--format','--output'],
  'catalog-upload': ['--file', '--request'],
  'catalog-import': ['--file', '--request'],
  'catalog-save': ['--request'],
  'catalog-preview': ['--request'],
  'catalog-select': ['--request'],
  'catalog-decision': ['--request'],
  'catalog-create-draft': ['--request'],
  'catalog-export': ['--catalog', '--format', '--output', '--edition', '--index']
};
const MUTATIONS = {
  'catalog-retire-import-stage': 'retireImportStage',
  'catalog-save': 'save',
  'catalog-preview': 'preview',
  'catalog-select': 'select',
  'catalog-decision': 'saveDecision',
  'catalog-create-draft': 'createDraft',
  'catalog-supplier-save': 'supplierSave',
  'catalog-supplier-correction': 'supplierCorrection',
  'catalog-supplier-review': 'supplierReview'
};
const CHUNK = 262144;
const MAX_INPUT = 8 * 1024 * 1024 * 1024;
class CatalogCommandError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function fail(code, message) { throw new CatalogCommandError(code, message); }
function required(options, name) {
  if (!Object.hasOwn(options, name) || options[name].length === 0)
    fail('CATALOG_CLI_OPTION_REQUIRED', 'Supply ' + name + '. See --help for the complete command.');
  return options[name];
}
function argumentsFor(command, args) {
  if (!Object.hasOwn(OPTIONS, command))
    fail('CATALOG_CLI_COMMAND_INVALID', 'Select an original catalog-* command. See --help.');
  const allowed = new Set([...COMMON, ...OPTIONS[command]]), options = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i], value = args[i + 1];
    if (!allowed.has(name) || Object.hasOwn(options, name) || typeof value !== 'string' || value.startsWith('--'))
      fail('CATALOG_CLI_ARGUMENT_INVALID', 'Unknown, repeated, or incomplete option: ' + name + '.');
    options[name] = value;
  }
  required(options, '--source'); required(options, '--workspace');
  return options;
}
function integer(options, name) {
  if (!Object.hasOwn(options, name)) return undefined;
  const text = options[name];
  if (!/^(?:0|[1-9]\d*)$/.test(text) || !Number.isSafeInteger(Number(text)))
    fail('CATALOG_CLI_INTEGER_REQUIRED', name + ' requires a nonnegative whole number.');
  return Number(text);
}
function paging(options) {
  const result = {};
  for (const key of ['offset', 'limit']) {
    const value = integer(options, '--' + key);
    if (value !== undefined) result[key] = value;
  }
  return result;
}
async function readText(path, limit, stdin) {
  const chunks = []; let bytes = 0, file;
  try {
    let iterable;
    if (path === '-') {
      if (!stdin || typeof stdin[Symbol.asyncIterator] !== 'function')
        fail('CATALOG_CLI_STDIN_REQUIRED', 'This command requires its original JSON input stream.');
      iterable = stdin;
    } else {
      file = await open(resolve(path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = await file.stat();
      if (!stat.isFile()) fail('CATALOG_CLI_INPUT_FILE_INVALID', 'Select a regular input file.');
      if (stat.size > limit) fail('CATALOG_CLI_INPUT_TOO_LARGE', 'The command input exceeds ' + limit + ' bytes.');
      iterable = fileChunks(file, limit);
    }
    for await (const value of iterable) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      bytes += chunk.length;
      if (bytes > limit) fail('CATALOG_CLI_INPUT_TOO_LARGE', 'The command input exceeds ' + limit + ' bytes.');
      chunks.push(chunk);
    }
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); }
    catch { fail('CATALOG_CLI_UTF8_REQUIRED', 'Use the original UTF-8 command input.'); }
    if (text.includes('\0')) fail('CATALOG_CLI_NUL_INVALID', 'Command input contains a NUL character.');
    return text;
  } finally { if (file) await file.close(); }
}
async function requestInput(options, stdin, { requireRequestId = true } = {}) {
  const text = await readText(required(options, '--request'), 1024 * 1024, stdin);
  let value;
  try { value = JSON.parse(text); }
  catch { fail('CATALOG_CLI_JSON_REQUIRED', 'Supply one complete JSON request object.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('CATALOG_CLI_JSON_REQUIRED', 'Supply one complete JSON request object.');
  if (requireRequestId && (typeof value.requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value.requestId)))
    fail('CATALOG_CLI_REQUEST_ID_REQUIRED', 'Supply the original requestId in the request JSON.');
  return value;
}
async function* fileChunks(file, max = MAX_INPUT) {
  let offset = 0;
  while (true) {
    const buffer = Buffer.allocUnsafe(CHUNK);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
    if (!bytesRead) break;
    offset += bytesRead;
    if (offset > max) fail('CATALOG_CLI_INPUT_TOO_LARGE', 'The selected file exceeds the supported byte count.');
    yield buffer.subarray(0, bytesRead);
  }
}
function sameFile(a, b) {
  return ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => a[key] === b[key]);
}
async function hashHandle(file) {
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of fileChunks(file)) { hash.update(chunk); bytes += chunk.length; }
  return { bytes, sha256: hash.digest('hex') };
}
async function transferFile(workspace, command, options, request) {
  const path = resolve(required(options, '--file'));
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.size < 1n || before.size > BigInt(MAX_INPUT))
      fail('CATALOG_CLI_SOURCE_FILE_INVALID', 'Select a nonempty regular source file up to 8 GiB.');
    const actual = await hashHandle(file);
    if (!sameFile(before, await file.stat({ bigint: true })))
      fail('CATALOG_CLI_SOURCE_CHANGED', 'The source file changed while its original manifest was being read.');
    if (request.bytes !== undefined && request.bytes !== actual.bytes ||
        request.sha256 !== undefined && request.sha256 !== actual.sha256)
      fail('CATALOG_CLI_SOURCE_MANIFEST_CHANGED', 'The selected file does not match the request’s declared byte count or SHA-256.');
    const metadata = { ...request, name: request.name ?? basename(path), ...actual };
    async function* originalBytes() {
      yield* fileChunks(file);
      if (!sameFile(before, await file.stat({ bigint: true })))
        fail('CATALOG_CLI_SOURCE_CHANGED', 'The source file changed during its original transfer.');
    }
    return await (command === 'catalog-upload' ? workspace.catalog.upload(metadata, originalBytes())
      : workspace.catalog.importBundle(metadata, originalBytes()));
  } finally { await file.close(); }
}
async function* exportChunks(body) {
  if (typeof body === 'string' || Buffer.isBuffer(body) || body instanceof Uint8Array) {
    yield Buffer.isBuffer(body) ? body : Buffer.from(body); return;
  }
  if (!body || typeof body[Symbol.iterator] !== 'function' && typeof body[Symbol.asyncIterator] !== 'function')
    fail('CATALOG_CLI_EXPORT_INVALID', 'The original catalog export did not provide a byte stream.');
  for await (const chunk of body) {
    if (typeof chunk !== 'string' && !Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array))
      fail('CATALOG_CLI_EXPORT_INVALID', 'The original export contains a non-byte value.');
    yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  }
}
async function exportFile(value, destination, stdout) {
  const hash = createHash('sha256'); let bytes = 0;
  async function* measured() {
    for await (const chunk of exportChunks(value.body)) { hash.update(chunk); bytes += chunk.length; yield chunk; }
  }
  if (destination === '-') {
    await pipeline(Readable.from(measured()), stdout, { end: false });
    return { destination: 'stdout', filename: value.filename, contentType: value.type, bytes, sha256: hash.digest('hex') };
  }
  const path = resolve(destination), parent = dirname(path);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const temporary = join(parent, '.' + basename(path) + '.' + randomUUID() + '.part');
  const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  let closed = false;
  try {
    for await (const chunk of measured()) await file.writeFile(chunk);
    await file.sync(); await file.close(); closed = true;
    const sha256 = hash.digest('hex');
    try { await link(temporary, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const stat = await existing.stat({ bigint: true });
        if (!stat.isFile() || stat.size !== BigInt(bytes))
          fail('CATALOG_CLI_EXPORT_CONFLICT', 'The selected output already exists with different bytes.');
        const actual = await hashHandle(existing);
        if (actual.bytes !== bytes || actual.sha256 !== sha256 || !sameFile(stat, await existing.stat({ bigint: true })))
          fail('CATALOG_CLI_EXPORT_CONFLICT', 'The selected output already exists with different bytes.');
      } finally { await existing.close(); }
    }
    const directory = await open(parent, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
    return { destination: path, filename: value.filename, contentType: value.type, bytes, sha256 };
  } finally {
    if (!closed) await file.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}
async function perform(workspace, command, options, context) {
  const catalog = workspace.catalog;
  if (Object.hasOwn(MUTATIONS, command))
    return catalog[MUTATIONS[command]](await requestInput(options, context.stdin, {
      requireRequestId: command !== 'catalog-retire-import-stage' }));
  if (command === 'catalog-supplier-profile') return catalog.supplier.templates(options['--target']?{target:options['--target']}:{});
  if (command === 'catalog-supplier-state') return catalog.supplier.state({catalogId:required(options,'--catalog')});
  if (command === 'catalog-supplier-plan') return catalog.supplier.plan(required(options,'--submission'));
  if (command === 'catalog-supplier-history') return {revisions:catalog.supplier.planHistory(required(options,'--submission'))};
  if (command === 'catalog-supplier-product') return catalog.supplier.currentProduct({
    planId:required(options,'--submission'),materialKey:required(options,'--material-key')});
  if (command === 'catalog-supplier-rows') return catalog.supplier.rows({
    reviewId:required(options,'--review'),status:options['--status']??'all',search:options['--search']??'',...paging(options)});
  if (command === 'catalog-supplier-recipient-rows') return catalog.supplier.recipientRows({
    reviewId:required(options,'--review'),kind:options['--kind']??'all',change:options['--change']??'all',search:options['--search']??'',...paging(options)});
  if (command === 'catalog-supplier-row') return catalog.supplier.reviewRow({
    reviewId:required(options,'--review'),materialKey:required(options,'--material-key')});
  if (command === 'catalog-supplier-export') {
    const reviewId=required(options,'--review'),format=required(options,'--format'),output=required(options,'--output');
    const value=catalog.supplier.export({reviewId,format,expectedReviewSha256:required(options,'--review-sha256')});
    return {schema:'stellar-forge.supplier-export-receipt.v1',workspaceId:workspace.store.id,reviewId,format,
      ...await exportFile(value,output,context.stdout)};
  }
  if (command === 'catalog-upload' || command === 'catalog-import')
    return transferFile(workspace, command, options, await requestInput(options, context.stdin));
  if (command === 'catalog-state')
    return { workspaceId: workspace.store.id, sourceProfileSha256: workspace.store.profileHash, ...catalog.state() };
  if (command === 'catalog-show') return catalog.catalog(required(options, '--catalog'), integer(options, '--revision'));
  if (command === 'catalog-history') return { revisions: catalog.history(required(options, '--catalog')) };
  if (command === 'catalog-source') return catalog.source(required(options, '--source-id'));
  if (command === 'catalog-edition') return catalog.edition(required(options, '--edition'));
  if (command === 'catalog-material') {
    const edition = catalog.edition(required(options, '--edition'));
    const material = catalog.material(edition.id, required(options, '--material-key'));
    if (!material) fail('CATALOG_MATERIAL_NOT_FOUND', 'Material not found in the selected original edition.');
    return { editionId: edition.id, material };
  }
  if (command === 'catalog-materials') return catalog.materials({
    editionId: required(options, '--edition'), ...paging(options), search: options['--search'] ?? '' });
  if (command === 'catalog-changes') return catalog.changes({
    editionId: required(options, '--edition'), ...paging(options) });
  if (command === 'catalog-facets') return catalog.facets({
    catalogId: required(options, '--catalog'), editionId: options['--edition'] });
  if (command === 'catalog-suggest') {
    if (Object.hasOwn(options, '--text') && Object.hasOwn(options, '--text-file'))
      fail('CATALOG_CLI_TEXT_REPEATED', 'Use either --text or --text-file for the original customer description.');
    const text = Object.hasOwn(options, '--text-file')
      ? await readText(options['--text-file'], 16384, context.stdin) : options['--text'] ?? '';
    return catalog.suggest({ catalogId: required(options, '--catalog'), text,
      customerId: options['--customer'] ?? '', category: options['--category'],
      manufacturer: options['--manufacturer'], unit: options['--unit'], ...paging(options) });
  }
  if (command === 'catalog-quantity') return catalog.quantity({
    catalogId: required(options, '--catalog'), materialKey: required(options, '--material-key'),
    expectedMaterialSha256: required(options, '--material-sha256'),
    quantity: required(options, '--quantity'), unit: required(options, '--unit') });
  if (command === 'catalog-decisions') return catalog.decisions({
    catalogId: required(options, '--catalog'), ...paging(options) });
  if (command === 'catalog-operation') return workspace.operation(required(options, '--request-id'));
  if (command === 'catalog-import-storage') return catalog.importStorage({
    ...(options['--import-request-id'] ? { importRequestId: options['--import-request-id'] } : {}), ...paging(options) });
  if (command === 'catalog-export') {
    const catalogId = required(options, '--catalog'), format = required(options, '--format');
    const output = required(options, '--output');
    const value = await catalog.export(catalogId, format, {
      editionId: options['--edition'], index: options['--index'] });
    return { schema: 'stellar-forge.material-catalog-export-receipt.v1', workspaceId: workspace.store.id,
      catalogId, format, ...await exportFile(value, output, context.stdout) };
  }
  fail('CATALOG_CLI_COMMAND_INVALID', 'Select an original catalog-* command.');
}
async function emitJson(stream, value) {
  await pipeline(Readable.from([JSON.stringify(value, null, 2) + '\n']), stream, { end: false });
}
export async function main(args = process.argv.slice(2), {
  stdout = process.stdout, stderr = process.stderr, stdin = process.stdin, env = process.env, print
} = {}) {
  if (!args.length || args.length === 1 && ['--help', '-h', 'help'].includes(args[0]) ||
      args.length === 2 && Object.hasOwn(OPTIONS, args[0]) && ['--help', '-h'].includes(args[1])) {
    if (print) await print(CATALOG_HELP);
    else await pipeline(Readable.from([CATALOG_HELP]), stdout, { end: false });
    return null;
  }
  const [command, ...rest] = args, options = argumentsFor(command, rest);
  const { createOpenSearchWorkspace } = await import('../workspace/service.mjs');
  const workspace = await createOpenSearchWorkspace({ sourceFile: options['--source'],
    planFile: options['--plan'], directory: options['--workspace'], env });
  let result, failure;
  try { result = await perform(workspace, command, options, { stdout, stderr, stdin }); }
  catch (error) { failure = error; }
  finally {
    try { await workspace.close(); }
    catch (error) {
      if (failure) failure.cleanup = { code: error.code ?? 'CATALOG_CLI_CLOSE_FAILED', message: error.message };
      else failure = error;
    }
  }
  if (failure) throw failure;
  if (print) await print(result);
  else await emitJson(['catalog-export','catalog-supplier-export'].includes(command) && options['--output'] === '-' ? stderr : stdout, result);
  if ((Object.hasOwn(MUTATIONS, command) || ['catalog-upload', 'catalog-import'].includes(command)) &&
      result?.state !== 'COMPLETE') {
    const error = new CatalogCommandError(result?.error?.code ?? 'CATALOG_OPERATION_PENDING',
      result?.error?.message ?? 'The original operation is retained with state ' + (result?.state ?? 'UNKNOWN') + '.');
    error.requestId = result?.id; error.state = result?.state; throw error;
  }
  return result;
}
if (process.argv[1] && await realpath(resolve(process.argv[1])).then(
  path => pathToFileURL(path).href === import.meta.url, () => false))
  main().catch(error => {
    process.stderr.write(JSON.stringify({ error: error.code ?? 'CATALOG_COMMAND_FAILED', message: error.message,
      ...(error.requestId ? { requestId: error.requestId } : {}), ...(error.state ? { state: error.state } : {}),
      ...(error.cleanup ? { cleanup: error.cleanup } : {}) }) + '\n');
    process.exitCode = 1;
  });
