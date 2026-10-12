// MIT. Retained CKAN edition -> original SF61/SF82 seller -> original SF88 buyer.
import { mkdir, rename, rm, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { buildDatasetSellerConfig, datasetQueryParameters } from '../../dataset-cli.mjs';
import { loadDatasetConfig } from '../../dataset-handler.mjs';
import { readDatasetBuyerOffer, prepareDatasetBuyer } from '../../dataset-refresh/buyer-handoff.mjs';
import { importOpenApi } from '../../../sf61-openapi-seller-import/importer.mjs';
import { createSellerServiceConfig } from '../../../sf61-openapi-seller-import/service-config.mjs';
import { readReleaseState, stageRelease } from '../../../sf82-seller-pilot/releases.mjs';
import { readCkanSourceFile } from '../declaration.mjs';
import { readCkanCapture } from '../capture.mjs';
import { projectCkanSemantics } from '../semantics.mjs';
import { captureMember } from './driver.mjs';
import { inspectCkanMerchantFiles } from './handler-runtime.mjs';
import { object, absolute, bytes, digest, createFile, privateDirectory, readPrivate,
  syncDirectory, fault } from '../../postgres/publisher/files.mjs';

const HASH = /^[a-f0-9]{64}$/;
const only = (value, keys, code) => {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) throw fault(code);
};
const manifestName = 'merchant-manifest.json';
function handlerEntry(manifestSha256, runtimeSha256) {
  // Relative files only: the copied package can be staged on another host.
  return '// MIT. Pinned CKAN merchant entry for the original SF82 handler interface.\n' +
    "import { readFile } from 'node:fs/promises';\n" +
    "import { createHash } from 'node:crypto';\n" +
    "import { fileURLToPath } from 'node:url';\n" +
    "const runtime = new URL('./runtime/handler-runtime.mjs', import.meta.url);\n" +
    "const source = await readFile(runtime);\n" +
    "if (createHash('sha256').update(source).digest('hex') !== " + JSON.stringify(runtimeSha256) +
    ") throw new Error('CKAN_MERCHANT_RUNTIME_CHANGED');\n" +
    "const { openCkanMerchantHandlers } = await import(runtime.href);\n" +
    "const handlers = await openCkanMerchantHandlers(fileURLToPath(new URL('.', import.meta.url)), " +
    JSON.stringify(manifestSha256) + ");\n" +
    "export const queryDataset = handlers.queryDataset;\n" +
    "export const admitDataset = handlers.admitDataset;\n";
}
function semanticBinding(semantics) {
  return { sha256: semantics.sha256, definitionSha256: semantics.definitionSha256,
    file: 'semantics.json', csvwFile: 'table-schema.json' };
}
function semanticResponseSchema(description, semantics) {
  const meanings = new Map(semantics.columns.map(column => [column.name, column]));
  const properties = Object.fromEntries(description.columns.map(column => {
    const meaning = meanings.get(column.name);
    return [column.name, { type: column.type, ...(column.nullable ? { nullable: true } : {}),
      ...(meaning ? { 'x-ckan-source-field': meaning.sourceField, 'x-ckan-encoding': meaning.encoding,
        'x-csvw-column': meaning.projectedDefinition } : {}) }];
  }));
  return { type: 'object', required: ['schema', 'dataset', 'fields', 'rows', 'page', 'semantics'],
    properties: {
      schema: { type: 'string', enum: ['stellar-forge.dataset-page.v1'] },
      dataset: { type: 'object' },
      fields: { type: 'array', items: { type: 'string', enum: description.columns.map(column => column.name) } },
      // The ordinary fields query can select a subset of these columns.
      rows: { type: 'array', items: { type: 'object', properties, additionalProperties: false } },
      page: { type: 'object' },
      semantics: { type: 'object', description: 'The full retained semantic document for the published dataset; fields selects the columns returned on this page.',
        required: ['schema', 'sha256', 'definitionSha256', 'source', 'columns', 'csvw'],
        properties: {
          schema: { type: 'string', enum: ['stellar-forge.ckan-semantics.v1'] },
          sha256: { type: 'string', enum: [semantics.sha256] },
          definitionSha256: { type: 'string', enum: [semantics.definitionSha256] },
          source: { type: 'object' }, columns: { type: 'array', items: { type: 'object' } },
          csvw: { type: 'object' },
        } },
    }, 'x-stellar-forge-ckan-semantics': semanticBinding(semantics) };
}
function reviewedMerchantSemantics(selected, capture, queryName, description) {
  const query = selected.queries[queryName], review = query?.semanticReview;
  if (review === undefined) return null;
  if (!object(review) || !HASH.test(review.sha256 ?? '') || !HASH.test(review.definitionSha256 ?? ''))
    throw fault('CKAN_SEMANTIC_REVIEW_REQUIRED');
  const reviewed = projectCkanSemantics(capture, query.projection);
  if (!reviewed || reviewed.sha256 !== review.sha256 || reviewed.definitionSha256 !== review.definitionSha256)
    throw fault('CKAN_SEMANTIC_REVIEW_CHANGED', 'Review this retained capture and source projection before exporting.', 409);
  // The accepted candidate may expose a subset of its source query, or narrow
  // nullable columns. Publish the meaning of the actual accepted CSV columns.
  const projection = Object.fromEntries(description.columns.map(column => {
    const source = query.projection[column.name];
    if (!source || source.type !== column.type) throw fault('CKAN_MERCHANT_COLUMN_CHANGED');
    return [column.name, { ...source, type: column.type, nullable: column.nullable }];
  }));
  const semantics = projectCkanSemantics(capture, projection);
  if (!semantics || !HASH.test(semantics.sha256 ?? '') || !HASH.test(semantics.definitionSha256 ?? ''))
    throw fault('CKAN_MERCHANT_SEMANTICS_INVALID');
  return { semantics, sourceSemanticReview: { sha256: review.sha256, definitionSha256: review.definitionSha256 } };
}
function inputs(description, payment, origin, path, capture, semantics) {
  const resource = origin + path;
  const parameters = datasetQueryParameters(description).map(parameter => ({
    name: parameter.name, in: 'query', required: false, description: parameter.description,
    schema: { type: parameter.type }, example: parameter.example,
  }));
  parameters.push({ name: 'snapshot', in: 'query', required: false,
    description: 'Select this retained edition by its immutable dataset snapshot.',
    schema: { type: 'string' }, example: description.snapshot });
  if (semantics) parameters.push({ name: 'semantics', in: 'query', required: false,
    description: 'Select the reviewed meaning for this capture and published projection. Omission selects the current meaning.',
    schema: { type: 'string' }, example: semantics.sha256 });
  if (parameters.length > 32)
    throw fault('CKAN_MERCHANT_QUERY_BUDGET_EXCEEDED', 'Select fewer filter/range capabilities; dataset queries, snapshot and reviewed semantics share the original 32-parameter offer budget.');
  const document = { openapi: '3.0.3', info: { title: description.name, version: description.snapshot },
    servers: [{ url: new URL('/', origin).href }], paths: { [path]: { get: {
      operationId: 'queryCkanDataset', summary: description.name,
      description: 'Retained CKAN DataStore edition from ' + capture.catalogOrigin +
        '; package ' + capture.packageId + '; resource ' + capture.resourceId +
        '. One paid request per page. Original publisher metadata and license are retained with the edition.',
      tags: ['dataset', 'ckan'], parameters,
      responses: { '200': { description: 'A page from the selected immutable dataset edition.',
        content: { 'application/json': { schema: semantics ? semanticResponseSchema(description, semantics) : { type: 'object' } } } } },
    } } } };
  const selections = [{ method: 'GET', path, serviceName: 'CKAN DataStore API', accepts: [payment] }];
  const bindings = [{ method: 'GET', path, id: 'ckan_dataset',
    handler: 'queryDataset', admit: 'admitDataset', validateInput: true }];
  // Compile the real offers and service bindings before writing an export.
  const imported = importOpenApi(document, selections);
  createSellerServiceConfig(imported, bindings);
  return { document, selections, bindings, resource };
}
function sourceMetadata(capture) {
  let raw = {};
  try {
    const source = capture.rawFiles.get(capture.manifest.packageFile);
    const envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(source));
    if (envelope.success === true && object(envelope.result)) raw = envelope.result;
  } catch { /* The verified original source bytes remain in the capture. */ }
  const keep = key => typeof raw[key] === 'string' ? raw[key] : null;
  return { catalogOrigin: capture.manifest.catalogOrigin, packageId: capture.manifest.packageId,
    resourceId: capture.manifest.resourceId, manifestSha256: capture.manifestSha256,
    rowCount: capture.manifest.rowCount, pageCount: capture.manifest.pages.length,
    title: keep('title'), publisher: object(raw.organization) ? raw.organization.title ?? raw.organization.name ?? null : null,
    license: { id: keep('license_id'), title: keep('license_title'), url: keep('license_url') },
    metadataModified: keep('metadata_modified') };
}
/** Export the exact reviewed candidate with its complete original capture.
 * The caller keeps the publisher open for this operation. No target is activated. */
