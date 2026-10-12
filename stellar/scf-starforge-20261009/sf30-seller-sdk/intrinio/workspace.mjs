// MIT. Intrinio application composition over the ORIGINAL Python workspace.
import { lstat, realpath, link, rm, open } from 'node:fs/promises';
import { dirname, resolve, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createWorkspace, openWorkspace, importWorkspace } from '../python/workspace/model.mjs';
import { startPythonWorkspace } from '../python/workspace/server.mjs';
import {
  INDEX_PATH, FILE_LIMIT, parseIndex, captureManifest, importCaptureInput, saveReviewInput, saveSelectionInput,
  reviewValidationInput, selectionValidationInput, comparisonValidationInput, saveComparisonInput, previewResult, operationOutcome, fail,
} from './public/data.mjs';

export const APPLICATION_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REQUIRED = ['list_editions', 'inspect_statement', 'compare_statements', 'validate_review',
  'validate_selection', 'validate_comparison', 'export_selection_json', 'export_selection_csv', 'export_selection_html',
  'inspect_fundamentals', 'build_fundamentals', 'customer_fundamentals'];
const pause = milliseconds => new Promise(done => setTimeout(done, milliseconds));

async function regular(path, maximum) {
  const handle = await open(path, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > maximum) throw fail('INTRINIO_FILE', 'Select a complete regular file within the original retained limit.');
    const bytes = await handle.readFile(), after = await handle.stat();
    if (bytes.length !== before.size || bytes.length > maximum || before.ino !== after.ino || before.mtimeMs !== after.mtimeMs || before.size !== after.size)
      throw fail('INTRINIO_FILE_CHANGED', 'The selected file changed while being read.');
    return bytes;
  } finally { await handle.close(); }
}
async function member(root, path) {
  const target = join(root, path), resolved = await realpath(target), delta = relative(root, resolved);
  if (isAbsolute(delta) || delta === '..' || delta.startsWith('../') || delta.startsWith('..\\') || (await lstat(target)).isSymbolicLink())
    throw fail('INTRINIO_MEMBER', 'A response member leaves the selected capture directory or is a symbolic link.');
  return regular(target, FILE_LIMIT);
}
function validateRevision(revision, index) {
  const files = new Map(revision.files.map(file => [file.path, file]));
  for (const edition of Object.values(index.editions)) {
    const file = files.get(edition.path);
    if (!file || file.sha256 !== edition.sha256 || file.bytes !== edition.bytes)
      throw fail('INTRINIO_REVISION_BINDING', 'A source revision no longer contains the exact body selected by its review index.');
  }
  return index;
}
export async function createIntrinioWorkspace(directory, {config, python, label = 'Intrinio statement review'} = {}) {
  directory = resolve(directory);
  const sourceConfig = config ? resolve(config) : join(APPLICATION_DIRECTORY, 'merchant.example.json');
  const declaration = JSON.parse((await regular(sourceConfig, 1024 * 1024)).toString('utf8'));
  if (!REQUIRED.every(name => declaration.functions?.[name]))
    throw fail('INTRINIO_DECLARATION', 'Use the complete Intrinio declaration; it preserves the complete original review function contracts.');
  const selectedApplication = await realpath(resolve(dirname(sourceConfig), declaration.application));
  const originalApplication = await realpath(join(APPLICATION_DIRECTORY, 'application.py'));
  if (selectedApplication !== originalApplication)
    throw fail('INTRINIO_APPLICATION', 'The selected declaration must point to this installed Intrinio application.py.');
  let native;
  try {
    native = await createWorkspace(directory, {config: sourceConfig, pythonRoot: APPLICATION_DIRECTORY, label});
    if (python !== undefined) {
      const revision = native.revision();
      const current = JSON.parse(revision.declarationText);
      await native.save({baseRevision: revision.id, expectedHead: revision.id,
        declarationText: JSON.stringify({...current, python}, null, 2) + '\n',
        note: 'Selected the local Python interpreter for Intrinio preview', files: [], remove: []});
    }
    const result = new IntrinioWorkspace(native);
    await result.state();
    return result;
  } catch (error) { await native?.close().catch(() => {}); throw error; }
}
export async function openIntrinioWorkspace(directory) {
  const native = await openWorkspace(resolve(directory));
  try { const workspace = new IntrinioWorkspace(native); await workspace.state(); return workspace; }
  catch (error) { await native.close(); throw error; }
}
export async function importIntrinioWorkspace(directory, bundle) {
  const native = await importWorkspace(resolve(directory), bundle);
  try { const workspace = new IntrinioWorkspace(native); await workspace.state(); return workspace; }
  catch (error) { await native.close(); throw error; }
}
export class IntrinioWorkspace {
  constructor(native) { this.native = native; this.directory = native.root; }
  async state(revisionId) {
    const native = await this.native.state();
    const revision = revisionId ? this.native.revision(revisionId) : native.revision;
    const index = validateRevision(revision, parseIndex(await this.native.file(revision.id, INDEX_PATH)));
    return {native, revision, index, historical: revision.id !== native.workspace.head};
  }
  async preview(name, input, {revisionId, operationId = 'intrinio-' + randomUUID(), signal, onProgress} = {}) {
    const revision = revisionId ?? this.native.metadata().head;
    let job = await this.native.preview({revisionId: revision, function: name, input, operationId});
    for (;;) {
      onProgress?.({id: job.id, status: job.status});
      if (!['QUEUED', 'RUNNING'].includes(job.status)) return job;
      if (signal?.aborted) {
        try { job = await this.native.cancelPreview({id: job.id}); }
        catch (error) {
          if (error.code !== 'PREVIEW_NOT_OWNED') throw error;
          job = await this.native.previewDetail(job.id);
        }
        throw Object.assign(new Error('The caller stopped waiting for the original preview.'), {code: 'INTRINIO_CANCELLED', preview: job});
      }
      await pause(250);
      job = await this.native.previewDetail(job.id);
    }
  }
  async importCapture(manifestPath, {actor, operationId = 'import-' + randomUUID(), expectedHead, externalCustody} = {}) {
    const state = await this.state(), path = resolve(manifestPath), root = await realpath(dirname(path));
    const manifest = await captureManifest(await regular(path, FILE_LIMIT));
    const existing = state.index.captures.find(item => item.id === manifest.id);
    const files = new Map();
    if (!existing) {
      const retained = new Map(state.revision.files.map(file => [file.path, file]));
      for (const row of manifest.responses) {
        const file = retained.get(row.path);
        if (!file || file.sha256 !== row.sha256 || file.bytes !== row.bytes)
          if (!files.has(row.path)) files.set(row.path, new Uint8Array(await member(root, row.path)));
      }
    }
    if (!existing) for (const row of manifest.sidecars ?? []) files.set(row.path, new Uint8Array(await member(root, row.path)));
    for (const row of manifest.originals) {
      if (state.revision.files.some(file => file.path === row.path && file.sha256 === row.sha256 && file.bytes === row.bytes) || files.has(row.path)) continue;
      if (row.bytes <= FILE_LIMIT) {
        try { files.set(row.path, new Uint8Array(await member(root, row.path))); }
        catch (error) { if (!externalCustody || error.code !== 'ENOENT') throw error; }
      }
    }
    const prepared = await importCaptureInput(state.revision, state.index, manifest, files,
      {actor, operationId, expectedHead: expectedHead ?? state.revision.id, externalCustody});
    if (prepared.reused) return {...prepared, currentRevision: state.revision.id};
    const revision = await this.native.save(prepared.input);
    return {result: prepared.result, revision, reused: false};
  }
  async review(command, {signal} = {}) {
    let state = await this.state();
    const old = operationOutcome(state.index, command.operationId);
    if (old) {
      const prepared = await saveReviewInput(state.revision, state.index, command, null);
      return {...prepared, currentRevision: state.revision.id};
    }
    const input = reviewValidationInput(state.index, command);
    const validation = await this.preview('validate_review', input, {revisionId: command.expectedHead,
      operationId: 'validate-' + command.operationId, signal});
    previewResult(validation);
    state = await this.state();
    const prepared = await saveReviewInput(state.revision, state.index, command, validation);
    if (prepared.reused) return {...prepared, currentRevision: state.revision.id};
    const revision = await this.native.save(prepared.input);
    return {result: prepared.result, revision, validationId: validation.id, reused: false};
  }
  async select(command, {signal} = {}) {
    let state = await this.state();
    if (operationOutcome(state.index, command.operationId)) {
      const prepared = await saveSelectionInput(state.revision, state.index, command, null);
      return {...prepared, currentRevision: state.revision.id};
    }
    const input = selectionValidationInput(state.index, command);
    const validation = await this.preview('validate_selection', input, {revisionId: command.expectedHead,
      operationId: 'validate-' + command.operationId, signal});
    previewResult(validation);
    state = await this.state();
    const prepared = await saveSelectionInput(state.revision, state.index, command, validation);
    if (prepared.reused) return {...prepared, currentRevision: state.revision.id};
    const revision = await this.native.save(prepared.input);
    return {result: prepared.result, revision, validationId: validation.id, reused: false};
  }
  async bindComparison(command, {signal} = {}) {
    let state = await this.state();
    if (operationOutcome(state.index, command.operationId)) {
      const prepared = await saveComparisonInput(state.revision, state.index, command, null);
      return {...prepared, currentRevision: state.revision.id};
    }
    const input = comparisonValidationInput(state.index, command);
    const validation = await this.preview('validate_comparison', input, {revisionId: command.expectedHead,
      operationId: 'validate-' + command.operationId, signal});
    previewResult(validation);
    state = await this.state();
    const prepared = await saveComparisonInput(state.revision, state.index, command, validation);
    if (prepared.reused) return {...prepared, currentRevision: state.revision.id};
    const revision = await this.native.save(prepared.input);
    return {result: prepared.result, revision, validationId: validation.id, reused: false};
  }
  async exportSelection(projectionId, format, destination, options = {}) {
    const names = {json: 'export_selection_json', csv: 'export_selection_csv', html: 'export_selection_html'};
    if (!names[format]) throw fail('INTRINIO_EXPORT_FORMAT', 'Choose json, csv or html.');
    const job = await this.preview(names[format], {projection_id: projectionId}, options);
    if (job.status !== 'COMPLETED') throw Object.assign(fail(job.error?.code ?? 'INTRINIO_EXPORT_FAILED', job.error?.message ?? 'The original export did not complete.'), {preview: job});
    if (format === 'json') previewResult(job);
    const output = await this.native.previewOutput(job.id);
    await writeNewOutput(destination, output.bytes);
    return {path: resolve(destination), bytes: output.bytes.length, sha256: output.sha256, previewId: job.id, status: job.status};
  }
  async exportWorkspace(destination) {
    const exported = await this.native.exportBundle();
    await writeNewOutput(destination, exported.bytes);
    return {path: resolve(destination), bytes: exported.bytes.length, sha256: exported.sha256, nativeFilename: exported.filename};
  }
  close() { return this.native.close(); }
}
export async function writeNewOutput(path, bytes) {
  path = resolve(path);
  const temporary = path + '.' + randomUUID() + '.tmp';
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await link(temporary, path);
    let directory;
    try { directory = await open(dirname(path), 'r'); await directory.sync(); }
    catch (error) { if (!['EINVAL', 'EPERM', 'EISDIR', 'ENOTSUP'].includes(error.code)) throw error; }
    finally { await directory?.close(); }
  } finally { await rm(temporary, {force: true}); }
}
export async function startIntrinioWorkspace(directory, {port = 0} = {}) {
  const workspace = typeof directory === 'string' ? await openIntrinioWorkspace(directory) : directory;
  const assets = [
    {path: '/intrinio', file: new URL('./public/index.html', import.meta.url), type: 'text/html; charset=utf-8'},
    {path: '/intrinio/app.mjs', file: new URL('./public/app.mjs', import.meta.url), type: 'text/javascript; charset=utf-8'},
    {path: '/intrinio/data.mjs', file: new URL('./public/data.mjs', import.meta.url), type: 'text/javascript; charset=utf-8'},
    {path: '/intrinio/style.css', file: new URL('./public/style.css', import.meta.url), type: 'text/css; charset=utf-8'},
  ];
  const server = await startPythonWorkspace(workspace.native, {port, operatorAssets: assets, operatorPath: '/intrinio'});
  return {...server, intrinio: workspace};
}
