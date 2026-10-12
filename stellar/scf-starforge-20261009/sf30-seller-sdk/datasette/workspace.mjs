// MIT. One operator workspace over retained Datasette sources and the original merchant publisher.
import { lstat, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  absolute, privateDirectory, acquireWorkspace, readJson, readPrivate, createFile,
  atomicJson, bytes, digest, identity, object, fault, stamp,
} from '../postgres/publisher/files.mjs';
import { captureDatasette, adoptDatasettePages, readDatasetteCapture, inspectDatasetteOperation } from './capture.mjs';
import {
  reviewDatasetteCapture, createDatasetteEdition, readDatasetteEdition,
  compareDatasetteEditions, exportDatasetteEdition, receiveDatasettePackage,
} from './editions.mjs';
import { isJsonNumber, numericToken, exactCell } from './json.mjs';
import { retainedDatasetteFiles } from './files.mjs';
import { openDatasetteRequests } from './requests.mjs';

export const DATASETTE_WORKSPACE_SCHEMA = 'stellar-forge.datasette-workspace.v1';
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAX_JSON = 64 * 1024 * 1024;
const descriptions = [
  ['source.capture', 'Capture a selected Datasette table or read-only query, continuing its original operation.', ['operationId', 'selection']],
  ['source.adopt', 'Receive original complete HTTP pages and their native request and response metadata.', ['operationId', 'selection', 'pages']],
  ['source.inspect', 'Read a retained capture and a page of its original exact source values.', ['operationId']],
  ['source.review', 'Review every source value, selected key and proposed column representation.', ['operationId']],
  ['editions.create', 'Save the complete reviewed capture as an immutable named source edition.', ['id', 'operationId', 'name', 'key', 'projection']],
  ['editions.list', 'List all complete named source editions in this workspace.', []],
  ['editions.inspect', 'Inspect one complete source edition and a page of its original values.', ['id']],
  ['editions.compare', 'Compare two retained editions using their reviewed source keys.', ['left', 'right']],
  ['source.select', 'Select an immutable source edition for the next original publisher plan.', ['editionId']],
  ['publisher.status', 'Read the maintained publisher plan, extraction and publication history.', []],
  ['publisher.source', 'Inspect the exact source declaration selected for the publisher.', []],
  ['publisher.target', 'Read the original versioned dataset target and its current revision.', []],
  ['publisher.plan', 'Save a source-bound plan in the maintained dataset publisher.', ['title']],
  ['publisher.extract', 'Run or reopen one original extraction by its caller-retained UUID.', ['planId', 'runId']],
  ['publisher.inspect', 'Inspect the original candidate and dataset preview.', ['runId']],
  ['publisher.review', 'Record the exact candidate and target revision reviewed for publication.', ['runId', 'reviewer', 'note']],
  ['publisher.publish', 'Publish the candidate using the current original review identifier.', ['runId', 'reviewId']],
  ['publisher.recover', 'Reconcile the original extraction or publication after a lost response.', ['runId']],
  ['publisher.buyer-offer', 'Read an offer for the original published snapshot and buyer resource.', ['runId']],
  ['publisher.prepare-buyer', 'Prepare the existing buyer configuration for that exact snapshot.', ['runId']],
  ['release.prepare', 'Prepare the complete original source and dataset release package.', ['runId', 'payment', 'origin']],
  ['release.stage', 'Stage that package in the maintained merchant release store.', ['packageDirectory', 'id']],
  ['source.export', 'Export a complete named edition, review and original capture for receiving.', ['editionId']],
  ['source.receive', 'Receive and verify a complete original source-edition package.', ['archiveFile', 'sha256']],
  ['files.list', 'List complete retained source, edition, publisher, customer and export files.', []],
  ['files.inspect', 'Read the exact identity and size of a retained file.', ['path']],
  ['files.read', 'Read a complete byte range of an identified original file.', ['path', 'sha256']],
  ['workspace.export', 'Export complete source editions, publisher history and customer work for independent receiving.', []],
  ['workspace.receive', 'Receive the complete archived workspace and its original history.', ['archiveFile', 'directory', 'sha256']],
  ['requests.inspect', 'Reopen the exact original operator request and its native result.', ['requestId']],
  ['requests.list', 'Read the paged original request history and pending outcomes.', []],
  ['operations.inspect', 'Reopen a saved source or publisher operation by its original identifier.', ['operationId']],
  ['operations.cancel', 'Cancel the currently running source capture or extraction.', ['operationId']],
];
export const DATASETTE_OPERATIONS = Object.freeze(descriptions.map(([operation, description, required]) =>
  Object.freeze({ operation, description, required: Object.freeze(required) })));