export async function exportCkanMerchantPackage(options) {
  only(options, ['publisher', 'runId', 'directory', 'expectedCandidateDigest', 'payment', 'origin', 'path'],
    'CKAN_MERCHANT_OPTIONS_INVALID');
  const { publisher, runId, expectedCandidateDigest, payment, origin, path = '/data' } = options;
  const out = absolute(options.directory, 'merchant package directory');
  if (!publisher || typeof publisher.candidate !== 'function' || !HASH.test(expectedCandidateDigest ?? ''))
    throw fault('CKAN_MERCHANT_CANDIDATE_REQUIRED');
  const run = publisher.run(runId), plan = publisher.plan(run.plan);
  const current = await publisher.candidate(runId), candidate = current.manifest;
  if (candidate.candidateDigest !== expectedCandidateDigest || !['REVIEWED', 'PUBLISHED'].includes(run.state) ||
      run.data.review?.candidateDigest !== candidate.candidateDigest)
    throw fault('CKAN_MERCHANT_REVIEW_CHANGED', 'Review this exact retained candidate before exporting its merchant package.', 409);
  const seller = await buildDatasetSellerConfig(current.dataset, { payment, origin, path });
  const sourceDirectory = join(publisher.directory, 'plans', plan.folder);
  const selected = await readCkanSourceFile(join(sourceDirectory, 'source.json'));
  const capture = await readCkanCapture(selected.captureFile, selected.config.connection.sha256);
  if (capture.manifestSha256 !== plan.data.retainedCapture?.manifestSha256 ||
      capture.manifest.catalogOrigin !== selected.config.catalogOrigin ||
      capture.manifest.packageId !== selected.config.packageId || capture.manifest.resourceId !== selected.config.resourceId)
    throw fault('CKAN_MERCHANT_CAPTURE_CHANGED');
  const metadata = sourceMetadata(capture);
  const meaning = reviewedMerchantSemantics(selected, capture, plan.data.query, candidate.dataset);
  const generated = inputs(candidate.dataset, payment, seller.publicOrigin, path, metadata, meaning?.semantics);
  const csv = await readPrivate(join(dirname(current.configPath), 'data.csv'), plan.data.extraction.maxBytes);
  if (digest(csv) !== candidate.csvHash || csv.length !== candidate.csvBytes)
    throw fault('CKAN_MERCHANT_CANDIDATE_CHANGED');
  const datasetConfig = await readPrivate(current.configPath, 65536);
  if (digest(datasetConfig) !== candidate.configHash) throw fault('CKAN_MERCHANT_CANDIDATE_CHANGED');
  if (meaning) {
    const pageBudget = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(datasetConfig)).maxPageBytes ?? 921600;
    if (Buffer.byteLength(JSON.stringify({ semantics: meaning.semantics })) >= pageBudget)
      throw fault('CKAN_SEMANTICS_PAGE_TOO_LARGE', 'The selected semantic document exceeds the original page budget. Review a smaller publication projection.', 413);
  }
  const source = structuredClone(selected.config); source.connection.file = 'capture/capture.json';
  const fileMap = new Map([
    ['data.csv', csv], ['dataset.json', datasetConfig], ['source.json', bytes(source)],
    ['original-source.json', await readPrivate(join(sourceDirectory, 'original-source.json'))],
    ['reviewed-plan.json', bytes(plan.data)], ['candidate.json', bytes(candidate)],
    ['review.json', bytes(run.data.review)], ['openapi.json', bytes(generated.document)],
    ['selections.json', bytes(generated.selections)], ['route-bindings.json', bytes(generated.bindings)],
    ['capture/capture.json', capture.manifestBytes],
    ['runtime/dataset-handler.mjs', await readFile(new URL('../../dataset-handler.mjs', import.meta.url))],
    ['runtime/handler-runtime.mjs', await readFile(new URL('./handler-runtime.mjs', import.meta.url))],
  ]);
  if (meaning) {
    fileMap.set('semantics.json', bytes(meaning.semantics));
    fileMap.set('table-schema.json', bytes(meaning.semantics.csvw));
  }
  for (const [name, content] of capture.rawFiles) fileMap.set('capture/' + captureMember(name), content);
  const manifest = { schema: 'stellar-forge.ckan-merchant-package.v1', createdAt: new Date().toISOString(),
    resource: generated.resource, publicOrigin: seller.publicOrigin, path,
    dataset: candidate.dataset, capture: metadata,
    ...(meaning ? { semantics: semanticBinding(meaning.semantics), sourceSemanticReview: meaning.sourceSemanticReview } : {}),
    candidate: { runId, candidateDigest: candidate.candidateDigest, planDigest: candidate.planDigest,
      csvHash: candidate.csvHash, configHash: candidate.configHash },
    review: { id: run.data.review.id, reviewer: run.data.review.reviewer, recordedAt: run.data.review.recordedAt },
    files: [...fileMap].map(([file, content]) => ({ file, bytes: content.length, sha256: digest(content) }))
      .sort((a, b) => a.file.localeCompare(b.file)) };
  const manifestBytes = bytes(manifest), manifestSha256 = digest(manifestBytes);
  const entry = Buffer.from(handlerEntry(manifestSha256, digest(fileMap.get('runtime/handler-runtime.mjs'))));
  await mkdir(out, { mode: 0o700 });
  await privateDirectory(out);
  for (const [name, content] of fileMap) {
    const parent = dirname(join(out, name));
    if (parent !== out) await privateDirectory(parent, true);
    await createFile(join(out, name), content);
  }
  await createFile(join(out, manifestName), manifestBytes);
  await createFile(join(out, 'handlers.mjs'), entry);
  await syncDirectory(out);
  return { directory: out, manifestSha256, handlerSha256: digest(entry),
    resource: generated.resource, dataset: candidate.dataset, capture: metadata,
    ...(meaning ? { semantics: manifest.semantics, sourceSemanticReview: manifest.sourceSemanticReview } : {}),
    files: manifest.files.length + 2 };
}
export async function inspectCkanMerchantPackage(directory, expectedManifestSha256) {
  const retained = await inspectCkanMerchantFiles(directory, expectedManifestSha256);
  const runtime = retained.manifest.files.find(file => file.file === 'runtime/handler-runtime.mjs');
  const entry = await readPrivate(join(retained.directory, 'handlers.mjs'), 65536);
  if (!entry.equals(Buffer.from(handlerEntry(retained.manifestSha256, runtime.sha256))))
    throw fault('CKAN_MERCHANT_ENTRY_CHANGED');
  const dataset = await loadDatasetConfig(join(retained.directory, 'dataset.json'));
  if (dataset.describe().snapshot !== retained.manifest.dataset.snapshot ||
      dataset.describe().rowCount !== retained.manifest.dataset.rowCount)
    throw fault('CKAN_MERCHANT_DATASET_CHANGED');
  return { ...retained, handlerSha256: digest(entry), handlerBytes: entry };
}
async function retainPackage(root, original) {
  const base = join(root, 'ckan-packages');
  await privateDirectory(base, true);
  const destination = join(base, original.manifestSha256);
  try { return await inspectCkanMerchantPackage(destination, original.manifestSha256); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = join(base, '.copy-' + randomUUID());
  await mkdir(temporary, { mode: 0o700 });
  let moved = false;
  try {
    for (const file of original.manifest.files) {
      const content = await readPrivate(join(original.directory, file.file), file.bytes);
      if (content.length !== file.bytes || digest(content) !== file.sha256) throw fault('CKAN_MERCHANT_FILE_CHANGED');
      const parent = dirname(join(temporary, file.file));
      if (parent !== temporary) await privateDirectory(parent, true);
      await createFile(join(temporary, file.file), content);
    }
    await createFile(join(temporary, manifestName), original.manifestBytes);
    await createFile(join(temporary, 'handlers.mjs'), original.handlerBytes);
    await syncDirectory(temporary);
    await inspectCkanMerchantPackage(temporary, original.manifestSha256);
    try { await rename(temporary, destination); moved = true; }
    catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
      await inspectCkanMerchantPackage(destination, original.manifestSha256);
    }
    await syncDirectory(base);
    return await inspectCkanMerchantPackage(destination, original.manifestSha256);
  } finally { if (!moved) await rm(temporary, { recursive: true, force: true }); }
}
/** Copy the full edition into the existing SF82 store, then use its original
 * OpenAPI/handler stage operation. Starting and selecting remain SF82 operations. */
