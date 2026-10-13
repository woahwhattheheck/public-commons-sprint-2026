#!/usr/bin/env node
// MIT. Prepare supplier document rows and use the maintained catalog workspace.
import { constants } from 'node:fs';
import { open, mkdir, lstat, link, unlink, realpath } from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { openDocumentWorkingRecord, applyDocumentDecision, resetDocumentDecision,
  prepareDocument, documentPreparationFiles } from './document-preparation.mjs';

const HELP = [
  'Supplier document preparation', '',
  'node catalog/document-cli.mjs inspect --input OBSERVATIONS_OR_WORKING_RECORD.json',
  'node catalog/document-cli.mjs export --input INPUT.json --output DIRECTORY',
  'node catalog/document-cli.mjs decide --input INPUT.json --sku EXACT_SKU',
  '  --decision DECISION.json --output NEW_WORKING_RECORD.json',
  'node catalog/document-cli.mjs restore-source --input INPUT.json --sku EXACT_SKU',
  '  --output NEW_WORKING_RECORD.json',
  'node catalog/document-cli.mjs intake --input INPUT.json --source SOURCE.json',
  '  --workspace PRIVATE_DIRECTORY --request-id ORIGINAL_OPERATION --title TITLE --tenant TENANT',
  '  [--plan PLAN.json] [--catalog CATALOG_ID --revision N] [--select yes]', '',
  'intake uses original catalog save, source upload, edition preview and optional selection.',
  'The same request prefix and same input resume the same operations.',
  'export writes all six complete files; existing identical files are accepted.',
  'decide preserves complete source and prior decisions; its JSON needs an operator note.',
  'Prices remain decimal strings. Native source format: json, rowsPath /products.', '',
].join('\n');
const optionsByCommand = {
  inspect: ['--input'], export: ['--input', '--output'],
  decide: ['--input', '--sku', '--decision', '--output'],
  'restore-source': ['--input', '--sku', '--output'],
  intake: ['--input', '--source', '--workspace', '--request-id', '--title', '--tenant',
    '--plan', '--catalog', '--revision', '--select'],
};
function fail(code, message) { const e = new Error(message); e.code = code; throw e; }
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function required(options, key) {
  if (typeof options[key] !== 'string' || !options[key].length) fail('DOCUMENT_OPTION_REQUIRED', 'Supply ' + key + '.');
  return options[key];
}
function parse(command, args) {
  if (!Object.hasOwn(optionsByCommand, command)) fail('DOCUMENT_COMMAND_INVALID', HELP);
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!optionsByCommand[command].includes(key) || Object.hasOwn(result, key) ||
        value === undefined || value.startsWith('--'))
      fail('DOCUMENT_OPTION_INVALID', 'Use the declared command options once each.');
    result[key] = value;
  }
  return result;
}
async function readOriginal(path, maximum = 64 * 1024 * 1024) {
  const file = await open(resolve(path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.size < 1n || before.size > BigInt(maximum))
      fail('DOCUMENT_INPUT_INVALID', 'Choose a regular nonempty UTF-8 source file within 64 MiB.');
    const bytes = await file.readFile(), after = await file.stat({ bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs)
      fail('DOCUMENT_INPUT_CHANGED', 'The source changed while it was being read.');
    let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { fail('DOCUMENT_UTF8_REQUIRED', 'The source must contain valid UTF-8 text.'); }
    return { value: JSON.parse(text), bytes: bytes.length, sha256: hash(bytes) };
  } finally { await file.close(); }
}
async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const s = await lstat(path);
  if (!s.isDirectory() || s.isSymbolicLink()) fail('DOCUMENT_OUTPUT_INVALID', 'Use a regular output directory.');
}
async function writeComplete(path, content) {
  const destination = resolve(path), parent = dirname(destination), bytes = Buffer.from(content);
  await privateDirectory(parent);
  const temporary = join(parent, '.' + basename(destination) + '.' + randomUUID() + '.part');
  const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    try { await link(temporary, destination); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const existing = await open(destination, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const info = await existing.stat();
        if (!info.isFile() || info.size !== bytes.length || !(await existing.readFile()).equals(bytes))
          fail('DOCUMENT_OUTPUT_CONFLICT', 'Different content already occupies ' + destination + '. Choose a new output.');
      } finally { await existing.close(); }
    }
    const directory = await open(parent, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
    return { path: destination, bytes: bytes.length, sha256: hash(bytes) };
  } finally { await unlink(temporary).catch(() => {}); }
}
function completed(operation) {
  if (operation?.state !== 'COMPLETE') {
    const e = new Error(operation?.error?.message || 'The original catalog operation is ' + (operation?.state || 'UNKNOWN') + '.');
    e.code = operation?.error?.code || 'DOCUMENT_NATIVE_OPERATION_PENDING';
    e.requestId = operation?.id; e.state = operation?.state; throw e;
  }
  return operation.result;
}
async function intake(record, options, env) {
  const prefix = required(options, '--request-id');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,78}$/.test(prefix))
    fail('DOCUMENT_REQUEST_ID_INVALID', 'Use an original request prefix of at most 79 letters, digits, underscores or hyphens.');
  if (options['--select'] !== undefined && options['--select'] !== 'yes')
    fail('DOCUMENT_SELECT_INVALID', 'Use --select yes to select the prepared complete edition.');
  if (Boolean(options['--catalog']) !== Boolean(options['--revision']))
    fail('DOCUMENT_REVISION_REQUIRED', 'An existing catalog needs its original expected revision.');
  const revision = options['--revision'] === undefined ? undefined : Number(options['--revision']);
  if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1))
    fail('DOCUMENT_REVISION_INVALID', 'Use the selected positive catalog revision.');
  const title = required(options, '--title'), tenantId = required(options, '--tenant');
  const sourceFile = required(options, '--source'), directory = required(options, '--workspace');
  const prepared = prepareDocument(record);
  if (!prepared.rows.length) fail('DOCUMENT_EMPTY_EDITION', 'A full catalog needs at least one included product.');
  const file = documentPreparationFiles(record).find(f => f.name === 'Prepared_Catalogue.json');
  const bytes = Buffer.from(file.content), source = record.source.source_document;
  const { createOpenSearchWorkspace } = await import('../workspace/service.mjs');
  const workspace = await createOpenSearchWorkspace({ sourceFile, directory, planFile: options['--plan'], env });
  let result, failure;
  try {
    const saveRequest = { requestId: prefix + '-mapping', title, tenantId, mapping: prepared.mapping,
      ...(options['--catalog'] ? { catalogId: options['--catalog'], expectedRevision: revision } : {}) };
    const save = completed(await workspace.catalog.save(saveRequest)), catalog = save.catalog;
    const upload = completed(await workspace.catalog.upload({
      requestId: prefix + '-source', name: 'Prepared_Catalogue.json',
      bytes: bytes.length, sha256: hash(bytes), format: { kind: 'json', rowsPath: '/products' },
      provenance: { url: source.url, publisher: source.publisher, kind: 'prepared-supplier-document',
        revision: String(record.revision), note: 'Complete original observation bundle and operator revision history retained under preparation.' },
    }, [bytes]));
    const preview = completed(await workspace.catalog.preview({
      requestId: prefix + '-edition', catalogId: catalog.id, expectedRevision: catalog.revision,
      sourceId: upload.source.id, mode: 'full', baseEditionId: catalog.activeEditionId ?? null,
    }));
    let selected = null;
    if (options['--select'] === 'yes')
      selected = completed(await workspace.catalog.select({ requestId: prefix + '-select',
        catalogId: catalog.id, expectedRevision: catalog.revision, editionId: preview.edition.id,
        reviewSha256: preview.edition.reviewSha256 }));
    result = { schema: 'stellar-forge.document-catalog-intake.v1', workspaceId: workspace.store.id,
      requestPrefix: prefix, catalog: selected?.catalog || catalog, source: upload.source,
      edition: preview.edition, selected: Boolean(selected), summary: prepared.summary,
      requestIds: [prefix + '-mapping', prefix + '-source', prefix + '-edition', ...(selected ? [prefix + '-select'] : [])] };
  } catch (error) { failure = error; }
  finally {
    try { await workspace.close(); } catch (error) {
      if (failure) failure.cleanup = { code: error.code, message: error.message };
      else failure = error;
    }
  }
  if (failure) throw failure;
  return result;
}
export async function main(args = process.argv.slice(2), { env = process.env, print = value =>
  process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n') } = {}) {
  if (!args.length || ['--help', '-h', 'help'].includes(args[0])) { await print(HELP); return null; }
  const [command, ...rest] = args, options = parse(command, rest);
  const input = await readOriginal(required(options, '--input')), record = openDocumentWorkingRecord(input.value);
  let result;
  if (command === 'inspect') {
    const prepared = prepareDocument(record);
    result = { source: record.source.source_document, summary: prepared.summary, review: prepared.review,
      input: { bytes: input.bytes, sha256: input.sha256 } };
  } else if (command === 'export') {
    const output = resolve(required(options, '--output')); await privateDirectory(output);
    const files = [];
    for (const file of documentPreparationFiles(record)) files.push(await writeComplete(join(output, file.name), file.content));
    result = { output, summary: prepareDocument(record).summary, files };
  } else if (command === 'decide' || command === 'restore-source') {
    const sku = required(options, '--sku');
    const next = command === 'decide'
      ? applyDocumentDecision(record, sku, (await readOriginal(required(options, '--decision'), 131072)).value)
      : resetDocumentDecision(record, sku);
    result = { ...await writeComplete(required(options, '--output'), JSON.stringify(next, null, 2) + '\n'),
      summary: prepareDocument(next).summary };
  } else result = await intake(record, options, env);
  await print(result); return result;
}
if (process.argv[1] && await realpath(resolve(process.argv[1])).then(
  path => pathToFileURL(path).href === import.meta.url, () => false))
  main().catch(error => { process.stderr.write(JSON.stringify({ error: error.code || 'DOCUMENT_COMMAND_FAILED',
    message: error.message, ...(error.requestId ? { requestId: error.requestId, state: error.state } : {}),
    ...(error.cleanup ? { cleanup: error.cleanup } : {}) }) + '\n'); process.exitCode = 1; });
