// MIT. One original public-source -> reviewed dataset -> reopened customer handoff.
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { bytes, createFile, readJson, hashPrivate, privateDirectory, fault } from '../../postgres/publisher/files.mjs';
import { discoverBaserowTable } from '../http.mjs';
import { captureBaserowSource, readBaserowCapture, copyBaserowCapture, bindBaserowCapture, exportBaserowAttachments } from '../capture.mjs';
import { readBaserowSourceFile } from '../declaration.mjs';
import { openBaserowPublisher } from '../publisher/model.mjs';
import { reviewBaserowDeployment, prepareBaserowDeployment, inspectBaserowDeployment, stageBaserowDeployment } from '../deployment.mjs';

const PUBLIC_GRID = 'https://baserow.io/public/grid/4si6SNrY_T9_ENsCPjjSr2LDynTxbDh7OkvLkQorPY8';
const PUBLIC_SLUG = '4si6SNrY_T9_ENsCPjjSr2LDynTxbDh7OkvLkQorPY8';
const ORIGINAL_STORAGE_ORIGIN = 'https://baserow-backend-production20240528124524339000000001.s3.amazonaws.com';
const HELP = 'One native Baserow customer journey (Node 24, Linux, util-linux flock)\n\n' +
  '  node examples/public-catalog.mjs --out NEW_PRIVATE_DIRECTORY --source-ref GIT_SHA\n' +
  '       [--capture ORIGINAL_BASEROW_CAPTURE.json] [--attachment-origin ORIGINAL_ORIGIN ...]\n' +
  '       [--terms ORIGINAL_PRIVATE_MERCHANT_TERMS.json [--runtime ORIGINAL_PRIVATE_RUNTIME.json]]\n\n' +
  'The default acquires the original first-party public software catalog and its original files.\n' +
  'An existing complete capture is copied byte-for-byte when --capture is supplied.\n' +
  'The original publisher reviews, publishes and reopens one private dataset version.\n' +
  'With actual supplied merchant terms, the original SF82 package/release is prepared and staged.\n' +
  'All original captures, CSV, file exports and native-result.json remain in the chosen directory.\n';
