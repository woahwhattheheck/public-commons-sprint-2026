// MIT. Original managed application operations and complete data-edition receiving.
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { absolute, digest, need, plain, readJSON, operationId, id, sha, label, member,
  exists, directory, hashObject, regular, openSnapshot } from '../files.mjs';

import { previewApplicationEditionSource } from './source.mjs';

const EDITION = 'stellar-forge.ruby-application-data-edition.v1';
const SOURCE = 'stellar-forge.ruby-application-data-source.v1';
const REVIEW = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const FAILED = new Set(['FAILED','INTERRUPTED','CANCELLED']);
function object(value, keys) {
  need(plain(value) && Object.keys(value).every(key => keys.includes(key)), 'RUBY_EDITION_ARGUMENTS');
}
function reviewId(value) {
  need(typeof value === 'string' && REVIEW.test(value), 'RUBY_EDITION_REVIEW_ID_INVALID');
  return value;
}
function actor(value) {
  need(typeof value === 'string' && value.trim() && Buffer.byteLength(value) <= 512 && !value.includes('\0'),
    'RUBY_EDITION_ACTOR_REQUIRED');
  return value;
}
function page(value, fallback, maximum) {
  value ??= fallback;
  need(Number.isSafeInteger(value) && value >= 0 && value <= maximum, 'RUBY_EDITION_PAGE');
  return value;
}
function descriptor(value) {
  need(plain(value) && typeof value.name === 'string' && Number.isSafeInteger(value.bytes) &&
    value.bytes >= 0 && /^[a-f0-9]{64}$/.test(value.sha256), 'RUBY_EDITION_FILE_CHANGED');
  member(value.name);
  return value;
}