const known = new Set(DATASETTE_OPERATIONS.map(item => item.operation));

function identifier(value, label = 'identifier') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) || value === '.' || value === '..')
    throw fault('DATASETTE_IDENTIFIER_INVALID', 'Use a non-empty ' + label + ' containing letters, digits, dots, underscores or hyphens.');
  return value;
}
function text(value, label, maximum = 256) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum)
    throw fault('DATASETTE_TEXT_REQUIRED', 'Enter ' + label + '.');
  return value.trim();
}
async function exists(path) {
  try { await lstat(path); return true; }
  catch (issue) { if (issue.code === 'ENOENT') return false; throw issue; }
}
function pageOptions(input) {
  const offset = input.offset ?? 0, limit = input.limit ?? 50;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 250)
    throw fault('DATASETTE_PAGE_INVALID', 'Use a non-negative offset and a page size from 1 to 250.');
  return { offset, limit };
}
function kind(value) {
  if (value === null) return 'null';
  if (isJsonNumber(value)) return 'number';
  return Array.isArray(value) ? 'array' : typeof value;
}
/** HTTP projections keep numeric lexemes as strings; source readers keep native values. */
function captureView(value, input = {}) {
  const { offset, limit } = pageOptions(input);
  const selected = value.rows.slice(offset, offset + limit);
  return {
    captureFile: value.captureFile, captureSha256: value.captureSha256,
    capture: value.capture, columns: value.columns,
    rows: selected.map(row => row.map(cell => exactCell(cell))),
    cellTypes: selected.map(row => row.map(kind)),
    valueEncoding: 'exact-source-text-with-explicit-cell-types',
    page: { offset, limit, total: value.rows.length,
      next: offset + selected.length < value.rows.length ? offset + selected.length : null,
      previous: offset > 0 ? Math.max(0, offset - limit) : null },
  };
}
export function datasetteJsonReplacer(key, value) {
  const original = this && Object.hasOwn(this, key) ? this[key] : value;
  return isJsonNumber(original) ? { kind: 'number', value: numericToken(original) } : value;
}