export async function stageCkanMerchantRelease(root, options) {
  only(options, ['packageDirectory', 'expectedManifestSha256', 'id', 'label', 'runtime'], 'CKAN_RELEASE_OPTIONS_INVALID');
  root = absolute(resolve(root), 'release store directory');
  await readReleaseState(root);
  if (options.runtime && (options.runtime.handlers || options.runtime.upstreams || options.runtime.allowLoopbackUpstream))
    throw fault('CKAN_RELEASE_HANDLERS_OWNED');
  const original = await inspectCkanMerchantPackage(options.packageDirectory, options.expectedManifestSha256);
  const retained = await retainPackage(root, original);
  const release = await stageRelease(root, {
    id: options.id, label: options.label,
    spec: join(retained.directory, 'openapi.json'), config: join(retained.directory, 'selections.json'),
    bindings: join(retained.directory, 'route-bindings.json'),
    runtime: { ...(options.runtime ?? {}), handlers: join(retained.directory, 'handlers.mjs') },
  });
  return { release, packageDirectory: retained.directory, manifestSha256: retained.manifestSha256,
    resource: retained.manifest.resource, dataset: retained.manifest.dataset, capture: retained.manifest.capture,
    ...(retained.manifest.semantics ? { semantics: retained.manifest.semantics,
      sourceSemanticReview: retained.manifest.sourceSemanticReview } : {}) };
}
export async function readCkanMerchantBuyerOffer(options) {
  only(options, ['packageDirectory', 'expectedManifestSha256', 'seller', 'query'], 'CKAN_BUYER_OPTIONS_INVALID');
  const retained = await inspectCkanMerchantPackage(options.packageDirectory, options.expectedManifestSha256);
  const semantics = retained.manifest.semantics;
  let query = options.query ?? '';
  if (semantics) {
    if (typeof query !== 'string' || query.length > 8192)
      throw fault('BUYER_SELECTION_REQUIRED', 'Select a published edition and its first-page query.');
    const selected = new URL(retained.manifest.resource); selected.search = query;
    const parameters = selected.searchParams, requested = parameters.getAll('semantics');
    if (requested.length > 1 || requested.length === 1 && requested[0] !== semantics.sha256)
      throw fault('CKAN_SEMANTICS_CHANGED', 'Select the reviewed meaning of this merchant package.', 409);
    parameters.delete('semantics');
    query = parameters.toString();
  }
  // Reuse the original snapshot, route, payment and dataset-query checks.
  const review = await readDatasetBuyerOffer({ seller: options.seller, resource: retained.manifest.resource,
    snapshot: retained.manifest.dataset.snapshot, query });
  if (!semantics) return review;
  const bazaar = review.offer.extensions?.bazaar;
  const advertised = bazaar?.schema?.properties?.input?.properties?.queryParams;
  if (advertised?.properties?.semantics?.type !== 'string' ||
      advertised.required?.includes('semantics') ||
      Object.hasOwn(advertised.properties.semantics, 'default') ||
      bazaar?.info?.input?.queryParams?.semantics !== semantics.sha256)
    throw fault('CKAN_SEMANTICS_NOT_ADVERTISED', 'Activate the release advertising this exact reviewed semantic digest, then reload its offer.', 409);
  const url = new URL(review.url); url.searchParams.set('semantics', semantics.sha256);
  return { ...review, url: url.href, query: url.searchParams.toString(),
    semantics: { ...semantics }, sourceSemanticReview: { ...retained.manifest.sourceSemanticReview } };
}
export async function prepareCkanMerchantBuyer(options) {
  only(options, ['packageDirectory', 'expectedManifestSha256', 'seller', 'query',
    'intentId', 'acceptIndex', 'offerSha256', 'out'], 'CKAN_BUYER_OPTIONS_INVALID');
  const offer = await readCkanMerchantBuyerOffer({ packageDirectory: options.packageDirectory,
    expectedManifestSha256: options.expectedManifestSha256, seller: options.seller, query: options.query ?? '' });
  const prepared = { ...prepareDatasetBuyer(offer, {
    intentId: options.intentId, acceptIndex: options.acceptIndex, offerSha256: options.offerSha256 }),
    ...(offer.semantics ? { semantics: offer.semantics, sourceSemanticReview: offer.sourceSemanticReview } : {}) };
  if (options.out) {
    const out = absolute(options.out, 'buyer configuration file');
    await createFile(out, Buffer.from(prepared.configText));
    await syncDirectory(dirname(out));
    return { ...prepared, path: out };
  }
  return prepared;
}