/** The enclosing runtime owns admission, process leases, cancellation and close. */
export function applicationEditionMethods({
  root, appSelection, selected, envPath, selectionAdmission, admit, spawnWorker, operation, operationsFor,
}) {
  const base = app => join(app.directory, 'data-editions');
  const place = (app, value) => join(base(app), id(value));
  const reviewRoot = (app, record) => join(app.directory, 'operator', digest(record.tenantKey));
  async function original(value, editionId) {
    const app = await appSelection(id(value));
    const path = place(app, editionId);
    const record = await readJSON(join(path, 'selection.json'));
    const { sha256, ...body } = record;
    need(record.schema === EDITION && record.id === editionId && hashObject(body) === sha256 &&
      record.originalApplicationManifestSha256 === app.source.manifest.sha256 &&
      typeof record.tenantKey === 'string' && typeof record.sourceKey === 'string' &&
      plain(record.source) && ['native','baserow'].includes(record.source.format) &&
      /^[a-f0-9]{64}$/.test(record.source.manifestSha256), 'RUBY_EDITION_SELECTION_CHANGED', undefined, 409);
    const source = await readJSON(join(path, 'source.json'), true);
    if (source) need(source.schema === SOURCE && source.selectionSha256 === record.sha256 &&
      source.format === record.source.format && source.manifestSha256 === record.source.manifestSha256 &&
      Array.isArray(source.files) && source.files.every(file => descriptor(file)),
      'RUBY_EDITION_SOURCE_CHANGED', undefined, 409);
    return { app, path, record, source };
  }
  async function nativeReview(context, value) {
    reviewId(value);
    const { app, record, source } = context;
    need(source, 'RUBY_EDITION_SOURCE_INCOMPLETE', undefined, 409);
    const path = join(reviewRoot(app, record), value);
    const selection = await readJSON(join(path, 'selection.json'));
    need(selection.id === value && selection.tenant_key === record.tenantKey &&
      selection.candidate?.id === 'data-edition-' + record.id &&
      selection.candidate.manifest_sha256 === source.manifestSha256 &&
      selection.candidate.format === source.format && typeof selection.operation_key === 'string',
      'RUBY_EDITION_REVIEW_CHANGED', undefined, 409);
    const review = await readJSON(join(path, 'review.json'), true);
    const approval = await readJSON(join(path, 'approval.json'), true);
    const committed = await readJSON(join(path, 'committed.json'), true);
    const state = await readJSON(join(path, 'state.json'), true);
    if (review) need(review.id === value && review.schema === 'stellar-forge.dataset-operator-review.v1' &&
      review.summary?.binding?.source?.manifest_sha256 === source.datasetManifestSha256 &&
      Array.isArray(review.files) && review.files.every(file => descriptor(file)),
      'RUBY_EDITION_REVIEW_CHANGED', undefined, 409);
    if (committed) need(committed.id === value &&
      committed.receipt?.manifest_sha256 === source.datasetManifestSha256 &&
      committed.receipt?.source_sha256 === source.sourceSha256 &&
      committed.receipt?.operation_sha256 === digest(selection.operation_key) &&
      committed.receipt?.preview_sha256 === review?.summary?.preview_sha256 &&
      descriptor(committed.file), 'RUBY_EDITION_RECEIPT_CHANGED', undefined, 409);
    return { id: value, directory: path, selection, review, approval, committed,
      state: state ?? { phase: 'selected' } };
  }
  async function reviews(context) {
    const path = reviewRoot(context.app, context.record);
    if (!await exists(path)) return [];
    await directory(path);
    const result = [];
    for (const name of (await readdir(path)).sort()) {
      if (!REVIEW.test(name)) continue;
      const selection = await readJSON(join(path,name,'selection.json'), true);
      if (selection?.candidate?.id === 'data-edition-' + context.record.id)
        result.push(await nativeReview(context,name));
    }
    return result;
  }
  async function editionOperation(input, command) {
    const common = ['id','editionId','reviewId','operationId','actor'];
    object(input, command === 'stage' ? [...common,'title','format','directory','expectedManifestSha256'] :
      command === 'commit' ? [...common,'expectedPreviewSha256'] : common);
    const app = await appSelection(id(input.id));
    id(input.editionId); reviewId(input.reviewId); operationId(input.operationId); actor(input.actor);
    const parameters = { command, editionId: input.editionId, reviewId: input.reviewId, actor: input.actor };
    if (command === 'stage') {
      label(input.title); absolute(input.directory); sha(input.expectedManifestSha256);
      need(['native','baserow'].includes(input.format), 'RUBY_EDITION_FORMAT');
      Object.assign(parameters, { title: input.title, format: input.format,
        directory: input.directory, expectedManifestSha256: input.expectedManifestSha256 });
    } else {
      await original(app.id, input.editionId);
      if (command === 'commit') parameters.expectedPreviewSha256 = sha(input.expectedPreviewSha256);
    }
    const observed = await selectionAdmission(app.environmentId, app.id, async () => {
      const environment = await selected(app.environmentId);
      need(environment.support.some(file => file.name === 'editions/native.rb'),
        'RUBY_EDITION_RUNTIME_SOURCE_REQUIRED',
        'Receive this application archive with the current runtime to adopt its data-edition support.', 409);
      need(await exists(join(envPath(app.environmentId),'installation.json')), 'RUBY_INSTALLATION_REQUIRED');
      const registered = await readJSON(join(root,'applications',app.id,'registered.json'));
      need(registered.applicationSha256 === app.sha256, 'RUBY_APPLICATION_CHANGED', undefined, 409);
      return admit({ environmentId: app.environmentId, applicationId: app.id, action: 'application-edition',
        operationId: input.operationId, parameters });
    });
    return FAILED.has(observed.phase) ? observed : spawnWorker(input.operationId);
  }
  async function applicationEdition({ id: value, editionId } = {}) {
    const context = await original(value, editionId);
    const retained = await reviews(context);
    const operations = [];
    for (const op of await operationsFor(context.app.environmentId, context.app.id)) {
      if (op.action !== 'application-edition') continue;
      const request = await readJSON(join(root,'operations',op.id,'request.json'));
      if (request.parameters.editionId === editionId) operations.push(op);
    }
    const complete = retained.filter(review => review.committed);
    const latest = complete.sort((a,b) => b.committed.receipt.revision - a.committed.receipt.revision)[0] ?? null;
    const active = operations.find(op => op.active || op.phase === 'QUEUED');
    const files = [
      { name: 'selection.json', scope: 'edition' },
      ...(context.source ? [{ name: 'source.json', scope: 'edition' },
        ...context.source.files.map(file => ({ ...file, name: 'source/' + file.name, scope: 'source' }))] : []),
      ...retained.flatMap(review => [
        ...(review.review?.files ?? []).map(file => ({ ...file, scope: 'review', reviewId: review.id })),
        ...(review.committed ? [{ ...review.committed.file, scope: 'review', reviewId: review.id }] : []),
      ]),
    ];
    return { schema: 'stellar-forge.ruby-application-edition-view.v1',
      applicationId: context.app.id, environmentId: context.app.environmentId,
      editionId, selection: context.record, selectionSha256: context.record.sha256,
      source: context.source, reviews: retained, operations, files,
      phase: active ? 'RUNNING' : latest ? 'COMMITTED' :
        retained.some(review => review.review) ? 'PREPARED' : context.source ? 'RECEIVED' : 'RECEIVING',
      latestCommitted: latest?.committed ?? null };
  }
  async function applicationEditions({ id: value, offset = 0, limit = 25 } = {}) {
    offset = page(offset,0,Number.MAX_SAFE_INTEGER); limit = page(limit,25,100);
    need(limit > 0,'RUBY_EDITION_PAGE');
    const app = await appSelection(id(value));
    const path = base(app);
    const names = [];
    if (await exists(path)) {
      await directory(path);
      for (const name of (await readdir(path)).sort()) {
        if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(name) &&
          await exists(join(path,name,'selection.json'))) names.push(name);
      }
    }
    const editions = [];
    for (const name of names.slice(offset,offset + limit))
      editions.push(await applicationEdition({id:value,editionId:name}));
    return { schema: 'stellar-forge.ruby-application-editions.v1', applicationId:value,
      offset,total:names.length,nextOffset:offset + editions.length < names.length ? offset + editions.length : null,editions };
  }
  async function openEditionFile({ id: value, editionId, reviewId: selectedReview, name } = {}) {
    member(name);
    const context = await original(value,editionId);
    let path, expected;
    if (selectedReview !== undefined) {
      const retained = await nativeReview(context,selectedReview);
      expected = name === 'receipt.json' ? retained.committed?.file :
        retained.review?.files.find(file => file.name === name);
      need(expected,'RUBY_EDITION_FILE_UNKNOWN',undefined,404);
      path = join(retained.directory,member(name));
    } else if (name === 'selection.json' || name === 'source.json') {
      path = join(context.path,name);
      const bytes = await regular(path,64 * 1024 * 1024);
      expected = {name,bytes:bytes.length,sha256:digest(bytes)};
    } else if (name.startsWith('source/')) {
      expected = context.source?.files.find(file => file.name === name.slice(7));
      need(expected,'RUBY_EDITION_FILE_UNKNOWN',undefined,404);
      path = join(context.path,'source',member(expected.name));
    } else need(false,'RUBY_EDITION_FILE_UNKNOWN',undefined,404);
    const handle = await openSnapshot(path,expected,context.path);
    return {handle,name,bytes:expected.bytes,sha256:expected.sha256,
      type:name.endsWith('.csv') ? 'text/csv; charset=utf-8' :
        name.endsWith('.json') || name.endsWith('.jsonl') ? 'application/json' : 'application/octet-stream'};
  }
  return {
    stageApplicationEdition: input => editionOperation(input,'stage'),
    prepareApplicationEdition: input => editionOperation(input,'prepare'),
    commitApplicationEdition: input => editionOperation(input,'commit'),
    previewApplicationEditionSource, applicationEdition, applicationEditions, openEditionFile,
  };
}