function argumentsFor(argv) {
  const values = {}, origins = [];
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (!['--out', '--source-ref', '--capture', '--attachment-origin', '--terms', '--runtime'].includes(key) ||
        key !== '--attachment-origin' && Object.hasOwn(values, key) || !argv[index + 1] || argv[index + 1].startsWith('--'))
      throw fault('BASEROW_EXAMPLE_OPTION_INVALID', HELP);
    const value = argv[++index];
    if (key === '--attachment-origin') origins.push(value); else values[key] = value;
  }
  if (!values['--out'] || !/^[a-f0-9]{40}$/.test(values['--source-ref'] ?? '') || values['--runtime'] && !values['--terms'])
    throw fault('BASEROW_EXAMPLE_OPTIONS_REQUIRED', HELP);
  return { directory: resolve(values['--out']), sourceRef: values['--source-ref'],
    captureFile: values['--capture'] ? resolve(values['--capture']) : null,
    termsFile: values['--terms'] ? resolve(values['--terms']) : null,
    runtimeFile: values['--runtime'] ? resolve(values['--runtime']) : null,
    origins: origins.length ? origins : [ORIGINAL_STORAGE_ORIGIN] };
}
function columnsFrom(fields) {
  const names = new Set(['record_id', 'source_order']), columns = {
    record_id: { source: '$recordId', type: 'string', encoding: 'identity-text' },
    source_order: { source: '$order', type: 'string', encoding: 'identity-text' } };
  const textTypes = new Set(['text', 'long_text', 'url', 'email', 'phone_number', 'number',
    'date', 'created_on', 'last_modified', 'uuid']);
  for (const field of fields) {
    let alias = field.name.normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
    if (!/^[a-z]/.test(alias)) alias = 'field_' + field.id;
    alias = alias.slice(0, 35);
    if (names.has(alias) || ['constructor', 'prototype', '__proto__'].includes(alias)) alias += '_' + field.id;
    if (alias.length > 48) throw fault('BASEROW_EXAMPLE_ALIAS_INVALID');
    names.add(alias);
    const type = field.type === 'boolean' ? 'boolean' : field.type === 'rating' ? 'integer' : 'string';
    const encoding = field.type === 'file' ? 'attachments' :
      textTypes.has(field.type) || ['boolean', 'rating'].includes(field.type) ? 'native' : 'json-text';
    columns[alias] = { source: 'field_' + field.id, providerType: field.type, type, encoding,
      nullable: true, empty: 'null' };
  }
  if (Object.keys(columns).length > 64) throw fault('BASEROW_EXAMPLE_FIELD_LIMIT');
  return columns;
}
function originalPublicOrder(view) {
  if (!Array.isArray(view.sortings)) throw fault('BASEROW_EXAMPLE_SORTINGS_MISSING');
  return view.sortings.map(item => {
    if (!Number.isSafeInteger(item.field) || item.field < 1 || !['ASC', 'DESC'].includes(item.order))
      throw fault('BASEROW_EXAMPLE_SORTING_INVALID');
    return { field: item.field, direction: item.order.toLowerCase() };
  });
}
export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') { process.stdout.write(HELP); return; }
  const options = argumentsFor(argv);
  await privateDirectory(dirname(options.directory));
  await mkdir(options.directory, { mode: 0o700 }); await privateDirectory(options.directory);
  const startedAt = new Date().toISOString();
  let publisher, stage = 'discovery';
  try {
    let discovery, capture, base;
    if (options.captureFile) {
      capture = await readBaserowCapture(options.captureFile);
      const selection = capture.manifest.selection;
      if (selection.kind !== 'public-grid' || selection.slug !== PUBLIC_SLUG || selection.attachments.mode !== 'retain')
        throw fault('BASEROW_EXAMPLE_ORIGINAL_CATALOG_REQUIRED');
      const fieldIds = new Set(selection.fields.map(item => item.id));
      discovery = { source: selection, title: capture.table.view.name, publicView: capture.table.view,
        fields: capture.table.fields.filter(item => fieldIds.has(item.id)), schemaSha256: capture.manifest.schemaSha256 };
      base = { schema: 'stellar-forge.baserow-source.v1', ...selection,
        connection: { kind: 'capture', file: options.captureFile, sha256: capture.manifestSha256 } };
      delete base.fields;
      if (base.attachments.mode === 'metadata') base.attachments = { mode: 'metadata' };
    } else {
      base = { schema: 'stellar-forge.baserow-source.v1', server: 'https://api.baserow.io', kind: 'public-grid',
        slug: PUBLIC_SLUG, orderBy: [], connection: { kind: 'rest', pageSize: 50, timeoutMs: 1800000,
          requestIntervalMs: 250, maxCaptureBytes: 268435456, maxRows: 100000 },
        attachments: { mode: 'retain', allowedOrigins: options.origins, maxFileBytes: 33554432, maxFiles: 10000 }, queries: {} };
      discovery = await discoverBaserowTable(base);
      base.orderBy = originalPublicOrder(discovery.publicView);
    }
    await createFile(join(options.directory, 'discovery.json'), bytes(discovery));
    const nativeFields = discovery.fields.map(field => field.metadata ?? field), columns = columnsFrom(nativeFields);
    const config = { ...base, queries: { catalog: { columns } } };
    await createFile(join(options.directory, 'reviewed-source.json'), bytes(config));
    const selected = await readBaserowSourceFile(join(options.directory, 'reviewed-source.json'));
    stage = 'complete-source-capture';
    if (capture) {
      bindBaserowCapture(capture, config); capture = await copyBaserowCapture(capture, join(options.directory, 'capture'));
    } else capture = await captureBaserowSource(config, join(options.directory, 'capture'));
    const frozen = { ...config, connection: { kind: 'capture', file: 'capture/capture.json', sha256: capture.manifestSha256 } };
    const sourceFile = join(options.directory, 'source.json');
    await createFile(sourceFile, bytes(frozen));
    const exact = await readBaserowSourceFile(sourceFile);
    const publisherDirectory = join(options.directory, 'publisher'), targetDirectory = join(options.directory, 'dataset');
    stage = 'original-publisher-extraction';
    publisher = await openBaserowPublisher({ directory: publisherDirectory, create: true, sourceFile, targetDirectory });
    const sortColumn = Object.keys(columns).find(name => name === 'name') ??
      Object.entries(columns).find(([name, spec]) => !['record_id', 'source_order'].includes(name) && spec.type === 'string')?.[0] ?? 'record_id';
    const plan = await publisher.savePlan({ title: 'Original Baserow public software catalog', query: 'catalog', input: {},
      sourceHash: exact.hash, dataset: { name: 'Baserow software catalog', columns: Object.fromEntries(
        Object.entries(columns).map(([name, spec]) => [name, { type: spec.type, nullable: spec.nullable ?? false }])),
        filters: [sortColumn], ranges: [], sorts: [sortColumn], defaultLimit: 50, maxLimit: 250, maxCellChars: 1048576 },
      extraction: { maxRows: 100000, maxBytes: 67108864, maxRowBytes: 8388608, timeoutMs: 300000,
        order: [{ column: sortColumn, direction: 'asc' }, { column: 'record_id', direction: 'asc' }].filter((item, index, list) =>
          list.findIndex(other => other.column === item.column) === index) } });
    const extraction = publisher.startExtraction(plan.id);
    const extracted = await extraction.completion;
    if (extracted.state !== 'READY') throw fault(extracted.data?.error ?? 'BASEROW_EXAMPLE_EXTRACTION_FAILED');
    const candidate = await publisher.candidate(extraction.id);
    if (candidate.manifest.dataset.rowCount !== capture.manifest.rowCount) throw fault('BASEROW_EXAMPLE_ROW_COUNT_CHANGED');
    stage = 'original-publication';
    const reviewed = await publisher.review(extraction.id, { reviewer: 'Commons native operator',
      note: 'Internal original-source demonstration: all visible catalog fields and complete files retained; explicit empty-to-null derivative columns; original source bytes preserved.',
      initialize: true });
    const published = await publisher.publish(extraction.id, reviewed.data.review.id);
    if (published.state !== 'PUBLISHED') throw fault(published.data?.error ?? 'BASEROW_EXAMPLE_PUBLICATION_FAILED');
    const originalSnapshot = published.data.publication.snapshot;
    await publisher.close(); publisher = null;
    stage = 'original-publication-reopen';
    publisher = await openBaserowPublisher({ directory: publisherDirectory });
    const recovered = await publisher.recover(extraction.id), current = await publisher.candidate(extraction.id);
    if (recovered.state !== 'PUBLISHED' || recovered.data.publication.snapshot !== originalSnapshot ||
        current.manifest.csvHash !== candidate.manifest.csvHash) throw fault('BASEROW_EXAMPLE_REOPEN_CHANGED');
    const preview = await publisher.inspect(extraction.id, 'limit=5');
    await createFile(join(options.directory, 'customer-preview.json'), bytes(preview.preview));
    stage = 'original-attachment-receiving';
    const delivered = await exportBaserowAttachments(capture.manifestFile, join(options.directory, 'customer-files'));
    for (const item of delivered.files) {
      const observed = await hashPrivate(join(delivered.directory, item.file), 33554432);
      if (observed.hash !== item.sha256 || observed.bytes !== item.bytes) throw fault('BASEROW_EXAMPLE_ATTACHMENT_RECEIVING_CHANGED');
    }
    let deployment = null;
    if (options.termsFile) {
      stage = 'original-merchant-deployment';
      const terms = await readJson(options.termsFile, 65536);
      const review = await reviewBaserowDeployment({ publisher, runId: extraction.id, terms });
      const prepared = await prepareBaserowDeployment({ publisher, runId: extraction.id, terms,
        expectedReviewSha256: review.reviewSha256, directory: join(options.directory, 'merchant-package') });
      const reopened = await inspectBaserowDeployment(prepared.packageDirectory);
      const staged = await stageBaserowDeployment({ packageDirectory: prepared.packageDirectory,
        releaseDirectory: join(options.directory, 'merchant-releases'), id: 'baserow-original-catalog',
        label: 'Original Baserow catalog', expectedSourceSha256: reopened.sourceSha256,
        runtime: options.runtimeFile ? await readJson(options.runtimeFile, 65536) : { port: 0 } });
      deployment = { review, prepared, reopened, staged };
      await createFile(join(options.directory, 'merchant-handoff.json'), bytes(deployment));
    }
    const result = { schema: 'stellar-forge.baserow-native-customer-journey.v1',
      operation: 'BASEROW-PUBLIC-CATALOG-CAPTURE-0D0B-20261012', state: 'COMPLETED',
      sourceRef: options.sourceRef, node: process.version, startedAt, completedAt: new Date().toISOString(),
      originalPublicSource: PUBLIC_GRID, directory: options.directory,
      source: { file: sourceFile, sha256: exact.hash, originalConfigSha256: selected.hash,
        captureFile: capture.manifestFile, captureSha256: capture.manifestSha256, rows: capture.manifest.rowCount,
        pages: capture.manifest.pageCount, sourceBytes: capture.manifest.sourceBytes,
        attachmentCount: capture.manifest.attachmentCount, attachmentBytes: capture.manifest.attachmentBytes,
        sourceSelectionSha256: capture.manifest.selectionSha256, schemaSha256: capture.manifest.schemaSha256 },
      publication: { publisherDirectory, targetDirectory, planId: plan.id, runId: extraction.id,
        state: recovered.state, snapshot: originalSnapshot, csvSha256: current.manifest.csvHash,
        csvBytes: current.manifest.csvBytes, rows: current.manifest.dataset.rowCount,
        originalCandidateDigest: current.manifest.candidateDigest, reopened: true },
      receiving: { preview: join(options.directory, 'customer-preview.json'), attachments: delivered.file,
        files: delivered.files.map(item => ({ file: item.file, bytes: item.bytes, sha256: item.sha256 })) },
      deployment: deployment ? { file: join(options.directory, 'merchant-handoff.json'),
        packageDirectory: deployment.prepared.packageDirectory, sourceSha256: deployment.reopened.sourceSha256,
        releaseId: deployment.staged.release.id } : null };
    await createFile(join(options.directory, 'native-result.json'), bytes(result));
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
  } catch (issue) {
    const result = { schema: 'stellar-forge.baserow-native-customer-journey.v1',
      operation: 'BASEROW-PUBLIC-CATALOG-CAPTURE-0D0B-20261012', state: 'FAILED', sourceRef: options.sourceRef,
      startedAt, stoppedAt: new Date().toISOString(), directory: options.directory, stage,
      code: issue.code ?? 'BASEROW_NATIVE_JOURNEY_FAILED', providerStatus: issue.providerStatus ?? null,
      retryAfter: issue.retryAfter ?? null };
    try { await createFile(join(options.directory, 'native-failure.json'), bytes(result)); } catch {}
    throw issue;
  } finally { await publisher?.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(issue => { process.stderr.write((issue.code ?? 'BASEROW_NATIVE_JOURNEY_FAILED') + '\n'); process.exitCode = 1; });