export async function openDatasetteWorkspace({
  directory, create = false, seller, resource, environment = process.env,
} = {}) {
  directory = absolute(directory, 'Datasette workspace directory');
  await privateDirectory(directory, create);
  const releaseLock = await acquireWorkspace(directory);
  let closed = false, active = null, publisher = null, files = null, publisherTail = Promise.resolve(), closing = null;
  try {
    const settingsFile = join(directory, 'workspace.json');
    if (!await exists(settingsFile)) {
      if (!create) throw fault('DATASETTE_WORKSPACE_NOT_FOUND', 'Create the selected workspace before opening it.', 404);
      if ((seller === undefined) !== (resource === undefined))
        throw fault('DATASETTE_BUYER_BINDING_INCOMPLETE', 'Select both the original seller and resource.');
      const initial = { schema: DATASETTE_WORKSPACE_SCHEMA, workspaceId: randomUUID(), createdAt: stamp() };
      if (seller !== undefined) initial.buyer = { seller, resource };
      await createFile(settingsFile, bytes(initial));
    }
    const settings = await readJson(settingsFile, 16384);
    if (settings.schema !== DATASETTE_WORKSPACE_SCHEMA || !UUID.test(settings.workspaceId ?? ''))
      throw fault('DATASETTE_WORKSPACE_INVALID');
    if (seller !== undefined && (settings.buyer?.seller !== seller || settings.buyer?.resource !== resource))
      throw fault('DATASETTE_BUYER_BINDING_CHANGED', 'Open this workspace with its original seller and resource.', 409);
    for (const name of ['captures', 'editions', 'exports', 'imports'])
      await privateDirectory(join(directory, name), true);

    files = retainedDatasetteFiles({ directory, workspaceId: settings.workspaceId });
    const requests = await openDatasetteRequests({ directory, workspaceId: settings.workspaceId });
    const capturePath = operationId => join(directory, 'captures', identifier(operationId, 'capture operation'), 'capture.json');
    const editionPath = id => join(directory, 'editions', identifier(id, 'edition identifier'), 'edition.json');
    const selectedSource = join(directory, 'selected-source.json');
    const publisherDirectory = join(directory, 'publisher');
    const targetDirectory = join(directory, 'dataset');

    function ensureOpen() { if (closed) throw fault('DATASETTE_WORKSPACE_CLOSED'); }
    async function selected() {
      if (!await exists(selectedSource)) return null;
      const declaration = await readJson(selectedSource, 1024 * 1024);
      if (declaration.schema !== 'stellar-forge.datasette-source.v1' || !HASH.test(declaration.editionSha256 ?? ''))
        throw fault('DATASETTE_SOURCE_SELECTION_INVALID');
      return declaration;
    }
    async function listCaptures() {
      const items = [];
      for (const entry of await readdir(join(directory, 'captures'), { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(entry.name)) continue;
        const path = capturePath(entry.name);
        if (!await exists(path)) {
          items.push({ operationId: entry.name, state: 'INCOMPLETE', captureFile: path }); continue;
        }
        const original = await readPrivate(path, MAX_JSON), capture = JSON.parse(original.toString('utf8'));
        items.push({ operationId: entry.name, state: capture.state,
          captureFile: path, captureSha256: digest(original),
          startedAt: capture.startedAt, completedAt: capture.completedAt,
          rowCount: capture.rowCount, pageCount: capture.pageCount,
          selection: capture.selection, consistency: capture.consistency });
      }
      return items.sort((a, b) => (b.completedAt ?? b.startedAt ?? '').localeCompare(a.completedAt ?? a.startedAt ?? ''));
    }
    async function listEditions() {
      const items = [];
      for (const entry of await readdir(join(directory, 'editions'), { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(entry.name)) continue;
        const path = editionPath(entry.name);
        if (!await exists(path)) continue;
        const original = await readPrivate(path, MAX_JSON), edition = JSON.parse(original.toString('utf8'));
        items.push({ id: entry.name, editionFile: path, editionSha256: digest(original), edition });
      }
      return items.sort((a, b) => a.id.localeCompare(b.id));
    }
    async function withPublisher(action, { idleRead = false } = {}) {
      ensureOpen();
      const execute = async () => {
        ensureOpen();
        if (idleRead && active) return null;
        if (!await selected()) throw fault('DATASETTE_EDITION_SELECTION_REQUIRED', 'Select a saved source edition first.', 409);
        const { openDatasettePublisher } = await import('./model.mjs');
        const current = await openDatasettePublisher({
          directory: publisherDirectory, create: !await exists(join(publisherDirectory, 'workspace.json')),
          sourceFile: selectedSource, targetDirectory, environment,
          ...(settings.buyer ?? {}),
        });
        publisher = current;
        try { return await action(current); }
        finally { if (publisher === current) publisher = null; await current.close(); }
      };
      // Status and dispatch can arrive together. Serialize native publisher opens
      // and closes while allowing read-only status on the already open instance.
      const result = publisherTail.then(execute, execute);
      publisherTail = result.then(() => undefined, () => undefined);
      return result;
    }
    async function status() {
      ensureOpen();
      const [captures, editions, selection] = await Promise.all([listCaptures(), listEditions(), selected()]);
      let publication = null;
      if (publisher) publication = publisher.status();
      else if (!active && selection && await exists(join(publisherDirectory, 'workspace.json')) && !active)
        publication = await withPublisher(value => value.status(), { idleRead: true });
      return {
        schema: DATASETTE_WORKSPACE_SCHEMA, directory, workspaceId: settings.workspaceId,
        createdAt: settings.createdAt, buyer: settings.buyer ?? null,
        selection, selectionHash: requests.selectionHash(selection), captures, editions, publisher: publication,
        active: active ? { operation: active.operation, operationId: active.operationId, startedAt: active.startedAt } : null,
      };
    }
    function operations() { return DATASETTE_OPERATIONS; }


    async function prepareSelection(input) {
      const value = await readDatasetteEdition(editionPath(input.editionId));
      const declaration = { schema: 'stellar-forge.datasette-source.v1',
        edition: relative(directory,value.editionFile),editionSha256:value.editionSha256,
        query:identifier(input.query ?? 'data','query name') };
      const previous = await selected(), beforeHash = requests.selectionHash(previous);
      if (Object.hasOwn(input,'expectedSelectionHash') &&
          (!(input.expectedSelectionHash === null || HASH.test(input.expectedSelectionHash ?? '')) ||
           input.expectedSelectionHash !== beforeHash))
        throw fault('DATASETTE_SELECTION_CHANGED','Read the currently saved source selection before submitting a new choice.',409);
      return {declaration,declarationHash:requests.selectionHash(declaration),beforeHash};
    }
    async function preparePublisherPlan(value,input) {
          const source = await value.source(), queryName = input.query ?? 'data', query = source.queries[queryName];
          if (!query) throw fault('QUERY_NOT_FOUND');
          const selectedDeclaration = await selected();
          const edition = await readDatasetteEdition(resolve(directory, selectedDeclaration.edition),
            { expectedSha256: selectedDeclaration.editionSha256 });
          const types = edition.review.columnTypes;
          const columns = Object.fromEntries(types.map(field => [field.name, { type: field.type, nullable: field.nullable }]));
          const key = edition.review.key.columns.map(name =>
            Object.entries(edition.review.projection).find(([, field]) => field.column === name)?.[0]).filter(Boolean);
          const order = (key.length ? key : query.columns.slice(0, 1)).map(column => ({ column, direction: 'asc' }));
          const numeric = types.filter(field => ['integer', 'number'].includes(field.type)).map(field => field.name);
          const categorical = types.filter(field => ['string', 'boolean'].includes(field.type)).map(field => field.name);
          // The original dataset offer allows eight fields per capability group
          // and 32 total query parameters. All reviewed columns remain in the dataset.
          const dataset = input.dataset ?? { name: edition.edition.name, columns,
            filters: [...new Set([...key, ...categorical])].slice(0, 8),
            sorts: [...new Set([...key, ...numeric, ...categorical])].slice(0, 8),
            ranges: numeric.slice(0, 4) };
          return { title: text(input.title, 'a publication plan title', 128),
            query: queryName, input: input.input ?? {}, dataset,
            extraction: { order, ...(input.extraction ?? {}) }, sourceHash: input.sourceHash ?? source.hash };
    }
    async function prepareRequest(operation,input) {
      if (operation === 'source.select') return prepareSelection(input);
      if (operation === 'publisher.plan') return {nativeInput:await withPublisher(value => preparePublisherPlan(value,input))};
      return {};
    }

    async function execute(operation, input, controller, request = null) {
      if (operation === 'requests.inspect') return requests.inspect(input);
      if (operation === 'requests.list') return requests.list(input);
      if (operation === 'files.list') return files.list(input);
      if (operation === 'files.inspect') return files.inspect(input);
      if (operation === 'files.read') return files.read(input);
      if (operation === 'workspace.export') {
        const { exportDatasetteWorkspace } = await import('./archive.mjs');
        const outputFile = input.outputFile === undefined ? join(directory, 'exports', 'workspace-' + randomUUID() + '.zip') : absolute(input.outputFile, 'workspace archive file');
        const result = await exportDatasetteWorkspace({ directory, workspace: { directory, workspaceId: settings.workspaceId }, outputFile });
        if (outputFile.startsWith(directory + '/')) result.retainedFile = await files.inspect({ path: files.relativeName(result.archiveFile ?? outputFile), sha256: result.sha256 });
        return result;
      }
      if (operation === 'workspace.receive') {
        const { receiveDatasetteWorkspace } = await import('./archive.mjs');
        return receiveDatasetteWorkspace({ archiveFile: absolute(input.archiveFile, 'workspace archive'), directory: absolute(input.directory, 'received workspace directory'), sha256: input.sha256 });
      }
      if (operation === 'operations.inspect') {
        const id = identifier(input.operationId, 'saved operation');
        const sourceDirectory = join(directory, 'captures', id);
        if (await exists(join(sourceDirectory, 'operation.json'))) return inspectDatasetteOperation(sourceDirectory);
        if (UUID.test(id)) {
          if (publisher) return { run: publisher.run(id) };
          const result = await withPublisher(value => ({ run: value.run(id) }), { idleRead: true });
          if (!result) throw fault('DATASETTE_WORKSPACE_BUSY', 'Read workspace status while its current operation completes.', 409);
          return result;
        }
        throw fault('DATASETTE_OPERATION_NOT_FOUND', 'Choose a saved source operation or extraction.', 404);
      }
      if (operation === 'source.capture' || operation === 'source.adopt') {
        const operationId = identifier(input.operationId, 'capture operation');
        const options = { directory: join(directory, 'captures', operationId), operationId,
          selection: input.selection, signal: controller.signal };
        const result = operation === 'source.adopt' ?
          await adoptDatasettePages({ ...options, pages: input.pages }) :
          await captureDatasette({ ...options, ...(input.pageLimit === undefined ? {} : { pageLimit: input.pageLimit }) });
        // A completed retry returns the same operation receipt. Read full rows
        // through source.inspect so replay never sends the whole dataset over HTTP.
        const { rows, pages, columns, hash, ...receipt } = result;
        return receipt;
      }
      if (operation === 'source.inspect')
        return captureView(await readDatasetteCapture(capturePath(input.operationId)), input);
      if (operation === 'source.review')
        return reviewDatasetteCapture(capturePath(input.operationId), { key: input.key ?? [], projection: input.projection });
      if (operation === 'editions.create') {
        const id = identifier(input.id, 'edition identifier'), file = capturePath(input.operationId);
        const review = await reviewDatasetteCapture(file, { key: input.key ?? [], projection: input.projection });
        if (!review.approved) throw fault('DATASETTE_SOURCE_REVIEW_REQUIRED', 'Review the complete key and column projection before saving this edition.', 409);
        const value = await createDatasetteEdition({ captureFile: file, directory: join(directory, 'editions', id),
          name: text(input.name, 'an edition name', 128), review, operationId: identifier(input.operationId) });
        return { id, editionFile: value.editionFile, editionSha256: value.editionSha256,
          edition: value.edition, review: value.review, ...captureView(value, input) };
      }
      if (operation === 'editions.list') return listEditions();
      if (operation === 'editions.inspect') {
        const value = await readDatasetteEdition(editionPath(input.id));
        return { id: input.id, editionFile: value.editionFile, editionSha256: value.editionSha256,
          edition: value.edition, review: value.review, ...captureView(value, input) };
      }
      if (operation === 'editions.compare')
        return compareDatasetteEditions(editionPath(input.left), editionPath(input.right));
      if (operation === 'source.select') {
        const prepared = await prepareSelection(input);
        await publisherTail; controller.signal.throwIfAborted();
        const currentHash = requests.selectionHash(await selected());
        if (currentHash !== prepared.beforeHash) throw fault('DATASETTE_SELECTION_CHANGED','The source choice changed while it was being prepared.',409);
        if (currentHash === prepared.declarationHash) return {...prepared.declaration,reused:true};
        await atomicJson(directory,'selected-source.json',prepared.declaration);
        return {...prepared.declaration,reused:false};
      }
      if (operation === 'source.export') {
        const outputFile = input.outputFile === undefined ?
          join(directory, 'exports', identifier(input.editionId) + '.datasette.json.gz') :
          absolute(input.outputFile, 'source export file');
        const result = await exportDatasetteEdition({ editionFile: editionPath(input.editionId), outputFile });
        if (outputFile.startsWith(directory + '/')) result.retainedFile = await files.inspect({ path: files.relativeName(outputFile), sha256: result.sha256 });
        return result;
      }
      if (operation === 'source.receive') {
        const destination = input.directory === undefined ?
          join(directory, 'editions', identifier(input.id ?? 'received-' + randomUUID())) :
          absolute(input.directory, 'received source directory');
        const value = await receiveDatasettePackage({ archiveFile: absolute(input.archiveFile, 'source archive file'),
          directory: destination, sha256: input.sha256 });
        return { directory: value.directory, archiveSha256: value.archiveSha256, reused: value.reused ?? false,
          files: value.files, editionFile: value.editionFile, editionSha256: value.editionSha256,
          edition: value.edition, review: value.review, ...captureView(value, input) };
      }
      if (operation === 'release.stage') {
        const { stageDatasetteRelease } = await import('./release.mjs');
        return stageDatasetteRelease({ ...input,
          releaseDirectory: input.releaseDirectory ?? join(directory, 'releases') });
      }
      return withPublisher(async value => {
        if (operation === 'publisher.status') return value.status(input);
        if (operation === 'publisher.source') return value.source();
        if (operation === 'publisher.target') return value.target();
        if (operation === 'publisher.plan') {
          const prepared = request?.prepared?.nativeInput ?? await preparePublisherPlan(value,input);
          return value.savePlan(prepared,input.requestId === undefined ? {} : { requestId: input.requestId });
        }
        if (operation === 'publisher.extract') {
          if (!UUID.test(input.runId ?? '')) throw fault('EXTRACTION_ID_INVALID', 'Retain an extraction UUID before starting this operation.');
          let existing;
          try { existing = value.run(input.runId); }
          catch (issue) { if (!['RUN_NOT_FOUND', 'PUBLISHER_RUN_NOT_FOUND'].includes(issue.code)) throw issue; }
          if (existing) {
            if (existing.plan !== Number(input.planId)) throw fault('DATASETTE_EXTRACTION_INPUT_CHANGED', 'This extraction belongs to another saved plan.', 409);
            return { run: existing, reused: true };
          }
          controller.signal.throwIfAborted();
          const started = value.startExtraction(Number(input.planId), { id: input.runId });
          active.cancel = () => value.cancel(started.id);
          return { run: await started.completion, reused: false };
        }
        if (operation === 'publisher.inspect') return value.inspect(input.runId, input.query);
        if (operation === 'publisher.review') {
          const { runId, ...review } = input; return value.review(runId, review);
        }
        if (operation === 'publisher.publish') {
          const existing = value.run(input.runId);
          if (existing.state === 'PUBLISHED' && existing.data.review?.id === input.reviewId)
            return { ...existing, reused: true };
          if (existing.state === 'PUBLICATION_UNKNOWN') {
            const recovered = await value.recover(input.runId);
            if (recovered.state === 'PUBLISHED') return { ...recovered, reused: true };
          }
          return value.publish(input.runId, input.reviewId);
        }
        if (operation === 'publisher.recover') return value.recover(input.runId);
        if (operation === 'publisher.buyer-offer') return value.buyerOffer(input.runId, input.query);
        if (operation === 'publisher.prepare-buyer') {
          const { runId, ...buyerInput } = input; return value.prepareBuyer(runId, buyerInput);
        }
        if (operation === 'release.prepare') {
          const { prepareDatasetteRelease } = await import('./release.mjs');
          return prepareDatasetteRelease({ ...input, publisher: value,
            outputDirectory: input.outputDirectory ?? join(directory, 'exports', 'release-' + identifier(input.runId)) });
        }
        throw fault('DATASETTE_OPERATION_UNKNOWN');
      });
    }

    async function dispatch(operation, input = {}) {
      ensureOpen();
      if (!known.has(operation) || !object(input)) throw fault('DATASETTE_OPERATION_INVALID');
      if (operation === 'operations.cancel') {
        if (!active || active.operationId !== input.operationId)
          throw fault('DATASETTE_OPERATION_NOT_ACTIVE', 'Read the current workspace operation before cancelling it.', 409);
        const current = active;
        current.controller.abort();
        if (current.cancel) await current.cancel();
        return { operationId: current.operationId, cancelling: true };
      }
      if (['operations.inspect','requests.inspect','requests.list'].includes(operation)) return execute(operation,input,new AbortController());
      return admitted(operation, input.requestId ?? input.operationId ?? input.runId ?? randomUUID(), async controller => {
        const writeSelection = async declaration => {
          await publisherTail; controller.signal.throwIfAborted(); ensureOpen();
          await atomicJson(directory, 'selected-source.json', declaration);
        };
        if (operation === 'source.select')
          await requests.settleSelections({readSelection:selected, writeSelection, signal:controller.signal});
        return requests.run(operation, input, {
          prepare:selectedInput => prepareRequest(operation, selectedInput),
          execute:request => execute(operation, request?.input ?? input, controller, request),
          readSelection:selected, writeSelection, signal:controller.signal,
        });
      });
    }
    async function admitted(operation, operationId, action) {
      ensureOpen();
      if (active) throw fault('DATASETTE_WORKSPACE_BUSY', 'The workspace is continuing ' + active.operation + '.', 409);
      const controller = new AbortController();
      const selectedOperation = { operation, operationId,
        startedAt: stamp(), controller, cancel: null, promise: null };
      active = selectedOperation;
      selectedOperation.promise = Promise.resolve().then(async () => {
        // Drain the original publisher queue before an archive, file intake or
        // source mutation uses this same workspace.
        await publisherTail;
        controller.signal.throwIfAborted();
        return action(controller);
      });
      try { return await selectedOperation.promise; }
      finally { if (active === selectedOperation) active = null; }
    }
    async function uploadStatus(input) {
      ensureOpen();
      return files.uploadStatus(input);
    }
    async function receiveUpload(input, stream) {
      if (!object(input) || !UUID.test(input.uploadId ?? '') ||
          !stream || typeof stream[Symbol.asyncIterator] !== 'function')
        throw fault('DATASETTE_UPLOAD_INPUT_INVALID', 'Use the original upload UUID and raw byte stream.');
      return admitted('files.upload', input.uploadId, async controller => {
        // Native HTTP streams must wake when their original operation is
        // cancelled, even while the peer has stopped sending the next byte.
        const stop = () => stream.destroy?.(controller.signal.reason);
        active.cancel = stop;
        controller.signal.addEventListener('abort', stop, {once:true});
        try { return await files.receiveUpload(input, stream, {signal:controller.signal}); }
        finally { controller.signal.removeEventListener('abort', stop); }
      });
    }
    async function close() {
      if (closing) return closing;
      closed = true; active?.controller.abort();
      closing = (async () => {
        if (active?.cancel) { try { await active.cancel(); } catch {} }
        try { await active?.promise; } catch {}
        try { await publisherTail; await files.close(); } finally { await releaseLock(); }
      })();
      return closing;
    }
    return Object.freeze({ directory, workspaceId: settings.workspaceId, status, operations, dispatch,
      uploadStatus, receiveUpload, close });
  } catch (issue) {
    try { await files?.close(); await publisher?.close(); } finally { await releaseLock(); }
    throw issue;
  }
}
